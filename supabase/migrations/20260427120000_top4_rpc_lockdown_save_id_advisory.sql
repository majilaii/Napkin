-- TICKET-046 Fix Pass 1
-- Addresses BLOCKER 1 (Codex): revoke execute from authenticated — PostgREST
--   callers must go through the edge function (service_role path only).
-- Addresses BLOCKER 3 (Codex): advisory lock serializes concurrent saves per table.
-- Addresses BLOCKER 4 (Codex): save_id column collapses N per-slot history rows
--   into one activity-feed card per save.

-- ── 1. Revoke execute from authenticated ─────────────────────────────────────
-- The edge function uses the service_role client, which bypasses this restriction.
-- Authenticated clients (PostgREST) can no longer call the RPC directly with an
-- arbitrary p_actor_id.
revoke execute on function public.fn_set_table_top_4(uuid, uuid, jsonb) from authenticated;
-- Ensure service_role retains execute (re-grants are idempotent).
grant execute on function public.fn_set_table_top_4(uuid, uuid, jsonb) to service_role;

-- ── 2. Add save_id column to table_top_4_history ──────────────────────────────
-- Nullable for back-compat with history rows written before this migration.
-- All new rows written by the updated RPC will always have save_id set.
alter table public.table_top_4_history
    add column if not exists save_id uuid;

-- Index on save_id for the DISTINCT ON query in fn_table_activity_page.
create index if not exists idx_tt4_history_save_id
    on public.table_top_4_history (table_id, save_id, created_at desc, position asc);

-- ── 3. Replace fn_set_table_top_4 with advisory lock + save_id stamping ──────
create or replace function public.fn_set_table_top_4(
    p_table_id uuid,
    p_actor_id uuid,
    p_slots jsonb  -- [{position: int, restaurant_id: uuid|null}, ...]
) returns void language plpgsql security definer as $$
declare
    v_save_id uuid;
    slot      record;
    prev_rid  uuid;
    next_rid  uuid;
    evt       text;
begin
    -- Serialize concurrent saves for this table; advisory lock is released at
    -- transaction end. Cheap: one per save, no deadlock risk (single lock key).
    perform pg_advisory_xact_lock(hashtext('top_4:' || p_table_id::text));

    -- Verify membership using member_id (NOT user_id — TICKET-034 footgun).
    if not exists (
        select 1 from public.table_members tm
        where tm.table_id = p_table_id and tm.member_id = p_actor_id
    ) then
        raise exception 'not a member of this table';
    end if;

    -- One stable UUID for all history rows in this save — used by
    -- fn_table_activity_page to collapse N slots → 1 feed card.
    v_save_id := gen_random_uuid();

    for slot in
        select (elem->>'position')::smallint as position,
               nullif(elem->>'restaurant_id', '')::uuid as restaurant_id
        from jsonb_array_elements(p_slots) elem
    loop
        -- Read current state AFTER taking the lock (correct prev under concurrency).
        select restaurant_id into prev_rid
        from public.table_top_4
        where table_id = p_table_id and position = slot.position;

        next_rid := slot.restaurant_id;

        -- Skip no-ops.
        if prev_rid is null and next_rid is null then
            continue;
        end if;
        if prev_rid is not distinct from next_rid then
            continue;
        end if;

        -- Determine event type.
        if prev_rid is null then evt := 'added';
        elsif next_rid is null then evt := 'removed';
        else evt := 'swapped';
        end if;

        -- Apply the change.
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

        -- Write audit row stamped with this save's UUID.
        insert into public.table_top_4_history
            (table_id, position, actor_id, event_type, prev_restaurant_id, next_restaurant_id, save_id)
        values
            (p_table_id, slot.position, p_actor_id, evt, prev_rid, next_rid, v_save_id);
    end loop;
end;
$$;

-- ── 4. Rebuild fn_table_activity_page with save_id-collapsed tt4_stream ──────
-- entries_stream and nights_stream are BYTE-IDENTICAL to 20260424100000_pagination_rpcs.sql
-- (verified). Only the tt4_stream branch changes.

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
    -- One card per save: DISTINCT ON (save_id) keeps the earliest-position row
    -- as the canonical card. Rows with NULL save_id (pre-migration history) each
    -- surface as their own card via the fallback branch below.
    tt4_canonical as (
        select distinct on (h.save_id)
            h.save_id,
            h.id,
            h.created_at,
            to_jsonb(h) as payload
        from public.table_top_4_history h
        where h.table_id = p_table_id
          and h.save_id is not null
          and p_filter_type is null
          and (p_filter_user_id is null or h.actor_id = p_filter_user_id)
        order by h.save_id, h.created_at desc, h.position asc
    ),
    -- Legacy rows (save_id IS NULL) each surface individually.
    tt4_legacy as (
        select
            h.id,
            h.created_at,
            to_jsonb(h) as payload
        from public.table_top_4_history h
        where h.table_id = p_table_id
          and h.save_id is null
          and p_filter_type is null
          and (p_filter_user_id is null or h.actor_id = p_filter_user_id)
    ),
    tt4_stream as (
        -- Use save_id as the stable cursor id for canonical rows.
        select
            'top_4_edited'::text as kind,
            c.save_id as id,
            c.created_at as sort_date,
            c.payload
        from tt4_canonical c
        union all
        -- Legacy rows use their natural primary key.
        select
            'top_4_edited'::text as kind,
            l.id,
            l.created_at as sort_date,
            l.payload
        from tt4_legacy l
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
