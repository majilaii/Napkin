-- TICKET-196 B-0: fenced GC/job workers and durable account-deletion freeze.

CREATE OR REPLACE FUNCTION public.fn_claim_gc_queue(
    p_worker text,
    p_batch integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_rows jsonb;
BEGIN
    IF p_worker IS NULL OR pg_catalog.btrim(p_worker) = '' THEN
        RAISE EXCEPTION 'invalid_worker' USING ERRCODE = '22023';
    END IF;
    WITH candidates AS (
        SELECT q.id
        FROM public.image_gc_queue q
        WHERE q.next_attempt_at <= pg_catalog.clock_timestamp()
          AND (
              q.state IN ('pending', 'failed')
              OR (q.state IN ('claimed', 'deleting') AND q.lease_expires < pg_catalog.clock_timestamp())
          )
        ORDER BY q.enqueued_at, q.id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, LEAST(COALESCE(p_batch, 25), 100))
    ), claimed AS (
        UPDATE public.image_gc_queue q
        SET state = 'claimed',
            claimed_by = p_worker,
            lease_expires = pg_catalog.clock_timestamp() + interval '300 seconds',
            attempt = q.attempt + 1,
            last_error = NULL
        FROM candidates c
        WHERE q.id = c.id
          AND q.next_attempt_at <= pg_catalog.clock_timestamp()
          AND (
              q.state IN ('pending', 'failed')
              OR (q.state IN ('claimed', 'deleting')
                  AND q.lease_expires < pg_catalog.clock_timestamp())
          )
        RETURNING q.*
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(claimed)), '[]'::jsonb)
    INTO v_rows FROM claimed;
    RETURN v_rows;
END;
$fn$;

-- Exact ref unlink is fenced by the queue claim.  Shared objects finish here;
-- last refs advance the queue to deleting and are claimed separately below.
CREATE OR REPLACE FUNCTION public.fn_unlink_gc_ref(
    p_queue_id uuid,
    p_worker text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_q public.image_gc_queue;
    v_object_id uuid;
    v_refs integer;
    v_legacy_path text;
    v_public_marker text;
BEGIN
    SELECT q.* INTO v_q
    FROM public.image_gc_queue q
    WHERE q.id = p_queue_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'gc_queue_claim_lost' USING ERRCODE = '40001';
    END IF;
    -- Queue consumers and reconciliation can both touch the queue, exact ref,
    -- registry row, and visible sink.  Take the owner's lifecycle fence before
    -- any of those locks so neither path can hold queue -> wait on ref while the
    -- other holds ref -> waits on queue.  Namespace-orphan path fencing follows
    -- lifecycle, matching promotion's lifecycle -> physical-path order.
    IF v_q.user_id IS NOT NULL THEN
        PERFORM public.fn_lock_image_lifecycle(v_q.user_id);
    END IF;
    IF v_q.reason = 'namespace_orphan' THEN
        -- Promotion and orphan consumption share path -> queue lock order.
        -- The advisory lock spans the registry recheck + deleting transition;
        -- promotion then observes `deleting` until the external delete finishes.
        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(v_q.bucket || ':' || v_q.path, 197::bigint)
        );
    END IF;

    SELECT q.* INTO v_q
    FROM public.image_gc_queue q
    WHERE q.id = p_queue_id AND q.state = 'claimed'
      AND q.claimed_by = p_worker AND q.lease_expires > pg_catalog.clock_timestamp()
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'gc_queue_claim_lost' USING ERRCODE = '40001';
    END IF;

    -- An orphan finding is only a discovery snapshot.  Promotion may have
    -- registered (and even bound) this exact path before queue consumption;
    -- in that case cancel the stale work without touching refs or advancing
    -- the object into immediate GC (the ordinary 48h unbound rule still owns
    -- any genuinely abandoned approved object).
    IF v_q.reason = 'namespace_orphan' AND EXISTS (
        SELECT 1 FROM public.user_image_objects o
        WHERE o.bucket = v_q.bucket AND o.storage_path = v_q.path
    ) THEN
        UPDATE public.image_gc_queue q
        SET state = 'done', completed_at = pg_catalog.clock_timestamp(),
            claimed_by = NULL, lease_expires = NULL,
            last_error = 'cancelled_registry_restored'
        WHERE q.id = p_queue_id;
        RETURN pg_catalog.jsonb_build_object(
            'queue_id', p_queue_id, 'cancelled_registry_restored', true,
            'claimable', false
        );
    END IF;

    v_object_id := v_q.object_id;
    IF v_q.sink_kind IS NOT NULL AND v_q.sink_id IS NOT NULL THEN
        DELETE FROM public.image_object_refs r
        WHERE r.sink_kind = v_q.sink_kind AND r.sink_id = v_q.sink_id
        RETURNING r.object_id INTO v_object_id;
    END IF;
    IF v_object_id IS NULL AND v_q.path IS NOT NULL THEN
        SELECT o.id INTO v_object_id
        FROM public.user_image_objects o
        WHERE o.bucket = v_q.bucket
          AND (o.public_url = v_q.path OR o.storage_path = v_q.path)
        FOR UPDATE;
    END IF;

    IF v_object_id IS NULL THEN
        -- Defense in depth before handing a raw path to the service-role
        -- Storage worker.  A deleted sink may contain any legacy string, so
        -- require an unambiguous project-key spelling owned by the durable
        -- queue user. Encoded separators/dot segments are terminal no-ops.
        v_public_marker := '/storage/v1/object/public/' || v_q.bucket || '/';
        v_legacy_path := v_q.path;
        IF pg_catalog.strpos(COALESCE(v_legacy_path, ''), '://') > 0 THEN
            IF pg_catalog.strpos(v_legacy_path, v_public_marker) = 0
               OR v_legacy_path ~ '[?#]' THEN
                v_legacy_path := NULL;
            ELSE
                v_legacy_path := pg_catalog.substr(
                    v_legacy_path,
                    pg_catalog.strpos(v_legacy_path, v_public_marker)
                        + pg_catalog.length(v_public_marker)
                );
            END IF;
        END IF;
        IF v_q.bucket NOT IN ('avatars', 'entry-photos')
           OR v_q.user_id IS NULL
           OR v_legacy_path IS NULL OR v_legacy_path = ''
           OR v_legacy_path LIKE '/%'
           OR pg_catalog.strpos(v_legacy_path, pg_catalog.chr(92)) > 0
           OR v_legacy_path LIKE '%//%'
           OR v_legacy_path ~* '%(2f|5c|2e)'
           OR ('/' || v_legacy_path || '/') LIKE '%/./%'
           OR ('/' || v_legacy_path || '/') LIKE '%/../%'
           OR NOT (
                pg_catalog.split_part(v_legacy_path, '/', 1) = v_q.user_id::text
                OR (
                    pg_catalog.split_part(v_legacy_path, '/', 1) = 'approved'
                    AND pg_catalog.split_part(v_legacy_path, '/', 2) = v_q.user_id::text
                )
           ) THEN
            UPDATE public.image_gc_queue q
            SET state = 'done', completed_at = pg_catalog.clock_timestamp(),
                claimed_by = NULL, lease_expires = NULL,
                last_error = 'unsafe_or_cross_owner_legacy_path'
            WHERE q.id = p_queue_id AND q.claimed_by = p_worker;
            RETURN pg_catalog.jsonb_build_object(
                'queue_id', p_queue_id, 'object_id', NULL,
                'unsafe_legacy_path', true, 'claimable', false
            );
        END IF;

        -- Legacy URLs are not registry-backed and can be shared by several
        -- historical sinks. Compare both the raw value and the canonical
        -- bucket-relative/public-URL identity before authorizing deletion.
        IF EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.avatar_url = v_q.path OR p.avatar_url = v_legacy_path
               OR pg_catalog.right(
                    p.avatar_url,
                    pg_catalog.length(v_public_marker || v_legacy_path)
                  ) = v_public_marker || v_legacy_path
        ) OR EXISTS (
            SELECT 1 FROM public.entries e
            WHERE e.photo_url = v_q.path OR e.photo_url = v_legacy_path
               OR pg_catalog.right(
                    e.photo_url,
                    pg_catalog.length(v_public_marker || v_legacy_path)
                  ) = v_public_marker || v_legacy_path
        ) OR EXISTS (
            SELECT 1 FROM public.entry_photos ep
            WHERE ep.photo_url = v_q.path OR ep.photo_url = v_legacy_path
               OR pg_catalog.right(
                    ep.photo_url,
                    pg_catalog.length(v_public_marker || v_legacy_path)
                  ) = v_public_marker || v_legacy_path
        ) THEN
            UPDATE public.image_gc_queue q
            SET state = 'pending', claimed_by = NULL, lease_expires = NULL,
                next_attempt_at = pg_catalog.clock_timestamp() + interval '15 minutes',
                last_error = 'legacy_path_still_referenced'
            WHERE q.id = p_queue_id AND q.claimed_by = p_worker;
            RETURN pg_catalog.jsonb_build_object(
                'queue_id', p_queue_id, 'object_id', NULL,
                'deferred_shared_legacy', true, 'claimable', false
            );
        END IF;
        -- Legacy path: the Edge worker deletes the raw Storage object, then calls
        -- fn_finish_gc_queue.  No registry row exists to fence.
        UPDATE public.image_gc_queue q
        SET state = 'deleting', object_id = NULL
        WHERE q.id = p_queue_id;
        RETURN pg_catalog.jsonb_build_object(
            'queue_id', p_queue_id, 'object_id', NULL,
            'legacy_path', v_legacy_path, 'claimable', false
        );
    END IF;

    SELECT pg_catalog.count(*) INTO v_refs
    FROM public.image_object_refs r WHERE r.object_id = v_object_id;
    UPDATE public.image_gc_queue q
    SET object_id = v_object_id,
        state = CASE WHEN v_refs = 0 THEN 'deleting' ELSE 'done' END,
        completed_at = CASE WHEN v_refs = 0 THEN NULL ELSE pg_catalog.clock_timestamp() END,
        claimed_by = CASE WHEN v_refs = 0 THEN q.claimed_by ELSE NULL END,
        lease_expires = CASE WHEN v_refs = 0 THEN q.lease_expires ELSE NULL END
    WHERE q.id = p_queue_id;

    RETURN pg_catalog.jsonb_build_object(
        'queue_id', p_queue_id,
        'object_id', v_object_id,
        'remaining_refs', v_refs,
        'claimable', v_refs = 0
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_claim_image_object_gc(
    p_object_id uuid,
    p_worker text,
    p_reason text DEFAULT 'gc'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_row public.user_image_objects;
    v_user_id uuid;
BEGIN
    -- Learn the lifecycle-lock key without first taking the object lock.  All
    -- bind/promotion/deletion paths use lifecycle -> object ordering, avoiding
    -- a deadlock while making the account tombstone a true claim fence.
    SELECT o.user_id INTO v_user_id
    FROM public.user_image_objects o
    WHERE o.id = p_object_id;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('claimed', false, 'missing', true);
    END IF;
    PERFORM public.fn_lock_image_lifecycle(v_user_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d WHERE d.user_id = v_user_id
    ) THEN
        RETURN pg_catalog.jsonb_build_object('claimed', false, 'account_deleting', true);
    END IF;

    SELECT o.* INTO v_row
    FROM public.user_image_objects o
    WHERE o.id = p_object_id AND o.user_id = v_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN pg_catalog.jsonb_build_object('claimed', false, 'missing', true);
    END IF;
    IF EXISTS (SELECT 1 FROM public.image_object_refs r WHERE r.object_id = p_object_id) THEN
        RETURN pg_catalog.jsonb_build_object('claimed', false, 'has_refs', true);
    END IF;
    IF v_row.state = 'deleting'
       AND v_row.gc_lease_expires >= pg_catalog.clock_timestamp() THEN
        RETURN pg_catalog.jsonb_build_object('claimed', false, 'busy', true);
    END IF;
    IF v_row.state NOT IN ('approved', 'gc_pending', 'deleting') THEN
        RETURN pg_catalog.jsonb_build_object('claimed', false, 'state', v_row.state);
    END IF;

    -- Preserve the specified approved -> gc_pending -> deleting transition in
    -- this row-locked transaction.  Binders serialize on the same object row.
    IF v_row.state = 'approved' THEN
        UPDATE public.user_image_objects o SET state = 'gc_pending'
        WHERE o.id = p_object_id;
    END IF;
    UPDATE public.user_image_objects o
    SET state = 'deleting',
        gc_claimed_by = p_worker,
        gc_lease_expires = pg_catalog.clock_timestamp() + interval '300 seconds'
    WHERE o.id = p_object_id
    RETURNING o.* INTO v_row;

    RETURN pg_catalog.jsonb_build_object(
        'claimed', true,
        'object_id', v_row.id,
        'bucket', v_row.bucket,
        'storage_path', v_row.storage_path,
        'reason', p_reason,
        'lease_expires', v_row.gc_lease_expires
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finish_image_object_gc(
    p_object_id uuid,
    p_worker text,
    p_success boolean,
    p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF COALESCE(p_success, false) THEN
        DELETE FROM public.user_image_objects o
        WHERE o.id = p_object_id AND o.state = 'deleting'
          AND o.gc_claimed_by = p_worker
          AND o.gc_lease_expires > pg_catalog.clock_timestamp();
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE public.image_gc_queue q
        SET state = 'done', completed_at = pg_catalog.clock_timestamp(),
            claimed_by = NULL, lease_expires = NULL
        WHERE q.object_id = p_object_id AND q.claimed_by = p_worker
          AND q.state = 'deleting';
        RETURN true;
    END IF;

    UPDATE public.user_image_objects o
    SET state = 'gc_pending', gc_claimed_by = NULL, gc_lease_expires = NULL
    WHERE o.id = p_object_id AND o.state = 'deleting'
      AND o.gc_claimed_by = p_worker
      AND o.gc_lease_expires > pg_catalog.clock_timestamp();
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE public.image_gc_queue q
    SET state = 'failed', claimed_by = NULL, lease_expires = NULL,
        last_error = pg_catalog.left(p_error, 2000),
        next_attempt_at = pg_catalog.clock_timestamp()
            + pg_catalog.make_interval(secs => LEAST(86400, 300 * (2 ^ LEAST(q.attempt, 8))::integer))
    WHERE q.object_id = p_object_id AND q.claimed_by = p_worker;
    RETURN true;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finish_gc_queue(
    p_queue_id uuid,
    p_worker text,
    p_success boolean,
    p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    UPDATE public.image_gc_queue q
    SET state = CASE WHEN p_success THEN 'done' ELSE 'failed' END,
        completed_at = CASE WHEN p_success THEN pg_catalog.clock_timestamp() ELSE NULL END,
        claimed_by = NULL,
        lease_expires = NULL,
        last_error = CASE WHEN p_success THEN NULL ELSE pg_catalog.left(p_error, 2000) END,
        next_attempt_at = CASE WHEN p_success THEN q.next_attempt_at
            ELSE pg_catalog.clock_timestamp()
              + pg_catalog.make_interval(secs => LEAST(86400, 300 * (2 ^ LEAST(q.attempt, 8))::integer))
        END
    WHERE q.id = p_queue_id AND q.claimed_by = p_worker
      AND q.state IN ('claimed', 'deleting')
      AND q.lease_expires > pg_catalog.clock_timestamp();
    RETURN FOUND;
END;
$fn$;

-- Shared fenced job harness.  The lease token is bumped on every acquisition;
-- no advisory lock is used for multi-RPC work.
CREATE OR REPLACE FUNCTION public.fn_claim_moderation_job(
    p_job_name text,
    p_holder text,
    p_lease_seconds integer,
    p_to_addr text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_lease public.job_leases;
    v_previous public.job_runs;
    v_run public.job_runs;
    v_incident uuid;
    v_attempt integer;
    v_retry_at timestamptz;
    v_resume_cursor text;
    v_alarm_key text;
BEGIN
    IF p_holder IS NULL OR pg_catalog.btrim(p_holder) = '' THEN
        RAISE EXCEPTION 'invalid_holder' USING ERRCODE = '22023';
    END IF;
    IF p_job_name NOT IN (
        'grandfather', 'gc_staging', 'gc_unbound', 'gc_refdriven',
        'reconcile', 'account_cleanup', 'ops-alarm', 'alarm_selftest'
    ) THEN
        RAISE EXCEPTION 'unknown_job' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.job_leases (job_name, holder, lease_expires, fence_token)
    VALUES (
        p_job_name, p_holder,
        pg_catalog.clock_timestamp()
            + pg_catalog.make_interval(secs => GREATEST(30, COALESCE(p_lease_seconds, 300))),
        1
    )
    ON CONFLICT (job_name) DO UPDATE
    SET holder = EXCLUDED.holder,
        lease_expires = EXCLUDED.lease_expires,
        fence_token = public.job_leases.fence_token + 1,
        updated_at = pg_catalog.clock_timestamp()
    WHERE public.job_leases.lease_expires IS NULL
       OR public.job_leases.lease_expires < pg_catalog.clock_timestamp()
    RETURNING * INTO v_lease;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    -- The newest run is the only state that can drive this acquisition.  In
    -- particular, do not rediscover an older failed run after a newer retry
    -- succeeded, and do not silently abandon a running row whose lease died.
    SELECT r.* INTO v_previous
    FROM public.job_runs r
    WHERE r.job_name = p_job_name
    ORDER BY r.started_at DESC, r.id DESC
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
        IF v_previous.status = 'running' THEN
            -- Acquiring the singleton lease proves the prior fence expired (or
            -- was released abnormally).  Terminalize that orphan before any
            -- replacement may start, preserving its incident for the retry.
            v_retry_at := pg_catalog.clock_timestamp()
                + pg_catalog.make_interval(
                    hours => LEAST(24, 6 * (2 ^ (v_previous.attempt - 1))::integer)
                );
            UPDATE public.job_runs r
            SET status = 'failed',
                finished_at = pg_catalog.clock_timestamp(),
                error = 'lease_expired',
                next_attempt_at = v_retry_at
            WHERE r.id = v_previous.id AND r.status = 'running'
            RETURNING r.* INTO v_previous;

            -- A lease crash can itself exhaust attempt three.  Escalation is
            -- written in this same transaction so there is no terminal-run ->
            -- outbox crash gap.
            IF v_previous.attempt >= 3 THEN
                IF p_to_addr IS NULL OR pg_catalog.strpos(p_to_addr, '@') < 2 THEN
                    RAISE EXCEPTION 'invalid_alert_email' USING ERRCODE = '22023';
                END IF;
                v_alarm_key := v_previous.job_name || ':'
                    || v_previous.incident_id::text || ':retry_exhausted';
                INSERT INTO public.email_outbox (
                    idempotency_key, incident_id, job_name, alarm_kind,
                    to_addr, subject, body, provider_idem_key
                ) VALUES (
                    v_alarm_key, v_previous.incident_id, v_previous.job_name,
                    'retry_exhausted', p_to_addr,
                    'Napkin moderation job exhausted retries: ' || v_previous.job_name,
                    'Incident ' || v_previous.incident_id::text
                        || ' ended when attempt 3 lost its fenced lease.',
                    v_alarm_key
                ) ON CONFLICT (idempotency_key) DO NOTHING;
            END IF;

            UPDATE public.job_leases l
            SET holder = NULL, lease_expires = NULL, updated_at = pg_catalog.clock_timestamp()
            WHERE l.job_name = p_job_name AND l.holder = p_holder
              AND l.fence_token = v_lease.fence_token;
            RETURN NULL;
        END IF;

        IF v_previous.status = 'failed'
           AND v_previous.next_attempt_at > pg_catalog.clock_timestamp() THEN
            UPDATE public.job_leases l
            SET holder = NULL, lease_expires = NULL, updated_at = pg_catalog.clock_timestamp()
            WHERE l.job_name = p_job_name AND l.holder = p_holder
              AND l.fence_token = v_lease.fence_token;
            RETURN NULL;
        END IF;

        IF v_previous.status = 'failed' AND v_previous.attempt < 3 THEN
            v_incident := v_previous.incident_id;
            v_attempt := v_previous.attempt + 1;
        ELSE
            -- A successful run, or a fully exhausted incident whose final
            -- backoff elapsed, starts a new independently alarmed incident.
            v_incident := extensions.gen_random_uuid();
            v_attempt := 1;
        END IF;
    ELSE
        v_incident := extensions.gen_random_uuid();
        v_attempt := 1;
    END IF;

    SELECT r.cursor INTO v_resume_cursor
    FROM public.job_runs r
    WHERE r.job_name = p_job_name AND r.status = 'ok'
    ORDER BY r.finished_at DESC, r.id DESC
    LIMIT 1;

    INSERT INTO public.job_runs (
        job_name, incident_id, holder, fence_token, attempt, status, cursor
    ) VALUES (
        p_job_name, v_incident, p_holder, v_lease.fence_token, v_attempt, 'running',
        v_resume_cursor
    ) RETURNING * INTO v_run;

    RETURN pg_catalog.jsonb_build_object(
        'fence_token', v_lease.fence_token,
        'run_id', v_run.id,
        'incident_id', v_run.incident_id,
        'attempt', v_run.attempt,
        'cursor', v_resume_cursor,
        'lease_expires', v_lease.lease_expires
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_renew_moderation_job(
    p_job_name text,
    p_holder text,
    p_fence_token bigint,
    p_run_id uuid,
    p_lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    UPDATE public.job_leases l
    SET lease_expires = pg_catalog.clock_timestamp()
            + pg_catalog.make_interval(secs => GREATEST(30, COALESCE(p_lease_seconds, 300))),
        updated_at = pg_catalog.clock_timestamp()
    WHERE l.job_name = p_job_name AND l.holder = p_holder
      AND l.fence_token = p_fence_token
      AND l.lease_expires > pg_catalog.clock_timestamp()
      AND EXISTS (
          SELECT 1 FROM public.job_runs r
          WHERE r.id = p_run_id AND r.job_name = p_job_name
            AND r.holder = p_holder AND r.fence_token = p_fence_token
            AND r.status = 'running'
      );
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_complete_moderation_job(
    p_job_name text,
    p_holder text,
    p_fence_token bigint,
    p_run_id uuid,
    p_items_processed integer,
    p_cursor text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    UPDATE public.job_runs r
    SET status = 'ok', finished_at = pg_catalog.clock_timestamp(),
        items_processed = GREATEST(0, COALESCE(p_items_processed, 0)),
        cursor = p_cursor, error = NULL, next_attempt_at = NULL
    WHERE r.id = p_run_id AND r.job_name = p_job_name
      AND r.holder = p_holder AND r.fence_token = p_fence_token
      AND r.status = 'running'
      AND EXISTS (
          SELECT 1 FROM public.job_leases l
          WHERE l.job_name = p_job_name AND l.holder = p_holder
            AND l.fence_token = p_fence_token
            AND l.lease_expires > pg_catalog.clock_timestamp()
      );
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE public.job_leases l
    SET holder = NULL, lease_expires = NULL, updated_at = pg_catalog.clock_timestamp()
    WHERE l.job_name = p_job_name AND l.holder = p_holder
      AND l.fence_token = p_fence_token;
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_fail_moderation_job(
    p_job_name text,
    p_holder text,
    p_fence_token bigint,
    p_run_id uuid,
    p_error text,
    p_next_attempt_at timestamptz,
    p_to_addr text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_run public.job_runs;
    v_alarm_key text;
BEGIN
    UPDATE public.job_runs r
    SET status = 'failed', finished_at = pg_catalog.clock_timestamp(),
        error = pg_catalog.left(p_error, 4000),
        next_attempt_at = COALESCE(
            p_next_attempt_at,
            pg_catalog.clock_timestamp() + pg_catalog.make_interval(hours => LEAST(24, 6 * (2 ^ (r.attempt - 1))::integer))
        )
    WHERE r.id = p_run_id AND r.job_name = p_job_name
      AND r.holder = p_holder AND r.fence_token = p_fence_token
      AND r.status = 'running'
      AND EXISTS (
          SELECT 1 FROM public.job_leases l
          WHERE l.job_name = p_job_name AND l.holder = p_holder
            AND l.fence_token = p_fence_token
            AND l.lease_expires > pg_catalog.clock_timestamp()
      )
    RETURNING r.* INTO v_run;
    IF NOT FOUND THEN RETURN false; END IF;

    IF v_run.attempt >= 3 THEN
        IF p_to_addr IS NULL OR pg_catalog.strpos(p_to_addr, '@') < 2 THEN
            RAISE EXCEPTION 'invalid_alert_email' USING ERRCODE = '22023';
        END IF;
        v_alarm_key := v_run.job_name || ':' || v_run.incident_id::text
            || ':retry_exhausted';
        INSERT INTO public.email_outbox (
            idempotency_key, incident_id, job_name, alarm_kind,
            to_addr, subject, body, provider_idem_key
        ) VALUES (
            v_alarm_key, v_run.incident_id, v_run.job_name,
            'retry_exhausted', p_to_addr,
            'Napkin moderation job exhausted retries: ' || v_run.job_name,
            'Incident ' || v_run.incident_id::text || ' failed attempt 3: '
                || pg_catalog.left(COALESCE(p_error, 'unknown error'), 2000),
            v_alarm_key
        ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    UPDATE public.job_leases l
    SET holder = NULL, lease_expires = NULL, updated_at = pg_catalog.clock_timestamp()
    WHERE l.job_name = p_job_name AND l.holder = p_holder
      AND l.fence_token = p_fence_token;
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_job_alarm(
    p_run_id uuid,
    p_alarm_kind text,
    p_to_addr text,
    p_subject text,
    p_body text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_run public.job_runs;
    v_key text;
BEGIN
    SELECT r.* INTO v_run FROM public.job_runs r WHERE r.id = p_run_id;
    IF NOT FOUND OR v_run.status <> 'failed' OR v_run.attempt < 3 THEN
        RETURN false;
    END IF;
    v_key := v_run.job_name || ':' || v_run.incident_id::text || ':' || p_alarm_kind;
    INSERT INTO public.email_outbox (
        idempotency_key, incident_id, job_name, alarm_kind,
        to_addr, subject, body, provider_idem_key
    ) VALUES (
        v_key, v_run.incident_id, v_run.job_name, p_alarm_kind,
        p_to_addr, p_subject, p_body, v_key
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_freeze_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_quiesce timestamptz;
    v_paths jsonb;
    v_row public.account_deletions;
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);

    -- Bound every operation that could still cause bytes to arrive after the
    -- tombstone.  A staged reservation may be in a currently-running moderate
    -- request, a durable promoting row may be paused around the approved PUT,
    -- and a pre-freeze GC worker may still own a Storage delete.  New claims
    -- take this lifecycle lock and observe the permanent tombstone below.
    SELECT pg_catalog.max(x.deadline)
    INTO v_quiesce
    FROM (
        SELECT r.created_at + interval '730 seconds' AS deadline
        FROM public.staging_reservations r
        WHERE r.user_id = p_user_id
          AND r.state IN ('writing', 'putting', 'staged')
        UNION ALL
        SELECT COALESCE(
            o.promotion_lease_expires,
            o.created_at + interval '430 seconds'
        )
        FROM public.user_image_objects o
        WHERE o.user_id = p_user_id AND o.state = 'promoting'
        UNION ALL
        SELECT o.gc_lease_expires
        FROM public.user_image_objects o
        WHERE o.user_id = p_user_id AND o.state = 'deleting'
          AND o.gc_lease_expires IS NOT NULL
    ) x;
    v_quiesce := COALESCE(v_quiesce, pg_catalog.clock_timestamp());

    SELECT COALESCE(
        pg_catalog.jsonb_agg(r.staging_path ORDER BY r.created_at),
        '[]'::jsonb
    ) INTO v_paths
    FROM public.staging_reservations r
    WHERE r.user_id = p_user_id;

    INSERT INTO public.account_deletions (
        user_id, state, quiesce_after, next_attempt_at, created_at, updated_at
    ) VALUES (
        p_user_id, 'freezing', v_quiesce, pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET quiesce_after = GREATEST(public.account_deletions.quiesce_after, EXCLUDED.quiesce_after),
        updated_at = pg_catalog.clock_timestamp()
    RETURNING * INTO v_row;

    -- Invalidate both pre-fence writing and post-fence putting handlers.  The
    -- generation bump makes every not-yet-claimed writer fail; a handler paused
    -- after a successful claim is caught by the durable quiescence + final list.
    UPDATE public.staging_reservations r
    SET generation = CASE
            WHEN r.state IN ('writing', 'putting') THEN r.generation + 1
            ELSE r.generation
        END,
        state = 'cleanup_required',
        failure_reason = 'account_deleting',
        updated_at = pg_catalog.clock_timestamp()
    WHERE r.user_id = p_user_id
      AND r.state IN ('writing', 'putting', 'staged', 'write_failed', 'consumed');

    UPDATE public.account_deletions d
    SET state = CASE WHEN d.state = 'freezing' THEN 'draining' ELSE d.state END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE d.user_id = p_user_id
    RETURNING * INTO v_row;

    RETURN pg_catalog.to_jsonb(v_row) || pg_catalog.jsonb_build_object('staging_paths', v_paths);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_record_account_deletion_zero(
    p_user_id uuid,
    p_scope text,
    p_is_empty boolean,
    p_poll_interval_seconds integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_row public.account_deletions;
BEGIN
    IF p_scope NOT IN ('writer', 'all_prefix') THEN
        RAISE EXCEPTION 'invalid_zero_scope' USING ERRCODE = '22023';
    END IF;
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF p_scope = 'writer' THEN
        UPDATE public.account_deletions d
        SET writer_zero_seen_at = CASE
                WHEN NOT p_is_empty THEN NULL
                WHEN d.writer_zero_seen_at IS NULL THEN pg_catalog.clock_timestamp()
                ELSE d.writer_zero_seen_at END,
            writer_zero_confirmed_at = CASE
                WHEN NOT p_is_empty THEN NULL
                WHEN d.writer_zero_seen_at IS NOT NULL
                 AND d.writer_zero_seen_at <= pg_catalog.clock_timestamp()
                    - pg_catalog.make_interval(secs => GREATEST(1, p_poll_interval_seconds))
                    THEN pg_catalog.clock_timestamp()
                ELSE d.writer_zero_confirmed_at END,
            updated_at = pg_catalog.clock_timestamp()
        WHERE d.user_id = p_user_id AND d.state = 'draining'
        RETURNING * INTO v_row;
    ELSE
        UPDATE public.account_deletions d
        SET all_prefix_zero_seen_at = CASE
                WHEN NOT p_is_empty THEN NULL
                WHEN d.all_prefix_zero_seen_at IS NULL THEN pg_catalog.clock_timestamp()
                ELSE d.all_prefix_zero_seen_at END,
            all_prefix_zero_confirmed_at = CASE
                WHEN NOT p_is_empty THEN NULL
                WHEN d.all_prefix_zero_seen_at IS NOT NULL
                 AND d.all_prefix_zero_seen_at <= pg_catalog.clock_timestamp()
                    - pg_catalog.make_interval(secs => GREATEST(1, p_poll_interval_seconds))
                    THEN pg_catalog.clock_timestamp()
                ELSE d.all_prefix_zero_confirmed_at END,
            updated_at = pg_catalog.clock_timestamp()
        WHERE d.user_id = p_user_id AND d.state = 'purging'
        RETURNING * INTO v_row;
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'account_deletion_not_found' USING ERRCODE = 'P0001';
    END IF;
    RETURN pg_catalog.to_jsonb(v_row);
END;
$fn$;

-- After the durable writer/Edge bounds and writer-prefix stable-zero, account
-- deletion takes ownership of every nonterminal registry object.  The Edge
-- saga deletes the returned physical paths, then completes each claim through
-- fn_finish_account_image_drain before inventory is allowed to persist.
CREATE OR REPLACE FUNCTION public.fn_claim_account_image_drain(
    p_user_id uuid,
    p_worker text,
    p_batch integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_deletion public.account_deletions;
    v_rows jsonb;
BEGIN
    IF p_worker IS NULL OR pg_catalog.btrim(p_worker) = '' THEN
        RAISE EXCEPTION 'invalid_worker' USING ERRCODE = '22023';
    END IF;
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    SELECT d.* INTO v_deletion
    FROM public.account_deletions d
    WHERE d.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND OR v_deletion.state <> 'draining' THEN
        RAISE EXCEPTION 'account_deletion_state_conflict' USING ERRCODE = '40001';
    END IF;
    IF v_deletion.quiesce_after > pg_catalog.clock_timestamp()
       OR v_deletion.writer_zero_confirmed_at IS NULL
       OR EXISTS (
            SELECT 1 FROM public.staging_reservations r
            WHERE r.user_id = p_user_id AND r.state IN ('writing', 'putting')
       ) THEN
        RAISE EXCEPTION 'account_deletion_not_quiescent' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.user_image_objects o
        JOIN public.image_object_refs r ON r.object_id = o.id
        WHERE o.user_id = p_user_id
          AND o.state IN ('promoting', 'gc_pending', 'deleting')
    ) THEN
        RAISE EXCEPTION 'account_image_drain_has_refs' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.user_image_objects o
        WHERE o.user_id = p_user_id AND o.state = 'deleting'
          AND o.gc_lease_expires >= pg_catalog.clock_timestamp()
          AND o.gc_claimed_by IS DISTINCT FROM p_worker
    ) THEN
        RAISE EXCEPTION 'account_image_drain_busy' USING ERRCODE = '55000';
    END IF;

    WITH candidates AS (
        SELECT o.id
        FROM public.user_image_objects o
        WHERE o.user_id = p_user_id
          AND o.state IN ('promoting', 'gc_pending', 'deleting')
          AND (
              o.state <> 'deleting'
              OR o.gc_lease_expires < pg_catalog.clock_timestamp()
              OR o.gc_claimed_by = p_worker
          )
        ORDER BY o.created_at, o.id
        FOR UPDATE
        LIMIT GREATEST(1, LEAST(COALESCE(p_batch, 100), 500))
    ), claimed AS (
        UPDATE public.user_image_objects o
        SET state = 'deleting',
            gc_claimed_by = p_worker,
            gc_lease_expires = pg_catalog.clock_timestamp() + interval '300 seconds'
        FROM candidates c
        WHERE o.id = c.id
        RETURNING o.id AS object_id, o.bucket, o.storage_path,
                  o.gc_lease_expires AS lease_expires
    )
    SELECT COALESCE(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(claimed) ORDER BY claimed.object_id),
        '[]'::jsonb
    ) INTO v_rows
    FROM claimed;
    RETURN v_rows;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finish_account_image_drain(
    p_user_id uuid,
    p_object_id uuid,
    p_worker text,
    p_success boolean,
    p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF NOT EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id AND d.state = 'draining'
    ) THEN
        RETURN false;
    END IF;

    IF COALESCE(p_success, false) THEN
        DELETE FROM public.user_image_objects o
        WHERE o.id = p_object_id AND o.user_id = p_user_id
          AND o.state = 'deleting' AND o.gc_claimed_by = p_worker
          AND o.gc_lease_expires > pg_catalog.clock_timestamp();
        IF NOT FOUND THEN RETURN false; END IF;
        UPDATE public.image_gc_queue q
        SET state = 'done', completed_at = pg_catalog.clock_timestamp(),
            claimed_by = NULL, lease_expires = NULL, last_error = NULL
        WHERE q.object_id = p_object_id AND q.state <> 'done';
        RETURN true;
    END IF;

    UPDATE public.user_image_objects o
    SET state = 'gc_pending', gc_claimed_by = NULL, gc_lease_expires = NULL
    WHERE o.id = p_object_id AND o.user_id = p_user_id
      AND o.state = 'deleting' AND o.gc_claimed_by = p_worker
      AND o.gc_lease_expires > pg_catalog.clock_timestamp();
    IF NOT FOUND THEN RETURN false; END IF;
    UPDATE public.image_gc_queue q
    SET state = 'failed', claimed_by = NULL, lease_expires = NULL,
        last_error = pg_catalog.left(COALESCE(p_error, 'account_image_drain_failed'), 2000),
        next_attempt_at = pg_catalog.clock_timestamp() + interval '15 minutes'
    WHERE q.object_id = p_object_id AND q.state <> 'done';
    RETURN true;
END;
$fn$;

-- Storage's list API is directory-oriented and can miss nested legacy names
-- when a caller treats returned folder rows as objects.  This catalog page is
-- recursive over exact names and accepts only the five user-owned prefixes in
-- the deletion contract.
CREATE OR REPLACE FUNCTION public.fn_list_account_storage_paths(
    p_user_id uuid,
    p_bucket text,
    p_prefix text,
    p_after_path text DEFAULT NULL,
    p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
    v_rows jsonb;
    v_count integer;
    v_last text;
BEGIN
    IF p_user_id IS NULL OR NOT (
        (p_bucket = 'image-staging' AND p_prefix = p_user_id::text)
        OR (p_bucket = 'avatars' AND p_prefix IN (
            p_user_id::text, 'approved/' || p_user_id::text
        ))
        OR (p_bucket = 'entry-photos' AND p_prefix IN (
            p_user_id::text, 'approved/' || p_user_id::text
        ))
    ) THEN
        RAISE EXCEPTION 'invalid_account_storage_scope' USING ERRCODE = '22023';
    END IF;

    WITH page AS (
        SELECT s.name AS path
        FROM storage.objects s
        WHERE s.bucket_id = p_bucket
          AND s.name LIKE p_prefix || '/%'
          AND (p_after_path IS NULL OR s.name > p_after_path)
        ORDER BY s.name
        LIMIT v_limit
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(p.path ORDER BY p.path), '[]'::jsonb),
           pg_catalog.count(*)::integer,
           pg_catalog.max(p.path)
    INTO v_rows, v_count, v_last
    FROM page p;

    RETURN pg_catalog.jsonb_build_object(
        'paths', v_rows,
        'next_cursor', CASE WHEN v_count = v_limit THEN v_last ELSE NULL END
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finalize_account_image_inventory(
    p_user_id uuid,
    p_storage_inventory jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_inventory jsonb;
    v_row public.account_deletions;
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    SELECT d.* INTO v_row FROM public.account_deletions d
    WHERE d.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND OR v_row.state NOT IN ('draining', 'inventoried', 'purging') THEN
        RAISE EXCEPTION 'account_deletion_state_conflict' USING ERRCODE = '40001';
    END IF;
    IF v_row.state = 'draining' AND (
        v_row.quiesce_after > pg_catalog.clock_timestamp()
        OR v_row.writer_zero_confirmed_at IS NULL
        OR EXISTS (
            SELECT 1 FROM public.staging_reservations r
            WHERE r.user_id = p_user_id AND r.state IN ('writing', 'putting')
        )
        OR EXISTS (
            SELECT 1 FROM public.user_image_objects o
            WHERE o.user_id = p_user_id
              AND o.state IN ('promoting', 'gc_pending', 'deleting')
        )
    ) THEN
        RAISE EXCEPTION 'account_deletion_not_quiescent' USING ERRCODE = '55000';
    END IF;

    SELECT COALESCE(p_storage_inventory, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'reservation_ids', COALESCE((SELECT pg_catalog.jsonb_agg(r.id) FROM public.staging_reservations r WHERE r.user_id = p_user_id), '[]'::jsonb),
        'registry_ids', COALESCE((SELECT pg_catalog.jsonb_agg(o.id) FROM public.user_image_objects o WHERE o.user_id = p_user_id), '[]'::jsonb),
        'ref_ids', COALESCE((SELECT pg_catalog.jsonb_agg(x.id) FROM public.image_object_refs x JOIN public.user_image_objects o ON o.id = x.object_id WHERE o.user_id = p_user_id), '[]'::jsonb),
        'queue_ids', COALESCE((
            SELECT pg_catalog.jsonb_agg(q.id)
            FROM public.image_gc_queue q
            WHERE q.user_id = p_user_id
               OR q.object_id IN (
                    SELECT o.id FROM public.user_image_objects o
                    WHERE o.user_id = p_user_id
               )
               OR EXISTS (
                    SELECT 1
                    FROM public.image_object_refs r
                    JOIN public.user_image_objects o ON o.id = r.object_id
                    WHERE o.user_id = p_user_id
                      AND r.sink_kind = q.sink_kind AND r.sink_id = q.sink_id
               )
        ), '[]'::jsonb),
        'quarantine_ids', COALESCE((SELECT pg_catalog.jsonb_agg(q.id) FROM public.image_quarantine q WHERE q.user_id = p_user_id), '[]'::jsonb)
    ) INTO v_inventory;

    UPDATE public.account_deletions d
    SET inventory = v_inventory, state = 'inventoried',
        -- A refreshed inventory starts a new purge observation window.  A
        -- prior first-zero (or confirmation) must never authorize Auth delete
        -- for bytes discovered by this refresh.
        all_prefix_zero_seen_at = NULL,
        all_prefix_zero_confirmed_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
    WHERE d.user_id = p_user_id
    RETURNING * INTO v_row;
    RETURN pg_catalog.to_jsonb(v_row);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_mark_account_images_purging(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    UPDATE public.account_deletions d
    SET state = 'purging', updated_at = pg_catalog.clock_timestamp()
    WHERE d.user_id = p_user_id AND d.state IN ('inventoried', 'purging');
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_mark_account_auth_deleted(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    UPDATE public.account_deletions d
    SET state = 'auth_deleted', updated_at = pg_catalog.clock_timestamp()
    WHERE d.user_id = p_user_id AND d.state = 'purging'
      AND d.all_prefix_zero_confirmed_at IS NOT NULL;
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finish_account_image_cleanup(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_inventory jsonb;
BEGIN
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    SELECT d.inventory INTO v_inventory
    FROM public.account_deletions d
        WHERE d.user_id = p_user_id AND d.state = 'auth_deleted'
          AND d.all_prefix_zero_confirmed_at IS NOT NULL
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    -- Queue rows have no auth FK and cascade triggers can enqueue fresh work
    -- while Auth/content deletion runs.  Cancel every durable owner/object/
    -- sink inventory match (including legacy public URLs for inventoried
    -- Storage paths) before deleting the registry rows they reference.
    DELETE FROM public.image_gc_queue q
    WHERE q.user_id = p_user_id
       OR q.object_id IN (
            SELECT o.id FROM public.user_image_objects o
            WHERE o.user_id = p_user_id
       )
       OR q.id IN (
            SELECT x.value::uuid
            FROM pg_catalog.jsonb_array_elements_text(
                COALESCE(v_inventory -> 'queue_ids', '[]'::jsonb)
            ) x(value)
       )
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.jsonb_array_elements(
                COALESCE(v_inventory -> 'storage', '[]'::jsonb)
            ) s(value)
            WHERE q.bucket = s.value ->> 'bucket'
              AND (
                  q.path = s.value ->> 'path'
                  OR q.path LIKE '%/storage/v1/object/public/'
                      || (s.value ->> 'bucket') || '/' || (s.value ->> 'path')
              )
       );
    DELETE FROM public.image_object_refs r USING public.user_image_objects o
    WHERE r.object_id = o.id AND o.user_id = p_user_id;
    DELETE FROM public.user_image_objects o WHERE o.user_id = p_user_id;
    DELETE FROM public.image_quarantine q WHERE q.user_id = p_user_id;
    DELETE FROM public.image_moderation_notifications n WHERE n.user_id = p_user_id;
    DELETE FROM public.staging_reservations r WHERE r.user_id = p_user_id;
    DELETE FROM public.image_stage_budget b WHERE b.user_id = p_user_id;
    DELETE FROM public.image_compute_budget b WHERE b.scope = 'user' AND b.subject_id = p_user_id;
    DELETE FROM public.image_scan_budget b WHERE b.scope = 'user' AND b.subject_id = p_user_id;
    DELETE FROM public.image_moderation_ledger l WHERE l.user_id = p_user_id;
    UPDATE public.account_deletions d
    SET state = 'done', updated_at = pg_catalog.clock_timestamp(), last_error = NULL
    WHERE d.user_id = p_user_id;
    RETURN FOUND;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_claim_gc_queue(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_unlink_gc_ref(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_image_object_gc(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_image_object_gc(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_gc_queue(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_moderation_job(text, text, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_renew_moderation_job(text, text, bigint, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_complete_moderation_job(text, text, bigint, uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_fail_moderation_job(text, text, bigint, uuid, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_enqueue_job_alarm(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_freeze_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_record_account_deletion_zero(uuid, text, boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_account_image_drain(uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_account_image_drain(uuid, uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_list_account_storage_paths(uuid, text, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finalize_account_image_inventory(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mark_account_images_purging(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_mark_account_auth_deleted(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_account_image_cleanup(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_claim_gc_queue(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_unlink_gc_ref(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_image_object_gc(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_image_object_gc(uuid, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_gc_queue(uuid, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_moderation_job(text, text, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_renew_moderation_job(text, text, bigint, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_complete_moderation_job(text, text, bigint, uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_fail_moderation_job(text, text, bigint, uuid, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_job_alarm(uuid, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_freeze_account_deletion(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_account_deletion_zero(uuid, text, boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_account_image_drain(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_account_image_drain(uuid, uuid, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_list_account_storage_paths(uuid, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finalize_account_image_inventory(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_account_images_purging(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_mark_account_auth_deleted(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_account_image_cleanup(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_freeze_account_deletion(uuid) IS
    'TICKET-196: durable tombstone; quiesce_after covers staged writers, promotion attempts, and active object-GC leases.';

CREATE OR REPLACE FUNCTION public.fn_claim_staging_gc(
    p_worker text,
    p_batch integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_rows jsonb;
BEGIN
    WITH candidates AS (
        SELECT r.id
        FROM public.staging_reservations r
        WHERE (
            (r.state = 'staged' AND r.created_at < pg_catalog.clock_timestamp() - interval '24 hours')
            OR (r.state IN ('writing', 'putting') AND r.lease_expires < pg_catalog.clock_timestamp())
            OR r.state IN ('cleanup_required', 'write_failed', 'consumed')
        )
          AND (r.gc_lease_expires IS NULL OR r.gc_lease_expires < pg_catalog.clock_timestamp())
        ORDER BY r.created_at, r.id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, LEAST(COALESCE(p_batch, 50), 200))
    ), claimed AS (
        UPDATE public.staging_reservations r
        SET state = 'cleanup_required',
            generation = CASE WHEN r.state IN ('writing', 'putting') THEN r.generation + 1 ELSE r.generation END,
            gc_claimed_by = p_worker,
            gc_lease_expires = pg_catalog.clock_timestamp() + interval '300 seconds',
            updated_at = pg_catalog.clock_timestamp()
        FROM candidates c WHERE r.id = c.id
        RETURNING r.*
    ) SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(claimed)), '[]'::jsonb)
      INTO v_rows FROM claimed;
    RETURN v_rows;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finish_staging_gc(
    p_reservation_id uuid,
    p_worker text,
    p_success boolean,
    p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF p_success THEN
        DELETE FROM public.staging_reservations r
        WHERE r.id = p_reservation_id AND r.gc_claimed_by = p_worker
          AND r.gc_lease_expires > pg_catalog.clock_timestamp();
        RETURN FOUND;
    END IF;
    UPDATE public.staging_reservations r
    SET gc_claimed_by = NULL, gc_lease_expires = NULL,
        failure_reason = pg_catalog.left(p_error, 500),
        updated_at = pg_catalog.clock_timestamp()
    WHERE r.id = p_reservation_id AND r.gc_claimed_by = p_worker
      AND r.gc_lease_expires > pg_catalog.clock_timestamp();
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_claim_unbound_image_gc(
    p_worker text,
    p_batch integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_id uuid;
    v_claim jsonb;
    v_rows jsonb := '[]'::jsonb;
BEGIN
    FOR v_id IN
        SELECT o.id FROM public.user_image_objects o
        WHERE (
                o.state IN ('approved', 'gc_pending')
                OR (o.state = 'deleting'
                    AND o.gc_lease_expires < pg_catalog.clock_timestamp())
              )
          AND o.bound_at IS NULL
          AND o.created_at < pg_catalog.clock_timestamp() - interval '48 hours'
          AND NOT EXISTS (SELECT 1 FROM public.image_object_refs r WHERE r.object_id = o.id)
        ORDER BY o.created_at, o.id
        LIMIT GREATEST(1, LEAST(COALESCE(p_batch, 50), 200))
    LOOP
        v_claim := public.fn_claim_image_object_gc(v_id, p_worker, 'unbound_ttl');
        IF COALESCE((v_claim ->> 'claimed')::boolean, false) THEN
            v_rows := v_rows || pg_catalog.jsonb_build_array(v_claim);
        END IF;
    END LOOP;
    RETURN v_rows;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_list_reconcile_registry(
    p_after_id uuid DEFAULT NULL,
    p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) ORDER BY x.id), '[]'::jsonb)
    FROM (
        SELECT o.* FROM public.user_image_objects o
        WHERE p_after_id IS NULL OR o.id > p_after_id
        ORDER BY o.id
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))
    ) x;
$fn$;

-- Bounded, durable reconciliation page.  The cursor is a stable lexical key
-- over finding kind + physical identity, so each successful run can resume
-- without re-listing the entire registry or recursively walking namespaces in
-- Edge.  storage.objects is a catalog approximation; the repair RPC remains
-- idempotent when the backing object changed between list and repair.
CREATE OR REPLACE FUNCTION public.fn_list_reconcile_findings(
    p_after_cursor text DEFAULT NULL,
    p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
    WITH requested AS (
        SELECT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500))::integer AS n
    ), registry_candidates AS (
        SELECT
            CASE
                WHEN o.state = 'promoting' AND s.id IS NOT NULL
                    THEN 'promoting_object_present'
                WHEN o.state = 'promoting'
                    THEN 'promoting_object_missing'
                WHEN o.state = 'deleting'
                    THEN 'expired_delete_lease'
                ELSE 'registry_storage_missing'
            END AS kind,
            o.id AS object_id,
            o.bucket,
            o.storage_path AS path,
            CASE
                WHEN o.state = 'promoting' AND s.id IS NOT NULL THEN '10:'
                WHEN o.state = 'promoting' THEN '11:'
                WHEN o.state = 'deleting' THEN '12:'
                ELSE '13:'
            END || o.id::text AS cursor
        FROM public.user_image_objects o
        LEFT JOIN storage.objects s
          ON s.bucket_id = o.bucket AND s.name = o.storage_path
        WHERE (o.state = 'promoting'
               AND COALESCE(o.promotion_lease_expires, '-infinity'::timestamptz)
                   < pg_catalog.clock_timestamp())
           OR (o.state = 'deleting'
               AND o.gc_lease_expires < pg_catalog.clock_timestamp())
           OR (o.state IN ('approved', 'gc_pending') AND s.id IS NULL)
    ), orphan_candidates AS (
        SELECT
            'orphan_storage'::text AS kind,
            NULL::uuid AS object_id,
            s.bucket_id AS bucket,
            s.name AS path,
            '20:' || s.bucket_id || ':' || s.name AS cursor
        FROM storage.objects s
        WHERE s.bucket_id IN ('avatars', 'entry-photos')
          AND s.name LIKE 'approved/%'
          AND NOT EXISTS (
              SELECT 1 FROM public.user_image_objects o
              WHERE o.bucket = s.bucket_id AND o.storage_path = s.name
          )
    ), candidates AS (
        SELECT * FROM registry_candidates
        UNION ALL
        SELECT * FROM orphan_candidates
    ), page AS (
        SELECT c.kind, c.object_id, c.bucket, c.path, c.cursor
        FROM candidates c, requested r
        WHERE p_after_cursor IS NULL OR c.cursor > p_after_cursor
        ORDER BY c.cursor
        LIMIT (SELECT n FROM requested)
    ), aggregate_page AS (
        SELECT
            COALESCE(
                pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY p.cursor),
                '[]'::jsonb
            ) AS rows,
            pg_catalog.count(*) AS row_count,
            pg_catalog.max(p.cursor) AS last_cursor
        FROM page p
    )
    SELECT pg_catalog.jsonb_build_object(
        'rows', a.rows,
        'next_cursor', CASE WHEN a.row_count = r.n THEN a.last_cursor ELSE NULL END
    )
    FROM aggregate_page a CROSS JOIN requested r;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_reconcile_staging_usage()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
    SELECT pg_catalog.jsonb_build_object(
        'objects', pg_catalog.count(*),
        'bytes', COALESCE(pg_catalog.sum(
            CASE
                WHEN COALESCE(s.metadata ->> 'size', '') ~ '^[0-9]+$'
                    THEN (s.metadata ->> 'size')::numeric
                ELSE 0::numeric
            END
        ), 0::numeric)
    )
    FROM storage.objects s
    WHERE s.bucket_id = 'image-staging';
$fn$;

CREATE OR REPLACE FUNCTION public.fn_reconcile_registry_object(
    p_object_id uuid,
    p_storage_exists boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_row public.user_image_objects;
    v_ref public.image_object_refs;
    v_user_id uuid;
    v_cleared integer := 0;
    v_storage_exists boolean;
BEGIN
    -- Read the lifecycle key without first taking an object/ref/sink lock.  All
    -- user-image writers and grandfather repairs take this same fence first, so
    -- reconciliation cannot invert their lock order while repairing stale refs.
    SELECT o.user_id INTO v_user_id
    FROM public.user_image_objects o
    WHERE o.id = p_object_id;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('missing', true); END IF;
    PERFORM public.fn_lock_image_lifecycle(v_user_id);

    SELECT o.* INTO v_row FROM public.user_image_objects o
    WHERE o.id = p_object_id AND o.user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('missing', true); END IF;

    -- The list page is only a work-discovery hint.  Storage may change before
    -- this repair transaction reaches the row, so never trust the caller's
    -- snapshot (`p_storage_exists` is retained only for Edge compatibility).
    SELECT EXISTS (
        SELECT 1 FROM storage.objects s
        WHERE s.bucket_id = v_row.bucket AND s.name = v_row.storage_path
    ) INTO v_storage_exists;

    IF v_row.state = 'promoting'
       AND COALESCE(v_row.promotion_lease_expires, '-infinity'::timestamptz)
           >= pg_catalog.clock_timestamp() THEN
        RETURN pg_catalog.to_jsonb(v_row)
            || pg_catalog.jsonb_build_object('promotion_in_flight', true);
    END IF;

    IF v_row.state = 'deleting' AND v_row.gc_lease_expires < pg_catalog.clock_timestamp() THEN
        -- The caller uses false for an expired deleting lease because existence
        -- is immaterial to this transition; the next GC claim owns the Storage
        -- retry.  Never treat that boolean as proof the bytes are absent here.
        UPDATE public.user_image_objects o
        SET state = 'gc_pending', gc_claimed_by = NULL, gc_lease_expires = NULL
        WHERE o.id = p_object_id RETURNING o.* INTO v_row;
        RETURN pg_catalog.to_jsonb(v_row);
    ELSIF NOT v_storage_exists THEN
        -- A registry row without bytes is never left referenced.  Clear each
        -- exact sink with a value CAS, record a deduplicated owner notice, then
        -- remove refs + registry.  A stale ref whose sink has since changed is
        -- removed without touching the newer sink value.
        FOR v_ref IN
            SELECT r.* FROM public.image_object_refs r
            WHERE r.object_id = p_object_id FOR UPDATE
        LOOP
            IF v_ref.sink_kind = 'avatar' THEN
                UPDATE public.profiles p SET avatar_url = NULL
                WHERE p.user_id::text = v_ref.sink_id AND p.avatar_url = v_row.public_url;
            ELSIF v_ref.sink_kind = 'entry_hero' THEN
                UPDATE public.entries e SET photo_url = NULL
                WHERE e.id = v_ref.sink_id::uuid AND e.photo_url = v_row.public_url;
            ELSIF v_ref.sink_kind = 'entry_photo' THEN
                DELETE FROM public.entry_photos ep
                WHERE ep.id = v_ref.sink_id::uuid AND ep.photo_url = v_row.public_url;
            END IF;
            IF FOUND THEN
                v_cleared := v_cleared + 1;
                PERFORM public.fn_record_image_rejection(
                    v_row.user_id, v_ref.sink_kind, v_ref.sink_id,
                    'registry_storage_missing'
                );
            END IF;
        END LOOP;
        DELETE FROM public.image_object_refs r WHERE r.object_id = p_object_id;
        DELETE FROM public.user_image_objects o WHERE o.id = p_object_id;
        UPDATE public.image_gc_queue q
        SET state = 'done', completed_at = pg_catalog.clock_timestamp(),
            claimed_by = NULL, lease_expires = NULL
        WHERE (q.object_id = p_object_id OR (q.bucket = v_row.bucket AND q.path = v_row.public_url))
          AND q.state <> 'done';
        RETURN pg_catalog.jsonb_build_object(
            'repaired_storage_missing', true,
            'cleared_sinks', v_cleared,
            'deleted_registry', true
        );
    ELSIF v_row.state = 'promoting' AND v_storage_exists
       AND EXISTS (SELECT 1 FROM public.image_hash_verdicts h WHERE h.sha256 = v_row.sha256 AND h.verdict = 'pass') THEN
        UPDATE public.user_image_objects o
        SET state = 'approved', promotion_lease_expires = NULL
        WHERE o.id = p_object_id
        RETURNING o.* INTO v_row;
    END IF;
    RETURN pg_catalog.to_jsonb(v_row);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_orphan_storage_object(
    p_bucket text,
    p_storage_path text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_id uuid;
    v_user_id uuid;
BEGIN
    IF p_bucket NOT IN ('avatars', 'entry-photos') OR p_storage_path NOT LIKE 'approved/%' THEN
        RAISE EXCEPTION 'invalid_orphan_path' USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.split_part(p_storage_path, '/', 2)
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_user_id := pg_catalog.split_part(p_storage_path, '/', 2)::uuid;
    END IF;
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_bucket || ':' || p_storage_path, 197::bigint)
    );
    INSERT INTO public.image_gc_queue (user_id, reason, bucket, path)
    SELECT v_user_id, 'namespace_orphan', p_bucket, p_storage_path
    WHERE NOT EXISTS (
        SELECT 1 FROM public.user_image_objects o
        WHERE o.bucket = p_bucket AND o.storage_path = p_storage_path
    )
    ON CONFLICT (bucket, path)
        WHERE reason = 'namespace_orphan' AND state <> 'done'
    DO UPDATE SET path = EXCLUDED.path
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_claim_account_cleanup(p_batch integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_rows jsonb;
BEGIN
    WITH candidates AS (
        SELECT d.user_id FROM public.account_deletions d
        WHERE d.state <> 'done' AND d.next_attempt_at <= pg_catalog.clock_timestamp()
        ORDER BY d.updated_at, d.user_id
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, LEAST(COALESCE(p_batch, 25), 100))
    ), claimed AS (
        UPDATE public.account_deletions d
        SET attempt = d.attempt + 1,
            next_attempt_at = pg_catalog.clock_timestamp() + interval '15 minutes',
            updated_at = pg_catalog.clock_timestamp()
        FROM candidates c WHERE d.user_id = c.user_id
        RETURNING d.*
    ) SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(claimed)), '[]'::jsonb)
      INTO v_rows FROM claimed;
    RETURN v_rows;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_claim_email_outbox(
    p_worker text,
    p_batch integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_rows jsonb;
BEGIN
    WITH candidates AS (
        SELECT o.idempotency_key FROM public.email_outbox o
        WHERE o.next_attempt_at <= pg_catalog.clock_timestamp()
          AND (o.state IN ('pending', 'failed') OR (o.state = 'claimed' AND o.claim_expires < pg_catalog.clock_timestamp()))
        ORDER BY o.created_at, o.idempotency_key
        FOR UPDATE SKIP LOCKED
        LIMIT GREATEST(1, LEAST(COALESCE(p_batch, 25), 100))
    ), claimed AS (
        UPDATE public.email_outbox o
        SET state = 'claimed', claimed_by = p_worker,
            claim_expires = pg_catalog.clock_timestamp() + interval '300 seconds',
            attempt = o.attempt + 1
        FROM candidates c WHERE o.idempotency_key = c.idempotency_key
        RETURNING o.*
    ) SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(claimed)), '[]'::jsonb)
      INTO v_rows FROM claimed;
    RETURN v_rows;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_finish_email_outbox(
    p_idempotency_key text,
    p_worker text,
    p_success boolean,
    p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    UPDATE public.email_outbox o
    SET state = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
        sent_at = CASE WHEN p_success THEN pg_catalog.clock_timestamp() ELSE NULL END,
        last_error = CASE WHEN p_success THEN NULL ELSE pg_catalog.left(p_error, 2000) END,
        claimed_by = NULL, claim_expires = NULL,
        next_attempt_at = CASE WHEN p_success THEN o.next_attempt_at
            ELSE pg_catalog.clock_timestamp()
              + pg_catalog.make_interval(secs => LEAST(86400, 300 * (2 ^ LEAST(o.attempt, 8))::integer)) END
    WHERE o.idempotency_key = p_idempotency_key AND o.state = 'claimed'
      AND o.claimed_by = p_worker
      AND o.claim_expires > pg_catalog.clock_timestamp();
    RETURN FOUND;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_enqueue_alarm_selftest(p_to_addr text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_incident uuid := extensions.gen_random_uuid();
    v_key text;
BEGIN
    IF p_to_addr IS NULL OR pg_catalog.strpos(p_to_addr, '@') < 2 THEN
        RAISE EXCEPTION 'invalid_alert_email' USING ERRCODE = '22023';
    END IF;
    v_key := 'alarm_selftest:' || v_incident::text;
    INSERT INTO public.email_outbox (
        idempotency_key, incident_id, job_name, alarm_kind,
        to_addr, subject, body, provider_idem_key
    ) VALUES (
        v_key, v_incident, 'alarm_selftest', 'manual_selftest', p_to_addr,
        'Napkin moderation alarm self-test',
        'Manual TICKET-196 alarm path self-test. This is not a scheduled failure.',
        v_key
    );
    RETURN pg_catalog.jsonb_build_object('idempotency_key', v_key, 'incident_id', v_incident);
END;
$fn$;

-- Return the actionable backlog for one harness action.  This is deliberately
-- computed in the database so alarm decisions do not trust a processor's page
-- size or an Edge-side estimate.  Reconcile can only approximate physical
-- absence from SQL, so it uses the Storage catalog plus nonterminal registry
-- states; the worker still performs the authoritative Storage API probe.
CREATE OR REPLACE FUNCTION public.fn_moderation_job_backlog(p_job_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_count bigint := 0;
    v_oldest timestamptz;
    v_gate boolean;
BEGIN
    IF p_job_name = 'gc_staging' THEN
        SELECT pg_catalog.count(*), pg_catalog.min(r.created_at)
        INTO v_count, v_oldest
        FROM public.staging_reservations r
        WHERE (
            (r.state = 'staged'
             AND r.created_at < pg_catalog.clock_timestamp() - interval '24 hours')
            OR (r.state IN ('writing', 'putting')
                AND r.lease_expires < pg_catalog.clock_timestamp())
            OR r.state IN ('cleanup_required', 'write_failed', 'consumed')
        )
          AND (r.gc_lease_expires IS NULL
               OR r.gc_lease_expires < pg_catalog.clock_timestamp());
    ELSIF p_job_name = 'gc_unbound' THEN
        SELECT pg_catalog.count(*), pg_catalog.min(o.created_at)
        INTO v_count, v_oldest
        FROM public.user_image_objects o
        WHERE (
                o.state IN ('approved', 'gc_pending')
                OR (o.state = 'deleting'
                    AND o.gc_lease_expires < pg_catalog.clock_timestamp())
              )
          AND o.bound_at IS NULL
          AND o.created_at < pg_catalog.clock_timestamp() - interval '48 hours'
          AND NOT EXISTS (
              SELECT 1 FROM public.image_object_refs r WHERE r.object_id = o.id
          );
    ELSIF p_job_name = 'gc_refdriven' THEN
        SELECT pg_catalog.count(*), pg_catalog.min(q.enqueued_at)
        INTO v_count, v_oldest
        FROM public.image_gc_queue q
        WHERE q.next_attempt_at <= pg_catalog.clock_timestamp()
          AND (
              q.state IN ('pending', 'failed')
              OR (q.state IN ('claimed', 'deleting')
                  AND q.lease_expires < pg_catalog.clock_timestamp())
          );
    ELSIF p_job_name = 'account_cleanup' THEN
        SELECT pg_catalog.count(*), pg_catalog.min(d.created_at)
        INTO v_count, v_oldest
        FROM public.account_deletions d
        WHERE d.state <> 'done';
    ELSIF p_job_name = 'ops-alarm' THEN
        SELECT pg_catalog.count(*), pg_catalog.min(o.created_at)
        INTO v_count, v_oldest
        FROM public.email_outbox o
        WHERE o.next_attempt_at <= pg_catalog.clock_timestamp()
          AND (
              o.state IN ('pending', 'failed')
              OR (o.state = 'claimed'
                  AND o.claim_expires < pg_catalog.clock_timestamp())
          );
    ELSIF p_job_name = 'grandfather' THEN
        SELECT c.enforce INTO v_gate
        FROM public.moderation_config c
        WHERE c.key = 'grandfather_sweep';
        IF NOT FOUND THEN
            RAISE EXCEPTION 'moderation_config_missing' USING ERRCODE = '55000';
        END IF;
        IF v_gate THEN
            WITH candidates AS (
                SELECT p.created_at AS pending_at
                FROM public.profiles p
                WHERE p.avatar_url IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM public.user_image_objects o
                      WHERE o.user_id = p.user_id AND o.bucket = 'avatars'
                        AND o.public_url = p.avatar_url AND o.state = 'approved'
                  )
                UNION ALL
                SELECT e.created_at
                FROM public.entries e
                WHERE e.photo_url IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM public.user_image_objects o
                      WHERE o.user_id = e.user_id AND o.bucket = 'entry-photos'
                        AND o.public_url = e.photo_url AND o.state = 'approved'
                  )
                UNION ALL
                SELECT ep.created_at
                FROM public.entry_photos ep
                JOIN public.entries e ON e.id = ep.entry_id
                WHERE NOT EXISTS (
                      SELECT 1 FROM public.user_image_objects o
                      WHERE o.user_id = e.user_id AND o.bucket = 'entry-photos'
                        AND o.public_url = ep.photo_url AND o.state = 'approved'
                  )
            )
            SELECT pg_catalog.count(*), pg_catalog.min(c.pending_at)
            INTO v_count, v_oldest FROM candidates c;
        END IF;
    ELSIF p_job_name = 'reconcile' THEN
        WITH registry_work AS (
            SELECT o.created_at AS pending_at
            FROM public.user_image_objects o
            WHERE (o.state = 'promoting'
                   AND COALESCE(o.promotion_lease_expires, '-infinity'::timestamptz)
                       < pg_catalog.clock_timestamp())
               OR (o.state = 'deleting'
                   AND o.gc_lease_expires < pg_catalog.clock_timestamp())
               OR (
                    o.state IN ('approved', 'gc_pending')
                    AND NOT EXISTS (
                        SELECT 1 FROM storage.objects s
                        WHERE s.bucket_id = o.bucket AND s.name = o.storage_path
                    )
               )
        ), namespace_work AS (
            SELECT COALESCE(s.created_at, pg_catalog.clock_timestamp()) AS pending_at
            FROM storage.objects s
            WHERE s.bucket_id IN ('avatars', 'entry-photos')
              AND s.name LIKE 'approved/%'
              AND NOT EXISTS (
                  SELECT 1 FROM public.user_image_objects o
                  WHERE o.bucket = s.bucket_id AND o.storage_path = s.name
              )
        ), candidates AS (
            SELECT pending_at FROM registry_work
            UNION ALL
            SELECT pending_at FROM namespace_work
        )
        SELECT pg_catalog.count(*), pg_catalog.min(c.pending_at)
        INTO v_count, v_oldest FROM candidates c;
    ELSE
        RAISE EXCEPTION 'unknown_job' USING ERRCODE = '22023';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
        'backlog_count', COALESCE(v_count, 0),
        'oldest_pending_at', v_oldest
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_evaluate_moderation_job_alarms(
    p_job_name text,
    p_run_id uuid,
    p_items_processed integer,
    p_backlog_count bigint,
    p_oldest_pending_at timestamptz,
    p_to_addr text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_run public.job_runs;
    v_previous_items integer;
    v_previous_backlog bigint;
    v_has_previous boolean := false;
    v_backlog_alarm boolean := false;
    v_stuck_alarm boolean := false;
    v_key text;
BEGIN
    SELECT r.* INTO v_run FROM public.job_runs r
    WHERE r.id = p_run_id AND r.job_name = p_job_name
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'job_run_not_found' USING ERRCODE = 'P0001'; END IF;
    IF v_run.status <> 'running' OR NOT EXISTS (
        SELECT 1 FROM public.job_leases l
        WHERE l.job_name = v_run.job_name AND l.holder = v_run.holder
          AND l.fence_token = v_run.fence_token
          AND l.lease_expires > pg_catalog.clock_timestamp()
    ) THEN
        RAISE EXCEPTION 'job_run_superseded' USING ERRCODE = '40001';
    END IF;
    IF p_to_addr IS NULL OR pg_catalog.strpos(p_to_addr, '@') < 2 THEN
        RAISE EXCEPTION 'invalid_alert_email' USING ERRCODE = '22023';
    END IF;
    v_backlog_alarm := COALESCE(p_backlog_count, 0) > 0
        AND p_oldest_pending_at < pg_catalog.clock_timestamp() - interval '24 hours';
    UPDATE public.job_runs r
    SET backlog_count = GREATEST(0, COALESCE(p_backlog_count, 0))
    WHERE r.id = p_run_id AND r.status = 'running'
      AND r.holder = v_run.holder AND r.fence_token = v_run.fence_token;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'job_run_superseded' USING ERRCODE = '40001';
    END IF;

    SELECT r.items_processed, r.backlog_count
    INTO v_previous_items, v_previous_backlog
    FROM public.job_runs r
    WHERE r.job_name = p_job_name AND r.id <> p_run_id
      AND r.finished_at IS NOT NULL
    ORDER BY r.started_at DESC LIMIT 1;
    v_has_previous := FOUND;
    v_stuck_alarm := COALESCE(p_backlog_count, 0) > 0
        AND v_has_previous
        AND GREATEST(0, COALESCE(p_items_processed, 0)) = 0
        AND COALESCE(v_previous_items, 0) = 0
        AND COALESCE(v_previous_backlog, 0) > 0;

    IF v_backlog_alarm THEN
        v_key := p_job_name || ':' || v_run.incident_id::text || ':backlog_age';
        INSERT INTO public.email_outbox (
            idempotency_key, incident_id, job_name, alarm_kind,
            to_addr, subject, body, provider_idem_key
        ) VALUES (
            v_key, v_run.incident_id, p_job_name, 'backlog_age', p_to_addr,
            'Napkin moderation backlog is older than 24h',
            'Job ' || p_job_name || ' has ' || COALESCE(p_backlog_count, 0)::text || ' pending items.',
            v_key
        ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    IF v_stuck_alarm THEN
        v_key := p_job_name || ':' || v_run.incident_id::text || ':stuck_progress';
        INSERT INTO public.email_outbox (
            idempotency_key, incident_id, job_name, alarm_kind,
            to_addr, subject, body, provider_idem_key
        ) VALUES (
            v_key, v_run.incident_id, p_job_name, 'stuck_progress', p_to_addr,
            'Napkin moderation job made no progress twice',
            'Job ' || p_job_name || ' has a non-empty backlog and two zero-progress runs.',
            v_key
        ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'backlog_age_enqueued', v_backlog_alarm,
        'stuck_progress_enqueued', v_stuck_alarm
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_claim_staging_gc(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_staging_gc(uuid, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_unbound_image_gc(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_list_reconcile_registry(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_list_reconcile_findings(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reconcile_staging_usage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reconcile_registry_object(uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_enqueue_orphan_storage_object(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_account_cleanup(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_claim_email_outbox(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_email_outbox(text, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_enqueue_alarm_selftest(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_moderation_job_backlog(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_evaluate_moderation_job_alarms(text, uuid, integer, bigint, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_staging_gc(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_staging_gc(uuid, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_unbound_image_gc(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_list_reconcile_registry(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_list_reconcile_findings(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_staging_usage() TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_reconcile_registry_object(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_orphan_storage_object(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_account_cleanup(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_claim_email_outbox(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_finish_email_outbox(text, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_enqueue_alarm_selftest(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_moderation_job_backlog(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_evaluate_moderation_job_alarms(text, uuid, integer, bigint, timestamptz, text) TO service_role;
