-- TICKET-063: multi-spot import idempotency schema.
-- Adds client_nonce to wishlist_items + table_shares for per-spot replay safety.
-- Adds import_nonce to import_jobs for job-level replay dedup.
-- Adds fn_save_import_spot SECURITY DEFINER for the synchronous save_spots action.
--
-- ARCH-REVIEW-2 #2/#3/#4 resolutions (BINDING):
--   - wishlist_items: UNIQUE(user_id, client_nonce) WHERE client_nonce IS NOT NULL AND deleted_at IS NULL
--   - table_shares:   UNIQUE(author_id, table_id, client_nonce) WHERE client_nonce IS NOT NULL
--   - import_jobs:    UNIQUE(user_id, import_nonce) WHERE import_nonce IS NOT NULL
--   - fn_save_import_spot (singular): per-spot, ON CONFLICT DO NOTHING, not batch transaction
--
-- No DDL change to extraction_cache (HASH_VERSION bump is a code constant — TICKET-063 design).
-- No PGRST201 risk: client_nonce is a scalar uuid with no FK relationship.

-- ─── wishlist_items: client_nonce ────────────────────────────────────────────

ALTER TABLE public.wishlist_items
  ADD COLUMN IF NOT EXISTS client_nonce uuid;

-- Partial unique: live (non-deleted) rows only; nonce=NULL rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS wishlist_items_client_nonce_uidx
  ON public.wishlist_items (user_id, client_nonce)
  WHERE client_nonce IS NOT NULL
    AND deleted_at IS NULL;

-- ─── table_shares: client_nonce ──────────────────────────────────────────────

ALTER TABLE public.table_shares
  ADD COLUMN IF NOT EXISTS client_nonce uuid;

-- Partial unique: per-author per-table per-nonce live share.
CREATE UNIQUE INDEX IF NOT EXISTS table_shares_client_nonce_uidx
  ON public.table_shares (author_id, table_id, client_nonce)
  WHERE client_nonce IS NOT NULL;

-- ─── import_jobs: import_nonce ────────────────────────────────────────────────

ALTER TABLE public.import_jobs
  ADD COLUMN IF NOT EXISTS import_nonce uuid;

-- Partial unique: one job per user per import_nonce (job-level replay dedup).
CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_import_nonce_uidx
  ON public.import_jobs (user_id, import_nonce)
  WHERE import_nonce IS NOT NULL;

-- ─── fn_save_import_spot ─────────────────────────────────────────────────────
-- SECURITY DEFINER: writes one wishlist row + optional table_share rows for a
-- single resolved restaurant spot, idempotent on client_nonce.
--
-- Called from resolve-url save_spots action, looped per spot (≤6).
-- Per-spot ON CONFLICT DO NOTHING ensures replay safety.
-- Returns per-spot result (saved | already_pinned | job_id).
--
-- Parameters:
--   p_user_id         — the authenticated saver (jwt sub)
--   p_import_nonce    — job-level idempotency key (minted by client pre-auth)
--   p_client_nonce    — spot-level idempotency key (minted by client at save time)
--   p_restaurant_id   — persisted restaurant UUID (null for ghost/unresolved)
--   p_external_id     — Google place_id for ghost upsert (null when restaurant_id provided)
--   p_restaurant_name — display name for ghost (null when restaurant_id provided)
--   p_restaurant_city — city for ghost upsert (null OK)
--   p_source          — WishlistSource jsonb
--   p_note            — optional note text
--   p_table_id        — optional table to post a share card to (null = wishlist only)
--   p_table_client_nonce — per-table-share nonce (can differ from p_client_nonce)

CREATE OR REPLACE FUNCTION public.fn_save_import_spot(
  p_user_id             uuid,
  p_import_nonce        uuid,
  p_client_nonce        uuid,
  p_restaurant_id       uuid     DEFAULT NULL,
  p_external_id         text     DEFAULT NULL,
  p_restaurant_name     text     DEFAULT NULL,
  p_restaurant_city     text     DEFAULT NULL,
  p_source              jsonb    DEFAULT NULL,
  p_note                text     DEFAULT NULL,
  p_table_id            uuid     DEFAULT NULL,
  p_table_client_nonce  uuid     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job_id          uuid;
  v_restaurant_id   uuid;
  v_wishlist_id     uuid;
  v_share_id        uuid;
  v_existing        boolean;
BEGIN
  -- ── 1. Upsert or find the import_jobs row for this import_nonce ──────────
  -- ON CONFLICT DO NOTHING + re-select so replays reuse the same job.
  INSERT INTO public.import_jobs (user_id, import_nonce, status, source)
  VALUES (p_user_id, p_import_nonce, 'resolved', p_source)
  ON CONFLICT (user_id, import_nonce) WHERE import_nonce IS NOT NULL
  DO NOTHING;

  SELECT job_id INTO v_job_id
  FROM public.import_jobs
  WHERE user_id = p_user_id
    AND import_nonce = p_import_nonce
  LIMIT 1;

  IF v_job_id IS NULL THEN
    RETURN jsonb_build_object('status', 'failed', 'error', 'could not create import job');
  END IF;

  -- ── 2. Resolve restaurant_id ──────────────────────────────────────────────
  IF p_restaurant_id IS NOT NULL THEN
    v_restaurant_id := p_restaurant_id;
  ELSIF p_external_id IS NOT NULL THEN
    -- Upsert ghost/verified restaurant by external_id
    INSERT INTO public.restaurants (external_id, name, city, verification)
    VALUES (p_external_id, p_restaurant_name, p_restaurant_city, 'unverified')
    ON CONFLICT (external_id) DO UPDATE
      SET name = COALESCE(EXCLUDED.name, restaurants.name),
          city = COALESCE(EXCLUDED.city, restaurants.city)
    RETURNING id INTO v_restaurant_id;

    IF v_restaurant_id IS NULL THEN
      SELECT id INTO v_restaurant_id
      FROM public.restaurants
      WHERE external_id = p_external_id
      LIMIT 1;
    END IF;
  END IF;

  -- ── 3. Check existing wishlist row (already_pinned via restaurant_id) ─────
  IF v_restaurant_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.wishlist_items
      WHERE user_id = p_user_id
        AND restaurant_id = v_restaurant_id
        AND deleted_at IS NULL
    ) INTO v_existing;

    IF v_existing THEN
      RETURN jsonb_build_object(
        'status',         'already_pinned',
        'job_id',         v_job_id,
        'restaurant_id',  v_restaurant_id
      );
    END IF;
  END IF;

  -- ── 4. Insert wishlist row (ON CONFLICT DO NOTHING for nonce replay) ──────
  INSERT INTO public.wishlist_items
    (user_id, restaurant_id, job_id, extraction_status, source, note, client_nonce)
  VALUES
    (p_user_id, v_restaurant_id, v_job_id, 'resolved', p_source, p_note, p_client_nonce)
  ON CONFLICT (user_id, client_nonce) WHERE client_nonce IS NOT NULL AND deleted_at IS NULL
  DO NOTHING
  RETURNING id INTO v_wishlist_id;

  -- ── 5. Insert table_share row if a table was specified ────────────────────
  IF p_table_id IS NOT NULL THEN
    INSERT INTO public.table_shares
      (job_id, table_id, author_id, restaurant_id, extraction_status, source, note, client_nonce)
    VALUES
      (v_job_id, p_table_id, p_user_id, v_restaurant_id, 'resolved', p_source, p_note, p_table_client_nonce)
    ON CONFLICT (author_id, table_id, client_nonce) WHERE client_nonce IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_share_id;
  END IF;

  RETURN jsonb_build_object(
    'status',         'saved',
    'job_id',         v_job_id,
    'wishlist_id',    v_wishlist_id,
    'share_id',       v_share_id,
    'restaurant_id',  v_restaurant_id
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'status', 'failed',
      'error',  SQLERRM
    );
END;
$$;

-- Lock to service_role only (ARCH-REVIEW-2 #4)
REVOKE ALL ON FUNCTION public.fn_save_import_spot FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_save_import_spot TO service_role;

COMMENT ON FUNCTION public.fn_save_import_spot IS
  'SECURITY DEFINER: idempotent per-spot wishlist save with optional table share. '
  'ON CONFLICT DO NOTHING on client_nonce for replay safety. [TICKET-063 ARCH-REVIEW-2 #4]';
