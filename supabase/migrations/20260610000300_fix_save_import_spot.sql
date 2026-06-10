-- TICKET-063 Fix Pass 1: repair fn_save_import_spot (P0-B ghost collision, P1 membership gate).
--
-- 20260610000200 is already applied in prod — do NOT edit it.
-- This migration CREATE OR REPLACEs fn_save_import_spot with the following fixes:
--
--   1. Ghost external_id minting:
--      When p_restaurant_id IS NULL AND p_external_id IS NULL (or 'ghost_pending'),
--      mint external_id = 'ghost_' || p_user_id || '_' || p_client_nonce.
--      This is stable per (user+spot) across replays and avoids cross-user row collapse.
--      Client-sent 'ghost_pending' is sanitized to NULL in the edge layer
--      (handleSaveSpots) so this branch serves true ghosts only.
--
--   2. Table membership check inside the RPC (tenant isolation, P1).
--      Before any table_shares INSERT, verify p_user_id IS a member of p_table_id
--      via table_members.member_id (NOT user_id — TICKET-034 doctrine).
--      On membership failure: RAISE EXCEPTION so the edge handler catches it
--      and records status='failed', code='NOT_A_MEMBER' for this spot.
--
--   3. Ghost quarantine at fan-out:
--      Spots without a resolved restaurant (v_restaurant_id IS NULL) NEVER write
--      table_shares (wishlist-only per spec).

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
  v_ghost_ext_id    text;
  v_verification    text;
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
    -- Caller already resolved: use it directly.
    v_restaurant_id := p_restaurant_id;

  ELSIF p_external_id IS NOT NULL AND p_external_id != '' AND p_external_id != 'ghost_pending' THEN
    -- Real Places external_id — upsert with verified status.
    -- (Edge handler upserts resolved spots before calling RPC, so this branch
    --  is mainly a safety net for callers who pass external_id directly.)
    INSERT INTO public.restaurants (external_id, name, city, verification)
    VALUES (p_external_id, p_restaurant_name, p_restaurant_city, 'verified')
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

  ELSE
    -- FIX P0-B: Ghost case — mint a stable, per-user-per-spot external_id.
    -- 'ghost_pending' sentinel from old clients is treated as NULL here
    -- (the edge layer also sanitizes it to NULL before calling the RPC).
    -- The minted id is stable across replays: same (user, client_nonce) → same id.
    v_ghost_ext_id := 'ghost_' || p_user_id::text || '_' || p_client_nonce::text;

    INSERT INTO public.restaurants (external_id, name, city, verification, created_by)
    VALUES (v_ghost_ext_id, p_restaurant_name, p_restaurant_city, 'unverified', p_user_id)
    ON CONFLICT (external_id) DO UPDATE
      SET name = COALESCE(EXCLUDED.name, restaurants.name),
          city = COALESCE(EXCLUDED.city, restaurants.city)
    RETURNING id INTO v_restaurant_id;

    IF v_restaurant_id IS NULL THEN
      SELECT id INTO v_restaurant_id
      FROM public.restaurants
      WHERE external_id = v_ghost_ext_id
      LIMIT 1;
    END IF;
  END IF;

  -- ── 2b. Read verification status of the resolved restaurant ─────────────
  -- Used in step 5 ghost quarantine: minted ghosts (unverified) are never
  -- written to table_shares, even though they DO have a v_restaurant_id.
  -- Codex round-2 finding: the old `IS NULL` check was unreachable for ghosts.
  IF v_restaurant_id IS NOT NULL THEN
    SELECT verification INTO v_verification
    FROM public.restaurants
    WHERE id = v_restaurant_id;
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
  -- Soft-delete resurrection (Claude cycle-2 P2):
  -- wishlist_items_user_restaurant_idx is a NON-partial UNIQUE(user_id, restaurant_id).
  -- A soft-deleted row for the same (user, restaurant) causes the INSERT below to collide
  -- and fall into EXCEPTION WHEN OTHERS → status 'failed', deterministically non-retriable.
  -- Fix: resurrect the soft-deleted row first; only INSERT when no resurrection happened.
  IF v_restaurant_id IS NOT NULL THEN
    UPDATE public.wishlist_items
    SET
      deleted_at   = NULL,
      job_id       = v_job_id,
      source       = p_source,
      note         = COALESCE(p_note, note),
      client_nonce = p_client_nonce
    WHERE user_id       = p_user_id
      AND restaurant_id = v_restaurant_id
      AND deleted_at IS NOT NULL
    RETURNING id INTO v_wishlist_id;
  END IF;

  IF v_wishlist_id IS NULL THEN
    INSERT INTO public.wishlist_items
      (user_id, restaurant_id, job_id, extraction_status, source, note, client_nonce)
    VALUES
      (p_user_id, v_restaurant_id, v_job_id, 'resolved', p_source, p_note, p_client_nonce)
    ON CONFLICT (user_id, client_nonce) WHERE client_nonce IS NOT NULL AND deleted_at IS NULL
    DO NOTHING
    RETURNING id INTO v_wishlist_id;
  END IF;

  -- ── 5. Insert table_share row if a table was specified ────────────────────
  -- FIX P1 + ghost quarantine: only write if (a) we have a resolved restaurant
  --   (ghost quarantine: unresolved spots are wishlist-only per spec) AND
  --   (b) the user is actually a member of the table (tenant isolation).
  IF p_table_id IS NOT NULL THEN

    -- FIX P1 + Codex round-2: Ghost quarantine.
    -- Exclude BOTH: (a) unresolved spots (v_restaurant_id IS NULL) AND (b) minted ghosts
    -- that have a v_restaurant_id but are still 'unverified'. The old NULL-only check was
    -- unreachable for ghosts minted in step 2 (they always produce a v_restaurant_id).
    -- Only Places-resolved, verified restaurants are eligible for table_shares.
    IF v_restaurant_id IS NULL OR v_verification IS DISTINCT FROM 'verified' THEN
      -- Wishlist row was written above. Skip the share silently.
      RETURN jsonb_build_object(
        'status',      'saved',
        'job_id',      v_job_id,
        'wishlist_id', v_wishlist_id,
        'share_id',    NULL,
        'restaurant_id', v_restaurant_id
      );
    END IF;

    -- FIX P1: Membership check — member_id column (TICKET-034 doctrine, NOT user_id).
    IF NOT EXISTS (
      SELECT 1 FROM public.table_members
      WHERE table_id  = p_table_id
        AND member_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'NOT_A_MEMBER: user % is not a member of table %', p_user_id, p_table_id;
    END IF;

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

-- Permissions unchanged from 20260610000200 (REVOKE/GRANT already applied).
-- Re-apply to be safe since CREATE OR REPLACE resets to session defaults.
REVOKE ALL ON FUNCTION public.fn_save_import_spot FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_save_import_spot TO service_role;

COMMENT ON FUNCTION public.fn_save_import_spot IS
  'SECURITY DEFINER: idempotent per-spot wishlist save with optional table share. '
  'Fix-pass-1: ghost external_id minting (user+nonce), membership check (member_id), '
  'ghost quarantine (no table_share for unresolved ghosts). '
  'Fix-pass-2: v_verification read + extended quarantine (unverified ghosts excluded from '
  'table_shares); soft-delete resurrection (avoids UNIQUE(user_id,restaurant_id) collision '
  'on re-import of a soft-deleted wishlist row). [TICKET-063 fix-pass-2]';
