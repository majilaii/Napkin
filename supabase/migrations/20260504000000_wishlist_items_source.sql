-- TICKET-053: Add source jsonb column to wishlist_items
-- Architecture decision [H1]: nullable column with CHECK enforcing discriminated-union shape.
-- Existing rows (source IS NULL) read fine — backward compatible.

ALTER TABLE wishlist_items ADD COLUMN IF NOT EXISTS source jsonb;

ALTER TABLE wishlist_items
    ADD CONSTRAINT wishlist_items_source_shape
    CHECK (
        source IS NULL
        OR (
            jsonb_typeof(source) = 'object'
            AND source ? 'type'
            AND source ? 'url'
            AND (source->>'type') IN ('tiktok', 'google_maps', 'web')
        )
    );
