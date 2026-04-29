-- TICKET-043 finding 7: post-interactions trigger + RLS deltas.
--
-- (a) Rewrite set_post_interaction_table_id() so a non-NULL NEW.table_id is
--     trusted (it came from the request and was validated by the edge fn);
--     fall back to entries.table_id only when NEW.table_id IS NULL (legacy callers).
--     Validates that caller-supplied table_id corresponds to a real entry_tables
--     link (or matches legacy entries.table_id during transition window).
--
-- (b) RLS WITH CHECK on table-scope inserts is extended to additionally accept
--     entry_tables membership for entry targets (in addition to the existing
--     table_members membership check on the supplied table_id).
--
-- Existing triggers (set_post_reaction_table_id, set_post_comment_table_id) bind
-- by name; they continue to invoke the updated function with no recreation needed.
--
-- Addresses [ARCH-REVIEW] finding 7.

CREATE OR REPLACE FUNCTION set_post_interaction_table_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_resolved_table_id uuid;
    v_is_member_of_linked boolean;
BEGIN
    -- table_night targets: always resolve from the parent round.
    IF NEW.target_type = 'table_night' THEN
        SELECT table_id INTO v_resolved_table_id
        FROM table_nights WHERE id = NEW.target_id;
        IF v_resolved_table_id IS NULL THEN
            RAISE EXCEPTION 'post interaction target not found: type=table_night, id=%', NEW.target_id;
        END IF;
        NEW.table_id := v_resolved_table_id;
        RETURN NEW;
    END IF;

    -- target_type = 'entry'

    -- Public scope: table_id is irrelevant for visibility; allow NULL or whatever was passed.
    IF NEW.scope = 'public' THEN
        RETURN NEW;
    END IF;

    -- Table scope on entry: check if caller supplied table_id (TICKET-043 new contract).
    IF NEW.table_id IS NOT NULL THEN
        -- Validate: caller-supplied table_id must correspond to a real entry_tables link.
        SELECT EXISTS (
            SELECT 1 FROM public.entry_tables et
            WHERE et.entry_id = NEW.target_id AND et.table_id = NEW.table_id
        ) INTO v_is_member_of_linked;

        IF NOT v_is_member_of_linked THEN
            -- Transition-window fallback: accept legacy entries.table_id match.
            -- This allows legacy clients that pre-date entry_tables to still work
            -- during the transition. Remove after entries.table_id column is dropped.
            IF NOT EXISTS (
                SELECT 1 FROM public.entries e
                WHERE e.id = NEW.target_id AND e.table_id = NEW.table_id
            ) THEN
                RAISE EXCEPTION 'post_interaction.table_id (%) not linked to entry %',
                    NEW.table_id, NEW.target_id;
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    -- NEW.table_id IS NULL — legacy caller. Resolve from entries.table_id.
    -- DEPRECATION NOTE: this path is kept for the transition window only.
    -- New callers MUST supply table_id in the request body.
    SELECT table_id INTO v_resolved_table_id FROM public.entries WHERE id = NEW.target_id;
    IF v_resolved_table_id IS NOT NULL THEN
        NEW.table_id := v_resolved_table_id;
    END IF;
    -- If entries.table_id is also NULL (feed-only entry), allow NULL table_id through.
    RETURN NEW;
END;
$$;

-- Existing triggers bind to this function by name; no recreation needed.
-- set_post_reaction_table_id → set_post_interaction_table_id()
-- set_post_comment_table_id  → set_post_interaction_table_id()

-- RLS extension: extend INSERT WITH CHECK on entry-scope table reactions/comments
-- to allow entry_tables membership in addition to direct table_members membership
-- on the supplied table_id. The supplied table_id must be one this entry was
-- posted to AND the caller must be a member of that Table.

DROP POLICY IF EXISTS "post_reactions_insert_table" ON post_reactions;
CREATE POLICY "post_reactions_insert_table" ON post_reactions
    FOR INSERT WITH CHECK (
        scope = 'table'
        AND user_id = auth.uid()
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
        -- For entry targets, table_id must correspond to a linked entry_tables row OR legacy primary.
        AND (
            target_type <> 'entry'
            OR EXISTS (
                SELECT 1 FROM public.entry_tables et
                WHERE et.entry_id = target_id AND et.table_id = post_reactions.table_id
            )
            OR EXISTS (
                SELECT 1 FROM public.entries e
                WHERE e.id = target_id AND e.table_id = post_reactions.table_id
            )
        )
    );

DROP POLICY IF EXISTS "post_comments_insert_table" ON post_comments;
CREATE POLICY "post_comments_insert_table" ON post_comments
    FOR INSERT WITH CHECK (
        scope = 'table'
        AND user_id = auth.uid()
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
        AND (
            target_type <> 'entry'
            OR EXISTS (
                SELECT 1 FROM public.entry_tables et
                WHERE et.entry_id = target_id AND et.table_id = post_comments.table_id
            )
            OR EXISTS (
                SELECT 1 FROM public.entries e
                WHERE e.id = target_id AND e.table_id = post_comments.table_id
            )
        )
    );

-- SELECT policies are unchanged: scope='table' visibility keys on table_id (the
-- requesting Table). Same reaction/comment numbers across all linked Tables —
-- entry-level reactions are already counted via target_id; the table_id denorm
-- is for filtering reads to the right scope, which now correctly differs per Table.
