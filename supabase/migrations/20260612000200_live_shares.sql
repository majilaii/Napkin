-- TICKET-077: live shares — unfreeze the handoff.
--
-- The frozen-snapshot doctrine from TICKET-072 is REVERSED. A share token now
-- references (owner_id, list_id?) and is resolved LIVE at view time: the public
-- share-page, the in-app resolve, and the pin path all read the owner's CURRENT
-- verified spots + CURRENT ratings off owner_id (+ list_id for per-list shares).
--
-- Schema changes (plain ALTERs only — no function redefinition, no return-type
-- traps, no CREATE OR REPLACE):
--   (a) ADD list_id uuid NULL REFERENCES lists(id) ON DELETE CASCADE.
--       NULL list_id  → wishlist share (live off wishlist_items).
--       non-NULL      → per-list share (live off list_entries; CASCADE so a
--                       deleted list takes its shares with it → tombstone).
--   (b) snapshot becomes vestigial: stop writing it (new rows insert it NULL),
--       stop reading it. Old rows keep their frozen blob — it is never read again.
--       Drop NOT NULL + drop the shape CHECK so NULL inserts are accepted.
--       Do NOT drop the column (old rows still carry it; nothing reads it).

-- ── (a) list_id ────────────────────────────────────────────────────────────────
ALTER TABLE public.wishlist_shares
    ADD COLUMN IF NOT EXISTS list_id uuid NULL
        REFERENCES public.lists(id) ON DELETE CASCADE;

-- Optional supporting index: per-list share lookups by (owner_id, list_id).
-- Live tokens only — mirrors the existing wishlist_shares_owner_live_idx scope.
CREATE INDEX IF NOT EXISTS wishlist_shares_owner_list_live_idx
    ON public.wishlist_shares (owner_id, list_id)
    WHERE revoked_at IS NULL;

-- ── (b) snapshot → vestigial ────────────────────────────────────────────────────
-- New rows insert snapshot = NULL; the column is no longer read by any path.
ALTER TABLE public.wishlist_shares
    ALTER COLUMN snapshot DROP NOT NULL;

-- Drop the structural CHECK: it required snapshot to be an object with
-- sharer_name + spots[]. We no longer build a snapshot, so a NULL (or any old
-- frozen blob) must be accepted. CHECK on NULL is SQL-true, but the constraint
-- is meaningless now — drop it rather than leave a dead guard around.
ALTER TABLE public.wishlist_shares
    DROP CONSTRAINT IF EXISTS wishlist_shares_snapshot_shape;

-- ── Security: NO RLS / grant change (deliberate) ─────────────────────────────────
-- wishlist_shares has REVOKE ALL FROM anon, authenticated, PUBLIC and ZERO RLS
-- policies (see 20260611000100_wishlist_shares.sql). The new list_id column
-- inherits that lockdown: column-level grants do not auto-extend, but since the
-- table carries NO table-level grant to anon/authenticated at all, there is
-- nothing to extend and nothing a client can read or write. The public path
-- remains exclusively the share-page / handoff / resolve-url edge functions,
-- all running under the service-role key (which bypasses RLS). This is the same
-- service-role-only posture TICKET-072 locked; live reads do not loosen it.
--
-- Regression invariant (unchanged): pg_policies WHERE tablename='wishlist_shares'
-- must still return ZERO rows after this migration.
