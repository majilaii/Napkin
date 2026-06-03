-- TICKET-060: Extend wishlist_items.source CHECK for screenshot + vision variants.
-- The new variants do not require a 'url' field (url-less capture paths).
-- Updated CHECK: url required only for url-sourced types; screenshot/vision allowed without url.

ALTER TABLE public.wishlist_items
  DROP CONSTRAINT IF EXISTS wishlist_items_source_shape;

ALTER TABLE public.wishlist_items
  ADD CONSTRAINT wishlist_items_source_shape
    CHECK (
      source IS NULL
      OR (
        jsonb_typeof(source) = 'object'
        AND source ? 'type'
        AND (
          -- url-sourced types still require 'url'
          (source->>'type' IN ('tiktok', 'google_maps', 'web') AND source ? 'url')
          -- new vision/screenshot types: url optional
          OR source->>'type' IN ('screenshot', 'vision')
        )
      )
    );
