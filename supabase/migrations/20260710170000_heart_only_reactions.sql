-- Heart-only reactions: post reactions become a like/unlike heart.
--
-- The 5-emoji picker (🔥 😋 ❤️ 💯 👀) is gone from the client; a reaction now
-- means exactly "liked". This migration canonicalizes existing data and fixes a
-- latent constraint bug:
--
--   The original unique constraint was (target_type, target_id, user_id, emoji)
--   — WITHOUT scope (predates TICKET-021 dual-scope). A user's table-scope ❤️ on
--   an entry therefore blocked their public-scope ❤️ on the same entry with a
--   unique violation (HTTP 500 at the edge). Heart-only makes that collision the
--   common case, so the constraint moves to (target_type, target_id, user_id,
--   scope): one reaction per user per scope, like/unlike semantics at the DB.
--
-- Steps (order matters):
--   1. Dedupe to one row per (target_type, target_id, user_id, scope) — keep the
--      ❤️ row when present, else the earliest.
--   2. Drop the old unique constraint BEFORE canonicalizing: a user may hold
--      🔥(table) + ❤️(public) on one target, and converting the 🔥 to ❤️ would
--      collide under the old scope-less uniqueness.
--   3. Canonicalize every remaining row to ❤️.
--   4. Add the new (…, scope) unique constraint.
--   5. Resync denormalized reaction_count/top_emojis on all three parents —
--      the sync trigger fires on INSERT/DELETE only, so step 3's UPDATE left
--      parents stale (top_emojis still listing 🔥 etc.).
--
-- Idempotent: re-running finds no dupes, no non-❤️ rows, and IF EXISTS guards
-- on the constraint swap.

-- ── 1. Dedupe per (target_type, target_id, user_id, scope) ───────────────────
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY target_type, target_id, user_id, scope
               ORDER BY (emoji = '❤️') DESC, created_at ASC, id ASC
           ) AS rn
    FROM public.post_reactions
)
DELETE FROM public.post_reactions pr
USING ranked r
WHERE pr.id = r.id AND r.rn > 1;

-- ── 2. Swap constraints (drop old before the emoji rewrite) ──────────────────
ALTER TABLE public.post_reactions
    DROP CONSTRAINT IF EXISTS post_reactions_target_type_target_id_user_id_emoji_key;

-- ── 3. Canonicalize to ❤️ ─────────────────────────────────────────────────────
UPDATE public.post_reactions
SET emoji = '❤️'
WHERE emoji <> '❤️';

-- ── 4. One reaction per user per scope ────────────────────────────────────────
DO $do$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'post_reactions_one_per_user_scope'
          AND conrelid = 'public.post_reactions'::regclass
    ) THEN
        ALTER TABLE public.post_reactions
            ADD CONSTRAINT post_reactions_one_per_user_scope
            UNIQUE (target_type, target_id, user_id, scope);
    END IF;
END;
$do$;

-- ── 5. Resync denormalized counts + top_emojis ────────────────────────────────
-- Every target that still has rows gets a fresh single-bucket ❤️ aggregate.
-- (Dedupe never removes a target's last row, so recomputing over post_reactions
-- covers every parent whose numbers could have changed.)

-- table_nights (table scope only; jsonb top_emojis)
UPDATE public.table_nights t
SET reaction_count = agg.cnt,
    top_emojis = jsonb_build_array(
        jsonb_build_object('emoji', '❤️', 'count', agg.cnt, 'last_reacted_at', agg.last_at)
    )
FROM (
    SELECT target_id, COUNT(*) AS cnt, MAX(created_at) AS last_at
    FROM public.post_reactions
    WHERE target_type = 'table_night' AND scope = 'table'
    GROUP BY target_id
) agg
WHERE t.id = agg.target_id;

-- entries, table scope (jsonb top_emojis)
UPDATE public.entries e
SET reaction_count = agg.cnt,
    top_emojis = jsonb_build_array(
        jsonb_build_object('emoji', '❤️', 'count', agg.cnt, 'last_reacted_at', agg.last_at)
    )
FROM (
    SELECT target_id, COUNT(*) AS cnt, MAX(created_at) AS last_at
    FROM public.post_reactions
    WHERE target_type = 'entry' AND scope = 'table'
    GROUP BY target_id
) agg
WHERE e.id = agg.target_id;

-- entries, public scope (jsonb public_top_emojis)
UPDATE public.entries e
SET public_reaction_count = agg.cnt,
    public_top_emojis = jsonb_build_array(
        jsonb_build_object('emoji', '❤️', 'count', agg.cnt, 'last_reacted_at', agg.last_at)
    )
FROM (
    SELECT target_id, COUNT(*) AS cnt, MAX(created_at) AS last_at
    FROM public.post_reactions
    WHERE target_type = 'entry' AND scope = 'public'
    GROUP BY target_id
) agg
WHERE e.id = agg.target_id;

-- table_shares (table scope only; text[] top_emojis)
UPDATE public.table_shares ts
SET reaction_count = agg.cnt,
    top_emojis = ARRAY['❤️']::text[]
FROM (
    SELECT target_id, COUNT(*) AS cnt
    FROM public.post_reactions
    WHERE target_type = 'table_share' AND scope = 'table'
    GROUP BY target_id
) agg
WHERE ts.id = agg.target_id;
