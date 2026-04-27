-- supabase/migrations/20260427000000_user_top_fours.sql
--
-- Personal regional Top 4s (TICKET-047)
--
-- Tables:
--   user_claimed_cities    — cities the user has opted into
--   user_top_4             — up to 4 ordered picks per (user, city)
--   user_claim_nudge_dismissals — 30-day snooze for the claim-nudge card
--
-- RPCs (SECURITY DEFINER, search_path locked per ARCH-2):
--   claim_city_with_picks    — atomic first-claim + pick insertion (ARCH-3)
--   set_user_top_four_picks  — atomic pick replacement for update_picks
--   unclaim_city             — delete city + cascade + HOME promotion (ARCH-4)
--   set_user_home_city       — atomic HOME swap with pre-validation (ARCH-5)
--
-- [ARCH-11] If restaurants.city is later edited the pick stays linked by
-- restaurant_id but the city aggregations will diverge. Acceptable for v1 —
-- restaurants.city rarely changes post-canonicalization (TICKET-045 ran once).
-- Do NOT add a trigger. Revisit if city-editing becomes a common op.

-- ── Tables ─────────────────────────────────────────────────────────────────

create table public.user_claimed_cities (
    user_id    uuid        not null references auth.users(id) on delete cascade,
    city       text        not null,
    is_home    boolean     not null default false,
    claimed_at timestamptz not null default now(),
    primary key (user_id, city)
);

-- "exactly one HOME per user" enforced at the DB level.
create unique index user_claimed_cities_one_home_idx
    on public.user_claimed_cities (user_id)
    where is_home;

create table public.user_top_4 (
    user_id       uuid     not null references auth.users(id) on delete cascade,
    city          text     not null,
    position      smallint not null check (position between 1 and 4),
    restaurant_id uuid     not null references public.restaurants(id) on delete cascade,
    updated_at    timestamptz not null default now(),
    primary key (user_id, city, position)
);

-- [ARCH-1] Prevent the same restaurant from occupying multiple slots per (user, city).
alter table public.user_top_4
    add constraint user_top_4_distinct_pick_uq
    unique (user_id, city, restaurant_id);

-- FK on (user_id, city) so unclaiming a city cascades to its picks.
alter table public.user_top_4
    add constraint user_top_4_claimed_city_fk
    foreign key (user_id, city)
    references public.user_claimed_cities (user_id, city)
    on delete cascade;

create index user_top_4_user_idx on public.user_top_4 (user_id);

create table public.user_claim_nudge_dismissals (
    user_id      uuid        not null references auth.users(id) on delete cascade,
    city         text        not null,
    dismissed_at timestamptz not null default now(),
    primary key (user_id, city)
);

-- ── RLS ────────────────────────────────────────────────────────────────────
-- [ARCH-6] SELECT-only policies — writes go through service-role RPCs only.

alter table public.user_claimed_cities           enable row level security;
alter table public.user_top_4                    enable row level security;
alter table public.user_claim_nudge_dismissals   enable row level security;

-- user_claimed_cities: self read + public-profile read
create policy "claimed_cities self read"
    on public.user_claimed_cities
    for select
    using (user_id = auth.uid());

create policy "claimed_cities read public"
    on public.user_claimed_cities
    for select
    using (
        exists (
            select 1
            from public.profiles p
            where p.user_id = user_claimed_cities.user_id
              and p.account_privacy = 'public'
        )
    );

-- user_top_4: self read + public-profile read
create policy "top_4 self read"
    on public.user_top_4
    for select
    using (user_id = auth.uid());

create policy "top_4 read public"
    on public.user_top_4
    for select
    using (
        exists (
            select 1
            from public.profiles p
            where p.user_id = user_top_4.user_id
              and p.account_privacy = 'public'
        )
    );

-- user_claim_nudge_dismissals: self read only ([ARCH-7] no public read)
create policy "nudge_dismissals self read"
    on public.user_claim_nudge_dismissals
    for select
    using (user_id = auth.uid());

-- ── Grants ─────────────────────────────────────────────────────────────────
-- [ARCH-6 + ARCH-7] authenticated gets select only; service_role gets all.

grant select on public.user_claimed_cities          to authenticated;
grant select on public.user_top_4                   to authenticated;
-- [ARCH-7] No grant to authenticated on nudge_dismissals — owner-only, via service role.

grant all on public.user_claimed_cities             to service_role;
grant all on public.user_top_4                      to service_role;
grant all on public.user_claim_nudge_dismissals     to service_role;

-- ── RPC helpers ────────────────────────────────────────────────────────────
-- All functions are SECURITY DEFINER with explicit search_path (ARCH-2).
-- Revoke default execute from public/authenticated before granting to service_role.

-- ── 1. set_user_top_four_picks ─────────────────────────────────────────────
-- Called by update_picks. Validates picks then atomically replaces them.
-- p_picks: jsonb array of { "position": 1-4, "restaurant_id": uuid }
-- [ARCH-9] Enforces same validity checks as claim_city_with_picks (defense in depth).

create or replace function public.set_user_top_four_picks(
    p_user_id     uuid,
    p_city        text,
    p_picks       jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_len     int;
    v_pos     smallint;
    v_rid     uuid;
    v_elem    jsonb;
begin
    -- Basic city checks
    if p_city is null or p_city = '' or p_city = 'Elsewhere' then
        raise exception using errcode = '22023',
            message = 'city must be a non-empty canonical city string, not Elsewhere';
    end if;

    -- Must have 1–4 picks
    v_len := jsonb_array_length(p_picks);
    if v_len = 0 then
        raise exception using errcode = '22023',
            message = 'picks array must not be empty';
    end if;
    if v_len > 4 then
        raise exception using errcode = '22023',
            message = 'picks array must have at most 4 elements';
    end if;

    -- Validate each pick: position 1–4, restaurant logged by user in city
    for v_elem in select * from jsonb_array_elements(p_picks)
    loop
        v_pos := (v_elem->>'position')::smallint;
        v_rid := (v_elem->>'restaurant_id')::uuid;

        if v_pos < 1 or v_pos > 4 then
            raise exception using errcode = '22023',
                message = format('invalid position %s — must be 1..4', v_pos);
        end if;

        -- Must be logged by this user in this canonical city
        if not exists (
            select 1
            from entries e
            join restaurants r on r.id = e.restaurant_id
            where e.user_id   = p_user_id
              and e.restaurant_id = v_rid
              and r.city = p_city
        ) then
            raise exception using errcode = '22023',
                message = format('restaurant %s not logged by user in city %L', v_rid, p_city);
        end if;
    end loop;

    -- Distinct position check
    if (select count(distinct (elem->>'position'))
        from jsonb_array_elements(p_picks) elem) <> v_len then
        raise exception using errcode = '22023',
            message = 'duplicate position values in picks';
    end if;

    -- Distinct restaurant_id check (ARCH-1 defense in depth)
    if (select count(distinct (elem->>'restaurant_id'))
        from jsonb_array_elements(p_picks) elem) <> v_len then
        raise exception using errcode = '22023',
            message = 'duplicate restaurant_id in picks — DUPLICATE_PICK';
    end if;

    -- Atomic replace
    delete from public.user_top_4
    where user_id = p_user_id and city = p_city;

    insert into public.user_top_4 (user_id, city, position, restaurant_id, updated_at)
    select p_user_id,
           p_city,
           (elem->>'position')::smallint,
           (elem->>'restaurant_id')::uuid,
           now()
    from jsonb_array_elements(p_picks) elem;
end $$;

revoke all on function public.set_user_top_four_picks(uuid, text, jsonb) from public, authenticated;
grant execute on function public.set_user_top_four_picks(uuid, text, jsonb) to service_role;

-- ── 2. claim_city_with_picks ───────────────────────────────────────────────
-- Atomic first-claim: inserts user_claimed_cities + picks in one transaction.
-- is_home = true only if this is the user's very first claimed city.
-- [ARCH-3]

create or replace function public.claim_city_with_picks(
    p_user_id     uuid,
    p_city        text,
    p_picks       jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_is_first_claim boolean;
    v_len            int;
    v_pos            smallint;
    v_rid            uuid;
    v_elem           jsonb;
begin
    -- City guard
    if p_city is null or p_city = '' or p_city = 'Elsewhere' then
        raise exception using errcode = '22023',
            message = 'city must be a non-empty canonical city string, not Elsewhere';
    end if;

    -- Must have at least 1 pick
    v_len := jsonb_array_length(p_picks);
    if v_len = 0 then
        raise exception using errcode = '22023',
            message = 'picks array must not be empty';
    end if;
    if v_len > 4 then
        raise exception using errcode = '22023',
            message = 'picks array must have at most 4 elements';
    end if;

    -- Validate each pick
    for v_elem in select * from jsonb_array_elements(p_picks)
    loop
        v_pos := (v_elem->>'position')::smallint;
        v_rid := (v_elem->>'restaurant_id')::uuid;

        if v_pos < 1 or v_pos > 4 then
            raise exception using errcode = '22023',
                message = format('invalid position %s — must be 1..4', v_pos);
        end if;

        if not exists (
            select 1
            from entries e
            join restaurants r on r.id = e.restaurant_id
            where e.user_id   = p_user_id
              and e.restaurant_id = v_rid
              and r.city = p_city
        ) then
            raise exception using errcode = '22023',
                message = format('restaurant %s not logged by user in city %L', v_rid, p_city);
        end if;
    end loop;

    -- Distinct position check
    if (select count(distinct (elem->>'position'))
        from jsonb_array_elements(p_picks) elem) <> v_len then
        raise exception using errcode = '22023',
            message = 'duplicate position values in picks';
    end if;

    -- Distinct restaurant_id check (ARCH-1 defense in depth)
    if (select count(distinct (elem->>'restaurant_id'))
        from jsonb_array_elements(p_picks) elem) <> v_len then
        raise exception using errcode = '22023',
            message = 'duplicate restaurant_id in picks — DUPLICATE_PICK';
    end if;

    -- Is this the user's first ever claim?
    v_is_first_claim := not exists (
        select 1 from public.user_claimed_cities where user_id = p_user_id
    );

    -- Upsert the city row (idempotent if called again — DO NOTHING on conflict)
    insert into public.user_claimed_cities (user_id, city, is_home, claimed_at)
    values (p_user_id, p_city, v_is_first_claim, now())
    on conflict (user_id, city) do nothing;

    -- Atomic pick replacement
    delete from public.user_top_4
    where user_id = p_user_id and city = p_city;

    insert into public.user_top_4 (user_id, city, position, restaurant_id, updated_at)
    select p_user_id,
           p_city,
           (elem->>'position')::smallint,
           (elem->>'restaurant_id')::uuid,
           now()
    from jsonb_array_elements(p_picks) elem;
end $$;

revoke all on function public.claim_city_with_picks(uuid, text, jsonb) from public, authenticated;
grant execute on function public.claim_city_with_picks(uuid, text, jsonb) to service_role;

-- ── 3. unclaim_city ────────────────────────────────────────────────────────
-- Deletes the city row (cascades picks) then promotes next-most-recent city
-- to HOME if the deleted city was HOME. [ARCH-4]

create or replace function public.unclaim_city(
    p_user_id  uuid,
    p_city     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_was_home boolean;
    v_next_city text;
begin
    -- Lock the row before deciding
    select is_home into v_was_home
    from public.user_claimed_cities
    where user_id = p_user_id and city = p_city
    for update;

    -- Nothing to delete if not claimed
    if not found then
        return;
    end if;

    -- Delete (cascades to user_top_4 via FK)
    delete from public.user_claimed_cities
    where user_id = p_user_id and city = p_city;

    -- Promote next most-recent city to HOME if needed
    if v_was_home then
        select city into v_next_city
        from public.user_claimed_cities
        where user_id = p_user_id
        order by claimed_at desc
        limit 1;

        if v_next_city is not null then
            update public.user_claimed_cities
               set is_home = true
             where user_id = p_user_id and city = v_next_city;
        end if;
    end if;
end $$;

revoke all on function public.unclaim_city(uuid, text) from public, authenticated;
grant execute on function public.unclaim_city(uuid, text) to service_role;

-- ── 4. set_user_home_city ──────────────────────────────────────────────────
-- Validates target city is claimed, then atomically swaps HOME.
-- Does NOT touch claimed_at (per spec resolution). [ARCH-5]

create or replace function public.set_user_home_city(
    p_user_id  uuid,
    p_city     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    -- [ARCH-5] Validate before clearing the previous HOME.
    if not exists (
        select 1 from public.user_claimed_cities
        where user_id = p_user_id and city = p_city
    ) then
        raise exception using errcode = '22023',
            message = format('city %L not claimed by user', p_city);
    end if;

    update public.user_claimed_cities
       set is_home = false
     where user_id = p_user_id and is_home = true and city <> p_city;

    update public.user_claimed_cities
       set is_home = true
     where user_id = p_user_id and city = p_city;
end $$;

revoke all on function public.set_user_home_city(uuid, text) from public, authenticated;
grant execute on function public.set_user_home_city(uuid, text) to service_role;
