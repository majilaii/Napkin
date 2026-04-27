-- TICKET-046: Table Top 4 — RLS policies, audit history, set RPC,
-- and fn_table_activity_page extension for top_4_edited feed events.
-- All membership checks use tm.member_id (NOT user_id) — TICKET-034 footgun.

-- ── 1. RLS policies on existing table_top_4 (RLS enabled, no policies) ────────

create policy "tt4_select_member"
    on public.table_top_4 for select
    using (exists (
        select 1 from public.table_members tm
        where tm.table_id = table_top_4.table_id
          and tm.member_id = auth.uid()
    ));

create policy "tt4_insert_member"
    on public.table_top_4 for insert
    with check (exists (
        select 1 from public.table_members tm
        where tm.table_id = table_top_4.table_id
          and tm.member_id = auth.uid()
    ));

create policy "tt4_update_member"
    on public.table_top_4 for update
    using (exists (
        select 1 from public.table_members tm
        where tm.table_id = table_top_4.table_id
          and tm.member_id = auth.uid()
    ))
    with check (exists (
        select 1 from public.table_members tm
        where tm.table_id = table_top_4.table_id
          and tm.member_id = auth.uid()
    ));

create policy "tt4_delete_member"
    on public.table_top_4 for delete
    using (exists (
        select 1 from public.table_members tm
        where tm.table_id = table_top_4.table_id
          and tm.member_id = auth.uid()
    ));

-- ── 2. Audit history table ────────────────────────────────────────────────────

create table public.table_top_4_history (
    id uuid primary key default gen_random_uuid(),
    table_id uuid not null references public.tables(id) on delete cascade,
    position smallint not null check (position between 1 and 4),
    actor_id uuid not null references auth.users(id),
    event_type text not null check (event_type in ('added','swapped','removed')),
    prev_restaurant_id uuid references public.restaurants(id),
    next_restaurant_id uuid references public.restaurants(id),
    created_at timestamptz not null default now()
);

create index idx_tt4_history_table_created
    on public.table_top_4_history (table_id, created_at desc, position asc);

alter table public.table_top_4_history enable row level security;

-- Members can read their own table's history; service role writes via RPC (SECURITY DEFINER).
create policy "tt4_hist_select_member"
    on public.table_top_4_history for select
    using (exists (
        select 1 from public.table_members tm
        where tm.table_id = table_top_4_history.table_id
          and tm.member_id = auth.uid()
    ));

-- ── 3. fn_set_table_top_4 — atomic diff + upsert/delete + history ────────────
-- SECURITY DEFINER: runs as the function owner (postgres/service_role) so it can
-- write to table_top_4_history without an INSERT policy on that table.
-- Membership is verified explicitly inside the function before any writes.

create or replace function fn_set_table_top_4(
    p_table_id uuid,
    p_actor_id uuid,
    p_slots jsonb  -- [{position: int, restaurant_id: uuid|null}, ...]
) returns void language plpgsql security definer as $$
declare
    slot record;
    prev_rid uuid;
    next_rid uuid;
    evt text;
begin
    -- Verify membership using member_id (NOT user_id — TICKET-034 footgun)
    if not exists (
        select 1 from public.table_members tm
        where tm.table_id = p_table_id and tm.member_id = p_actor_id
    ) then
        raise exception 'not a member of this table';
    end if;

    for slot in
        select (elem->>'position')::smallint as position,
               nullif(elem->>'restaurant_id','')::uuid as restaurant_id
        from jsonb_array_elements(p_slots) elem
    loop
        -- Read current state for this position
        select restaurant_id into prev_rid
        from public.table_top_4
        where table_id = p_table_id and position = slot.position;

        next_rid := slot.restaurant_id;

        -- Skip if no change
        if prev_rid is null and next_rid is null then
            continue;
        end if;
        if prev_rid is not distinct from next_rid then
            continue;
        end if;

        -- Determine event type
        if prev_rid is null then evt := 'added';
        elsif next_rid is null then evt := 'removed';
        else evt := 'swapped';
        end if;

        -- Apply the change
        if next_rid is null then
            delete from public.table_top_4
            where table_id = p_table_id and position = slot.position;
        else
            insert into public.table_top_4 (table_id, position, restaurant_id, updated_by, updated_at)
            values (p_table_id, slot.position, next_rid, p_actor_id, now())
            on conflict (table_id, position) do update
            set restaurant_id = excluded.restaurant_id,
                updated_by    = excluded.updated_by,
                updated_at    = excluded.updated_at;
        end if;

        -- Write audit row (service-role write — bypasses RLS)
        insert into public.table_top_4_history
            (table_id, position, actor_id, event_type, prev_restaurant_id, next_restaurant_id)
        values
            (p_table_id, slot.position, p_actor_id, evt, prev_rid, next_rid);
    end loop;
end;
$$;

grant execute on function fn_set_table_top_4(uuid, uuid, jsonb) to authenticated, service_role;

-- ── 4. Extend fn_table_activity_page with top_4_edited stream ────────────────
-- Re-creates the function with a third UNION branch (tt4_stream) that surfaces
-- table_top_4_history rows as activity feed items.
--
-- Cursor stability: tt4 rows use their natural uuid `id` column — no synthetic
-- uuid_generate_v5 needed because the id is already a stable primary key.
--
-- The entries_stream and nights_stream branches are preserved BYTE-IDENTICAL from
-- 20260424100000_pagination_rpcs.sql — only the UNION and param list change.
--
-- p_filter_type: top_4_edited rows are only included when filter is null
-- (they don't belong to 'round' or 'solo_share' filters).

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
    tt4_stream as (
        select
            'top_4_edited'::text as kind,
            h.id,
            h.created_at as sort_date,
            to_jsonb(h) as payload
        from public.table_top_4_history h
        where h.table_id = p_table_id
          -- Only show when no type filter is active (tt4 events have no sub-type)
          and p_filter_type is null
          -- Respect user filter: only show if actor matches
          and (p_filter_user_id is null or h.actor_id = p_filter_user_id)
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
