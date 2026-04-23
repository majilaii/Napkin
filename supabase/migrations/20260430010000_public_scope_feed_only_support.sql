-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: public scope feed-only entry support (TICKET-021 revision 2)
--
-- Fixes:
-- 1. Drop NOT NULL on post_comments.table_id (was blocking public-scope inserts
--    on feed-only entries — entries with table_id IS NULL — because the trigger
--    set_post_interaction_table_id raised EXCEPTION on NULL table_id).
-- 2. Drop NOT NULL on post_reactions.table_id for the same reason (post_reactions
--    already had it nullable per the original schema; this is a no-op guard).
-- 3. Patch set_post_interaction_table_id to tolerate NULL parent table_id when
--    NEW.scope = 'public'. Public rows on feed-only entries keep table_id NULL;
--    table-scope rows still require a non-NULL table_id (raise unchanged).
-- 4. Add REPLICA IDENTITY FULL on both tables so realtime DELETE payloads carry
--    the full row — including scope — enabling the client-side scope filter in
--    usePostInteractionsRealtime to work on DELETE events.
-- 5. Add get_public_reviews() SQL function that uses is_entry_publicly_eligible
--    as the single source of truth (no JS-side predicate duplication, no
--    LIMIT-before-filter correctness bug).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Drop NOT NULL on post_comments.table_id ───────────────────────────────
-- post_comments was created with `table_id UUID NOT NULL REFERENCES tables(id)`.
-- Public-scope comments on feed-only entries (table_id IS NULL) must be allowed.
-- The FK is kept (nullable FK is valid Postgres); cascade delete still fires when
-- a referenced table is dropped.

ALTER TABLE post_comments ALTER COLUMN table_id DROP NOT NULL;

-- post_reactions was already nullable in the original CREATE TABLE, but add the
-- guard so this migration is idempotent if someone tightened it later.
-- (ALTER COLUMN … DROP NOT NULL on an already-nullable column is a no-op in PG.)
ALTER TABLE post_reactions ALTER COLUMN table_id DROP NOT NULL;

-- ── 2. Patch set_post_interaction_table_id ───────────────────────────────────
-- Before: always RAISEs when v_table_id IS NULL.
-- After:  if NEW.scope = 'public' AND parent entry has table_id IS NULL, allow
--         the insert with table_id remaining NULL (feed-only public row).
--         Table-scope rows still require a non-NULL table_id.

CREATE OR REPLACE FUNCTION set_post_interaction_table_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_table_id UUID;
BEGIN
    IF NEW.target_type = 'table_night' THEN
        SELECT table_id INTO v_table_id
        FROM table_nights
        WHERE id = NEW.target_id;
    ELSIF NEW.target_type = 'entry' THEN
        SELECT table_id INTO v_table_id
        FROM entries
        WHERE id = NEW.target_id;
    END IF;

    -- Public-scope rows on feed-only entries (table_id IS NULL) are allowed.
    -- The RLS scope='public' policies never join on table_id, so NULL is safe.
    IF v_table_id IS NULL AND NEW.scope = 'public' THEN
        NEW.table_id := NULL;
        RETURN NEW;
    END IF;

    -- For table-scope rows (and any target not found), still raise.
    IF v_table_id IS NULL THEN
        RAISE EXCEPTION 'post interaction target not found: type=%, id=%',
            NEW.target_type, NEW.target_id;
    END IF;

    NEW.table_id := v_table_id;
    RETURN NEW;
END;
$$;

-- ── 3. REPLICA IDENTITY FULL for realtime DELETE scope filtering ─────────────
-- Without FULL, Supabase realtime DELETE payloads only carry PK columns in
-- payload.old. The client's `row.scope` check in usePostInteractionsRealtime
-- would see undefined and fail open (both scopes get invalidated on any delete).
-- FULL makes DELETE carry all columns including scope.

ALTER TABLE post_reactions REPLICA IDENTITY FULL;
ALTER TABLE post_comments  REPLICA IDENTITY FULL;

-- ── 4. get_public_reviews() — server-side eligibility filter + total ──────────
-- Replaces the JS-side LIMIT-before-filter pattern in restaurant-history/index.ts.
-- Applies is_entry_publicly_eligible() (the SSOT) BEFORE the LIMIT, so the
-- correctness bug (20 private entries → 0 public results) is eliminated.
--
-- Returns up to p_limit rows plus total_count (same value across all rows via
-- CROSS JOIN). The edge function reads total_count from the first row.
--
-- Column notes:
--   content  = entries.content (the note field — called "content" in the DB schema)
--   sort_order = entry_photos column for ordering (not "position")

CREATE OR REPLACE FUNCTION get_public_reviews(
    p_restaurant_id UUID,
    p_limit         INT DEFAULT 20
)
RETURNS TABLE (
    entry_id              UUID,
    user_id               UUID,
    display_name          TEXT,
    username              TEXT,
    avatar_url            TEXT,
    rating                NUMERIC,
    content               TEXT,
    created_at            TIMESTAMPTZ,
    public_reaction_count INT,
    public_reply_count    INT,
    photo_url             TEXT,
    total_count           BIGINT
) LANGUAGE sql STABLE AS $$
    WITH eligible AS (
        SELECT
            e.id,
            e.user_id,
            e.rating,
            e.content,
            e.created_at,
            e.public_reaction_count,
            e.public_reply_count
        FROM entries e
        WHERE e.restaurant_id = p_restaurant_id
          AND is_entry_publicly_eligible(e.id)
        ORDER BY e.created_at DESC
    ),
    total AS (SELECT count(*) AS c FROM eligible)
    SELECT
        el.id                   AS entry_id,
        el.user_id,
        p.display_name,
        p.username,
        p.avatar_url,
        el.rating,
        el.content,
        el.created_at,
        el.public_reaction_count,
        el.public_reply_count,
        (
            SELECT ep.photo_url
            FROM entry_photos ep
            WHERE ep.entry_id = el.id
            ORDER BY ep.sort_order ASC
            LIMIT 1
        )                       AS photo_url,
        total.c                 AS total_count
    FROM eligible el
    CROSS JOIN total
    JOIN profiles p ON p.user_id = el.user_id
    ORDER BY el.created_at DESC
    LIMIT p_limit;
$$;
