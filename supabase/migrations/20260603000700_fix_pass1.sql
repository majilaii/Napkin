-- TICKET-060 Fix Pass 1 — addresses all P0 migration blockers from Review 1.
--
-- [CX-2]  REVOKE direct DML on import_jobs / table_shares / table_float_state;
--          force writes through service-role RPCs. Keep SELECT (already RLS-gated).
-- [CX-3]  Restrict public restaurants SELECT policy to verified OR owner.
-- [CX-4]  Fix trigger mismatch: patch sync_post_counts_and_top_emojis() to handle
--          'table_share' target; the live triggers call this function (not sync_post_counts).
-- [H-1/H-2] fn_compute_table_float: enforce p_threshold; expose helper
--            fn_detect_and_surface_float for the extract path to call.
-- [H-3]   Create import-uploads Storage bucket + owner-only RLS policies.
-- [H-5]   Add cascade delete trigger on table_shares (orphaned reactions/comments).
-- [CX-5]  fn_complete_import_job SECURITY DEFINER — transactional job completion.
--         Updates import_jobs + all destination rows in ONE transaction.

-- ─── [CX-2] Revoke direct DML on the three new social tables ────────────────────
-- Service-role edge functions bypass RLS, so restricting authenticated/anon DML
-- forces all writes through edge functions (fn_create_import / fn_complete_import_job
-- / fn_create_import are SECURITY DEFINER and already use service_role).
--
-- We keep the existing RLS SELECT policies (they are the correct membership gate).
-- We DROP the existing INSERT/UPDATE policies that allowed auth key DML and replace
-- them with strict ones, or remove them entirely (service-role is the write path).

-- import_jobs: drop the owner-update policy (prevents client from manually patching
-- status or restaurant_id outside the guarded transition RPC)
DROP POLICY IF EXISTS import_jobs_owner_update ON public.import_jobs;

-- Re-add with a status-transition guard: clients can only update notes / non-status
-- fields. Actually, to simplify: only service-role writes; drop client update path entirely.
-- If a client needs to read their own jobs (the SELECT policy) that stays.
-- No INSERT policy exists on import_jobs; fn_create_import (SECURITY DEFINER) handles inserts.
-- We leave SELECT to maintain read access for clients.

-- table_shares: the author_insert and author_update policies allow a hand-crafted
-- authenticated request to insert into any table_id. Remove them; edge fn (service-role) is
-- the only write path.
DROP POLICY IF EXISTS table_shares_author_insert ON public.table_shares;
DROP POLICY IF EXISTS table_shares_author_update ON public.table_shares;

-- table_float_state: no INSERT/UPDATE policies existed; nothing to drop. Service-role only.

-- ─── [CX-3] Restrict restaurants SELECT policy to verified OR owner ──────────────
-- The existing "Restaurants are publicly readable" / "restaurants readable" policies
-- use USING (true), which exposes unverified model-created ghosts to any client.
-- Replace with: verification='verified' OR (created_by = auth.uid()).

-- Drop all existing permissive SELECT policies on restaurants
DROP POLICY IF EXISTS "Allow public read restaurants"        ON public.restaurants;
DROP POLICY IF EXISTS "Restaurants are publicly readable"    ON public.restaurants;
DROP POLICY IF EXISTS "restaurants readable"                 ON public.restaurants;

-- Create the restricted read policy
CREATE POLICY restaurants_verified_or_owner_select ON public.restaurants
  FOR SELECT USING (
    verification = 'verified'
    OR created_by = auth.uid()
  );

-- ─── [CX-4] Fix trigger mismatch: add table_share branch to sync_post_counts_and_top_emojis ─
-- The live triggers (sync_counts_on_reaction, sync_counts_on_comment) call
-- sync_post_counts_and_top_emojis() — NOT sync_post_counts().
-- Migration 20260603000600 created sync_post_counts() with the table_share branch
-- but the live triggers never call it. Fix: extend sync_post_counts_and_top_emojis().

CREATE OR REPLACE FUNCTION public.sync_post_counts_and_top_emojis()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_target_type TEXT;
    v_target_id   UUID;
    v_scope       TEXT;
    v_reaction_count INT;
    v_comment_count  INT;
    v_top_emojis JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_type := OLD.target_type;
        v_target_id   := OLD.target_id;
        v_scope       := OLD.scope;
    ELSE
        v_target_type := NEW.target_type;
        v_target_id   := NEW.target_id;
        v_scope       := NEW.scope;
    END IF;

    -- Recount within the changed row's scope only
    SELECT COUNT(*) INTO v_reaction_count
    FROM post_reactions
    WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope;

    SELECT COUNT(*) INTO v_comment_count
    FROM post_comments
    WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope;

    SELECT COALESCE(
        jsonb_agg(jsonb_build_object('emoji', emoji, 'count', cnt, 'last_reacted_at', last_at)
                  ORDER BY cnt DESC, last_at DESC),
        '[]'::jsonb
    ) INTO v_top_emojis
    FROM (
        SELECT emoji, COUNT(*) AS cnt, MAX(created_at) AS last_at
        FROM post_reactions
        WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope
        GROUP BY emoji
    ) sub;

    IF v_target_type = 'table_night' THEN
        UPDATE public.table_nights
        SET reaction_count = v_reaction_count,
            comment_count  = v_comment_count,
            top_emojis     = v_top_emojis
        WHERE id = v_target_id;

    ELSIF v_target_type = 'entry' THEN
        IF v_scope = 'table' THEN
            UPDATE public.entries
            SET reaction_count = v_reaction_count,
                comment_count  = v_comment_count,
                top_emojis     = v_top_emojis
            WHERE id = v_target_id;
        ELSE
            UPDATE public.entries
            SET public_reaction_count = v_reaction_count,
                public_reply_count    = v_comment_count,
                public_top_emojis     = v_top_emojis
            WHERE id = v_target_id;
        END IF;

    ELSIF v_target_type = 'table_share' THEN
        -- [TICKET-060 CX-4/B1] Write reaction_count + top_emojis back to table_shares.
        -- table_shares has no comment_count (comments on shared cards not in v1 scope).
        UPDATE public.table_shares
        SET reaction_count = v_reaction_count,
            top_emojis = (
                -- table_shares.top_emojis is text[] (not jsonb), so extract just the emoji strings
                SELECT COALESCE(array_agg(emoji ORDER BY cnt DESC), '{}')
                FROM (
                    SELECT emoji, COUNT(*) AS cnt
                    FROM public.post_reactions pr
                    WHERE pr.target_id   = v_target_id
                      AND pr.target_type = 'table_share'
                      AND pr.scope       = 'table'
                    GROUP BY emoji
                    ORDER BY cnt DESC
                    LIMIT 3
                ) sub2
            )
        WHERE id = v_target_id;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.sync_post_counts_and_top_emojis IS
  'Denorm trigger: keeps reaction_count/comment_count/top_emojis on table_nights, entries, and table_shares in sync. Extended for table_share target in TICKET-060 (CX-4/B1).';

-- ─── [H-5] Cascade delete trigger on table_shares (orphaned reactions/comments) ─
-- When a table_share row is deleted (via CASCADE from import_jobs or tables),
-- the corresponding post_reactions/post_comments rows are orphaned (no FK to clean them).
-- This trigger reaps them, matching the pattern on table_nights and entries.

CREATE OR REPLACE FUNCTION public.cascade_delete_post_interactions_extended()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'table_nights' THEN
        DELETE FROM public.post_reactions WHERE target_type = 'table_night' AND target_id = OLD.id;
        DELETE FROM public.post_comments  WHERE target_type = 'table_night' AND target_id = OLD.id;
    ELSIF TG_TABLE_NAME = 'entries' THEN
        DELETE FROM public.post_reactions WHERE target_type = 'entry' AND target_id = OLD.id;
        DELETE FROM public.post_comments  WHERE target_type = 'entry' AND target_id = OLD.id;
    ELSIF TG_TABLE_NAME = 'table_shares' THEN
        DELETE FROM public.post_reactions WHERE target_type = 'table_share' AND target_id = OLD.id;
        DELETE FROM public.post_comments  WHERE target_type = 'table_share' AND target_id = OLD.id;
    END IF;
    RETURN OLD;
END;
$$;

-- Recreate the existing triggers to use the extended function
DROP TRIGGER IF EXISTS cascade_interactions_on_table_night_delete ON public.table_nights;
CREATE TRIGGER cascade_interactions_on_table_night_delete
    AFTER DELETE ON public.table_nights
    FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_post_interactions_extended();

DROP TRIGGER IF EXISTS cascade_interactions_on_entry_delete ON public.entries;
CREATE TRIGGER cascade_interactions_on_entry_delete
    AFTER DELETE ON public.entries
    FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_post_interactions_extended();

-- New trigger for table_shares
DROP TRIGGER IF EXISTS cascade_interactions_on_table_share_delete ON public.table_shares;
CREATE TRIGGER cascade_interactions_on_table_share_delete
    AFTER DELETE ON public.table_shares
    FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_post_interactions_extended();

COMMENT ON FUNCTION public.cascade_delete_post_interactions_extended IS
  'AFTER DELETE trigger: removes orphaned post_reactions/post_comments for table_nights, entries, and table_shares. Resolves the ARCHITECT-REVIEW open item from TICKET-060 B1.';

-- ─── [H-2 fix] fn_compute_table_float: enforce p_threshold ──────────────────────
-- The previous version returned one row per qualifying saver unconditionally —
-- the threshold was never applied. Replace with a version that uses HAVING to
-- enforce the minimum distinct-saver count.

CREATE OR REPLACE FUNCTION public.fn_compute_table_float(
  p_table_id      uuid,
  p_restaurant_id uuid,
  p_window_days   int DEFAULT 14,
  p_threshold     int DEFAULT 3
)
RETURNS TABLE (
  user_id          uuid,
  saved_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Only return rows when the distinct-saver count meets the threshold.
  -- The outer SELECT + EXISTS subquery enforces the threshold: we fetch all
  -- qualifying savers, count them, and only emit rows when count >= p_threshold.
  SELECT
    wi.user_id,
    wi.created_at AS saved_at
  FROM public.wishlist_items wi
  JOIN public.table_members tm
    ON tm.member_id = wi.user_id
   AND tm.table_id  = p_table_id
  JOIN public.restaurants r
    ON r.id = wi.restaurant_id
  WHERE wi.restaurant_id = p_restaurant_id
    AND r.verification   = 'verified'
    AND wi.deleted_at    IS NULL
    AND wi.created_at    > now() - (p_window_days || ' days')::interval
    AND (
      -- Subquery: assert distinct-saver count >= threshold before returning any rows
      SELECT COUNT(DISTINCT wi2.user_id)
      FROM public.wishlist_items wi2
      JOIN public.table_members tm2
        ON tm2.member_id = wi2.user_id
       AND tm2.table_id  = p_table_id
      JOIN public.restaurants r2
        ON r2.id = wi2.restaurant_id
      WHERE wi2.restaurant_id = p_restaurant_id
        AND r2.verification   = 'verified'
        AND wi2.deleted_at    IS NULL
        AND wi2.created_at    > now() - (p_window_days || ' days')::interval
    ) >= p_threshold
  ORDER BY wi.created_at ASC;
$$;

-- Lock to service_role (re-apply after CREATE OR REPLACE)
REVOKE ALL ON FUNCTION public.fn_compute_table_float FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compute_table_float TO service_role;

COMMENT ON FUNCTION public.fn_compute_table_float IS
  'SECURITY DEFINER: returns current-member user_ids who saved a VERIFIED restaurant in-window, ONLY when distinct-saver count >= p_threshold. Privacy boundary: Table-scoped, single-restaurant, current-members-only, verified-only. Threshold enforced in SQL. [TICKET-060 H2/H3/R5]';

-- ─── [H-1] fn_detect_and_surface_float — helper called after each wishlist save ─
-- After extraction resolves a wishlist_items row, the extract path calls this
-- function for each Table the saver belongs to. If the distinct-saver count
-- >= p_threshold, it UPSERTs a table_float_state row with surfaced_at=now(),
-- honoring the (table_id, restaurant_id, saver_set_hash) suppression key.

CREATE OR REPLACE FUNCTION public.fn_detect_and_surface_float(
  p_table_id      uuid,
  p_restaurant_id uuid,
  p_window_days   int DEFAULT 14,
  p_threshold     int DEFAULT 3
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_savers    uuid[];
  v_hash      text;
  v_count     int;
  v_win_start timestamptz;
  v_win_end   timestamptz;
BEGIN
  -- Collect qualifying savers (verified, current members, in-window)
  SELECT
    array_agg(DISTINCT wi.user_id ORDER BY wi.user_id),
    COUNT(DISTINCT wi.user_id),
    min(wi.created_at),
    now()
  INTO v_savers, v_count, v_win_start, v_win_end
  FROM public.wishlist_items wi
  JOIN public.table_members tm
    ON tm.member_id = wi.user_id
   AND tm.table_id  = p_table_id
  JOIN public.restaurants r
    ON r.id = wi.restaurant_id
  WHERE wi.restaurant_id = p_restaurant_id
    AND r.verification   = 'verified'
    AND wi.deleted_at    IS NULL
    AND wi.created_at    > now() - (p_window_days || ' days')::interval;

  -- Only proceed if threshold is met
  IF v_count < p_threshold OR v_savers IS NULL THEN
    RETURN;
  END IF;

  -- Compute a stable hash of the sorted saver uuid array
  v_hash := encode(sha256(array_to_string(v_savers, ',')::bytea), 'hex');

  -- UPSERT: if this exact saver-set hasn't been surfaced (or was suppressed
  -- and suppression has expired), surface it now.
  INSERT INTO public.table_float_state (
    table_id, restaurant_id, saver_set_hash, saver_user_ids,
    window_start, window_end, distinct_count, surfaced_at
  )
  VALUES (
    p_table_id, p_restaurant_id, v_hash, v_savers,
    v_win_start, v_win_end, v_count, now()
  )
  ON CONFLICT (table_id, restaurant_id, saver_set_hash) DO UPDATE
    SET surfaced_at    = CASE
                           WHEN table_float_state.dismissed_at IS NOT NULL
                             OR (table_float_state.suppressed_until IS NOT NULL
                                 AND table_float_state.suppressed_until < now())
                           THEN now()
                           ELSE table_float_state.surfaced_at
                         END,
        distinct_count = EXCLUDED.distinct_count,
        window_end     = EXCLUDED.window_end;

EXCEPTION
  WHEN others THEN
    -- Float detection is best-effort; never block the save
    NULL;
END;
$$;

-- Lock to service_role
REVOKE ALL ON FUNCTION public.fn_detect_and_surface_float FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_detect_and_surface_float TO service_role;

COMMENT ON FUNCTION public.fn_detect_and_surface_float IS
  'Called after each wishlist save resolves. Checks if distinct-saver count >= threshold for this (table, restaurant). If yes, UPSERTs a table_float_state row with surfaced_at=now(), honoring the saver-set suppression key. [TICKET-060 H-1]';

-- ─── [CX-5] fn_complete_import_job — transactional job completion ─────────────
-- Replaces the non-transactional three-update sequence in handleAsyncExtract.
-- Locks the pending job, validates the pending→terminal transition, updates
-- import_jobs + all wishlist_items + all table_shares in ONE transaction.
-- Throws on any failed update so the caller can observe and log the failure.

CREATE OR REPLACE FUNCTION public.fn_complete_import_job(
  p_job_id       uuid,
  p_status       text,        -- 'resolved' | 'needs_confirm' | 'failed'
  p_restaurant_id uuid         -- NULL when status != 'resolved'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
BEGIN
  -- Validate allowed terminal statuses
  IF p_status NOT IN ('resolved', 'needs_confirm', 'failed') THEN
    RAISE EXCEPTION 'Invalid terminal status: %', p_status;
  END IF;

  -- Lock the job row and read current status
  SELECT status INTO v_current_status
  FROM public.import_jobs
  WHERE job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found: %', p_job_id;
  END IF;

  -- Enforce pending→terminal transition
  IF v_current_status != 'pending' THEN
    -- Already processed — idempotent return (no exception)
    RETURN;
  END IF;

  -- Update job
  UPDATE public.import_jobs
  SET status        = p_status,
      restaurant_id = p_restaurant_id,
      resolved_at   = now()
  WHERE job_id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update import_jobs row: %', p_job_id;
  END IF;

  -- Update all destination wishlist_items
  UPDATE public.wishlist_items
  SET restaurant_id    = p_restaurant_id,
      extraction_status = p_status
  WHERE job_id = p_job_id;

  -- Update all destination table_shares
  UPDATE public.table_shares
  SET restaurant_id    = p_restaurant_id,
      extraction_status = p_status
  WHERE job_id = p_job_id;

END;
$$;

-- Lock to service_role
REVOKE ALL ON FUNCTION public.fn_complete_import_job FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_complete_import_job TO service_role;

COMMENT ON FUNCTION public.fn_complete_import_job IS
  'SECURITY DEFINER: transactionally completes an import job. Locks the pending job, validates pending→terminal transition, updates import_jobs + all destination rows in ONE transaction. Throws on failure. [TICKET-060 CX-5]';

-- ─── [H-3] import-uploads Storage bucket + owner-only RLS ──────────────────────
-- The screenshot path uploads to 'import-uploads/<user_id>/<uuid>.jpg' but
-- no migration creates the bucket or its storage.objects policies.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'import-uploads',
  'import-uploads',
  false,
  5242880,     -- 5 MB limit
  ARRAY['image/jpeg','image/png','image/webp','image/heic']
)
ON CONFLICT (id) DO NOTHING;

-- Owner-only INSERT (upload): first path segment must equal auth.uid()
CREATE POLICY import_uploads_owner_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'import-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Owner-only SELECT (download): same constraint
CREATE POLICY import_uploads_owner_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'import-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Owner-only DELETE
CREATE POLICY import_uploads_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'import-uploads'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Service-role read (edge functions must be able to download images for extraction)
-- Service-role bypasses RLS, so no explicit policy is needed for it — just confirming.
