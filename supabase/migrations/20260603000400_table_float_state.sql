-- TICKET-060: table_float_state + fn_compute_table_float SECURITY DEFINER.
-- [H3/R4/R5/R6/R11] Emergent overlap float — "3 of you saved Kono this week — plan it?"
--
-- Keyed by saver-set (R4): suppression is per (table_id, restaurant_id, saver_set_hash).
-- A new saver yields a new saver_set_hash → re-eligibilizes a fresh float.
-- A dismissal suppresses only the exact saver-set for 30 days.
--
-- fn_compute_table_float (R5): filters verification='verified' + valid (non-deleted) wishlist.
-- Never surfaces unverified ghosts; never crosses Tables; strictly current-member saves.
--
-- RLS ON (R6): member-read, service-role update.

CREATE TABLE IF NOT EXISTS public.table_float_state (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id         uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  restaurant_id    uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  saver_set_hash   text NOT NULL,                 -- stable hash of sorted saver_user_ids
  saver_user_ids   uuid[] NOT NULL,               -- current-member savers who crossed threshold
  window_start     timestamptz NOT NULL,
  window_end       timestamptz NOT NULL,
  distinct_count   int NOT NULL DEFAULT 0,
  first_crossed_at timestamptz NOT NULL DEFAULT now(),
  surfaced_at      timestamptz,                   -- when the float card was shown in feed
  dismissed_at     timestamptz,                   -- when a member dismissed the float
  suppressed_until timestamptz,                   -- 30-day suppression after fire/dismiss

  -- Uniqueness: one float per (table, restaurant, saver-set). R4.
  UNIQUE (table_id, restaurant_id, saver_set_hash)
);

CREATE INDEX IF NOT EXISTS table_float_state_table_idx
  ON public.table_float_state (table_id, restaurant_id);

CREATE INDEX IF NOT EXISTS table_float_state_active_idx
  ON public.table_float_state (table_id)
  WHERE dismissed_at IS NULL AND surfaced_at IS NOT NULL;

-- RLS ON (R6)
ALTER TABLE public.table_float_state ENABLE ROW LEVEL SECURITY;

-- Member-read: must be a member of the table.
CREATE POLICY table_float_state_member_select ON public.table_float_state
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.table_members tm
      WHERE tm.table_id = table_float_state.table_id
        AND tm.member_id = auth.uid()
    )
  );

-- ─── fn_compute_table_float ───────────────────────────────────────────────────
-- SECURITY DEFINER: the H3/R5 privacy boundary.
-- Returns ONLY current-member user_ids who have a valid (non-soft-deleted)
-- wishlist save for the specified verified restaurant within the window.
--
-- Privacy invariants (H3/R5):
--   - Only current Table members (joined via table_members.member_id).
--   - Only the specific floated restaurant (p_restaurant_id).
--   - Only verified restaurants (r.verification = 'verified').
--   - Only valid (non-deleted) wishlist rows (wi.deleted_at IS NULL).
--   - Only saves within the rolling window (p_window_days).
--   - Never crosses Tables; never returns the member's broader wishlist.
--   - Never a non-member's save.

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
  ORDER BY wi.created_at ASC;
$$;

-- Lock to service_role
REVOKE ALL ON FUNCTION public.fn_compute_table_float FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_compute_table_float TO service_role;

COMMENT ON FUNCTION public.fn_compute_table_float IS
  'SECURITY DEFINER: returns current-member user_ids who saved a VERIFIED restaurant in-window. Privacy boundary: Table-scoped, single-restaurant, current-members-only, verified-only. [TICKET-060 H3/R5]';

COMMENT ON TABLE public.table_float_state IS
  'Emergent overlap float state. Keyed by (table_id, restaurant_id, saver_set_hash) so a new saver re-eligibilizes. [TICKET-060 R4]';
