-- supabase/migrations/20260617000200_profile_top_four_allow_unlogged.sql
--
-- Profile Top 4 may now feature ANY restaurant, logged or not.
--
-- The original RPC (20260615000000) rejected a pick unless the user had logged
-- that restaurant. Product decision 2026-06-17: the Top 4 picker is a real
-- Google Places search, and a user may feature a place they haven't eaten at
-- yet (the tile simply shows name + city until a log adds rating/heart/review).
-- We drop the "logged by user" check. The FK on user_profile_top_4.restaurant_id
-- → restaurants(id) still guarantees the id is a real persisted restaurant
-- (the client upserts a ghost via places-search before featuring it), and the
-- ≤4 / distinct-position / distinct-restaurant guards are retained.
--
-- Pure function body replace. No table/column/RLS change → no PostgREST embed,
-- no edge-contract, no hook/queryKey impact. Signature unchanged.

create or replace function public.set_profile_top_four_picks(
    p_user_id uuid,
    p_picks   jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_len  int;
    v_pos  smallint;
    v_elem jsonb;
begin
    v_len := coalesce(jsonb_array_length(p_picks), 0);

    if v_len > 4 then
        raise exception using errcode = '22023',
            message = 'picks array must have at most 4 elements';
    end if;

    -- Validate each pick's position only — restaurant need NOT be logged.
    for v_elem in select * from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb))
    loop
        v_pos := (v_elem->>'position')::smallint;
        if v_pos < 1 or v_pos > 4 then
            raise exception using errcode = '22023',
                message = format('invalid position %s — must be 1..4', v_pos);
        end if;
    end loop;

    -- Distinct positions
    if (select count(distinct (elem->>'position'))
        from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) elem) <> v_len then
        raise exception using errcode = '22023',
            message = 'duplicate position values in picks';
    end if;

    -- Distinct restaurant_ids (defense in depth for the unique constraint)
    if (select count(distinct (elem->>'restaurant_id'))
        from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb)) elem) <> v_len then
        raise exception using errcode = '22023',
            message = 'duplicate restaurant_id in picks — DUPLICATE_PICK';
    end if;

    -- Atomic replace (FK on restaurant_id enforces the row exists)
    delete from public.user_profile_top_4 where user_id = p_user_id;

    if v_len > 0 then
        insert into public.user_profile_top_4 (user_id, position, restaurant_id, updated_at)
        select p_user_id,
               (elem->>'position')::smallint,
               (elem->>'restaurant_id')::uuid,
               now()
        from jsonb_array_elements(p_picks) elem;
    end if;
end $$;

revoke all on function public.set_profile_top_four_picks(uuid, jsonb) from public, authenticated;
grant execute on function public.set_profile_top_four_picks(uuid, jsonb) to service_role;
