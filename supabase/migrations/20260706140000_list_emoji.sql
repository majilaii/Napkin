-- TICKET-108 — per-list emoji icon (differentiates lists on the wishlist map).
-- Additive, nullable. char_length<=8 covers multi-codepoint emoji (ZWJ/skin
-- tone) which exceed a single "char". Client picker constrains to a curated
-- set + a 1-grapheme free-entry field; this CHECK is a length backstop only.
-- No RLS/embed/FK change — existing `select('*')` flows the column through
-- create/update/list_mine/get automatically.

ALTER TABLE public.lists
    ADD COLUMN IF NOT EXISTS emoji text
    CHECK (emoji IS NULL OR char_length(emoji) <= 8);

COMMENT ON COLUMN public.lists.emoji IS
    'TICKET-108: user-chosen emoji shown on the wishlist map pin + Lists index '
    'row. Nullable = default terracotta teardrop. The one sanctioned emoji-in-'
    'chrome exception (user content, like a reaction).';
