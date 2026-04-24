-- Migration: pagination_rpcs
-- Adds RPC functions and indexes for cursor-paginated endpoints.
-- All DDL is additive (no RLS changes, no destructive operations).
-- Safe to ship alongside the edge-function deploy.

-- ── fn_table_activity_page ────────────────────────────────────────────────────
-- Merges solo entries + table_nights for a table into a single keyset-paginated
-- stream ordered by sort_date DESC, id DESC.
--
-- Companion-widening: an entry is included if the caller is its author OR a
-- companion on it (independent of p_filter_user_id). This preserves the old
-- edge-function behavior where caller-companion widening is unconditional.
--
-- p_filter_user_id scopes the non-widened slice (author = filter_user_id) but
-- does NOT restrict companion-widened entries — those always belong to the caller.

create or replace function fn_table_activity_page(
    p_table_id uuid,
    p_caller_id uuid,         -- used for companion-widening; always the authenticated user
    p_cursor_date timestamptz,   -- null → first page
    p_cursor_id uuid,            -- null → first page
    p_limit int,                 -- caller passes pageSize + 1
    p_filter_type text,          -- null | 'round' | 'solo_share'
    p_filter_user_id uuid        -- null for no filter
) returns table (
    kind text,                   -- 'entry' | 'table_night'
    id uuid,
    sort_date timestamptz,
    payload jsonb                -- full row as jsonb — edge function hydrates
) language sql stable as $$
    with entries_stream as (
        select
            'entry'::text as kind,
            e.id,
            coalesce(e.visited_at, e.created_at) as sort_date,
            to_jsonb(e) as payload
        from entries e
        where e.table_id = p_table_id
          and e.table_night_id is null
          and (p_filter_type is null or p_filter_type = 'solo_share')
          -- author match OR companion-widening for the caller
          and (
              p_filter_user_id is null
              or e.user_id = p_filter_user_id
              or (
                  e.user_id = p_caller_id
                  or exists (
                      select 1 from entry_companions ec
                      where ec.entry_id = e.id and ec.user_id = p_caller_id
                  )
              )
          )
    ),
    nights_stream as (
        select
            'table_night'::text as kind,
            n.id,
            coalesce(n.revealed_at, n.created_at) as sort_date,
            to_jsonb(n) as payload
        from table_nights n
        where n.table_id = p_table_id
          and n.status in ('rating', 'revealed', 'closed')
          and (p_filter_type is null or p_filter_type = 'round')
          and (
              p_filter_user_id is null
              or exists (
                  select 1 from table_night_participants p
                  where p.table_night_id = n.id and p.user_id = p_filter_user_id
              )
          )
    ),
    unified as (
        select * from entries_stream
        union all
        select * from nights_stream
    )
    select kind, id, sort_date, payload
    from unified
    where p_cursor_date is null
       or (sort_date, id) < (p_cursor_date, p_cursor_id)
    order by sort_date desc, id desc
    limit p_limit;
$$;

-- ── fn_atlas_city_restaurants ─────────────────────────────────────────────────
-- Returns restaurants for a table+city keyed by last_visit_date DESC,
-- restaurant_id DESC for stable keyset pagination.
-- Returns (restaurant_id, last_visit_date) — edge function hydrates the tiles.

create or replace function fn_atlas_city_restaurants(
    p_table_id uuid,
    p_city text,
    p_cursor_date timestamptz,   -- null → first page
    p_cursor_id uuid,            -- null → first page
    p_limit int                  -- caller passes pageSize + 1
) returns table (
    restaurant_id uuid,
    last_visit_date timestamptz
) language sql stable as $$
    with solo_visits as (
        select
            e.restaurant_id,
            max(coalesce(e.visited_at, e.created_at)) as last_visit_date
        from entries e
        join restaurants r on r.id = e.restaurant_id
        where e.table_id = p_table_id
          and e.table_night_id is null
          and r.city = p_city
        group by e.restaurant_id
    ),
    round_visits as (
        select
            n.restaurant_id,
            max(coalesce(n.revealed_at, n.created_at)) as last_visit_date
        from table_nights n
        join restaurants r on r.id = n.restaurant_id
        where n.table_id = p_table_id
          and r.city = p_city
        group by n.restaurant_id
    ),
    all_visits as (
        select restaurant_id, last_visit_date from solo_visits
        union all
        select restaurant_id, last_visit_date from round_visits
    ),
    per_restaurant as (
        select
            restaurant_id,
            max(last_visit_date) as last_visit_date
        from all_visits
        group by restaurant_id
    )
    select restaurant_id, last_visit_date
    from per_restaurant
    where p_cursor_date is null
       or (last_visit_date, restaurant_id) < (p_cursor_date, p_cursor_id)
    order by last_visit_date desc, restaurant_id desc
    limit p_limit;
$$;

-- ── Supporting indexes ────────────────────────────────────────────────────────
-- Partial index for fn_table_activity_page entries stream.
-- Covers: table_id filter + sort_date keyset + id tiebreak for solo entries only.

create index if not exists idx_entries_table_solo_sort
    on entries (table_id, coalesce(visited_at, created_at) desc, id desc)
    where table_night_id is null;

-- Index for fn_table_activity_page nights stream.
create index if not exists idx_table_nights_table_sort
    on table_nights (table_id, coalesce(revealed_at, created_at) desc, id desc);

-- Index for fn_atlas_city_restaurants — restaurant join on city.
create index if not exists idx_restaurants_city
    on restaurants (city)
    where city is not null;
