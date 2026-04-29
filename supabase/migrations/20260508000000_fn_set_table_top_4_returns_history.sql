-- TICKET-FOLLOWUP-A — fn_set_table_top_4 returns inserted history rows
--
-- The notifications producer needs to know exactly which history rows were
-- written by THIS save (not "the most recent N rows in a time window") to
-- avoid:
--   1. No-op saves re-emitting a previous swap by the same actor
--   2. Concurrent saves by different actors racing
--   3. Multi-slot saves only seeing one row (current edge fn used .limit(1))
--
-- Fix: change the RPC return type from `void` to `setof table_top_4_history`
-- and have it RETURN QUERY the rows it just inserted (filtered by save_id,
-- which is unique per call). Empty result = no-op = no notifications.
--
-- All other behavior (advisory lock, membership check, save_id stamping,
-- diff/upsert/delete logic, audit row insertion) is byte-identical to the
-- previous definition in 20260427120000_top4_rpc_lockdown_save_id_advisory.sql.
--
-- Postgres doesn't allow CREATE OR REPLACE to change return type
-- (SQLSTATE 42P13), so we DROP first. Safe: the only caller is the
-- service-role edge fn at supabase/functions/table-management/index.ts,
-- which is being updated in lockstep with this migration.

drop function if exists public.fn_set_table_top_4(uuid, uuid, jsonb);

create function public.fn_set_table_top_4(
    p_table_id uuid,
    p_actor_id uuid,
    p_slots jsonb  -- [{position: int, restaurant_id: uuid|null}, ...]
) returns setof public.table_top_4_history
language plpgsql security definer as $$
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
    -- fn_table_activity_page to collapse N slots → 1 feed card AND used
    -- below to RETURN only the rows written by THIS call.
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

    -- Return ONLY the rows just written by this save. The notifications
    -- producer iterates these and emits one top_four_swap per row.
    -- No-op saves return empty (no rows match v_save_id).
    return query
    select *
    from public.table_top_4_history
    where save_id = v_save_id
    order by position asc;
end;
$$;

-- Re-grant execute. DROP+CREATE makes this a fresh function, so prior
-- REVOKE/GRANTs from earlier migrations need to be re-applied. Lock down
-- to service_role only (matches 20260427140000 hardening).
revoke execute on function public.fn_set_table_top_4(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_set_table_top_4(uuid, uuid, jsonb) to service_role;

comment on function public.fn_set_table_top_4(uuid, uuid, jsonb) is
    'Atomically diffs + applies a Top 4 save and returns the inserted history rows.
     Service-role only. No-op saves return empty.
     Notifications producer iterates the returned rows to fan out top_four_swap.';
