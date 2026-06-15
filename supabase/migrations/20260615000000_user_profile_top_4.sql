-- supabase/migrations/20260615000000_user_profile_top_4.sql
--
-- Manually-curated profile Top 4 (global — NOT city-scoped).
--
-- The profile Top 4 is otherwise auto-derived (user-profile fetchTopFour:
-- the user's highest-rated logged restaurants). This table lets a user OVERRIDE
-- that with a hand-picked, ordered set of up to 4 restaurants they've logged.
-- When rows exist for a user, the profile returns them in position order;
-- otherwise it falls back to the auto-derived list.
--
-- Distinct from user_top_4 (TICKET-047), which is per-claimed-city. This is a
-- single global set tied to the profile. Mirrors the same security shape:
-- SELECT-only RLS (self + public-profile), writes via a SECURITY DEFINER RPC.

-- ── Table ────────────────────────────────────────────────────────────────────

create table public.user_profile_top_4 (
    user_id       uuid        not null references auth.users(id) on delete cascade,
    position      smallint    not null check (position between 1 and 4),
    restaurant_id uuid        not null references public.restaurants(id) on delete cascade,
    updated_at    timestamptz not null default now(),
    primary key (user_id, position)
);

-- One restaurant cannot occupy two slots.
alter table public.user_profile_top_4
    add constraint user_profile_top_4_distinct_pick_uq
    unique (user_id, restaurant_id);

create index user_profile_top_4_user_idx on public.user_profile_top_4 (user_id);

-- ── RLS — SELECT only; writes go through the service-role RPC ─────────────────

alter table public.user_profile_top_4 enable row level security;

create policy "profile_top_4 self read"
    on public.user_profile_top_4
    for select
    using (user_id = auth.uid());

create policy "profile_top_4 read public"
    on public.user_profile_top_4
    for select
    using (
        exists (
            select 1
            from public.profiles p
            where p.user_id = user_profile_top_4.user_id
              and p.account_privacy = 'public'
        )
    );

grant select on public.user_profile_top_4 to authenticated;
grant all    on public.user_profile_top_4 to service_role;

-- ── RPC: set_profile_top_four_picks ──────────────────────────────────────────
-- Atomic replace of a user's curated profile Top 4. An empty array CLEARS the
-- override (profile reverts to the auto-derived list). Validates each pick was
-- logged by the user (no city constraint). Mirrors set_user_top_four_picks.

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
    v_rid  uuid;
    v_elem jsonb;
begin
    v_len := coalesce(jsonb_array_length(p_picks), 0);

    if v_len > 4 then
        raise exception using errcode = '22023',
            message = 'picks array must have at most 4 elements';
    end if;

    -- Validate each pick: position 1–4, restaurant logged by this user.
    for v_elem in select * from jsonb_array_elements(coalesce(p_picks, '[]'::jsonb))
    loop
        v_pos := (v_elem->>'position')::smallint;
        v_rid := (v_elem->>'restaurant_id')::uuid;

        if v_pos < 1 or v_pos > 4 then
            raise exception using errcode = '22023',
                message = format('invalid position %s — must be 1..4', v_pos);
        end if;

        if not exists (
            select 1 from entries e
            where e.user_id = p_user_id
              and e.restaurant_id = v_rid
        ) then
            raise exception using errcode = '22023',
                message = format('restaurant %s not logged by user', v_rid);
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

    -- Atomic replace
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
