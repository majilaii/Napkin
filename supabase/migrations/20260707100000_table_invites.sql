-- Real invite-by-link for Tables — table_invites.
--
-- One live invite code per table. Any member may mint (looked up + returned if
-- one already exists); the owner may revoke. A code is redeemed via the
-- join_by_invite edge action, which inserts the redeemer into table_members.
--
-- The public landing page (table-invite-page) and every mutation run under the
-- service-role key, so this table follows EXACTLY the wishlist_shares
-- service-role-only posture (TICKET-072). Do NOT touch the fossil
-- `table_invitations` — this is a fresh, separate table.

CREATE TABLE public.table_invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id    uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
    code        text NOT NULL UNIQUE,           -- 22-char base64url minted in the edge fn
    created_by  uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz,                    -- NULL = live; set to revoke
    uses        int NOT NULL DEFAULT 0          -- best-effort redemption counter
);

-- Live-code lookup + the "one active code per table" invariant, DB-enforced:
-- a concurrent double-mint hits 23505 on this index and the edge fn re-reads
-- the winner instead of inserting a second live code.
CREATE UNIQUE INDEX table_invites_table_live_idx
    ON public.table_invites (table_id)
    WHERE revoked_at IS NULL;

-- ── Security: lock table_invites to service-role writes only ─────────────────
--
-- Load-bearing (identical posture to wishlist_shares, TICKET-072): this repo
-- grants ALL ON TABLES to `anon`/`authenticated` by default. Without an
-- explicit REVOKE, an authenticated client could INSERT/UPDATE rows directly —
-- forging codes, flipping revoked_at, minting invites for tables they don't
-- belong to, or bumping `uses` — bypassing the member-verified mint and
-- owner-only revoke paths in the `table-management` edge function.
--
-- Fix: strip ALL direct-client DML and read access. The only callers that touch
-- table_invites are the `table-management` and `table-invite-page` edge
-- functions, both of which run under the service-role key and BYPASS RLS.
--
-- RLS is still ENABLED (deny-by-default) so that if a future migration
-- accidentally re-grants a privilege, the absence of matching policies means
-- zero rows are accessible — no silent escalation.
--
-- Regression invariant: absence of policies IS the security assertion.
-- To verify: `SELECT * FROM pg_policies WHERE tablename = 'table_invites';`
-- must return zero rows after this migration.
REVOKE ALL ON TABLE public.table_invites FROM anon, authenticated, PUBLIC;

ALTER TABLE public.table_invites ENABLE ROW LEVEL SECURITY;

-- No DML or SELECT policies. Service role bypasses RLS; authenticated clients
-- have no granted privilege, so deny-by-default applies even if an RLS policy
-- were somehow added later without a corresponding GRANT.
