-- TICKET-060: import_jobs table + fn_create_import SECURITY DEFINER.
-- [R1/R2/R6/R11] Server-owned async capture model.
--
-- import_jobs is the unit of async capture. One job per user × content × confirm-window.
-- The client makes ONE mutation to create_import → fn_create_import writes this row
-- PLUS all pending destination rows (wishlist + table_shares) atomically.
-- The async extractor PATCHes the JOB (status pending→resolved|needs_confirm|failed),
-- and the resolved restaurant_id propagates to all destination rows at once.
--
-- RLS ON (R6): owner-read/update only. Service-role does the actual work.
-- FK ON DELETE defined on all columns (R11).

CREATE TABLE IF NOT EXISTS public.import_jobs (
  job_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  content_hash  text,
  source        jsonb,                          -- WishlistSource discriminated union
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'resolved', 'needs_confirm', 'failed')),
  restaurant_id uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);

CREATE INDEX IF NOT EXISTS import_jobs_user_id_idx
  ON public.import_jobs (user_id);

CREATE INDEX IF NOT EXISTS import_jobs_content_hash_idx
  ON public.import_jobs (content_hash)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS import_jobs_status_idx
  ON public.import_jobs (status)
  WHERE status = 'pending';

-- RLS ON (R6)
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

-- Owner can read and update their own jobs (service-role does the writes via fn_create_import).
CREATE POLICY import_jobs_owner_select ON public.import_jobs
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY import_jobs_owner_update ON public.import_jobs
  FOR UPDATE USING (user_id = auth.uid());

-- Service-role (edge functions) bypass RLS — these policies are defense-in-depth
-- for the anon/auth key path.

COMMENT ON TABLE public.import_jobs IS
  'Async capture job: one row per user×content save. Status: pending→resolved|needs_confirm|failed. [TICKET-060 R1/R2]';

-- ─── Alter wishlist_items for async capture ───────────────────────────────────
-- restaurant_id becomes nullable for pending rows (resolves from job on extraction).
-- job_id links to import_jobs; extraction_status mirrors the job's status.
-- deleted_at for soft-delete (needed by float verified-save filter).

ALTER TABLE public.wishlist_items
  ALTER COLUMN restaurant_id DROP NOT NULL;

ALTER TABLE public.wishlist_items
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.import_jobs(job_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS extraction_status text
    CHECK (extraction_status IS NULL OR extraction_status IN ('pending','resolved','needs_confirm','failed')),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS wishlist_items_job_id_idx
  ON public.wishlist_items (job_id)
  WHERE job_id IS NOT NULL;

-- ─── fn_create_import ─────────────────────────────────────────────────────────
-- SECURITY DEFINER: writes job + all destination rows atomically.
-- Called from table-shares edge fn AFTER membership validation.
-- Parameters:
--   p_user_id       — the authenticated saver
--   p_content_hash  — sha256 of the normalized content (may be NULL for URL-only resolves)
--   p_source        — WishlistSource jsonb
--   p_wishlist      — true → insert a wishlist_items row (restaurant_id NULL, job_id set)
--   p_table_ids     — array of table UUIDs to post shared-restaurant cards to

CREATE OR REPLACE FUNCTION public.fn_create_import(
  p_user_id       uuid,
  p_content_hash  text,
  p_source        jsonb,
  p_wishlist      boolean DEFAULT true,
  p_table_ids     uuid[]  DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id        uuid;
  v_wishlist_id   uuid;
  v_share_ids     uuid[];
  v_share_id      uuid;
  v_table_id      uuid;
BEGIN
  -- Insert the job row
  INSERT INTO public.import_jobs (user_id, content_hash, source, status)
  VALUES (p_user_id, p_content_hash, p_source, 'pending')
  RETURNING job_id INTO v_job_id;

  -- Insert wishlist destination row (restaurant_id NULL until extract resolves it)
  IF p_wishlist THEN
    INSERT INTO public.wishlist_items (user_id, restaurant_id, job_id, extraction_status)
    VALUES (p_user_id, NULL, v_job_id, 'pending')
    RETURNING id INTO v_wishlist_id;
  END IF;

  -- Insert table_shares destination rows for each table
  v_share_ids := '{}';
  FOREACH v_table_id IN ARRAY p_table_ids
  LOOP
    INSERT INTO public.table_shares (job_id, table_id, author_id, restaurant_id, extraction_status)
    VALUES (v_job_id, v_table_id, p_user_id, NULL, 'pending')
    RETURNING id INTO v_share_id;
    v_share_ids := array_append(v_share_ids, v_share_id);
  END LOOP;

  RETURN jsonb_build_object(
    'job_id',       v_job_id,
    'wishlist_id',  v_wishlist_id,
    'share_ids',    v_share_ids
  );
END;
$$;

-- Lock to service_role only
REVOKE ALL ON FUNCTION public.fn_create_import FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_import TO service_role;

COMMENT ON FUNCTION public.fn_create_import IS
  'SECURITY DEFINER: atomically writes import_jobs row + all pending destination rows. [TICKET-060 R1/R2]';
