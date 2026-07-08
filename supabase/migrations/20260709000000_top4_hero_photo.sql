-- TICKET-144 part 2 — chosen-memory Top 4 heroes.
-- Per-slot, opt-in hero photo on the profile Top 4. The photo is ALWAYS the
-- owner's OWN entry photo at that restaurant; choosing it IS the publish action
-- (the hero is servable on a public profile regardless of the source entry's
-- visibility — see user-profile read hydration). Nothing else from the entry
-- leaks. Removing the photo un-publishes it (nulls the column).
--
-- Replay-safe: additive column (IF NOT EXISTS) + a pure `create or replace`
-- function-body swap. The FK targets entry_photos, created far earlier
-- (20260417…), so a from-zero replay never hits a backdated reference. No
-- renames, single-level dollar-quoting.

-- 1. Per-slot chosen-memory photo (nullable; SET NULL on photo delete → the
--    slot cleanly falls back to the typographic plate, no dangling URL).
alter table public.user_profile_top_4
    add column if not exists hero_entry_photo_id uuid
        references public.entry_photos(id) on delete set null;

-- 2. RPC: accept + validate per-pick hero_entry_photo_id. Signature UNCHANGED
--    (uuid, jsonb) — the photo id rides inside each picks element.
--
--    Stale-vs-violation split (TICKET-144 review P2; edited in place — this
--    migration is unapplied anywhere, CI applies it on merge):
--      • photo row MISSING (deleted — the FK already SET NULLed the stored
--        hero) → coerce THAT slot's hero to NULL. A stale client cache
--        re-sending a dangling id must not fail the whole save.
--      • photo row EXISTS but belongs to another user / another restaurant →
--        hard reject (PHOTO_NOT_OWNED). Never coerce a genuine violation —
--        that would soften the consent gate.
create or replace function public.set_profile_top_four_picks(
    p_user_id uuid, p_picks jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
    v_len int; v_pos smallint; v_rid uuid; v_photo uuid; v_elem jsonb;
    -- Sanitized picks: same rows, stale (deleted-photo) heroes coerced to NULL.
    v_clean jsonb := '[]'::jsonb;
begin
    v_len := coalesce(jsonb_array_length(p_picks), 0);
    if v_len > 4 then
        raise exception using errcode='22023', message='picks array must have at most 4 elements';
    end if;

    for v_elem in select * from jsonb_array_elements(coalesce(p_picks,'[]'::jsonb)) loop
        v_pos   := (v_elem->>'position')::smallint;
        v_rid   := (v_elem->>'restaurant_id')::uuid;
        v_photo := nullif(v_elem->>'hero_entry_photo_id','')::uuid;
        if v_pos < 1 or v_pos > 4 then
            raise exception using errcode='22023', message=format('invalid position %s — must be 1..4', v_pos);
        end if;
        if v_photo is not null then
            if not exists (select 1 from public.entry_photos ep where ep.id = v_photo) then
                -- STALE, not a violation: the photo row is gone. Self-heal the slot.
                v_photo := null;
            elsif not exists (
                -- CONSENT BOUNDARY: a hero photo must be the user's OWN, at THIS restaurant.
                select 1 from public.entry_photos ep
                join public.entries e on e.id = ep.entry_id
                where ep.id = v_photo and e.user_id = p_user_id and e.restaurant_id = v_rid
            ) then
                raise exception using errcode='22023',
                    message='hero_entry_photo_id not owned by user at this restaurant — PHOTO_NOT_OWNED';
            end if;
        end if;
        v_clean := v_clean || jsonb_build_object(
            'position', v_pos,
            'restaurant_id', v_rid,
            'hero_entry_photo_id', v_photo
        );
    end loop;

    -- distinct positions
    if (select count(distinct (elem->>'position')) from jsonb_array_elements(coalesce(p_picks,'[]'::jsonb)) elem) <> v_len then
        raise exception using errcode='22023', message='duplicate position values in picks';
    end if;
    -- distinct restaurants
    if (select count(distinct (elem->>'restaurant_id')) from jsonb_array_elements(coalesce(p_picks,'[]'::jsonb)) elem) <> v_len then
        raise exception using errcode='22023', message='duplicate restaurant_id in picks — DUPLICATE_PICK';
    end if;

    delete from public.user_profile_top_4 where user_id = p_user_id;
    if v_len > 0 then
        -- Insert from the SANITIZED array (stale heroes already nulled above).
        insert into public.user_profile_top_4 (user_id, position, restaurant_id, hero_entry_photo_id, updated_at)
        select p_user_id,
               (elem->>'position')::smallint,
               (elem->>'restaurant_id')::uuid,
               nullif(elem->>'hero_entry_photo_id','')::uuid,
               now()
        from jsonb_array_elements(v_clean) elem;
    end if;
end $$;

revoke all on function public.set_profile_top_four_picks(uuid, jsonb) from public, authenticated;
grant execute on function public.set_profile_top_four_picks(uuid, jsonb) to service_role;
