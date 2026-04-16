-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: backfill_post_interaction_counts
--
-- Normalizes reaction_count / comment_count on table_nights and entries after
-- the post_interactions migration. Required because comment_count was already
-- present on entries (without any maintaining trigger) when post_interactions
-- ran, so its values may be stale on pre-existing rows.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE table_nights tn SET
    reaction_count = COALESCE((
        SELECT COUNT(*) FROM post_reactions
        WHERE target_type = 'table_night' AND target_id = tn.id
    ), 0),
    comment_count = COALESCE((
        SELECT COUNT(*) FROM post_comments
        WHERE target_type = 'table_night' AND target_id = tn.id
    ), 0);

UPDATE entries e SET
    reaction_count = COALESCE((
        SELECT COUNT(*) FROM post_reactions
        WHERE target_type = 'entry' AND target_id = e.id
    ), 0),
    comment_count = COALESCE((
        SELECT COUNT(*) FROM post_comments
        WHERE target_type = 'entry' AND target_id = e.id
    ), 0);
