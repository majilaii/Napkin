-- TICKET-196 B-0: image moderation control plane.
--
-- This migration is intentionally activation-inert.  Both enforcement and the
-- grandfather sweep remain OFF until the held B-2 migration is applied after
-- the fleet-update window.  All objects in this file are service-role-only.

-- Unmoderated bytes are never client-addressable.  The moderate-image Edge
-- function proxies writes into this private bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'image-staging',
    'image-staging',
    false,
    8388608,
    ARRAY['image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE public.moderation_config (
    key text PRIMARY KEY,
    enforce boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT moderation_config_known_key CHECK (
        key IN ('image_moderation', 'grandfather_sweep')
    )
);

INSERT INTO public.moderation_config (key, enforce)
VALUES ('image_moderation', false), ('grandfather_sweep', false)
ON CONFLICT (key) DO NOTHING;

-- Canonical Storage origins are data, not caller input.  Production is pinned;
-- the local origins keep replay/integration tests usable without weakening the
-- production comparison to a suffix-only check.
CREATE TABLE public.image_storage_origins (
    origin text PRIMARY KEY,
    environment text NOT NULL CHECK (environment IN ('production', 'local'))
);

INSERT INTO public.image_storage_origins (origin, environment)
VALUES
    ('https://ftvmseaqwwlcxtdlvxxz.supabase.co', 'production'),
    ('http://127.0.0.1:54321', 'local'),
    ('http://localhost:54321', 'local'),
    ('http://kong:8000', 'local')
ON CONFLICT (origin) DO NOTHING;

CREATE TABLE public.staging_reservations (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    user_id uuid NOT NULL,
    staging_path text NOT NULL UNIQUE,
    state text NOT NULL DEFAULT 'writing',
    generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
    lease_expires timestamptz NOT NULL,
    byte_count bigint CHECK (byte_count IS NULL OR byte_count >= 0),
    content_type text,
    failure_reason text,
    gc_claimed_by text,
    gc_lease_expires timestamptz,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    consumed_at timestamptz,
    CONSTRAINT staging_reservations_state_check CHECK (
        state IN ('writing', 'putting', 'staged', 'cleanup_required', 'write_failed', 'consumed')
    ),
    CONSTRAINT staging_reservations_path_check CHECK (
        staging_path = user_id::text || '/' || id::text
    )
);

CREATE INDEX staging_reservations_user_live_idx
    ON public.staging_reservations (user_id, state, created_at);
CREATE INDEX staging_reservations_gc_idx
    ON public.staging_reservations (state, lease_expires, created_at);

CREATE TABLE public.image_stage_budget (
    user_id uuid PRIMARY KEY,
    window_started_at timestamptz NOT NULL,
    used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.image_hash_verdicts (
    sha256 text PRIMARY KEY,
    verdict text NOT NULL CHECK (verdict IN ('pass', 'rejected')),
    likelihoods jsonb NOT NULL,
    provider_call_marker text,
    scanned_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT image_hash_verdicts_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.user_image_objects (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    user_id uuid NOT NULL,
    bucket text NOT NULL CHECK (bucket IN ('avatars', 'entry-photos')),
    storage_path text NOT NULL,
    public_url text NOT NULL,
    sha256 text NOT NULL,
    state text NOT NULL DEFAULT 'promoting',
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    bound_at timestamptz,
    promotion_lease_expires timestamptz,
    gc_claimed_by text,
    gc_lease_expires timestamptz,
    CONSTRAINT user_image_objects_state_check CHECK (
        state IN ('promoting', 'approved', 'gc_pending', 'deleting')
    ),
    CONSTRAINT user_image_objects_path_check CHECK (
        storage_path = 'approved/' || user_id::text || '/' || sha256 || '.jpg'
    ),
    CONSTRAINT user_image_objects_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    UNIQUE (bucket, storage_path),
    UNIQUE (bucket, public_url)
);

CREATE INDEX user_image_objects_user_state_idx
    ON public.user_image_objects (user_id, state, created_at);
CREATE INDEX user_image_objects_gc_idx
    ON public.user_image_objects (state, gc_lease_expires, created_at);
CREATE INDEX user_image_objects_sha_idx
    ON public.user_image_objects (sha256);

CREATE TABLE public.image_object_refs (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    object_id uuid NOT NULL REFERENCES public.user_image_objects(id) ON DELETE CASCADE,
    sink_kind text NOT NULL CHECK (sink_kind IN ('avatar', 'entry_photo', 'entry_hero')),
    sink_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    UNIQUE (sink_kind, sink_id)
);

CREATE INDEX image_object_refs_object_idx ON public.image_object_refs (object_id);

CREATE TABLE public.image_scan_leases (
    sha256 text PRIMARY KEY,
    owner text NOT NULL,
    fencing_token bigint NOT NULL DEFAULT 1 CHECK (fencing_token > 0),
    expires_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT image_scan_leases_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.image_compute_budget (
    scope text NOT NULL CHECK (scope IN ('user', 'project')),
    subject_id uuid NOT NULL,
    window_started_at timestamptz NOT NULL,
    used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    PRIMARY KEY (scope, subject_id)
);

CREATE TABLE public.image_scan_budget (
    scope text NOT NULL CHECK (scope IN ('user', 'general', 'sweep', 'canary')),
    subject_id uuid NOT NULL,
    utc_day date NOT NULL,
    used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    PRIMARY KEY (scope, subject_id, utc_day)
);

-- Paid provider-attempt ledger.  Errors are durable here but never enter the
-- terminal hash cache above.
CREATE TABLE public.image_moderation_ledger (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    user_id uuid NOT NULL,
    budget_scope text NOT NULL CHECK (budget_scope IN ('general', 'sweep', 'canary')),
    sha256 text,
    outcome text NOT NULL DEFAULT 'debited' CHECK (
        outcome IN ('debited', 'pass', 'rejected', 'provider_error', 'timeout')
    ),
    provider_call_marker text,
    error text,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    finished_at timestamptz,
    CONSTRAINT image_moderation_ledger_sha_check CHECK (
        sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'
    )
);

CREATE INDEX image_moderation_ledger_user_created_idx
    ON public.image_moderation_ledger (user_id, created_at DESC);

CREATE TABLE public.image_gc_queue (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    user_id uuid,
    reason text NOT NULL,
    sink_kind text CHECK (sink_kind IS NULL OR sink_kind IN ('avatar', 'entry_photo', 'entry_hero')),
    sink_id text,
    bucket text,
    path text,
    object_id uuid,
    state text NOT NULL DEFAULT 'pending' CHECK (
        state IN ('pending', 'claimed', 'deleting', 'done', 'failed')
    ),
    claimed_by text,
    lease_expires timestamptz,
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    last_error text,
    enqueued_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    completed_at timestamptz
);

CREATE INDEX image_gc_queue_claim_idx
    ON public.image_gc_queue (state, next_attempt_at, lease_expires, enqueued_at);
CREATE INDEX image_gc_queue_user_state_idx
    ON public.image_gc_queue (user_id, state, enqueued_at);

CREATE UNIQUE INDEX image_gc_queue_live_sink_idx
    ON public.image_gc_queue (sink_kind, sink_id)
    WHERE sink_kind IS NOT NULL AND sink_id IS NOT NULL
      AND state <> 'done';

-- Reconciliation is intentionally repeatable.  Keep at most one retryable
-- namespace-orphan deletion for a physical path while allowing a genuinely
-- recreated object to be enqueued after the prior deletion reached `done`.
CREATE UNIQUE INDEX image_gc_queue_live_namespace_orphan_idx
    ON public.image_gc_queue (bucket, path)
    WHERE reason = 'namespace_orphan' AND state <> 'done';

CREATE TABLE public.image_quarantine (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    user_id uuid NOT NULL,
    sink_kind text NOT NULL CHECK (sink_kind IN ('avatar', 'entry_photo', 'entry_hero')),
    sink_id text NOT NULL,
    original_url text NOT NULL,
    reason text NOT NULL,
    state text NOT NULL DEFAULT 'pending_review' CHECK (
        state IN ('pending_review', 'released', 'rejected')
    ),
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    reviewed_at timestamptz,
    UNIQUE (sink_kind, sink_id)
);

CREATE INDEX image_quarantine_user_idx ON public.image_quarantine (user_id, state);

CREATE TABLE public.image_moderation_notifications (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    user_id uuid NOT NULL,
    sink_kind text NOT NULL,
    sink_id text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('image_rejected')),
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    delivered_at timestamptz,
    UNIQUE (user_id, sink_kind, sink_id, kind)
);

-- Bridge moderation removals into the existing user-visible inbox.  The
-- service-only table above remains the audit/delivery ledger; notifications is
-- what the app actually reads.  Retries are once-only per exact owner + sink.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'friend_logged',
    'friend_pinned',
    'top_four_swap',
    'table_invite',
    'claim_city',
    'reservation_reminder',
    'import_done',
    'table_invite_accepted',
    'supper_set',
    'image_rejected'
));
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_image_rejected_shape;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_image_rejected_shape CHECK (
    kind <> 'image_rejected' OR (
        actor_user_id IS NULL
        AND subject_meta ? 'sink_kind'
        AND subject_meta ? 'sink_id'
        AND subject_meta ? 'reason'
    )
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_image_rejected_once_idx
    ON public.notifications (
        user_id,
        (subject_meta ->> 'sink_kind'),
        (subject_meta ->> 'sink_id')
    )
    WHERE kind = 'image_rejected';

CREATE TABLE public.job_leases (
    job_name text PRIMARY KEY,
    holder text,
    lease_expires timestamptz,
    fence_token bigint NOT NULL DEFAULT 0 CHECK (fence_token >= 0),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE public.job_runs (
    id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
    job_name text NOT NULL,
    incident_id uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
    holder text NOT NULL,
    fence_token bigint NOT NULL,
    started_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'failed')),
    items_processed integer NOT NULL DEFAULT 0 CHECK (items_processed >= 0),
    backlog_count bigint NOT NULL DEFAULT 0 CHECK (backlog_count >= 0),
    cursor text,
    error text,
    attempt integer NOT NULL DEFAULT 1 CHECK (attempt BETWEEN 1 AND 3),
    next_attempt_at timestamptz
);

CREATE INDEX job_runs_job_started_idx ON public.job_runs (job_name, started_at DESC);
CREATE INDEX job_runs_retry_idx ON public.job_runs (status, next_attempt_at);

CREATE TABLE public.email_outbox (
    idempotency_key text PRIMARY KEY,
    incident_id uuid NOT NULL,
    job_name text NOT NULL,
    alarm_kind text NOT NULL,
    to_addr text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    provider_idem_key text NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'claimed', 'sent', 'failed')),
    claimed_by text,
    claim_expires timestamptz,
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    sent_at timestamptz,
    last_error text,
    UNIQUE (job_name, incident_id, alarm_kind)
);

CREATE INDEX email_outbox_claim_idx
    ON public.email_outbox (state, next_attempt_at, claim_expires);

CREATE TABLE public.account_deletions (
    user_id uuid PRIMARY KEY,
    state text NOT NULL DEFAULT 'freezing' CHECK (
        state IN ('freezing', 'draining', 'inventoried', 'purging', 'auth_deleted', 'done')
    ),
    inventory jsonb NOT NULL DEFAULT '{}'::jsonb,
    quiesce_after timestamptz NOT NULL DEFAULT pg_catalog.now(),
    writer_zero_seen_at timestamptz,
    writer_zero_confirmed_at timestamptz,
    all_prefix_zero_seen_at timestamptz,
    all_prefix_zero_confirmed_at timestamptz,
    attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    last_error text,
    created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
    updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

-- Gatherings landed after the compliance-pack FK audit.  A host-owned
-- proposal must disappear with its host just like a hosted supper; otherwise
-- its default NO ACTION FK prevents Auth deletion after the profile cascade.
ALTER TABLE public.gatherings
        DROP CONSTRAINT gatherings_host_user_id_fkey,
        ADD CONSTRAINT gatherings_host_user_id_fkey
        FOREIGN KEY (host_user_id) REFERENCES public.profiles(user_id)
        ON DELETE CASCADE;

-- Every control-plane table is service-only.  RLS is deliberately enabled but
-- not forced: the postgres-owned narrow trigger functions below must be able to
-- enqueue while client roles remain deny-all.
ALTER TABLE public.moderation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_storage_origins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staging_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_stage_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_hash_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_image_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_object_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_scan_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_compute_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_scan_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_moderation_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_gc_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.image_moderation_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.moderation_config,
    public.image_storage_origins,
    public.staging_reservations,
    public.image_stage_budget,
    public.image_hash_verdicts,
    public.user_image_objects,
    public.image_object_refs,
    public.image_scan_leases,
    public.image_compute_budget,
    public.image_scan_budget,
    public.image_moderation_ledger,
    public.image_gc_queue,
    public.image_quarantine,
    public.image_moderation_notifications,
    public.job_leases,
    public.job_runs,
    public.email_outbox,
    public.account_deletions
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
    public.moderation_config,
    public.image_storage_origins,
    public.staging_reservations,
    public.image_stage_budget,
    public.image_hash_verdicts,
    public.user_image_objects,
    public.image_object_refs,
    public.image_scan_leases,
    public.image_compute_budget,
    public.image_scan_budget,
    public.image_moderation_ledger,
    public.image_gc_queue,
    public.image_quarantine,
    public.image_moderation_notifications,
    public.job_leases,
    public.job_runs,
    public.email_outbox,
    public.account_deletions
TO service_role;

-- One transaction-scoped lifecycle fence is shared by staging, promotion,
-- binding, GC/reconciliation, grandfather repair, and account deletion.  It is
-- never used as a multi-request job lock.
CREATE OR REPLACE FUNCTION public.fn_lock_image_lifecycle(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 196::bigint)
    );
$fn$;

-- B-0 keeps the two legacy own-folder Storage writers available to old
-- clients.  Derive the subject from the JWT (never a caller argument), then
-- share the lifecycle xact lock with freeze so a legacy Storage commit is
-- ordered wholly before the tombstone or rejected wholly after it.
CREATE OR REPLACE FUNCTION public.fn_allow_legacy_image_storage_insert()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;
    PERFORM public.fn_lock_image_lifecycle(v_user_id);
    RETURN NOT EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = v_user_id
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_allow_legacy_image_storage_insert()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_allow_legacy_image_storage_insert()
    TO authenticated, service_role;

-- Preserve the exact legacy path predicates and policy names (the held B-2
-- migration drops those names), adding only the permanent tombstone fence.
-- Both ALTERs are one statement-level transaction for db-push replay safety.
DO $legacy_storage_policies$
BEGIN
    EXECUTE $policy$
        ALTER POLICY "Authenticated upload own folder avatars"
        ON storage.objects
        WITH CHECK (
            bucket_id = 'avatars'
            AND (storage.foldername(name))[1] = auth.uid()::text
            AND public.fn_allow_legacy_image_storage_insert()
        )
    $policy$;
    EXECUTE $policy$
        ALTER POLICY "Authenticated upload own folder entry-photos"
        ON storage.objects
        WITH CHECK (
            bucket_id = 'entry-photos'
            AND (storage.foldername(name))[1] = auth.uid()::text
            AND public.fn_allow_legacy_image_storage_insert()
        )
    $policy$;
END;
$legacy_storage_policies$;

-- tables.owner_id intentionally remains NO ACTION because ownership must be
-- transferred or the Table deleted by the account saga.  Serialize every new
-- owner assignment with freeze so no Table can appear behind the first release
-- pass and permanently block the profiles/Auth cascade.
CREATE OR REPLACE FUNCTION public.trg_tables_account_deletion_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF NEW.owner_id IS NULL THEN
        RAISE EXCEPTION 'invalid_table_owner' USING ERRCODE = '23502';
    END IF;
    PERFORM public.fn_lock_image_lifecycle(NEW.owner_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = NEW.owner_id
    ) THEN
        RAISE EXCEPTION 'account_deleting' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_tables_account_deletion_guard()
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_tables_account_deletion_guard()
    TO service_role;

DROP TRIGGER IF EXISTS tables_account_deletion_guard ON public.tables;
CREATE TRIGGER tables_account_deletion_guard
BEFORE INSERT OR UPDATE OF owner_id ON public.tables
FOR EACH ROW EXECUTE FUNCTION public.trg_tables_account_deletion_guard();

CREATE OR REPLACE FUNCTION public.fn_record_image_rejection(
    p_user_id uuid,
    p_sink_kind text,
    p_sink_id text,
    p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_payload jsonb;
BEGIN
    IF p_sink_kind NOT IN ('avatar', 'entry_photo', 'entry_hero')
       OR p_sink_id IS NULL OR p_reason IS NULL THEN
        RAISE EXCEPTION 'invalid_image_rejection' USING ERRCODE = '22023';
    END IF;
    v_payload := pg_catalog.jsonb_build_object(
        'sink_kind', p_sink_kind,
        'sink_id', p_sink_id,
        'reason', p_reason
    );
    INSERT INTO public.image_moderation_notifications (
        user_id, sink_kind, sink_id, kind, payload
    ) VALUES (
        p_user_id, p_sink_kind, p_sink_id, 'image_rejected', v_payload
    ) ON CONFLICT (user_id, sink_kind, sink_id, kind) DO NOTHING;

    -- auth.users may already be gone on a defensive cleanup retry; the
    -- FK-backed inbox row is then intentionally skipped.
    IF EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
        INSERT INTO public.notifications (
            user_id, kind, actor_user_id, subject_text, subject_meta
        ) VALUES (
            p_user_id, 'image_rejected', NULL,
            'One of your photos was removed.', v_payload
        ) ON CONFLICT DO NOTHING;
    END IF;
    RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_begin_stage(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_id uuid := extensions.gen_random_uuid();
    v_path text;
    v_used integer;
    v_live integer;
    v_project_count bigint;
    v_project_bytes numeric;
    v_row public.staging_reservations;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
    END IF;

    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'account_deleting' USING ERRCODE = '55000';
    END IF;

    INSERT INTO public.image_stage_budget (user_id, window_started_at, used)
    VALUES (p_user_id, pg_catalog.clock_timestamp(), 0)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE public.image_stage_budget b
    SET window_started_at = CASE
            WHEN b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour'
                THEN pg_catalog.clock_timestamp()
            ELSE b.window_started_at
        END,
        used = CASE
            WHEN b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour' THEN 1
            ELSE b.used + 1
        END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE b.user_id = p_user_id
      AND (
          b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour'
          OR b.used < 10
      )
    RETURNING used INTO v_used;

    IF v_used IS NULL THEN
        RAISE EXCEPTION 'staging_rate_exhausted' USING ERRCODE = 'P0001';
    END IF;

    SELECT pg_catalog.count(*) INTO v_live
    FROM public.staging_reservations r
    WHERE r.user_id = p_user_id
      AND r.state IN ('writing', 'putting', 'staged');
    IF v_live >= 50 THEN
        RAISE EXCEPTION 'staging_quota_exhausted' USING ERRCODE = 'P0001';
    END IF;

    SELECT pg_catalog.count(*), COALESCE(pg_catalog.sum(r.byte_count), 0)
    INTO v_project_count, v_project_bytes
    FROM public.staging_reservations r
    WHERE r.state IN ('writing', 'putting', 'staged');
    IF v_project_count >= 10000 OR v_project_bytes >= 2147483648 THEN
        RAISE EXCEPTION 'staging_project_ceiling' USING ERRCODE = 'P0001';
    END IF;

    v_path := p_user_id::text || '/' || v_id::text;
    INSERT INTO public.staging_reservations (
        id, user_id, staging_path, state, generation, lease_expires
    ) VALUES (
        v_id, p_user_id, v_path, 'writing', 1,
        pg_catalog.clock_timestamp() + interval '300 seconds'
    ) RETURNING * INTO v_row;

    RETURN pg_catalog.jsonb_build_object(
        'reservation_id', v_row.id,
        'staging_path', v_row.staging_path,
        'generation', v_row.generation,
        'state', v_row.state,
        'lease_expires', v_row.lease_expires
    );
END;
$fn$;

-- Round-5 generation-consuming byte-arrival fence.  A successful claim moves
-- writing -> putting, increments the generation, and renews a full 300s lease.
CREATE OR REPLACE FUNCTION public.fn_claim_stage_put(
    p_user_id uuid,
    p_staging_path text,
    p_generation bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_row public.staging_reservations;
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);

    UPDATE public.staging_reservations r
    SET state = 'putting',
        generation = r.generation + 1,
        lease_expires = pg_catalog.clock_timestamp() + interval '300 seconds',
        updated_at = pg_catalog.clock_timestamp()
    WHERE r.user_id = p_user_id
      AND r.staging_path = p_staging_path
      AND r.generation = p_generation
      AND r.state = 'writing'
      AND r.lease_expires > pg_catalog.clock_timestamp()
      AND NOT EXISTS (
          SELECT 1 FROM public.account_deletions d
          WHERE d.user_id = p_user_id
      )
    RETURNING r.* INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'stage_claim_conflict' USING ERRCODE = '40001';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'reservation_id', v_row.id,
        'staging_path', v_row.staging_path,
        'generation', v_row.generation,
        'state', v_row.state,
        'lease_expires', v_row.lease_expires
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finish_stage(
    p_user_id uuid,
    p_staging_path text,
    p_generation bigint,
    p_succeeded boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_tombstoned boolean;
    v_size bigint;
    v_mime text;
    v_row public.staging_reservations;
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    v_tombstoned := EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id
    );

    SELECT NULLIF(o.metadata ->> 'size', '')::bigint, o.metadata ->> 'mimetype'
    INTO v_size, v_mime
    FROM storage.objects o
    WHERE o.bucket_id = 'image-staging' AND o.name = p_staging_path;

    UPDATE public.staging_reservations r
    SET state = CASE
            WHEN v_tombstoned THEN 'cleanup_required'
            WHEN NOT COALESCE(p_succeeded, false) THEN 'write_failed'
            WHEN v_size IS NULL OR v_size > 5242880 THEN 'cleanup_required'
            ELSE 'staged'
        END,
        byte_count = v_size,
        content_type = v_mime,
        failure_reason = CASE
            WHEN v_tombstoned THEN 'account_deleting'
            WHEN NOT COALESCE(p_succeeded, false) THEN 'storage_write_failed'
            WHEN v_size IS NULL THEN 'storage_object_missing'
            WHEN v_size > 5242880 THEN 'byte_limit_exceeded'
            ELSE NULL
        END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE r.user_id = p_user_id
      AND r.staging_path = p_staging_path
      AND r.generation = p_generation
      AND r.state = 'putting'
    RETURNING r.* INTO v_row;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'stage_finish_conflict' USING ERRCODE = '40001';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'reservation_id', v_row.id,
        'staging_path', v_row.staging_path,
        'generation', v_row.generation,
        'state', v_row.state,
        'byte_count', v_row.byte_count,
        'cleanup_required', v_row.state = 'cleanup_required'
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_mark_stage_write_failed(
    p_user_id uuid,
    p_staging_path text,
    p_generation bigint,
    p_reason text DEFAULT 'storage_write_failed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_row public.staging_reservations;
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    UPDATE public.staging_reservations r
    SET state = CASE WHEN EXISTS (
            SELECT 1 FROM public.account_deletions d
            WHERE d.user_id = p_user_id
        ) THEN 'cleanup_required' ELSE 'write_failed' END,
        failure_reason = pg_catalog.left(COALESCE(p_reason, 'storage_write_failed'), 500),
        updated_at = pg_catalog.clock_timestamp()
    WHERE r.user_id = p_user_id
      AND r.staging_path = p_staging_path
      AND r.generation = p_generation
      AND r.state IN ('writing', 'putting')
    RETURNING r.* INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'stage_finish_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN pg_catalog.to_jsonb(v_row);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_assert_stage_moderatable(
    p_user_id uuid,
    p_staging_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_row public.staging_reservations;
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'account_deleting' USING ERRCODE = '55000';
    END IF;
    SELECT r.* INTO v_row
    FROM public.staging_reservations r
    WHERE r.user_id = p_user_id
      AND r.staging_path = p_staging_path
      AND r.state = 'staged'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'stage_not_moderatable' USING ERRCODE = 'P0001';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'reservation_id', v_row.id,
        'staging_path', v_row.staging_path,
        'generation', v_row.generation,
        'state', v_row.state,
        'byte_count', v_row.byte_count,
        'content_type', v_row.content_type
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_mark_stage_consumed(
    p_user_id uuid,
    p_staging_path text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    UPDATE public.staging_reservations r
    SET state = 'consumed', consumed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE r.user_id = p_user_id AND r.staging_path = p_staging_path
      AND r.state IN ('staged', 'cleanup_required');
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_debit_image_compute(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_project uuid := '00000000-0000-0000-0000-000000000000'::uuid;
    v_user_used integer;
    v_project_used integer;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
    END IF;
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'account_deleting' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.image_compute_budget (scope, subject_id, window_started_at, used)
    VALUES
        ('user', p_user_id, pg_catalog.clock_timestamp(), 0),
        ('project', v_project, pg_catalog.clock_timestamp(), 0)
    ON CONFLICT (scope, subject_id) DO NOTHING;

    UPDATE public.image_compute_budget b
    SET window_started_at = CASE WHEN b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour'
            THEN pg_catalog.clock_timestamp() ELSE b.window_started_at END,
        used = CASE WHEN b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour'
            THEN 1 ELSE b.used + 1 END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE b.scope = 'user' AND b.subject_id = p_user_id
      AND (b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour' OR b.used < 30)
    RETURNING b.used INTO v_user_used;
    IF v_user_used IS NULL THEN
        RAISE EXCEPTION 'compute_user_cap_exhausted' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.image_compute_budget b
    SET window_started_at = CASE WHEN b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour'
            THEN pg_catalog.clock_timestamp() ELSE b.window_started_at END,
        used = CASE WHEN b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour'
            THEN 1 ELSE b.used + 1 END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE b.scope = 'project' AND b.subject_id = v_project
      AND (b.window_started_at <= pg_catalog.clock_timestamp() - interval '1 hour' OR b.used < 2000)
    RETURNING b.used INTO v_project_used;
    IF v_project_used IS NULL THEN
        RAISE EXCEPTION 'compute_project_cap_exhausted' USING ERRCODE = 'P0001';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'user_used', v_user_used, 'user_cap', 30,
        'project_used', v_project_used, 'project_cap', 2000,
        'window_seconds', 3600
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_debit_scan_budget(
    p_user_id uuid,
    p_scope text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_project uuid := '00000000-0000-0000-0000-000000000000'::uuid;
    v_day date := (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date;
    v_pool_cap integer;
    v_user_used integer;
    v_pool_used integer;
    v_ledger_id uuid;
BEGIN
    IF p_scope NOT IN ('general', 'sweep', 'canary') THEN
        RAISE EXCEPTION 'invalid_scan_scope' USING ERRCODE = '22023';
    END IF;
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'invalid_user' USING ERRCODE = '22023';
    END IF;

    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'account_deleting' USING ERRCODE = '55000';
    END IF;

    IF p_scope = 'general' THEN
        INSERT INTO public.image_scan_budget (scope, subject_id, utc_day, used)
        VALUES ('user', p_user_id, v_day, 0)
        ON CONFLICT (scope, subject_id, utc_day) DO NOTHING;
        UPDATE public.image_scan_budget b
        SET used = b.used + 1, updated_at = pg_catalog.clock_timestamp()
        WHERE b.scope = 'user' AND b.subject_id = p_user_id AND b.utc_day = v_day
          AND b.used < 20
        RETURNING b.used INTO v_user_used;
        IF v_user_used IS NULL THEN
            RAISE EXCEPTION 'scan_user_cap_exhausted' USING ERRCODE = 'P0001';
        END IF;
        v_pool_cap := 395;
    ELSIF p_scope = 'sweep' THEN
        v_pool_cap := 100;
    ELSE
        v_pool_cap := 5;
    END IF;

    INSERT INTO public.image_scan_budget (scope, subject_id, utc_day, used)
    VALUES (p_scope, v_project, v_day, 0)
    ON CONFLICT (scope, subject_id, utc_day) DO NOTHING;
    UPDATE public.image_scan_budget b
    SET used = b.used + 1, updated_at = pg_catalog.clock_timestamp()
    WHERE b.scope = p_scope AND b.subject_id = v_project AND b.utc_day = v_day
      AND b.used < v_pool_cap
    RETURNING b.used INTO v_pool_used;
    IF v_pool_used IS NULL THEN
        RAISE EXCEPTION 'scan_project_cap_exhausted' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.image_moderation_ledger (user_id, budget_scope)
    VALUES (p_user_id, p_scope)
    RETURNING id INTO v_ledger_id;

    RETURN pg_catalog.jsonb_build_object(
        'ledger_id', v_ledger_id,
        'scope', p_scope,
        'user_used', v_user_used,
        'user_cap', CASE WHEN p_scope = 'general' THEN 20 ELSE NULL END,
        'pool_used', v_pool_used,
        'pool_cap', v_pool_cap,
        'global_cap', 500,
        'utc_day', v_day
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_record_scan_result(
    p_ledger_id uuid,
    p_sha256 text,
    p_outcome text,
    p_provider_call_marker text DEFAULT NULL,
    p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF p_outcome NOT IN ('pass', 'rejected', 'provider_error', 'timeout') THEN
        RAISE EXCEPTION 'invalid_scan_outcome' USING ERRCODE = '22023';
    END IF;
    UPDATE public.image_moderation_ledger l
    SET sha256 = p_sha256,
        outcome = p_outcome,
        provider_call_marker = p_provider_call_marker,
        error = pg_catalog.left(p_error, 2000),
        finished_at = pg_catalog.clock_timestamp()
    WHERE l.id = p_ledger_id AND l.outcome = 'debited';
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_acquire_scan_lease(
    p_sha256 text,
    p_owner text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_row public.image_scan_leases;
BEGIN
    INSERT INTO public.image_scan_leases (sha256, owner, fencing_token, expires_at)
    VALUES (p_sha256, p_owner, 1, pg_catalog.clock_timestamp() + interval '60 seconds')
    ON CONFLICT (sha256) DO UPDATE
    SET owner = EXCLUDED.owner,
        fencing_token = public.image_scan_leases.fencing_token + 1,
        expires_at = pg_catalog.clock_timestamp() + interval '60 seconds',
        updated_at = pg_catalog.clock_timestamp()
    WHERE public.image_scan_leases.expires_at < pg_catalog.clock_timestamp()
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'scan_lease_busy' USING ERRCODE = '55P03';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'acquired', true,
        'sha256', v_row.sha256,
        'owner', v_row.owner,
        'fencing_token', v_row.fencing_token,
        'expires_at', v_row.expires_at
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_release_scan_lease(
    p_sha256 text,
    p_owner text,
    p_fencing_token bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    DELETE FROM public.image_scan_leases l
    WHERE l.sha256 = p_sha256 AND l.owner = p_owner
      AND l.fencing_token = p_fencing_token
      AND l.expires_at > pg_catalog.clock_timestamp();
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_commit_image_verdict_locked(
    p_sha256 text,
    p_verdict text,
    p_likelihoods jsonb,
    p_owner text,
    p_fencing_token bigint,
    p_provider_call_marker text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_locked boolean;
BEGIN
    IF p_verdict NOT IN ('pass', 'rejected') THEN
        RAISE EXCEPTION 'invalid_terminal_verdict' USING ERRCODE = '22023';
    END IF;
    SELECT true INTO v_locked
    FROM public.image_scan_leases l
    WHERE l.sha256 = p_sha256 AND l.owner = p_owner
      AND l.fencing_token = p_fencing_token
      AND l.expires_at > pg_catalog.clock_timestamp()
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('committed', false);
    END IF;

    INSERT INTO public.image_hash_verdicts (
        sha256, verdict, likelihoods, provider_call_marker, scanned_at
    ) VALUES (
        p_sha256, p_verdict, COALESCE(p_likelihoods, '{}'::jsonb),
        p_provider_call_marker, pg_catalog.clock_timestamp()
    ) ON CONFLICT (sha256) DO NOTHING;

    DELETE FROM public.image_scan_leases l
    WHERE l.sha256 = p_sha256 AND l.owner = p_owner
      AND l.fencing_token = p_fencing_token
      AND l.expires_at > pg_catalog.clock_timestamp();
    RETURN pg_catalog.jsonb_build_object('committed', FOUND);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_commit_image_verdict(
    p_sha256 text,
    p_owner text,
    p_fencing_token bigint,
    p_verdict text,
    p_likelihoods jsonb,
    p_provider_call_marker text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT public.fn_commit_image_verdict_locked(
        p_sha256,
        p_verdict,
        p_likelihoods,
        p_owner,
        p_fencing_token,
        p_provider_call_marker
    );
$fn$;

-- Edge-facing order is kept explicit so PostgREST cannot confuse the fencing
-- token with verdict text.  The six-argument implementation above remains
-- available to the canary, which records a provider marker on the verdict.
CREATE OR REPLACE FUNCTION public.fn_commit_image_verdict(
    p_sha256 text,
    p_owner text,
    p_fencing_token bigint,
    p_verdict text,
    p_likelihoods jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT public.fn_commit_image_verdict_locked(
        p_sha256,
        p_verdict,
        p_likelihoods,
        p_owner,
        p_fencing_token,
        NULL
    );
$fn$;

-- The promotion-time deletion check is deliberately repeated here, under the
-- lifecycle lock, after scanning and immediately before registry/copy work.
CREATE OR REPLACE FUNCTION public.fn_begin_image_promotion(
    p_user_id uuid,
    p_bucket text,
    p_sha256 text,
    p_public_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_path text;
    v_row public.user_image_objects;
    v_orphan_queue public.image_gc_queue;
    v_inserted boolean := false;
BEGIN
    IF p_bucket NOT IN ('avatars', 'entry-photos') THEN
        RAISE EXCEPTION 'invalid_destination_bucket' USING ERRCODE = '22023';
    END IF;
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'account_deleting' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.image_hash_verdicts v
        WHERE v.sha256 = p_sha256 AND v.verdict = 'pass'
    ) THEN
        RAISE EXCEPTION 'image_not_approved' USING ERRCODE = 'P0001';
    END IF;
    v_path := 'approved/' || p_user_id::text || '/' || p_sha256 || '.jpg';
    IF p_public_url IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.image_storage_origins s
        WHERE p_public_url = s.origin || '/storage/v1/object/public/' || p_bucket || '/' || v_path
    ) THEN
        RAISE EXCEPTION 'invalid_public_url' USING ERRCODE = '22023';
    END IF;

    -- Serialize promotion with orphan discovery/consumption for the same
    -- physical path.  Pending discovery is cancelled before registry insert;
    -- once a worker has claimed/deleting work, promotion retries only after
    -- that Storage delete reaches its durable terminal row.
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_bucket || ':' || v_path, 197::bigint)
    );
    SELECT q.* INTO v_orphan_queue
    FROM public.image_gc_queue q
    WHERE q.reason = 'namespace_orphan' AND q.bucket = p_bucket
      AND q.path = v_path AND q.state <> 'done'
    FOR UPDATE;
    IF FOUND AND v_orphan_queue.state IN ('claimed', 'deleting') THEN
        RAISE EXCEPTION 'promotion_orphan_delete_in_flight' USING ERRCODE = '40001';
    ELSIF FOUND THEN
        UPDATE public.image_gc_queue q
        SET state = 'done', completed_at = pg_catalog.clock_timestamp(),
            claimed_by = NULL, lease_expires = NULL,
            last_error = 'cancelled_by_promotion'
        WHERE q.id = v_orphan_queue.id;
    END IF;

    INSERT INTO public.user_image_objects (
        user_id, bucket, storage_path, public_url, sha256, state,
        promotion_lease_expires
    ) VALUES (
        p_user_id, p_bucket, v_path, p_public_url, p_sha256, 'promoting',
        pg_catalog.clock_timestamp() + interval '430 seconds'
    ) ON CONFLICT (bucket, storage_path) DO NOTHING
    RETURNING * INTO v_row;
    IF FOUND THEN
        v_inserted := true;
    ELSE
        SELECT o.* INTO v_row
        FROM public.user_image_objects o
        WHERE o.bucket = p_bucket AND o.storage_path = v_path
          AND o.user_id = p_user_id AND o.sha256 = p_sha256
        FOR UPDATE;
        IF NOT FOUND OR v_row.state NOT IN ('promoting', 'approved') THEN
            RAISE EXCEPTION 'promotion_conflict' USING ERRCODE = '40001';
        END IF;
        IF v_row.state = 'promoting' THEN
            -- A retry starts a fresh approved-Storage attempt.  Refresh the
            -- durable deadline under the row lock; created_at is not an
            -- attempt clock and may be arbitrarily old.
            UPDATE public.user_image_objects o
            SET promotion_lease_expires = pg_catalog.clock_timestamp()
                    + interval '430 seconds'
            WHERE o.id = v_row.id
            RETURNING o.* INTO v_row;
        END IF;
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'object_id', v_row.id,
        'storage_path', v_row.storage_path,
        'public_url', v_row.public_url,
        'state', v_row.state,
        'needs_copy', v_inserted OR v_row.state = 'promoting'
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finish_image_promotion(
    p_user_id uuid,
    p_object_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_row public.user_image_objects;
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'account_deleting' USING ERRCODE = '55000';
    END IF;
    UPDATE public.user_image_objects o
    SET state = 'approved', promotion_lease_expires = NULL,
        gc_claimed_by = NULL, gc_lease_expires = NULL
    WHERE o.id = p_object_id AND o.user_id = p_user_id AND o.state = 'promoting'
    RETURNING o.* INTO v_row;
    IF NOT FOUND THEN
        SELECT o.* INTO v_row FROM public.user_image_objects o
        WHERE o.id = p_object_id AND o.user_id = p_user_id AND o.state = 'approved';
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promotion_finish_conflict' USING ERRCODE = '40001';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'object_id', v_row.id,
        'storage_path', v_row.storage_path,
        'public_url', v_row.public_url,
        'state', v_row.state
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.trg_entry_photos_gc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_user_id uuid;
BEGIN
    SELECT o.user_id INTO v_user_id
    FROM public.image_object_refs r
    JOIN public.user_image_objects o ON o.id = r.object_id
    WHERE r.sink_kind = 'entry_photo' AND r.sink_id = OLD.id::text;
    IF v_user_id IS NULL THEN
        SELECT e.user_id INTO v_user_id
        FROM public.entries e WHERE e.id = OLD.entry_id;
    END IF;
    INSERT INTO public.image_gc_queue (
        user_id, reason, sink_kind, sink_id, bucket, path
    )
    VALUES (
        v_user_id, 'entry_photo_delete', 'entry_photo', OLD.id::text,
        'entry-photos', OLD.photo_url
    )
    ON CONFLICT (sink_kind, sink_id)
        WHERE sink_kind IS NOT NULL AND sink_id IS NOT NULL
          AND state <> 'done'
        DO NOTHING;
    RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS entry_photos_after_delete_gc ON public.entry_photos;
CREATE TRIGGER entry_photos_after_delete_gc
AFTER DELETE ON public.entry_photos
FOR EACH ROW EXECUTE FUNCTION public.trg_entry_photos_gc();

CREATE OR REPLACE FUNCTION public.trg_entries_hero_gc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF OLD.photo_url IS NOT NULL THEN
        INSERT INTO public.image_gc_queue (
            user_id, reason, sink_kind, sink_id, bucket, path
        )
        VALUES (
            OLD.user_id, 'entry_hero_delete', 'entry_hero', OLD.id::text,
            'entry-photos', OLD.photo_url
        )
        ON CONFLICT (sink_kind, sink_id)
            WHERE sink_kind IS NOT NULL AND sink_id IS NOT NULL
              AND state <> 'done'
            DO NOTHING;
    END IF;
    RETURN OLD;
END;
$fn$;

-- Capture child-photo ownership before an entries cascade makes the parent
-- unavailable to the entry_photos AFTER DELETE trigger.  The child trigger
-- remains the deletion guarantee; this row only supplies durable user_id so
-- account cleanup can cancel cascade-created work after Auth deletion.
CREATE OR REPLACE FUNCTION public.trg_entries_photo_owner_gc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    INSERT INTO public.image_gc_queue (
        user_id, reason, sink_kind, sink_id, bucket, path
    )
    SELECT OLD.user_id, 'entry_photo_delete', 'entry_photo', ep.id::text,
           'entry-photos', ep.photo_url
    FROM public.entry_photos ep
    WHERE ep.entry_id = OLD.id
    ON CONFLICT (sink_kind, sink_id)
        WHERE sink_kind IS NOT NULL AND sink_id IS NOT NULL
          AND state <> 'done'
    DO UPDATE SET user_id = COALESCE(public.image_gc_queue.user_id, EXCLUDED.user_id);
    RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS entries_before_delete_photo_owner_gc ON public.entries;
CREATE TRIGGER entries_before_delete_photo_owner_gc
BEFORE DELETE ON public.entries
FOR EACH ROW EXECUTE FUNCTION public.trg_entries_photo_owner_gc();

DROP TRIGGER IF EXISTS entries_after_delete_hero_gc ON public.entries;
CREATE TRIGGER entries_after_delete_hero_gc
AFTER DELETE ON public.entries
FOR EACH ROW EXECUTE FUNCTION public.trg_entries_hero_gc();

-- Function privilege closure.  PUBLIC is explicit because CREATE FUNCTION
-- grants PUBLIC EXECUTE by default even when anon/authenticated are revoked.
REVOKE ALL ON FUNCTION public.fn_lock_image_lifecycle(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_record_image_rejection(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_begin_stage(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_stage_put(uuid, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_stage(uuid, text, bigint, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mark_stage_write_failed(uuid, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_assert_stage_moderatable(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mark_stage_consumed(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_debit_image_compute(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_debit_scan_budget(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_record_scan_result(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_acquire_scan_lease(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_release_scan_lease(text, text, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_commit_image_verdict_locked(text, text, jsonb, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_commit_image_verdict(text, text, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_commit_image_verdict(text, text, bigint, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_begin_image_promotion(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_image_promotion(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_entry_photos_gc() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_entries_hero_gc() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_entries_photo_owner_gc() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_begin_stage(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_image_rejection(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_stage_put(uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_stage(uuid, text, bigint, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_stage_write_failed(uuid, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_assert_stage_moderatable(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_stage_consumed(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_debit_image_compute(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_debit_scan_budget(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_scan_result(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_acquire_scan_lease(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_release_scan_lease(text, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_commit_image_verdict_locked(text, text, jsonb, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_commit_image_verdict(text, text, bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_commit_image_verdict(text, text, bigint, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_begin_image_promotion(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_image_promotion(uuid, uuid) TO service_role;

COMMENT ON TABLE public.staging_reservations IS
    'TICKET-196: server-proxied staging saga. claim consumes generation; putting lease is 300s.';
COMMENT ON TABLE public.user_image_objects IS
    'TICKET-196: physical approved-object registry; storage_path is distinct from sink public_url.';
COMMENT ON TABLE public.email_outbox IS
    'TICKET-196: at-least-once ops alerts; Resend keys only suppress duplicates within provider TTL.';
