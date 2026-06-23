-- TICKET-085 — Threaded replies + per-reply ❤️ likes on post_comments.
--
-- Additive only. Does NOT touch post_reactions, its CHECK constraint, or the
-- shared sync_post_counts_and_top_emojis() body — so existing entry/round/share
-- reactions are unaffected.
--
-- Threading model: post_comments gains a self-FK parent_id. A reply carries the
-- SAME (target_type, target_id) as its thread root (it's still a comment on the
-- entry), plus parent_id → the root. Max depth 2 is enforced in the edge fn
-- (reply-to-reply normalizes parent_id up to the root). Replies inherit the
-- parent's scope + table_id via the BEFORE-INSERT trigger below, so the existing
-- post_comments RLS policies apply UNCHANGED (no RLS edits needed).

-- ── 1. Threading column ──────────────────────────────────────────────────────
ALTER TABLE public.post_comments
    ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.post_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS post_comments_parent_idx
    ON public.post_comments(parent_id)
    WHERE parent_id IS NOT NULL;

-- ── 2. Per-comment ❤️ like count (denormalized) ──────────────────────────────
ALTER TABLE public.post_comments
    ADD COLUMN IF NOT EXISTS like_count int NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.post_comment_likes (
    comment_id uuid NOT NULL REFERENCES public.post_comments(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS post_comment_likes_comment_idx
    ON public.post_comment_likes(comment_id);

-- ── 3. BEFORE-INSERT trigger: reply scope/table_id inheritance ───────────────
-- Re-assert the canonical body (verbatim from 20260615000100) + a new leading
-- branch: when a post_comments row has parent_id, copy scope + table_id from the
-- parent so the whole thread stays in one scope/Table. Guarded by TG_TABLE_NAME
-- because this same function is bound to post_reactions (which has no parent_id).
CREATE OR REPLACE FUNCTION public.set_post_interaction_table_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_table_id uuid;
BEGIN
    -- Replies inherit their thread root's scope + table_id. Only post_comments
    -- has parent_id; the nested IF keeps the field reference off the
    -- post_reactions code path entirely (no "record NEW has no field" error).
    IF TG_TABLE_NAME = 'post_comments' THEN
        IF NEW.parent_id IS NOT NULL THEN
            SELECT scope, table_id INTO NEW.scope, NEW.table_id
            FROM public.post_comments
            WHERE id = NEW.parent_id;
            RETURN NEW;
        END IF;
    END IF;

    -- Public scope: table_id is irrelevant to visibility. Preserve whatever the
    -- caller supplied (NULL for feed-only entries).
    IF NEW.scope = 'public' THEN
        RETURN NEW;
    END IF;

    IF NEW.target_type = 'table_night' THEN
        SELECT table_id INTO v_table_id
        FROM public.table_nights
        WHERE id = NEW.target_id;

    ELSIF NEW.target_type = 'entry' THEN
        IF NEW.table_id IS NOT NULL THEN
            v_table_id := NEW.table_id;
        ELSE
            SELECT et.table_id INTO v_table_id
            FROM public.entry_tables et
            WHERE et.entry_id = NEW.target_id
            ORDER BY et.posted_at ASC
            LIMIT 1;
            IF v_table_id IS NULL THEN
                SELECT e.table_id INTO v_table_id
                FROM public.entries e
                WHERE e.id = NEW.target_id;
            END IF;
        END IF;

    ELSIF NEW.target_type = 'table_share' THEN
        SELECT table_id INTO v_table_id
        FROM public.table_shares
        WHERE id = NEW.target_id;
    END IF;

    NEW.table_id := v_table_id;
    RETURN NEW;
END;
$$;

-- ── 4. AFTER trigger: maintain post_comments.like_count ──────────────────────
CREATE OR REPLACE FUNCTION public.sync_comment_like_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_comment_id uuid;
BEGIN
    v_comment_id := COALESCE(NEW.comment_id, OLD.comment_id);
    UPDATE public.post_comments
    SET like_count = (
        SELECT COUNT(*) FROM public.post_comment_likes WHERE comment_id = v_comment_id
    )
    WHERE id = v_comment_id;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS sync_comment_like_count ON public.post_comment_likes;
CREATE TRIGGER sync_comment_like_count
    AFTER INSERT OR DELETE ON public.post_comment_likes
    FOR EACH ROW EXECUTE FUNCTION public.sync_comment_like_count();

-- ── 5. RLS on post_comment_likes (mirrors the comment's visibility) ──────────
-- The edge fn writes likes via service role (bypasses RLS) and validates
-- visibility manually; these policies are defense-in-depth for any direct access.
ALTER TABLE public.post_comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_comment_likes_select ON public.post_comment_likes;
CREATE POLICY post_comment_likes_select ON public.post_comment_likes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.post_comments c
            WHERE c.id = post_comment_likes.comment_id
              AND (
                  (c.scope = 'table'
                      AND c.table_id IN (SELECT table_id FROM public.table_members WHERE member_id = auth.uid()))
                  OR (c.scope = 'public'
                      AND auth.uid() IS NOT NULL
                      AND c.target_type = 'entry'
                      AND public.is_entry_publicly_eligible(c.target_id))
              )
        )
    );

DROP POLICY IF EXISTS post_comment_likes_insert ON public.post_comment_likes;
CREATE POLICY post_comment_likes_insert ON public.post_comment_likes
    FOR INSERT WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.post_comments c
            WHERE c.id = post_comment_likes.comment_id
              AND (
                  (c.scope = 'table'
                      AND c.table_id IN (SELECT table_id FROM public.table_members WHERE member_id = auth.uid()))
                  OR (c.scope = 'public'
                      AND c.target_type = 'entry'
                      AND public.is_entry_publicly_eligible(c.target_id))
              )
        )
    );

DROP POLICY IF EXISTS post_comment_likes_delete ON public.post_comment_likes;
CREATE POLICY post_comment_likes_delete ON public.post_comment_likes
    FOR DELETE USING (user_id = auth.uid());

-- service_role full access (edge fn path)
GRANT SELECT, INSERT, DELETE ON public.post_comment_likes TO authenticated, service_role;
