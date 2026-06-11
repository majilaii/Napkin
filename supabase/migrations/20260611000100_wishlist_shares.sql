-- TICKET-072: wishlist handoff — wishlist_shares table + extend source CHECK for 'handoff'
-- Two schema changes:
--   (a) NEW table wishlist_shares (owner-only RLS; public path is edge-only via service role)
--   (b) MODIFY wishlist_items_source_shape CHECK to allow type='handoff' with required sharer_name

-- ── (a) wishlist_shares ────────────────────────────────────────────────────────

CREATE TABLE public.wishlist_shares (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token       text NOT NULL UNIQUE,           -- 16-byte base64url minted in edge fn
    snapshot    jsonb NOT NULL,                 -- frozen display payload (sharer_name + spots[])
    created_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at  timestamptz                     -- NULL = live; set to revoke
);

-- Partial index for live-token lookup (revoke_all + status checks)
CREATE INDEX wishlist_shares_owner_live_idx
    ON public.wishlist_shares (owner_id)
    WHERE revoked_at IS NULL;

-- Structural CHECK: snapshot must be an object with sharer_name + spots array
ALTER TABLE public.wishlist_shares
    ADD CONSTRAINT wishlist_shares_snapshot_shape CHECK (
        jsonb_typeof(snapshot) = 'object'
        AND snapshot ? 'sharer_name'
        AND jsonb_typeof(snapshot->'spots') = 'array'
    );

-- ── Security: lock wishlist_shares to service-role writes only ───────────────
--
-- Codex #1 (HIGH — security): this repo grants ALL on public tables to
-- `authenticated` by default. Without an explicit REVOKE, an authenticated
-- client could INSERT/UPDATE rows directly (forging tokens, flipping revoked_at,
-- smuggling arbitrary snapshot payloads) — bypassing the verified-only create
-- and revoke_all paths in the `handoff` edge function.
--
-- Fix: strip ALL direct-client DML and read access.  The only callers that need
-- to touch wishlist_shares are the two edge functions (`handoff` and `share-page`),
-- both of which run under the service-role key and BYPASS RLS entirely.
--
-- RLS is still ENABLED (deny-by-default) so that if a future migration accidentally
-- re-grants a privilege the absence of matching policies means zero rows are
-- accessible — no silent escalation.
--
-- Regression invariant: absence of policies IS the security assertion.
-- To verify: `SELECT * FROM pg_policies WHERE tablename = 'wishlist_shares';`
-- must return zero rows after this migration.

-- REVOKE ALL (not an enumerated list): default privileges in this repo grant
-- ALL ON TABLES to anon/authenticated, which includes TRUNCATE/REFERENCES/
-- TRIGGER beyond the DML verbs. Only ALL (incl. PUBLIC) makes the table
-- strictly service-role-only at the privilege level. (Codex review, T-072.)
REVOKE ALL ON TABLE public.wishlist_shares FROM anon, authenticated, PUBLIC;

ALTER TABLE public.wishlist_shares ENABLE ROW LEVEL SECURITY;

-- No DML or SELECT policies.  Service role bypasses RLS; authenticated clients
-- have no granted privilege, so deny-by-default applies even if an RLS policy
-- were somehow added later without a corresponding GRANT.
--
-- No DELETE policy either: revocation = UPDATE revoked_at (soft-revoke only).
-- Shares are immutable after creation (snapshot is frozen). The tombstone page
-- always renders correctly even after revocation.

-- ── (b) Extend wishlist_items_source_shape CHECK for 'handoff' ────────────────
--
-- Previous form (20260603000050): url required for tiktok/google_maps/web;
--                                  screenshot/vision url-optional.
-- New form: also allow type='handoff' with required string sharer_name.
-- Blast radius: only new INSERT paths with type='handoff' are affected.
-- Existing tiktok/web/screenshot/vision inserts are completely unchanged.

ALTER TABLE public.wishlist_items
    DROP CONSTRAINT IF EXISTS wishlist_items_source_shape;

ALTER TABLE public.wishlist_items
    ADD CONSTRAINT wishlist_items_source_shape CHECK (
        source IS NULL
        OR (
            jsonb_typeof(source) = 'object'
            AND source ? 'type'
            AND (
                -- url-sourced types still require 'url'
                (source->>'type' IN ('tiktok', 'google_maps', 'web') AND source ? 'url')
                -- vision/screenshot: url optional (TICKET-060)
                OR source->>'type' IN ('screenshot', 'vision')
                -- handoff: sharer_name must be a non-empty string; ONLY 'type' and
                -- 'sharer_name' keys are allowed — reject extra keys (owner_id/token
                -- smuggling).  Defence-in-depth: save_spots already server-constructs
                -- the handoff source, but this CHECK guards any direct-write path.
                -- (source - 'type' - 'sharer_name') = '{}' means no extra keys remain.
                OR (
                    source->>'type' = 'handoff'
                    AND jsonb_typeof(source->'sharer_name') = 'string'
                    AND btrim(source->>'sharer_name') <> ''  -- non-blank, not just non-empty (renders on public page)
                    AND (source - 'type' - 'sharer_name') = '{}'::jsonb
                )
            )
        )
    );
