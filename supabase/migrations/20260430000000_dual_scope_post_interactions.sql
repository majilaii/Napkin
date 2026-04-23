-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: dual-scope post_interactions (TICKET-021)
--
-- Adds `scope` to post_reactions / post_comments so a single entry can host
-- two fully isolated comment/reaction containers: one for its Table
-- (existing behavior) and one for the restaurant-page public view.
--
-- Existing rows are Table-scoped by definition; backfilled to scope='table'.
--
-- Eligibility for scope='public' rows is validated live at read AND write via
-- the is_entry_publicly_eligible() function defined below; no denormalized
-- flag on entries (account_privacy flips must reflect immediately on next read).
--
-- TODO (future, TICKET-021-moderation): author-side hide/report surfaces on
-- public replies. None in v1.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Scope column on both interaction tables ───────────────────────────────

ALTER TABLE post_reactions
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'table'
        CHECK (scope IN ('table','public'));

ALTER TABLE post_comments
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'table'
        CHECK (scope IN ('table','public'));

-- Backfill is implicit via DEFAULT 'table' — all rows prior to this migration
-- are Table-scope by definition. Sanity check (should return 0):
--   SELECT COUNT(*) FROM post_reactions WHERE scope NOT IN ('table','public');
--   SELECT COUNT(*) FROM post_comments  WHERE scope NOT IN ('table','public');

-- ── 2. Composite indexes — back every scoped read in TICKET-021 ──────────────

CREATE INDEX IF NOT EXISTS post_reactions_target_scope_idx
    ON post_reactions (target_type, target_id, scope);

CREATE INDEX IF NOT EXISTS post_comments_target_scope_created_idx
    ON post_comments (target_type, target_id, scope, created_at ASC);

-- Existing *_target_idx indexes are intentionally KEPT for backward
-- compatibility (legacy queries that don't yet pass scope).

-- ── 3. Parallel denorm columns on entries ────────────────────────────────────

ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS public_reaction_count INT    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS public_reply_count    INT    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS public_top_emojis     JSONB  NOT NULL DEFAULT '[]'::jsonb;

-- ── 4. Eligibility function ──────────────────────────────────────────────────
-- Centralizes the rule so RLS, edge functions, and restaurant-history all
-- evaluate the same predicate. STABLE + LANGUAGE SQL so the planner can inline.

CREATE OR REPLACE FUNCTION is_entry_publicly_eligible(p_entry_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1
        FROM entries e
        JOIN profiles p ON p.user_id = e.user_id
        WHERE e.id = p_entry_id
          AND p.account_privacy = 'public'
          AND e.rating IS NOT NULL
          AND char_length(trim(COALESCE(e.content, ''))) >= 20
    );
$$;

-- Supporting index for the function's join — account_privacy + user_id covers
-- the hot path on every public-scope RLS check.
CREATE INDEX IF NOT EXISTS profiles_user_account_privacy_idx
    ON profiles (user_id, account_privacy, allow_public_replies);

-- ── 5. RLS rewrite — drop-and-recreate with scope-aware policies ─────────────

DROP POLICY IF EXISTS "post_reactions_select" ON post_reactions;
DROP POLICY IF EXISTS "post_reactions_insert" ON post_reactions;
DROP POLICY IF EXISTS "post_reactions_delete" ON post_reactions;
DROP POLICY IF EXISTS "post_comments_select"  ON post_comments;
DROP POLICY IF EXISTS "post_comments_insert"  ON post_comments;
DROP POLICY IF EXISTS "post_comments_update"  ON post_comments;
DROP POLICY IF EXISTS "post_comments_delete"  ON post_comments;

-- post_reactions
CREATE POLICY "post_reactions_select_table" ON post_reactions
    FOR SELECT USING (
        scope = 'table'
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
    );

CREATE POLICY "post_reactions_select_public" ON post_reactions
    FOR SELECT USING (
        scope = 'public'
        AND auth.uid() IS NOT NULL
        AND target_type = 'entry'
        AND is_entry_publicly_eligible(target_id)
    );

CREATE POLICY "post_reactions_insert_table" ON post_reactions
    FOR INSERT WITH CHECK (
        scope = 'table'
        AND user_id = auth.uid()
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
    );

CREATE POLICY "post_reactions_insert_public" ON post_reactions
    FOR INSERT WITH CHECK (
        scope = 'public'
        AND user_id = auth.uid()
        AND target_type = 'entry'
        AND is_entry_publicly_eligible(target_id)
    );

CREATE POLICY "post_reactions_delete" ON post_reactions
    FOR DELETE USING (user_id = auth.uid());

-- post_comments
CREATE POLICY "post_comments_select_table" ON post_comments
    FOR SELECT USING (
        scope = 'table'
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
    );

CREATE POLICY "post_comments_select_public" ON post_comments
    FOR SELECT USING (
        scope = 'public'
        AND auth.uid() IS NOT NULL
        AND target_type = 'entry'
        AND is_entry_publicly_eligible(target_id)
    );

CREATE POLICY "post_comments_insert_table" ON post_comments
    FOR INSERT WITH CHECK (
        scope = 'table'
        AND user_id = auth.uid()
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
    );

CREATE POLICY "post_comments_insert_public" ON post_comments
    FOR INSERT WITH CHECK (
        scope = 'public'
        AND user_id = auth.uid()
        AND target_type = 'entry'
        AND is_entry_publicly_eligible(target_id)
        AND EXISTS (
            SELECT 1 FROM entries e
            JOIN profiles p ON p.user_id = e.user_id
            WHERE e.id = target_id AND p.allow_public_replies = true
        )
    );

CREATE POLICY "post_comments_update" ON post_comments
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "post_comments_delete" ON post_comments
    FOR DELETE USING (user_id = auth.uid());

-- ── 6. Branched count/top-emoji trigger ──────────────────────────────────────
-- Table-scope rows write the existing columns; public-scope rows write the
-- parallel public_* columns. Single function handles both via NEW.scope.

CREATE OR REPLACE FUNCTION sync_post_counts_and_top_emojis()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_target_type TEXT;
    v_target_id   UUID;
    v_scope       TEXT;
    v_reaction_count INT;
    v_comment_count  INT;
    v_top_emojis JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_type := OLD.target_type;
        v_target_id   := OLD.target_id;
        v_scope       := OLD.scope;
    ELSE
        v_target_type := NEW.target_type;
        v_target_id   := NEW.target_id;
        v_scope       := NEW.scope;
    END IF;

    -- Recount within the changed row's scope only
    SELECT COUNT(*) INTO v_reaction_count
    FROM post_reactions
    WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope;

    SELECT COUNT(*) INTO v_comment_count
    FROM post_comments
    WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope;

    SELECT COALESCE(
        jsonb_agg(jsonb_build_object('emoji', emoji, 'count', cnt, 'last_reacted_at', last_at)
                  ORDER BY cnt DESC, last_at DESC),
        '[]'::jsonb
    ) INTO v_top_emojis
    FROM (
        SELECT emoji, COUNT(*) AS cnt, MAX(created_at) AS last_at
        FROM post_reactions
        WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope
        GROUP BY emoji
    ) sub;

    -- Route the update to the correct column set
    IF v_target_type = 'table_night' THEN
        -- table_nights only ever hosts scope='table' (Rounds have no public surface in v1)
        UPDATE table_nights
        SET reaction_count = v_reaction_count,
            comment_count  = v_comment_count,
            top_emojis     = v_top_emojis
        WHERE id = v_target_id;
    ELSIF v_target_type = 'entry' THEN
        IF v_scope = 'table' THEN
            UPDATE entries
            SET reaction_count = v_reaction_count,
                comment_count  = v_comment_count,
                top_emojis     = v_top_emojis
            WHERE id = v_target_id;
        ELSE -- scope = 'public'
            UPDATE entries
            SET public_reaction_count = v_reaction_count,
                public_reply_count    = v_comment_count,
                public_top_emojis     = v_top_emojis
            WHERE id = v_target_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

-- Existing triggers (sync_counts_on_reaction, sync_counts_on_comment) bind to
-- the function by name, so the CREATE OR REPLACE above is sufficient; no
-- trigger recreation needed.

-- ── 7. Cascade-delete on parent entry — already scope-agnostic ───────────────
-- The existing cascade_delete_post_interactions() deletes WHERE target_id=...
-- without a scope predicate, so it already removes BOTH scopes. No change.

-- ── 8. set_post_interaction_table_id — unchanged ─────────────────────────────
-- Still denormalizes table_id from the parent entry on INSERT. Harmless for
-- public rows (the RLS scope='public' path never joins on table_id), and
-- keeps the existing per-table index useful for cascade deletes.
