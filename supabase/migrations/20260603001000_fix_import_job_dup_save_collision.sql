-- TICKET-060 fix pass 4 — Critical-1 (bug-patrol 2026-06-03).
--
-- BUG: fn_complete_import_job / fn_correct_import_job resolved a pending capture
-- with a bare `UPDATE wishlist_items SET restaurant_id = X WHERE job_id = ...`.
-- wishlist_items has UNIQUE(user_id, restaurant_id) (wishlist_items_user_restaurant_idx,
-- NOT partial). When extraction (or a user correction) resolves to a restaurant the
-- user ALREADY has on their wishlist — the most natural action: re-saving a spot you
-- already saved — the UPDATE violates the unique index. The SECURITY DEFINER function
-- raises, the ENTIRE transaction rolls back, and the import_jobs row + wishlist row +
-- every table_shares row for that job stay pending/needs_confirm FOREVER (card stuck
-- on "reading it…"). The error was only console.error'd by the caller.
--
-- FIX: when resolving to a non-NULL restaurant the user already has wishlisted, DELETE
-- the pending placeholder (the spot is already saved) instead of UPDATE-ing it into a
-- collision; otherwise UPDATE as before. The job/import_jobs row still resolves correctly
-- and points at the canonical restaurant. table_shares has no such unique constraint, so
-- its UPDATE is unchanged. A job has at most one wishlist row (fn_create_import inserts
-- one), so no self-collision is possible.
--
-- Idempotent (CREATE OR REPLACE). No schema change. Pure function-body fix.

-- ─── fn_complete_import_job (was 20260603000700_fix_pass1.sql) ────────────────
CREATE OR REPLACE FUNCTION public.fn_complete_import_job(
  p_job_id        uuid,
  p_status        text,        -- 'resolved' | 'needs_confirm' | 'failed'
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
  IF p_status NOT IN ('resolved', 'needs_confirm', 'failed') THEN
    RAISE EXCEPTION 'Invalid terminal status: %', p_status;
  END IF;

  SELECT status INTO v_current_status
  FROM public.import_jobs
  WHERE job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found: %', p_job_id;
  END IF;

  IF v_current_status != 'pending' THEN
    RETURN;  -- already processed — idempotent
  END IF;

  UPDATE public.import_jobs
  SET status        = p_status,
      restaurant_id = p_restaurant_id,
      resolved_at   = now()
  WHERE job_id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update import_jobs row: %', p_job_id;
  END IF;

  -- [fix-4] Avoid UNIQUE(user_id, restaurant_id) collision: drop placeholders whose
  -- resolved restaurant the user already has wishlisted, then update the remainder.
  IF p_restaurant_id IS NOT NULL THEN
    DELETE FROM public.wishlist_items wi
    WHERE wi.job_id = p_job_id
      AND EXISTS (
        SELECT 1 FROM public.wishlist_items ex
        WHERE ex.user_id = wi.user_id
          AND ex.restaurant_id = p_restaurant_id
          AND ex.id <> wi.id
      );
  END IF;

  UPDATE public.wishlist_items
  SET restaurant_id     = p_restaurant_id,
      extraction_status = p_status
  WHERE job_id = p_job_id;

  UPDATE public.table_shares
  SET restaurant_id     = p_restaurant_id,
      extraction_status = p_status
  WHERE job_id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_complete_import_job FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_complete_import_job TO service_role;

COMMENT ON FUNCTION public.fn_complete_import_job IS
  'SECURITY DEFINER: transactionally completes an import job. Locks the pending job, validates pending->terminal transition, updates import_jobs + all destination rows in ONE transaction. Drops wishlist placeholders that would collide with an already-wishlisted restaurant instead of raising. [TICKET-060 CX-5 + fix-4]';

-- ─── fn_correct_import_job (was 20260603000800_fix_pass2.sql) ─────────────────
CREATE OR REPLACE FUNCTION public.fn_correct_import_job(
  p_job_id        uuid,
  p_user_id       uuid,        -- must match import_jobs.user_id (caller validation)
  p_restaurant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner
  FROM public.import_jobs
  WHERE job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found: %', p_job_id;
  END IF;

  IF v_owner != p_user_id THEN
    RAISE EXCEPTION 'Forbidden: job % not owned by %', p_job_id, p_user_id;
  END IF;

  UPDATE public.import_jobs
  SET restaurant_id = p_restaurant_id,
      status        = 'resolved',
      resolved_at   = now()
  WHERE job_id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update import_jobs: %', p_job_id;
  END IF;

  -- [fix-4] same collision guard as fn_complete_import_job
  IF p_restaurant_id IS NOT NULL THEN
    DELETE FROM public.wishlist_items wi
    WHERE wi.job_id = p_job_id
      AND EXISTS (
        SELECT 1 FROM public.wishlist_items ex
        WHERE ex.user_id = wi.user_id
          AND ex.restaurant_id = p_restaurant_id
          AND ex.id <> wi.id
      );
  END IF;

  UPDATE public.wishlist_items
  SET restaurant_id     = p_restaurant_id,
      extraction_status = 'resolved'
  WHERE job_id = p_job_id;

  UPDATE public.table_shares
  SET restaurant_id     = p_restaurant_id,
      extraction_status = 'resolved'
  WHERE job_id = p_job_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_correct_import_job FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_correct_import_job TO service_role;

COMMENT ON FUNCTION public.fn_correct_import_job IS
  'SECURITY DEFINER: transactionally corrects an import job''s restaurant. Locks the job, validates caller ownership, updates import_jobs + all destination rows in ONE transaction. Drops wishlist placeholders that would collide with an already-wishlisted restaurant instead of raising. [TICKET-060 N8 + fix-4]';
