-- TICKET-060: table_shares table.
-- [H2/R6/R11] "Shared restaurant" feed card posted into Table feed.
-- This is NOT a write to the emergent Table wishlist — it's a social "check this out"
-- card the author explicitly posts to a Table's feed.
--
-- RLS ON (R6): member-read, author-write/update.
-- FK ON DELETE (R11): cascade from table/job/author; SET NULL on restaurant.
-- No booking_url column — owner-private metadata only, until TICKET-061 defines reads. [L3/KEEP]

CREATE TABLE IF NOT EXISTS public.table_shares (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            uuid REFERENCES public.import_jobs(job_id) ON DELETE CASCADE,
  table_id          uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  author_id         uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  restaurant_id     uuid REFERENCES public.restaurants(id) ON DELETE SET NULL,
  note              text,
  source            jsonb,                      -- WishlistSource (subset for display)
  extraction_status text CHECK (extraction_status IS NULL OR extraction_status IN ('pending','resolved','needs_confirm','failed')),
  reaction_count    int  NOT NULL DEFAULT 0,
  top_emojis        text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS table_shares_table_id_idx
  ON public.table_shares (table_id, created_at DESC);

CREATE INDEX IF NOT EXISTS table_shares_author_id_idx
  ON public.table_shares (author_id);

CREATE INDEX IF NOT EXISTS table_shares_job_id_idx
  ON public.table_shares (job_id)
  WHERE job_id IS NOT NULL;

-- RLS ON (R6)
ALTER TABLE public.table_shares ENABLE ROW LEVEL SECURITY;

-- Member-read: caller must be a member of the table_id this share belongs to.
-- Uses member_id (NOT user_id) per CLAUDE.md doctrine.
CREATE POLICY table_shares_member_select ON public.table_shares
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.table_members tm
      WHERE tm.table_id = table_shares.table_id
        AND tm.member_id = auth.uid()
    )
  );

-- Author-insert (edge fn uses service-role; this guards the auth key path).
CREATE POLICY table_shares_author_insert ON public.table_shares
  FOR INSERT WITH CHECK (author_id = auth.uid());

-- Author-update: author can correct their own share.
CREATE POLICY table_shares_author_update ON public.table_shares
  FOR UPDATE USING (author_id = auth.uid());

COMMENT ON TABLE public.table_shares IS
  'Explicit "check this out" card posted by a user into a Table feed. NOT the emergent Table wishlist. [TICKET-060 H2/R6]';

COMMENT ON COLUMN public.table_shares.reaction_count IS
  'Denorm: maintained by sync_post_counts trigger extended for table_share target. [TICKET-060 B1]';
