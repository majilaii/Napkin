-- TICKET-060 Fix Pass 2 — addresses cycle-2 review blockers N1–N9.
--
-- N5  — Lock restaurants INSERT/UPDATE policies so clients cannot set/raise
--        verification to 'verified' directly.
-- N6  — Fix fn_detect_and_surface_float UPSERT: clear dismissed_at /
--        suppressed_until when re-surfacing after the cap expires.
--        Dismiss path: set suppressed_until = now() + 30 days.
-- N8  — fn_correct_import_job SECURITY DEFINER RPC: transactional correction
--        (replaces the three non-transactional updates in handleCorrect).

-- ─── [N5] Restrict restaurants INSERT/UPDATE so clients cannot set verification ─
--
-- Pre-existing policies allow any authenticated client to INSERT with
-- verification='verified' or UPDATE the verification flag, defeating the H4/R3
-- ghost quarantine. Fix: clients are NOT allowed to write verification or
-- created_by; those fields may only be written by service-role edge functions.
-- Strategy: drop the permissive WITH CHECK(true) policies and replace them with
-- ones that either (a) block direct client DML on restaurants entirely (safest —
-- all legitimate writes go through the edge function upsertRestaurant which
-- already uses service-role), or (b) constrain the write so verification cannot
-- be raised by a client.
-- We go with (a): drop client INSERT/UPDATE policies and let service-role do all
-- restaurant writes, consistent with the CX-2 lockdown doctrine.

DROP POLICY IF EXISTS "Allow authenticated insert restaurants"    ON public.restaurants;
DROP POLICY IF EXISTS "Authenticated users can update restaurants" ON public.restaurants;
DROP POLICY IF EXISTS "allow_authenticated_insert_restaurants"     ON public.restaurants;
DROP POLICY IF EXISTS "allow_authenticated_update_restaurants"     ON public.restaurants;

-- Verify no orphan client-write policies remain (drop any variants found in
-- remote_schema lines 421/441/445/501 per the Review 2 finding).
-- The service-role key bypasses RLS so edge functions can still upsert freely.
-- The SELECT policy (verified OR owner) was added in fix_pass1 and is unchanged.

-- ─── [N6] Fix float suppression: clear dismissed_at on re-surface ─────────────
--
-- The original UPSERT set surfaced_at but never cleared dismissed_at.
-- Feed gate is: dismissed_at IS NULL.
-- So a dismissed float was permanently hidden — the 30-day suppression_until
-- cap was unreachable.
--
-- Fix A (chosen): On the ON CONFLICT re-surface branch:
--   - Only resurface when suppressed_until < now() (cap truly expired).
--   - When resurfacing: set dismissed_at = NULL, suppressed_until = NULL,
--     surfaced_at = now().
--   - Otherwise leave row unchanged (still suppressed).
--
-- Separately, the dismiss path (table-shares dismiss_float action) must set
-- suppressed_until = now() + 30 days. This is enforced in the SQL below via a
-- new fn_dismiss_float RPC (the edge fn was doing direct UPDATEs).

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

  -- UPSERT saver-set float row.
  -- On conflict (same table, restaurant, saver-set):
  --   Only resurface when suppressed_until < now() (30-day cap expired or never set).
  --   When resurfacing: clear dismissed_at + suppressed_until, update surfaced_at.
  --   If still within the suppression window: leave row UNCHANGED (no update).
  INSERT INTO public.table_float_state (
    table_id, restaurant_id, saver_set_hash, saver_user_ids,
    window_start, window_end, distinct_count, surfaced_at
  )
  VALUES (
    p_table_id, p_restaurant_id, v_hash, v_savers,
    v_win_start, v_win_end, v_count, now()
  )
  ON CONFLICT (table_id, restaurant_id, saver_set_hash) DO UPDATE
    SET surfaced_at      = CASE
                             -- Re-surface only when the suppression cap has expired
                             WHEN (
                               table_float_state.suppressed_until IS NULL
                               OR table_float_state.suppressed_until < now()
                             ) THEN now()
                             ELSE table_float_state.surfaced_at
                           END,
        dismissed_at     = CASE
                             -- Clear dismissed_at when re-surfacing after cap expiry
                             WHEN (
                               table_float_state.suppressed_until IS NULL
                               OR table_float_state.suppressed_until < now()
                             ) THEN NULL
                             ELSE table_float_state.dismissed_at
                           END,
        suppressed_until = CASE
                             -- Clear suppressed_until when re-surfacing
                             WHEN (
                               table_float_state.suppressed_until IS NULL
                               OR table_float_state.suppressed_until < now()
                             ) THEN NULL
                             ELSE table_float_state.suppressed_until
                           END,
        distinct_count   = EXCLUDED.distinct_count,
        window_end       = EXCLUDED.window_end;

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
  'Called after each wishlist save resolves. Upserts table_float_state when distinct-saver count >= threshold. ON CONFLICT: resurfaces (cleared dismissed_at/suppressed_until) only after suppression cap expires; otherwise leaves row unchanged. [TICKET-060 N6/H-new-2]';

-- ─── [N6b] fn_dismiss_float — enforces 30-day suppression cap ────────────────
-- The dismiss_float edge action was doing raw UPDATEs without setting
-- suppressed_until. This RPC centralises the dismiss logic and enforces the cap.

CREATE OR REPLACE FUNCTION public.fn_dismiss_float(
  p_table_id      uuid,
  p_restaurant_id uuid,
  p_saver_set_hash text,
  p_suppress_days  int DEFAULT 30
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.table_float_state
  SET dismissed_at     = now(),
      suppressed_until = now() + (p_suppress_days || ' days')::interval
  WHERE table_id       = p_table_id
    AND restaurant_id  = p_restaurant_id
    AND saver_set_hash = p_saver_set_hash;
  -- If the row doesn't exist, silently succeed (float already gone)
END;
$$;

REVOKE ALL ON FUNCTION public.fn_dismiss_float FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_dismiss_float TO service_role;

COMMENT ON FUNCTION public.fn_dismiss_float IS
  'SECURITY DEFINER: dismisses a float row and sets suppressed_until = now() + 30 days. Called from the dismiss_float edge action. [TICKET-060 N6]';

-- ─── [N8] fn_correct_import_job — transactional correction RPC ────────────────
-- The handleCorrect edge action was doing three separate .update() calls with
-- no error checks and no transaction (the sibling of CX-5).
-- This RPC mirrors fn_complete_import_job: locks the job, updates all
-- destination rows in ONE transaction, throws on any failure.

CREATE OR REPLACE FUNCTION public.fn_correct_import_job(
  p_job_id        uuid,
  p_user_id       uuid,       -- must match import_jobs.user_id (caller validation)
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
  -- Lock the job row and read owner
  SELECT user_id INTO v_owner
  FROM public.import_jobs
  WHERE job_id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job not found: %', p_job_id;
  END IF;

  -- Caller must be the job owner
  IF v_owner != p_user_id THEN
    RAISE EXCEPTION 'Forbidden: job % not owned by %', p_job_id, p_user_id;
  END IF;

  -- Update import_jobs
  UPDATE public.import_jobs
  SET restaurant_id = p_restaurant_id,
      status        = 'resolved',
      resolved_at   = now()
  WHERE job_id = p_job_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update import_jobs: %', p_job_id;
  END IF;

  -- Update all wishlist_items for this job
  UPDATE public.wishlist_items
  SET restaurant_id    = p_restaurant_id,
      extraction_status = 'resolved'
  WHERE job_id = p_job_id;

  -- Update all table_shares for this job
  UPDATE public.table_shares
  SET restaurant_id    = p_restaurant_id,
      extraction_status = 'resolved'
  WHERE job_id = p_job_id;

END;
$$;

REVOKE ALL ON FUNCTION public.fn_correct_import_job FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_correct_import_job TO service_role;

COMMENT ON FUNCTION public.fn_correct_import_job IS
  'SECURITY DEFINER: transactionally corrects an import job''s restaurant. Locks the job row, validates caller ownership, updates import_jobs + all wishlist_items + all table_shares in ONE transaction. Throws on any failure. [TICKET-060 N8/M-1-new]';
