-- supabase/migrations/20260617000300_wishlist_source_video.sql
--
-- TICKET-082: allow source.type = 'video' on wishlist_items (on-device video
-- import). Mirrors the url-optional shape of 'screenshot'/'vision' — a video
-- import carries no URL (the user shared/picked a saved file). Pure additive
-- CHECK widening; existing rows + insert paths unchanged.

ALTER TABLE public.wishlist_items
    DROP CONSTRAINT IF EXISTS wishlist_items_source_shape;

ALTER TABLE public.wishlist_items
    ADD CONSTRAINT wishlist_items_source_shape CHECK (
        source IS NULL
        OR (
            jsonb_typeof(source) = 'object'
            AND source ? 'type'
            AND (
                (source->>'type' IN ('tiktok', 'google_maps', 'web') AND source ? 'url')
                OR source->>'type' IN ('screenshot', 'vision', 'video')
                OR (
                    source->>'type' = 'handoff'
                    AND jsonb_typeof(source->'sharer_name') = 'string'
                    AND btrim(source->>'sharer_name') <> ''
                    AND (source - 'type' - 'sharer_name') = '{}'::jsonb
                )
            )
        )
    );
