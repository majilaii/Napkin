-- TICKET-133: Revive the dormant table_invitations table as the consent gate
-- for owner-initiated adds. add_member now upserts a PENDING invitation instead
-- of seating the member; respond_invitation (accept|decline) does the real seat.
--
-- Replayability (locked doctrine): this migration is NOT a rename of any applied
-- version — its timestamp (20260708000000) is after the current head
-- (20260707180000). Every statement is idempotent (DROP ... IF EXISTS /
-- CREATE ... IF NOT EXISTS / CREATE POLICY guarded by prior DROP). On prod,
-- `db push` alters the live objects; on a fresh replay, table_invitations is
-- created at 20251222030000 then reshaped here. No dollar-quoted blocks are
-- used, so there is nothing to tag.
--
-- Blast radius: table_invitations had ZERO code references before this ticket,
-- so there are no existing PostgREST embeds to disambiguate. The only
-- readers/writers are the edge actions added in this release
-- (table-management: add_member, respond_invitation, pending_invitations,
-- join_by_invite side-effect; notifications: hydration batched select).

-- ── (a) Uniqueness fix ──────────────────────────────────────────────────────
-- The original UNIQUE (table_id, invited_user_id, status) is broken for repeat
-- declines: a second decline collides with the first declined row. Replace it
-- with a PARTIAL unique index on status='pending' — at most one live invite per
-- (table, invitee), but any number of terminal (declined/expired/accepted) rows.
ALTER TABLE public.table_invitations
    DROP CONSTRAINT IF EXISTS table_invitations_unique_pending;
CREATE UNIQUE INDEX IF NOT EXISTS table_invitations_one_pending
    ON public.table_invitations (table_id, invited_user_id)
    WHERE status = 'pending';

-- ── (b) Kind CHECK: add the inviter-side accepted kind ──────────────────────
-- A CHECK cannot be ALTERed in place — drop + recreate (precedent
-- 20260707170000). Replay: 20260707170000 sets 7 kinds; this relaxes to 8.
-- Adding a value to an IN-list validates trivially over existing rows.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
    'friend_logged',
    'friend_pinned',
    'top_four_swap',
    'table_invite',
    'claim_city',
    'reservation_reminder',
    'import_done',
    'table_invite_accepted'
));

-- Shape hygiene for the new kind: recipient is the inviter, actor is the joiner,
-- subject is the table. Constrains ONLY table_invite_accepted rows (none exist),
-- so this ADD validates trivially.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_table_invite_accepted_shape;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_table_invite_accepted_shape CHECK (
    kind <> 'table_invite_accepted' OR (subject_table_id IS NOT NULL AND actor_user_id IS NOT NULL)
);

COMMENT ON CONSTRAINT notifications_table_invite_accepted_shape ON public.notifications IS
    'TICKET-133: table_invite_accepted rows go to the inviter (user_id), carry the joiner as actor_user_id and the table as subject_table_id.';

-- ── (c) RLS rewrite ─────────────────────────────────────────────────────────
-- The Dec-2025 SELECT policy already uses member_id correctly (tm.member_id =
-- auth.uid()) — VERIFIED, no member_id trap present. But the INSERT/UPDATE/DELETE
-- policies granted authenticated writes; doctrine is writes via service-role
-- only (the edge fn holds the authz). Drop all four and recreate a single SELECT
-- policy idempotently (invitee OR any table member may read the table's invites).
DROP POLICY IF EXISTS "Admins can create invitations"           ON public.table_invitations;
DROP POLICY IF EXISTS "Invited users can respond to invitations" ON public.table_invitations;
DROP POLICY IF EXISTS "Admins can delete invitations"           ON public.table_invitations;
DROP POLICY IF EXISTS "Members can view table invitations"      ON public.table_invitations;
DROP POLICY IF EXISTS "Members or invitee can view invitations" ON public.table_invitations;
CREATE POLICY "Members or invitee can view invitations"
ON public.table_invitations FOR SELECT TO authenticated
USING (
    invited_user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = table_invitations.table_id
          AND tm.member_id = auth.uid()          -- member_id, NOT user_id (TICKET-034 trap)
    )
);
-- No INSERT/UPDATE/DELETE policies: all writes go through the service-role edge fn.
