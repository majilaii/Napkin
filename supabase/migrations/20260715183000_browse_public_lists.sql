-- TICKET-189 — For You public-lists block fixes: viewer-keyed browse RPC.
--
-- fn_browse_public_lists(p_viewer, p_limit) replaces the lists edge fn's
-- browse_public path (fn_search_public_lists with q='' + a per-list cover
-- fan-out). Sanctioned by fn_search_public_lists' own coupling note ("or give
-- browse_public its own fn"). Changes vs the old path:
--
--   1. SELF-EXCLUSION lands in the WHERE *before* LIMIT — the viewer's own
--      lists never consume the browse cap (spec AC§4: a viewer with 2 own +
--      6 others' public lists still gets 6 others').
--   2. The first-restaurant cover collapses into ONE lateral (no edge N+1),
--      and is PUBLIC-SAFE: cover_photo_url is returned ONLY WHEN the
--      restaurant's photo_source = 'places' AND attribution html exists
--      (Codex P1 — restaurants.photo_url can be a photo_source='user'/'table'
--      hero, i.e. someone's entry photo promoted to the restaurant row; that
--      must NEVER back a public-feed cover). Otherwise cover_photo_url is
--      NULL → the client falls to the emoji / tint plate. No entry_photos
--      column is ever read (blast-radius risk note).
--   3. cover_photo_source + cover_attribution_html ride along so the client
--      can render the Places credit (browse_public's old bare photo_url could
--      not attribute).
--
-- SAME TRIPLE GATE as fn_search_public_lists — the `lists` edge fn runs with
-- the service-role key (RLS is INERT there), so the predicate is the only
-- enforcement:
--   1. l.privacy = 'public'          — the list is public
--   2. l.table_id IS NULL            — Tables-never-public cross-gate
--   3. p.account_privacy = 'public'  — the owner's account is public
--
-- SECURITY INVOKER (mirrors fn_search_public_lists' posture — service-role-
-- called, RLS-inert). Explicit column list — table_id is NEVER returned.
-- Cover ordering mirrors the old edge behavior: ranked lists → first by
-- position ASC; unranked → most-recently-added (created_at DESC).
--
-- Replay-from-zero: references lists / profiles / list_entries / restaurants
-- (all pre-2026-07-15). No toggle needed.

create or replace function public.fn_browse_public_lists(
    p_viewer uuid,
    p_limit  int default 6
)
returns table (
    id                     uuid,
    owner_id               uuid,
    title                  text,
    description            text,
    ranked                 boolean,
    emoji                  text,
    entry_count            bigint,
    updated_at             timestamptz,
    owner_display_name     text,
    owner_avatar_url       text,
    owner_username         text,
    cover_photo_url        text,
    cover_photo_source     text,
    cover_attribution_html text
)
language sql
stable
as $fn$
    select
        l.id,
        l.owner_id,
        l.title,
        l.description,
        l.ranked,
        l.emoji,
        (select count(*) from public.list_entries le where le.list_id = l.id) as entry_count,
        l.updated_at,
        p.display_name as owner_display_name,
        p.avatar_url   as owner_avatar_url,
        p.username     as owner_username,
        -- Public-safe attributed cover: Places hero ONLY, else NULL.
        case when cover.photo_source = 'places'
              and cover.places_photo_attribution_html is not null
             then cover.photo_url else null end as cover_photo_url,
        case when cover.photo_source = 'places'
              and cover.places_photo_attribution_html is not null
             then cover.photo_source else null end as cover_photo_source,
        case when cover.photo_source = 'places'
              and cover.places_photo_attribution_html is not null
             then cover.places_photo_attribution_html else null end as cover_attribution_html
    from public.lists l
    join public.profiles p on p.user_id = l.owner_id
    left join lateral (
        -- The list's FIRST restaurant, exactly as the author ordered it:
        -- ranked → position ASC; unranked → newest add first (mirrors the old
        -- browse_public cover fan-out). Reads restaurants.photo_url /
        -- photo_source / attribution ONLY — never entry_photos.
        select r.photo_url, r.photo_source, r.places_photo_attribution_html
        from public.list_entries le
        join public.restaurants r on r.id = le.restaurant_id
        where le.list_id = l.id
        order by
            case when l.ranked then le.position end asc nulls last,
            case when not l.ranked then le.created_at end desc nulls last
        limit 1
    ) cover on true
    where l.privacy = 'public'
      and l.table_id is null                 -- Tables-never-public cross-gate
      and p.account_privacy = 'public'       -- owner account gate
      and l.owner_id <> p_viewer             -- self-exclusion BEFORE the limit
    order by l.updated_at desc, l.id desc
    limit p_limit;
$fn$;

comment on function public.fn_browse_public_lists(uuid, int) is
    'TICKET-189: viewer-keyed For You lists browse — triple gate (public list + '
    'non-Table + public owner) + owner_id <> p_viewer before LIMIT; laterals '
    'the first-restaurant cover, returned ONLY when photo_source=''places'' '
    'with attribution (never a user/table hero on the public feed). Explicit '
    'projection, no table_id. Service-role called; SECURITY INVOKER like '
    'fn_search_public_lists.';

revoke all on function public.fn_browse_public_lists(uuid, int) from PUBLIC, anon, authenticated;
grant execute on function public.fn_browse_public_lists(uuid, int) to service_role;
