-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: post_interactions
--
-- Adds the warmth layer: reactions and comments on table_nights and entries.
--
-- TODO (future): If an entry is ever moved between tables (currently impossible),
-- the denormalized table_id on post_reactions and post_comments must be updated
-- in the same transaction as the entry move.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Denormalized count columns on parent tables ────────────────────────────

ALTER TABLE table_nights
    ADD COLUMN IF NOT EXISTS reaction_count  INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS comment_count   INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS top_emojis      JSONB   NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS reaction_count  INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS comment_count   INT     NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS top_emojis      JSONB   NOT NULL DEFAULT '[]'::jsonb;

-- ── 2. post_reactions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS post_reactions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type TEXT        NOT NULL CHECK (target_type IN ('table_night', 'entry')),
    target_id   UUID        NOT NULL,
    table_id    UUID        REFERENCES tables(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    emoji       TEXT        NOT NULL CHECK (emoji IN ('🔥','😋','❤️','💯','👀')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (target_type, target_id, user_id, emoji)
);

-- ── 3. post_comments ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS post_comments (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type TEXT        NOT NULL CHECK (target_type IN ('table_night', 'entry')),
    target_id   UUID        NOT NULL,
    table_id    UUID        NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    body        TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    edited_at   TIMESTAMPTZ
);

-- ── 4. Indexes ────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS post_reactions_target_idx
    ON post_reactions (target_type, target_id);

CREATE INDEX IF NOT EXISTS post_reactions_table_id_idx
    ON post_reactions (table_id);

CREATE INDEX IF NOT EXISTS post_comments_target_idx
    ON post_comments (target_type, target_id, created_at ASC);

CREATE INDEX IF NOT EXISTS post_comments_table_id_idx
    ON post_comments (table_id);

-- ── 5. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments  ENABLE ROW LEVEL SECURITY;

-- post_reactions: table members can read/write
CREATE POLICY "post_reactions_select" ON post_reactions
    FOR SELECT USING (
        table_id IN (
            SELECT table_id FROM table_members WHERE member_id = auth.uid()
        )
    );

CREATE POLICY "post_reactions_insert" ON post_reactions
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND table_id IN (
            SELECT table_id FROM table_members WHERE member_id = auth.uid()
        )
    );

CREATE POLICY "post_reactions_delete" ON post_reactions
    FOR DELETE USING (user_id = auth.uid());

-- post_comments: table members can read; author can insert/update/delete
CREATE POLICY "post_comments_select" ON post_comments
    FOR SELECT USING (
        table_id IN (
            SELECT table_id FROM table_members WHERE member_id = auth.uid()
        )
    );

CREATE POLICY "post_comments_insert" ON post_comments
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND table_id IN (
            SELECT table_id FROM table_members WHERE member_id = auth.uid()
        )
    );

CREATE POLICY "post_comments_update" ON post_comments
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "post_comments_delete" ON post_comments
    FOR DELETE USING (user_id = auth.uid());

-- ── 6. Trigger: set_post_interaction_table_id ─────────────────────────────────
-- Resolves parent row, validates it exists, and copies table_id into both
-- post_reactions and post_comments on INSERT.

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

    IF v_table_id IS NULL THEN
        RAISE EXCEPTION 'post interaction target not found: type=%, id=%',
            NEW.target_type, NEW.target_id;
    END IF;

    NEW.table_id := v_table_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_post_reaction_table_id
    BEFORE INSERT ON post_reactions
    FOR EACH ROW EXECUTE FUNCTION set_post_interaction_table_id();

CREATE TRIGGER set_post_comment_table_id
    BEFORE INSERT ON post_comments
    FOR EACH ROW EXECUTE FUNCTION set_post_interaction_table_id();

-- ── 7. Trigger: sync_post_counts_and_top_emojis ──────────────────────────────
-- Maintains reaction_count, comment_count, and top_emojis on parent rows.
-- top_emojis is recomputed from scratch on each reaction change (5 emoji max,
-- trivial cost). Tiebreaker: higher count first, then most recent reaction.

CREATE OR REPLACE FUNCTION sync_post_counts_and_top_emojis()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_target_type TEXT;
    v_target_id   UUID;
    v_reaction_count INT;
    v_comment_count  INT;
    v_top_emojis JSONB;
BEGIN
    -- Determine which target row changed
    IF TG_OP = 'DELETE' THEN
        v_target_type := OLD.target_type;
        v_target_id   := OLD.target_id;
    ELSE
        v_target_type := NEW.target_type;
        v_target_id   := NEW.target_id;
    END IF;

    -- Recount reactions
    SELECT COUNT(*) INTO v_reaction_count
    FROM post_reactions
    WHERE target_type = v_target_type AND target_id = v_target_id;

    -- Recount comments
    SELECT COUNT(*) INTO v_comment_count
    FROM post_comments
    WHERE target_type = v_target_type AND target_id = v_target_id;

    -- Recompute top_emojis from scratch
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'emoji', emoji,
                'count', cnt,
                'last_reacted_at', last_at
            )
            ORDER BY cnt DESC, last_at DESC
        ),
        '[]'::jsonb
    ) INTO v_top_emojis
    FROM (
        SELECT
            emoji,
            COUNT(*)        AS cnt,
            MAX(created_at) AS last_at
        FROM post_reactions
        WHERE target_type = v_target_type AND target_id = v_target_id
        GROUP BY emoji
    ) sub;

    -- Write back to the correct parent table
    IF v_target_type = 'table_night' THEN
        UPDATE table_nights
        SET
            reaction_count = v_reaction_count,
            comment_count  = v_comment_count,
            top_emojis     = v_top_emojis
        WHERE id = v_target_id;
    ELSIF v_target_type = 'entry' THEN
        UPDATE entries
        SET
            reaction_count = v_reaction_count,
            comment_count  = v_comment_count,
            top_emojis     = v_top_emojis
        WHERE id = v_target_id;
    END IF;

    RETURN NULL; -- AFTER trigger, return value ignored
END;
$$;

-- Only comment changes affect comment_count and top_emojis (reactions handle top_emojis)
-- Reaction changes update all three: reaction_count, top_emojis, and comment_count (for consistency)
CREATE TRIGGER sync_counts_on_reaction
    AFTER INSERT OR DELETE ON post_reactions
    FOR EACH ROW EXECUTE FUNCTION sync_post_counts_and_top_emojis();

CREATE TRIGGER sync_counts_on_comment
    AFTER INSERT OR DELETE ON post_comments
    FOR EACH ROW EXECUTE FUNCTION sync_post_counts_and_top_emojis();

-- ── 8. Trigger: cascade_post_interactions_on_parent_delete ───────────────────
-- Since there are no polymorphic FKs, we cascade-delete interactions manually
-- when a parent table_night or entry is deleted.

CREATE OR REPLACE FUNCTION cascade_delete_post_interactions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'table_nights' THEN
        DELETE FROM post_reactions WHERE target_type = 'table_night' AND target_id = OLD.id;
        DELETE FROM post_comments  WHERE target_type = 'table_night' AND target_id = OLD.id;
    ELSIF TG_TABLE_NAME = 'entries' THEN
        DELETE FROM post_reactions WHERE target_type = 'entry' AND target_id = OLD.id;
        DELETE FROM post_comments  WHERE target_type = 'entry' AND target_id = OLD.id;
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER cascade_interactions_on_table_night_delete
    AFTER DELETE ON table_nights
    FOR EACH ROW EXECUTE FUNCTION cascade_delete_post_interactions();

CREATE TRIGGER cascade_interactions_on_entry_delete
    AFTER DELETE ON entries
    FOR EACH ROW EXECUTE FUNCTION cascade_delete_post_interactions();

-- ── 9. Realtime publication ───────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE post_reactions;
ALTER PUBLICATION supabase_realtime ADD TABLE post_comments;

-- ── 10. Sanity check (should return 0) ───────────────────────────────────────
-- SELECT COUNT(*) FROM post_reactions WHERE table_id IS NULL;
-- SELECT COUNT(*) FROM post_comments  WHERE table_id IS NULL;
