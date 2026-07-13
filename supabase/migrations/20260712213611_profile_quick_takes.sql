-- Profile Quick takes — prompt-led, ordered restaurant opinions.
--
-- This is deliberately separate from user_profile_top_4. Top 4 has ranking
-- and automatic-fallback semantics; Quick takes are explicit answers to a
-- stable prompt bank. A user may publish up to six answers, and the same
-- restaurant may answer more than one prompt.

-- ── Table ────────────────────────────────────────────────────────────────────

create table public.user_profile_takes (
    user_id       uuid        not null references auth.users(id) on delete cascade,
    prompt_key    text        not null,
    position      smallint    not null check (position between 1 and 6),
    restaurant_id uuid        not null references public.restaurants(id) on delete cascade,
    note          text        null check (note is null or pg_catalog.char_length(note) between 1 and 140),
    created_at    timestamptz not null default pg_catalog.now(),
    updated_at    timestamptz not null default pg_catalog.now(),

    primary key (user_id, prompt_key),
    constraint user_profile_takes_position_uq unique (user_id, position),
    constraint user_profile_takes_prompt_key_check check (
        prompt_key in (
            'best_value',
            'best_pub',
            'best_curry',
            'worth_the_hype',
            'dont_get_the_hype',
            'visitors',
            'date_night',
            'late_night',
            'worth_crossing_town',
            'forever_order'
        )
    )
);

comment on table public.user_profile_takes is
    'Up to six ordered, prompt-led restaurant opinions published on a user profile. '
    'Separate from ranked/auto-derived Top 4; restaurant reuse across prompts is allowed.';
comment on column public.user_profile_takes.note is
    'Optional public profile note, capped at 140 Unicode code points.';

create index user_profile_takes_restaurant_idx
    on public.user_profile_takes (restaurant_id);

-- ── Data API grants + RLS ────────────────────────────────────────────────────
--
-- Supabase stopped auto-exposing new public-schema tables in new projects in
-- 2026. Keep grants explicit and least-privilege. The Edge Functions read via
-- service_role; anon/authenticated get no table grant. RLS remains enabled as
-- defense in depth if a client grant is deliberately added later.

alter table public.user_profile_takes enable row level security;

create policy "profile takes self read"
    on public.user_profile_takes
    for select
    to authenticated
    using ((select auth.uid()) = user_id);

create policy "profile takes public read"
    on public.user_profile_takes
    for select
    to authenticated
    using (
        exists (
            select 1
            from public.profiles p
            where p.user_id = user_profile_takes.user_id
              and p.account_privacy = 'public'
        )
        and not public.fn_block_between_viewer(user_profile_takes.user_id)
    );

revoke all on table public.user_profile_takes from public, anon, authenticated, service_role;
grant select on table public.user_profile_takes to service_role;

-- ── Atomic service-role write path ───────────────────────────────────────────

create or replace function public.set_user_profile_takes(
    p_user_id uuid,
    p_takes   jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_len      integer;
    v_elem     jsonb;
    v_prompt   text;
    v_position smallint;
    v_rest     uuid;
    v_note     text;
begin
    if p_user_id is null then
        raise exception using errcode = '22023', message = 'user_id is required';
    end if;
    if not exists (select 1 from auth.users u where u.id = p_user_id) then
        raise exception using errcode = '22023', message = 'user does not exist';
    end if;

    -- Serialize concurrent full-set replacements for this one user. Without the
    -- lock, two valid delete+insert calls can interleave and hit the unique
    -- constraints (or leave the later caller with an unexpected mixed result).
    perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(p_user_id::text, 0)
    );

    if p_takes is null or pg_catalog.jsonb_typeof(p_takes) <> 'array' then
        raise exception using errcode = '22023', message = 'takes must be an array';
    end if;

    v_len := pg_catalog.jsonb_array_length(p_takes);
    if v_len > 6 then
        raise exception using errcode = '22023', message = 'takes array must have at most 6 elements';
    end if;

    for v_elem in select value from pg_catalog.jsonb_array_elements(p_takes)
    loop
        if pg_catalog.jsonb_typeof(v_elem) <> 'object' then
            raise exception using errcode = '22023', message = 'each take must be an object';
        end if;

        v_prompt := v_elem->>'prompt_key';
        if v_prompt is null or v_prompt not in (
            'best_value',
            'best_pub',
            'best_curry',
            'worth_the_hype',
            'dont_get_the_hype',
            'visitors',
            'date_night',
            'late_night',
            'worth_crossing_town',
            'forever_order'
        ) then
            raise exception using errcode = '22023',
                message = pg_catalog.format(
                    'invalid profile take prompt_key: %s',
                    coalesce(v_prompt, '<null>')
                );
        end if;

        begin
            v_position := (v_elem->>'position')::smallint;
        exception when invalid_text_representation or numeric_value_out_of_range then
            raise exception using errcode = '22023', message = 'take position must be an integer';
        end;
        if v_position is null or v_position < 1 or v_position > v_len then
            raise exception using errcode = '22023',
                message = pg_catalog.format(
                    'invalid take position %s - positions must be contiguous 1..%s',
                    v_position,
                    v_len
                );
        end if;

        begin
            v_rest := (v_elem->>'restaurant_id')::uuid;
        exception when invalid_text_representation then
            raise exception using errcode = '22023', message = 'take restaurant_id must be a UUID';
        end;
        if v_rest is null or not exists (
            select 1 from public.restaurants r where r.id = v_rest
        ) then
            raise exception using errcode = '22023',
                message = pg_catalog.format(
                    'take restaurant does not exist: %s',
                    coalesce(v_elem->>'restaurant_id', '<null>')
                );
        end if;

        if v_elem ? 'note'
           and v_elem->'note' <> 'null'::jsonb
           and pg_catalog.jsonb_typeof(v_elem->'note') <> 'string' then
            raise exception using errcode = '22023', message = 'take note must be a string or null';
        end if;
        v_note := nullif(pg_catalog.btrim(v_elem->>'note'), '');
        if v_note is not null and pg_catalog.char_length(v_note) > 140 then
            raise exception using errcode = '22023', message = 'take note must be at most 140 characters';
        end if;
    end loop;

    if (
        select count(distinct elem->>'prompt_key')
        from pg_catalog.jsonb_array_elements(p_takes) elem
    ) <> v_len then
        raise exception using errcode = '22023', message = 'duplicate prompt_key in takes';
    end if;

    if (
        select count(distinct elem->>'position')
        from pg_catalog.jsonb_array_elements(p_takes) elem
    ) <> v_len then
        raise exception using errcode = '22023', message = 'duplicate position in takes';
    end if;

    -- One transaction: validation completes before the old set is touched.
    delete from public.user_profile_takes where user_id = p_user_id;

    if v_len > 0 then
        insert into public.user_profile_takes (
            user_id,
            prompt_key,
            position,
            restaurant_id,
            note,
            created_at,
            updated_at
        )
        select
            p_user_id,
            elem->>'prompt_key',
            (elem->>'position')::smallint,
            (elem->>'restaurant_id')::uuid,
            nullif(pg_catalog.btrim(elem->>'note'), ''),
            pg_catalog.now(),
            pg_catalog.now()
        from pg_catalog.jsonb_array_elements(p_takes) elem;
    end if;
end;
$$;

comment on function public.set_user_profile_takes(uuid, jsonb) is
    'Atomically validates and replaces one user''s public profile Quick takes. '
    'Service-role only; the service role has no direct table-write grant.';

revoke all on function public.set_user_profile_takes(uuid, jsonb)
    from public, anon, authenticated;
grant execute on function public.set_user_profile_takes(uuid, jsonb)
    to service_role;
