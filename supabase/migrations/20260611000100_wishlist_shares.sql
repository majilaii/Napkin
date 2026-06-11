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

-- RLS: owner-only select/insert/update; NO public policies
-- The public read path is exclusively the share-page edge function (service role).
ALTER TABLE public.wishlist_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY ws_owner_select ON public.wishlist_shares
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY ws_owner_insert ON public.wishlist_shares
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY ws_owner_update ON public.wishlist_shares
    FOR UPDATE USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- No DELETE policy: revocation = UPDATE revoked_at. Shares are immutable after creation
-- (snapshot is frozen). Owner can only soft-revoke, not hard-delete, so the tombstone
-- page always renders correctly even after revocation.

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
                -- handoff: requires sharer_name string (TICKET-072 ARCH-REVIEW-2 #4)
                OR (source->>'type' = 'handoff' AND source ? 'sharer_name')
            )
        )
    );
