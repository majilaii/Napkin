-- TICKET-060: Extend post_reactions / post_comments / triggers for 'table_share' target.
-- [B1] Full audit: uniqueness constraints, denorm/count triggers, top-emoji paths,
-- delete cascades, and client switch(target_type) coverage.
--
-- B1 audit findings (done before this migration):
--   1. post_reactions target_type CHECK: currently ('table_night', 'entry') → extend.
--   2. post_comments target_type CHECK: currently ('table_night', 'entry') → extend.
--   3. sync_post_counts trigger function: branches on target_type to update parent counts.
--      Currently handles 'table_night' (→ table_nights) and 'entry' (→ entries).
--      Must add 'table_share' branch (→ table_shares.reaction_count / top_emojis).
--   4. set_post_interaction_table_id trigger: denorms table_id from the parent onto
--      each reaction/comment row. For 'table_share', table_id comes from table_shares.table_id.
--   5. post_reactions unique constraint: (target_type, target_id, user_id, emoji) —
--      no change needed (already target-type-keyed).
--   6. Cascade delete: post_reactions ON DELETE CASCADE from target. For 'table_share',
--      the cascade is application-level (edge fn deletes reactions when share is deleted).
--      Existing FK is on target_id but not table-share-specific — acceptable since
--      service-role handles deletes via the edge fn.
--
-- Note: The CHECK constraints on target_type use ALTER TABLE ... USING; we drop+recreate.

-- ── 1. Extend post_reactions target_type CHECK ────────────────────────────────
ALTER TABLE public.post_reactions
  DROP CONSTRAINT IF EXISTS post_reactions_target_type_check;

ALTER TABLE public.post_reactions
  ADD CONSTRAINT post_reactions_target_type_check
    CHECK (target_type IN ('table_night', 'entry', 'table_share'));

-- ── 2. Extend post_comments target_type CHECK ────────────────────────────────
ALTER TABLE public.post_comments
  DROP CONSTRAINT IF EXISTS post_comments_target_type_check;

ALTER TABLE public.post_comments
  ADD CONSTRAINT post_comments_target_type_check
    CHECK (target_type IN ('table_night', 'entry', 'table_share'));

-- ── 3. Extend sync_post_counts to handle 'table_share' ───────────────────────
-- Read the current function body and extend it. We recreate with the new branch.
-- The existing function is defined in 20260418000000_post_interactions.sql
-- and extended in 20260430000000_dual_scope_post_interactions.sql.
-- We CREATE OR REPLACE to add the table_share branch.

CREATE OR REPLACE FUNCTION public.sync_post_counts()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_target_id   uuid;
  v_target_type text;
  v_scope       text;
BEGIN
  -- Determine target from the changed row
  IF TG_OP = 'DELETE' THEN
    v_target_id   := OLD.target_id;
    v_target_type := OLD.target_type;
    v_scope       := OLD.scope;
  ELSE
    v_target_id   := NEW.target_id;
    v_target_type := NEW.target_type;
    v_scope       := NEW.scope;
  END IF;

  IF v_target_type = 'table_night' THEN
    UPDATE public.table_nights tn
    SET
      reaction_count = (
        SELECT count(*) FROM public.post_reactions pr
        WHERE pr.target_id   = v_target_id
          AND pr.target_type = 'table_night'
          AND pr.scope       = 'table'
      ),
      comment_count = (
        SELECT count(*) FROM public.post_comments pc
        WHERE pc.target_id   = v_target_id
          AND pc.target_type = 'table_night'
          AND pc.scope       = 'table'
      ),
      top_emojis = (
        SELECT COALESCE(array_agg(emoji ORDER BY cnt DESC), '{}')
        FROM (
          SELECT emoji, count(*) AS cnt
          FROM public.post_reactions pr
          WHERE pr.target_id   = v_target_id
            AND pr.target_type = 'table_night'
            AND pr.scope       = 'table'
          GROUP BY emoji
          ORDER BY cnt DESC
          LIMIT 3
        ) sub
      )
    WHERE tn.id = v_target_id;

  ELSIF v_target_type = 'entry' THEN
    IF v_scope = 'public' THEN
      UPDATE public.entries e
      SET
        public_reaction_count = (
          SELECT count(*) FROM public.post_reactions pr
          WHERE pr.target_id   = v_target_id
            AND pr.target_type = 'entry'
            AND pr.scope       = 'public'
        ),
        public_comment_count = (
          SELECT count(*) FROM public.post_comments pc
          WHERE pc.target_id   = v_target_id
            AND pc.target_type = 'entry'
            AND pc.scope       = 'public'
        ),
        public_top_emojis = (
          SELECT COALESCE(array_agg(emoji ORDER BY cnt DESC), '{}')
          FROM (
            SELECT emoji, count(*) AS cnt
            FROM public.post_reactions pr
            WHERE pr.target_id   = v_target_id
              AND pr.target_type = 'entry'
              AND pr.scope       = 'public'
            GROUP BY emoji
            ORDER BY cnt DESC
            LIMIT 3
          ) sub
        )
      WHERE e.id = v_target_id;
    ELSE
      UPDATE public.entries e
      SET
        reaction_count = (
          SELECT count(*) FROM public.post_reactions pr
          WHERE pr.target_id   = v_target_id
            AND pr.target_type = 'entry'
            AND pr.scope       = 'table'
        ),
        comment_count = (
          SELECT count(*) FROM public.post_comments pc
          WHERE pc.target_id   = v_target_id
            AND pc.target_type = 'entry'
            AND pc.scope       = 'table'
        ),
        top_emojis = (
          SELECT COALESCE(array_agg(emoji ORDER BY cnt DESC), '{}')
          FROM (
            SELECT emoji, count(*) AS cnt
            FROM public.post_reactions pr
            WHERE pr.target_id   = v_target_id
              AND pr.target_type = 'entry'
              AND pr.scope       = 'table'
            GROUP BY emoji
            ORDER BY cnt DESC
            LIMIT 3
          ) sub
        )
      WHERE e.id = v_target_id;
    END IF;

  ELSIF v_target_type = 'table_share' THEN
    -- [TICKET-060 B1] New branch: write reaction_count + top_emojis back to table_shares.
    -- table_shares has no comment_count column (comments on shared cards not in v1 scope).
    UPDATE public.table_shares ts
    SET
      reaction_count = (
        SELECT count(*) FROM public.post_reactions pr
        WHERE pr.target_id   = v_target_id
          AND pr.target_type = 'table_share'
          AND pr.scope       = 'table'
      ),
      top_emojis = (
        SELECT COALESCE(array_agg(emoji ORDER BY cnt DESC), '{}')
        FROM (
          SELECT emoji, count(*) AS cnt
          FROM public.post_reactions pr
          WHERE pr.target_id   = v_target_id
            AND pr.target_type = 'table_share'
            AND pr.scope       = 'table'
          GROUP BY emoji
          ORDER BY cnt DESC
          LIMIT 3
        ) sub
      )
    WHERE ts.id = v_target_id;
  END IF;

  RETURN NULL;
END;
$$;

-- ── 4. Extend set_post_interaction_table_id to handle 'table_share' ──────────
-- This function denorms table_id from the parent row onto each reaction/comment.
-- For 'table_share', table_id comes from table_shares.table_id directly.
-- We extend the existing function (defined across 20260418 + 20260430 migrations).

CREATE OR REPLACE FUNCTION public.set_post_interaction_table_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_table_id uuid;
BEGIN
  -- Determine table_id from the parent based on target_type
  IF NEW.target_type = 'table_night' THEN
    SELECT table_id INTO v_table_id
    FROM public.table_nights
    WHERE id = NEW.target_id;

  ELSIF NEW.target_type = 'entry' THEN
    -- For entries, look up via entry_tables to support multi-Table entries.
    -- Use the first match for the caller's scope.
    SELECT et.table_id INTO v_table_id
    FROM public.entry_tables et
    WHERE et.entry_id = NEW.target_id
    ORDER BY et.posted_at ASC
    LIMIT 1;
    -- Fall back to entries.table_id for legacy single-Table entries.
    IF v_table_id IS NULL THEN
      SELECT e.table_id INTO v_table_id
      FROM public.entries e
      WHERE e.id = NEW.target_id;
    END IF;

  ELSIF NEW.target_type = 'table_share' THEN
    -- [TICKET-060 B1] New branch: read table_id from table_shares.
    SELECT table_id INTO v_table_id
    FROM public.table_shares
    WHERE id = NEW.target_id;
  END IF;

  NEW.table_id := v_table_id;
  RETURN NEW;
END;
$$;

-- Triggers should already exist from prior migrations; recreate IF NOT EXISTS
-- equivalent (DROP IF EXISTS + CREATE) to pick up the new function body.
-- The trigger names are defined in 20260418000000_post_interactions.sql.

DO $$
BEGIN
  -- Drop and recreate reaction trigger
  DROP TRIGGER IF EXISTS set_post_reaction_table_id ON public.post_reactions;
  CREATE TRIGGER set_post_reaction_table_id
    BEFORE INSERT ON public.post_reactions
    FOR EACH ROW EXECUTE FUNCTION public.set_post_interaction_table_id();

  -- Drop and recreate comment trigger
  DROP TRIGGER IF EXISTS set_post_comment_table_id ON public.post_comments;
  CREATE TRIGGER set_post_comment_table_id
    BEFORE INSERT ON public.post_comments
    FOR EACH ROW EXECUTE FUNCTION public.set_post_interaction_table_id();
END;
$$;

-- The sync_counts triggers (sync_counts_on_reaction, sync_counts_on_comment) should
-- already exist and reference sync_post_counts(); they fire after INSERT/DELETE/UPDATE
-- on post_reactions and post_comments. No need to recreate them — the CREATE OR REPLACE
-- above updates the function body they call.

COMMENT ON FUNCTION public.sync_post_counts IS
  'Denorm trigger: keeps reaction_count/comment_count/top_emojis on table_nights, entries, and table_shares in sync. Extended for table_share target in TICKET-060 (B1).';

COMMENT ON FUNCTION public.set_post_interaction_table_id IS
  'BEFORE INSERT trigger: denorms table_id from parent (table_night|entry|table_share) onto each reaction/comment row. Extended for table_share in TICKET-060 (B1).';
