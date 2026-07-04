-- TICKET-099 — profile diary keyset pagination fix.
--
-- fetchDiary (user-profile: actions `diary` + `reviews`) paginated by calling
-- applyKeysetFilter against raw `entries`, which emits a filter on a literal
-- `sort_date` column. `entries` has no sort_date column, so every page-2+
-- request died at PostgREST with 42703 ("column entries.sort_date does not
-- exist") → user-profile 500. Verified against prod PostgREST 2026-07-04:
-- the exact or-filter returns HTTP 400/42703; the same shape on a real column
-- returns 200.
--
-- Fix mirrors fn_user_aggregate_feed / fn_friends_feed: keyset lives IN SQL on
-- a projected sort_date = COALESCE(visited_at, created_at) + id tiebreak —
-- never a PostgREST filter against raw entries. This also repairs a second
-- latent mismatch: the cursor already encoded COALESCE(visited_at, created_at)
-- (DiaryRow.visited_at) while the query ordered by raw visited_at — NULL
-- visited_at rows sorted DESC NULLS FIRST yet carried a created_at cursor date.
--
-- The predicate is intentionally IDENTICAL to the previous fetchDiary chain:
--     user_id = p_user_id AND restaurant_id IS NOT NULL
--     [+ visibility <> 'private' unless p_include_private (self view)]
--     [+ content nonempty when p_reviews_only]
-- It does NOT adopt fn_public_eligible_entries' engagement gate (rating +
-- 20-char content) — migrating the public diary onto the shared eligibility
-- predicate is the separate follow-up TICKET-098 anticipated, and is a product
-- decision, not part of this bugfix.

CREATE OR REPLACE FUNCTION public.fn_user_diary_page(
    p_user_id         uuid,
    p_include_private boolean,
    p_reviews_only    boolean,
    p_cursor_date     timestamptz,
    p_cursor_id       uuid,
    p_limit           int
)
RETURNS TABLE (
    id                   uuid,
    restaurant_id        uuid,
    rating               double precision,
    content              text,
    photo_url            text,
    visited_at           timestamptz,
    created_at           timestamptz,
    restaurant_name      text,
    restaurant_city      text,
    restaurant_photo_url text,
    sort_date            timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        e.id,
        e.restaurant_id,
        e.rating,
        e.content,
        e.photo_url,
        e.visited_at,
        e.created_at,
        -- LEFT JOIN preserves the old PostgREST-embed semantics: an entry is
        -- never dropped because of the restaurants join (the edge fn falls
        -- back to 'Unknown'). FK integrity makes a miss near-impossible anyway.
        r.name,
        r.city,
        r.photo_url,
        COALESCE(e.visited_at, e.created_at) AS sort_date
    FROM public.entries e
    LEFT JOIN public.restaurants r ON r.id = e.restaurant_id
    WHERE e.user_id = p_user_id
      AND e.restaurant_id IS NOT NULL
      -- `<>` excludes NULL visibility, matching PostgREST .neq('visibility','private')
      AND (p_include_private OR e.visibility <> 'private')
      -- reviews surface = rows with a written note; COALESCE(...) <> '' matches
      -- .not('content','is',null).neq('content','') exactly (NULL and '' out)
      AND (NOT p_reviews_only OR COALESCE(e.content, '') <> '')
      AND (p_cursor_date IS NULL
           OR (COALESCE(e.visited_at, e.created_at), e.id) < (p_cursor_date, p_cursor_id))
    ORDER BY COALESCE(e.visited_at, e.created_at) DESC, e.id DESC
    LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.fn_user_diary_page(uuid, boolean, boolean, timestamptz, uuid, int) IS
    'TICKET-099: profile diary/reviews keyset page on '
    'sort_date = COALESCE(visited_at, created_at). Predicate matches the '
    'pre-fix fetchDiary exactly (no engagement gate). Service-role only — '
    'user-profile validates the JWT and applies the gates.ts audience checks '
    'before calling.';

REVOKE ALL ON FUNCTION public.fn_user_diary_page(uuid, boolean, boolean, timestamptz, uuid, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_user_diary_page(uuid, boolean, boolean, timestamptz, uuid, int)
    TO service_role;
