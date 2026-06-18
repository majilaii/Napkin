-- TICKET-083 b48: let an already-pinned spot still reach the table(s).
--
-- Multi-select tables on the share card fans one import out to N tables by calling
-- save_spots once per table (same per-spot wishlist client_nonce, distinct per-table
-- client_nonce). But fn_save_import_spot (20260610000300) RETURNs 'already_pinned'
-- the moment a wishlist row exists for (user, restaurant) — BEFORE the table-share
-- step. So the first table call pins + shares, and every subsequent table call
-- short-circuits at already_pinned and silently drops its share. Result: a spot
-- already in your wishlist (or the 2nd..Nth table of a multi-table import) never
-- reaches those tables.
--
-- Fix: only early-return 'already_pinned' when NO table was requested. When a table
-- IS requested and the wishlist row already exists, keep the existing row (skip the
-- insert) and fall through to the membership-checked, ghost-quarantined table-share
-- insert. Everything else (ghost minting, verification read, soft-delete
-- resurrection, ON CONFLICT idempotency, permissions) is preserved verbatim.

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
  v_job_id              uuid;
  v_restaurant_id       uuid;
  v_wishlist_id         uuid;
  v_share_id            uuid;
  v_existing            boolean;
  v_ghost_ext_id        text;
  v_verification        text;
  v_skip_wishlist_insert boolean := false;
BEGIN
  -- ── 1. Upsert or find the import_jobs row for this import_nonce ──────────
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

  ELSIF p_external_id IS NOT NULL AND p_external_id != '' AND p_external_id != 'ghost_pending' THEN
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
  IF v_restaurant_id IS NOT NULL THEN
    SELECT verification INTO v_verification
    FROM public.restaurants
    WHERE id = v_restaurant_id;
  END IF;

  -- ── 3. Check existing wishlist row ───────────────────────────────────────
  -- CHANGED (b48): only early-return when NO table is requested. With a table
  -- requested, keep the existing wishlist row and fall through to the share so a
  -- spot already in the wishlist (or the 2nd..Nth table of a multi-table fan-out)
  -- still reaches the table.
  IF v_restaurant_id IS NOT NULL THEN
    SELECT id INTO v_wishlist_id
    FROM public.wishlist_items
    WHERE user_id = p_user_id
      AND restaurant_id = v_restaurant_id
      AND deleted_at IS NULL
    LIMIT 1;

    v_existing := v_wishlist_id IS NOT NULL;

    IF v_existing THEN
      IF p_table_id IS NULL THEN
        RETURN jsonb_build_object(
          'status',         'already_pinned',
          'job_id',         v_job_id,
          'restaurant_id',  v_restaurant_id
        );
      END IF;
      -- Table requested: reuse the existing wishlist row, skip the insert below.
      v_skip_wishlist_insert := true;
    END IF;
  END IF;

  -- ── 4. Insert wishlist row (unless it already exists) ─────────────────────
  IF NOT v_skip_wishlist_insert THEN
    -- Soft-delete resurrection (avoids UNIQUE(user_id,restaurant_id) collision).
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
  END IF;

  -- ── 5. Insert table_share row if a table was specified ────────────────────
  IF p_table_id IS NOT NULL THEN

    -- Ghost quarantine: only Places-resolved, verified restaurants reach tables.
    IF v_restaurant_id IS NULL OR v_verification IS DISTINCT FROM 'verified' THEN
      RETURN jsonb_build_object(
        'status',      CASE WHEN v_skip_wishlist_insert THEN 'already_pinned' ELSE 'saved' END,
        'job_id',      v_job_id,
        'wishlist_id', v_wishlist_id,
        'share_id',    NULL,
        'restaurant_id', v_restaurant_id
      );
    END IF;

    -- Membership check — member_id column (TICKET-034 doctrine, NOT user_id).
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
    'status',         CASE WHEN v_skip_wishlist_insert THEN 'already_pinned' ELSE 'saved' END,
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

REVOKE ALL ON FUNCTION public.fn_save_import_spot FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_save_import_spot TO service_role;

COMMENT ON FUNCTION public.fn_save_import_spot IS
  'SECURITY DEFINER: idempotent per-spot wishlist save with optional table share. '
  'b48: already-pinned spots still reach the table when p_table_id is set (multi-table '
  'fan-out no longer drops 2nd..Nth tables). Retains ghost minting, verification read, '
  'ghost quarantine, membership check (member_id), soft-delete resurrection.';
