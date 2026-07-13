-- Profile Quick takes: atomic replace, invariants, and privilege posture.
-- Run after migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/profile_quick_takes.spec.sql

begin;

insert into auth.users (
    instance_id, id, aud, role, email, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
)
values (
    '00000000-0000-0000-0000-000000000000',
    '66660000-0000-4000-8000-000000000000',
    'authenticated',
    'authenticated',
    'profile-takes-test@napkin.invalid',
    pg_catalog.now(),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Takes Tester"}'
)
on conflict (id) do nothing;

insert into public.restaurants (id, name, city)
values
    ('6666aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'One', 'London'),
    ('6666bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Two', 'London')
on conflict (id) do nothing;

do $$
declare
    v_user uuid := '66660000-0000-4000-8000-000000000000';
    v_one  uuid := '6666aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_count integer;
    v_failed boolean;
begin
    assert (
        select c.relrowsecurity
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'user_profile_takes'
    ), 'FAIL: user_profile_takes must have RLS enabled';

    assert not pg_catalog.has_table_privilege('anon', 'public.user_profile_takes', 'select'),
        'FAIL: anon must not have direct table SELECT';
    assert not pg_catalog.has_table_privilege('authenticated', 'public.user_profile_takes', 'select'),
        'FAIL: authenticated must not have direct table SELECT';
    assert pg_catalog.has_table_privilege('service_role', 'public.user_profile_takes', 'select'),
        'FAIL: service_role requires explicit SELECT for Edge hydration';
    assert not pg_catalog.has_table_privilege('service_role', 'public.user_profile_takes', 'insert,update,delete'),
        'FAIL: service_role writes must be forced through the atomic RPC';
    assert not pg_catalog.has_function_privilege(
        'authenticated',
        'public.set_user_profile_takes(uuid,jsonb)',
        'execute'
    ), 'FAIL: authenticated must not execute replacement RPC';
    assert pg_catalog.has_function_privilege(
        'service_role',
        'public.set_user_profile_takes(uuid,jsonb)',
        'execute'
    ), 'FAIL: service_role must execute replacement RPC';

    perform public.set_user_profile_takes(v_user, pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
            'prompt_key', 'best_value', 'position', 1,
            'restaurant_id', v_one, 'note', 'Lunch set.'
        ),
        pg_catalog.jsonb_build_object(
            'prompt_key', 'best_curry', 'position', 2,
            'restaurant_id', v_one
        )
    ));

    select pg_catalog.count(*) into v_count
    from public.user_profile_takes t where t.user_id = v_user;
    assert v_count = 2, 'FAIL: atomic replacement did not store two rows';
    assert (
        select pg_catalog.count(distinct t.restaurant_id) = 1
        from public.user_profile_takes t where t.user_id = v_user
    ), 'FAIL: one restaurant must be allowed across multiple prompts';

    -- An invalid replacement must not delete the prior valid set.
    v_failed := false;
    begin
        perform public.set_user_profile_takes(v_user, pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'prompt_key', 'not_a_real_prompt', 'position', 1,
                'restaurant_id', v_one
            )
        ));
    exception when sqlstate '22023' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: invalid prompt was accepted';

    select pg_catalog.count(*) into v_count
    from public.user_profile_takes t where t.user_id = v_user;
    assert v_count = 2, 'FAIL: invalid replacement mutated the prior set';

    -- The RPC must reject a duplicate position before touching the old set.
    v_failed := false;
    begin
        perform public.set_user_profile_takes(v_user, pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'prompt_key', 'best_value', 'position', 1,
                'restaurant_id', v_one
            ),
            pg_catalog.jsonb_build_object(
                'prompt_key', 'best_curry', 'position', 1,
                'restaurant_id', v_one
            )
        ));
    exception when sqlstate '22023' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: duplicate position was accepted';

    -- The RPC must reject a duplicate prompt before touching the old set.
    v_failed := false;
    begin
        perform public.set_user_profile_takes(v_user, pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'prompt_key', 'best_value', 'position', 1,
                'restaurant_id', v_one
            ),
            pg_catalog.jsonb_build_object(
                'prompt_key', 'best_value', 'position', 2,
                'restaurant_id', v_one
            )
        ));
    exception when sqlstate '22023' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: duplicate prompt was accepted';

    -- PostgreSQL char_length counts Unicode code points, matching the Edge cap.
    v_failed := false;
    begin
        perform public.set_user_profile_takes(v_user, pg_catalog.jsonb_build_array(
            pg_catalog.jsonb_build_object(
                'prompt_key', 'best_value', 'position', 1,
                'restaurant_id', v_one,
                'note', pg_catalog.repeat('🍜', 141)
            )
        ));
    exception when sqlstate '22023' then
        v_failed := true;
    end;
    assert v_failed, 'FAIL: note longer than 140 code points was accepted';

    select pg_catalog.count(*) into v_count
    from public.user_profile_takes t where t.user_id = v_user;
    assert v_count = 2, 'FAIL: rejected replacements mutated the prior set';

    perform public.set_user_profile_takes(v_user, '[]'::jsonb);
    assert not exists (
        select 1 from public.user_profile_takes t where t.user_id = v_user
    ), 'FAIL: empty replacement must clear Quick takes';

    raise notice 'PASS profile_quick_takes: grants, reuse, atomic validation, clear';
end;
$$;

rollback;
