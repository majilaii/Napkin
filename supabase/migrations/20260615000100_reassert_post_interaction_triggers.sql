-- Re-assert the post-interaction trigger functions + bindings to their correct,
-- current bodies. Defensive fix for suspected FUNCTION-BODY DRIFT on prod:
--
-- `set_post_interaction_table_id()` and `sync_post_counts_and_top_emojis()` are
-- each redefined by several migrations. `CREATE OR REPLACE` is order-dependent,
-- so a partial / out-of-order `db push` can leave an OLDER body winning on prod
-- even though `supabase migration list` reports every migration applied (that
-- table tracks applied migrations, not final function bodies).
--
-- Two drift scenarios both produce "react AND comment fail identically on a
-- table-scope entry" — the exact symptom reported:
--   1. BEFORE trigger = the original 20260418000000 body, which RAISEs when the
--      resolved table_id IS NULL (true for multi-Table entries whose table_id
--      moved to entry_tables). → every insert throws.
--   2. AFTER trigger body = the dead `sync_post_counts()` shape, which writes
--      `array_agg(emoji)` (text[]) into `entries.top_emojis` (JSONB). → every
--      insert throws on the type mismatch.
--
-- This migration pins BOTH functions to the correct bodies and re-binds all four
-- triggers, so the live state matches repo intent regardless of what drifted.
-- It is fully idempotent and safe to run even if no drift exists.
--
-- It ALSO fixes a real regression introduced by the 20260603000600 body of
-- set_post_interaction_table_id(): that body ignored NEW.scope and overwrote
-- NEW.table_id for PUBLIC-scope rows too, clobbering the NULL that public
-- reactions/comments on feed-only entries are supposed to keep. The public
-- early-return below restores the 20260430010000 intent.

-- ── 1. AFTER trigger function: counts + top_emojis (JSONB-correct) ───────────
-- Verbatim from 20260603000700_fix_pass1.sql (the canonical live body).
CREATE OR REPLACE FUNCTION public.sync_post_counts_and_top_emojis()
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

    IF v_target_type = 'table_night' THEN
        UPDATE public.table_nights
        SET reaction_count = v_reaction_count,
            comment_count  = v_comment_count,
            top_emojis     = v_top_emojis
        WHERE id = v_target_id;

    ELSIF v_target_type = 'entry' THEN
        IF v_scope = 'table' THEN
            UPDATE public.entries
            SET reaction_count = v_reaction_count,
                comment_count  = v_comment_count,
                top_emojis     = v_top_emojis
            WHERE id = v_target_id;
        ELSE
            UPDATE public.entries
            SET public_reaction_count = v_reaction_count,
                public_reply_count    = v_comment_count,
                public_top_emojis     = v_top_emojis
            WHERE id = v_target_id;
        END IF;

    ELSIF v_target_type = 'table_share' THEN
        -- table_shares.top_emojis is text[] (not jsonb), so extract emoji strings only.
        UPDATE public.table_shares
        SET reaction_count = v_reaction_count,
            top_emojis = (
                SELECT COALESCE(array_agg(emoji ORDER BY cnt DESC), '{}')
                FROM (
                    SELECT emoji, COUNT(*) AS cnt
                    FROM public.post_reactions pr
                    WHERE pr.target_id   = v_target_id
                      AND pr.target_type = 'table_share'
                      AND pr.scope       = 'table'
                    GROUP BY emoji
                    ORDER BY cnt DESC
                    LIMIT 3
                ) sub2
            )
        WHERE id = v_target_id;
    END IF;

    RETURN NULL;
END;
$$;

-- ── 2. BEFORE trigger function: denorm table_id (never RAISEs; scope-aware) ───
CREATE OR REPLACE FUNCTION public.set_post_interaction_table_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_table_id uuid;
BEGIN
    -- Public scope: table_id is irrelevant to visibility. Preserve whatever the
    -- caller supplied (NULL for feed-only entries). Restores 20260430010000
    -- intent; fixes the 20260603000600 regression that clobbered it.
    IF NEW.scope = 'public' THEN
        RETURN NEW;
    END IF;

    IF NEW.target_type = 'table_night' THEN
        SELECT table_id INTO v_table_id
        FROM public.table_nights
        WHERE id = NEW.target_id;

    ELSIF NEW.target_type = 'entry' THEN
        -- Trust an edge-fn-supplied (already validated) table_id. Otherwise
        -- resolve via entry_tables (multi-Table), then fall back to legacy
        -- entries.table_id. NEVER RAISE: a NULL resolution inserts cleanly
        -- (table_id is nullable on both tables).
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

-- ── 3. Re-bind all four triggers to the correct functions ────────────────────
-- Defensive: drift could include a wrong binding, not just a wrong body.
DROP TRIGGER IF EXISTS set_post_reaction_table_id ON public.post_reactions;
CREATE TRIGGER set_post_reaction_table_id
    BEFORE INSERT ON public.post_reactions
    FOR EACH ROW EXECUTE FUNCTION public.set_post_interaction_table_id();

DROP TRIGGER IF EXISTS set_post_comment_table_id ON public.post_comments;
CREATE TRIGGER set_post_comment_table_id
    BEFORE INSERT ON public.post_comments
    FOR EACH ROW EXECUTE FUNCTION public.set_post_interaction_table_id();

DROP TRIGGER IF EXISTS sync_counts_on_reaction ON public.post_reactions;
CREATE TRIGGER sync_counts_on_reaction
    AFTER INSERT OR DELETE ON public.post_reactions
    FOR EACH ROW EXECUTE FUNCTION public.sync_post_counts_and_top_emojis();

DROP TRIGGER IF EXISTS sync_counts_on_comment ON public.post_comments;
CREATE TRIGGER sync_counts_on_comment
    AFTER INSERT OR DELETE ON public.post_comments
    FOR EACH ROW EXECUTE FUNCTION public.sync_post_counts_and_top_emojis();
