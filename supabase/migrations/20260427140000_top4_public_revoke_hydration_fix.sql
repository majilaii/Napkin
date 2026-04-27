-- TICKET-046 Fix Pass 2
-- BLOCKER 1: Belt-and-suspenders revoke from PUBLIC (the default privilege that
--   authenticated inherits). Fix-pass-1 only revoked from 'authenticated', but
--   Postgres grants EXECUTE to PUBLIC by default; authenticated inherits that
--   grant, so the RPC was still callable via PostgREST.
-- BLOCKER 2: Fix fn_table_activity_page::tt4_canonical so it returns a real
--   table_top_4_history.id (row PK) as the feed card ID, not save_id. The
--   consumer's .in('id', tt4Ids) in table-activity/index.ts therefore matches
--   exactly. Deduplication per save is preserved via DISTINCT ON (save_id)
--   ordered by position asc — the lowest-position row's PK is the canonical card.

-- ── 1. Revoke from PUBLIC, anon, authenticated; grant only service_role ─────
revoke execute on function public.fn_set_table_top_4(uuid, uuid, jsonb) from public;
revoke execute on function public.fn_set_table_top_4(uuid, uuid, jsonb) from anon;
revoke execute on function public.fn_set_table_top_4(uuid, uuid, jsonb) from authenticated;
-- Idempotent re-grant so service_role is always present.
grant execute on function public.fn_set_table_top_4(uuid, uuid, jsonb) to service_role;

-- ── 2. Replace fn_table_activity_page — fix tt4_canonical hydration key ──────
-- entries_stream and nights_stream are BYTE-IDENTICAL to 20260427120000_*.sql.
-- Only tt4_canonical changes: returns h.id (real row PK) instead of c.save_id
-- as the outer id, so the table-activity consumer .in('id', tt4Ids) continues
-- to match table_top_4_history.id without any consumer-side change.
create or replace function fn_table_activity_page(
    p_table_id uuid,
    p_caller_id uuid,         -- used for companion-widening; always the authenticated user
    p_cursor_date timestamptz,   -- null → first page
    p_cursor_id uuid,            -- null → first page
    p_limit int,                 -- caller passes pageSize + 1
    p_filter_type text,          -- null | 'round' | 'solo_share'
    p_filter_user_id uuid        -- null for no filter
) returns table (
    kind text,                   -- 'entry' | 'table_night' | 'top_4_edited'
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
    -- One card per save: DISTINCT ON (save_id) ordered by (save_id, position asc)
    -- picks the lowest-position history row as the canonical card. Its h.id is a
    -- real table_top_4_history PK — the consumer .in('id', tt4Ids) matches it
    -- directly. Collapses N slot rows per save into 1 feed card.
    tt4_canonical as (
        select distinct on (h.save_id)
            h.id,                              -- real history row PK; consumer hydrates with .in('id', ...)
            h.created_at as sort_date,
            h.save_id
        from public.table_top_4_history h
        where h.table_id = p_table_id
          and h.save_id is not null
          and p_filter_type is null
          and (p_filter_user_id is null or h.actor_id = p_filter_user_id)
        order by h.save_id, h.position asc, h.created_at asc
    ),
    -- Legacy rows (save_id IS NULL) each surface individually.
    tt4_legacy as (
        select
            h.id,
            h.created_at as sort_date
        from public.table_top_4_history h
        where h.table_id = p_table_id
          and h.save_id is null
          and p_filter_type is null
          and (p_filter_user_id is null or h.actor_id = p_filter_user_id)
    ),
    tt4_stream as (
        select
            'top_4_edited'::text as kind,
            c.id,                              -- real row PK — hydrator can .in('id', ...)
            c.sort_date,
            to_jsonb(h) as payload
        from tt4_canonical c
        join public.table_top_4_history h on h.id = c.id
        union all
        select
            'top_4_edited'::text as kind,
            l.id,
            l.sort_date,
            to_jsonb(h) as payload
        from tt4_legacy l
        join public.table_top_4_history h on h.id = l.id
    ),
    unified as (
        select * from entries_stream
        union all
        select * from nights_stream
        union all
        select * from tt4_stream
    )
    select kind, id, sort_date, payload
    from unified
    where p_cursor_date is null
       or (sort_date, id) < (p_cursor_date, p_cursor_id)
    order by sort_date desc, id desc
    limit p_limit;
$$;
