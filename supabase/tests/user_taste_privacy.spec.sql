-- Public Taste aggregate privacy contract.
-- Run after migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/user_taste_privacy.spec.sql

BEGIN;

INSERT INTO auth.users (
    instance_id, id, aud, role, email, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
)
VALUES (
    '00000000-0000-0000-0000-000000000000',
    '77770000-0000-4000-8000-000000000000',
    'authenticated',
    'authenticated',
    'taste-privacy-test@napkin.invalid',
    pg_catalog.now(),
    pg_catalog.now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Taste Privacy Tester"}'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurants (id, name, city, cuisine)
VALUES
    ('7777aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Visible Ramen One', 'London', 'Ramen'),
    ('7777bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Visible Ramen Two', 'London', 'Ramen'),
    ('7777cccc-cccc-4ccc-8ccc-cccccccccccc', 'Private French', 'Paris', 'French'),
    ('7777dddd-dddd-4ddd-8ddd-dddddddddddd', 'Unset Thai', 'Bangkok', 'Thai')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.entries (
    user_id, restaurant_id, rating, flavor_rating, service_rating,
    value_rating, vibe_rating, visibility
)
VALUES
    ('77770000-0000-4000-8000-000000000000', '7777aaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 4,   4,   4,   4,   4,   'friends'),
    ('77770000-0000-4000-8000-000000000000', '7777bbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2,   2,   2,   2,   2,   'table'),
    ('77770000-0000-4000-8000-000000000000', '7777cccc-cccc-4ccc-8ccc-cccccccccccc', 5,   5,   5,   5,   5,   'private'),
    ('77770000-0000-4000-8000-000000000000', '7777dddd-dddd-4ddd-8ddd-dddddddddddd', 0.5, 0.5, 0.5, 0.5, 0.5, NULL);

DO $$
DECLARE
    v_user uuid := '77770000-0000-4000-8000-000000000000';
    v_public record;
    v_owner record;
    v_legacy record;
BEGIN
    ASSERT NOT pg_catalog.has_function_privilege(
        'authenticated', 'public.fn_user_taste(uuid,boolean)', 'execute'
    ), 'FAIL: authenticated must not execute the scoped Taste RPC directly';
    ASSERT pg_catalog.has_function_privilege(
        'service_role', 'public.fn_user_taste(uuid,boolean)', 'execute'
    ), 'FAIL: service_role must execute the scoped Taste RPC';

    SELECT * INTO v_public
    FROM public.fn_user_taste(v_user, false);

    ASSERT v_public.entry_count = 2,
        pg_catalog.format(
            'FAIL: public Taste must count only two non-private/non-NULL entries, got %s',
            v_public.entry_count
        );
    ASSERT v_public.overall_avg = 3,
        pg_catalog.format('FAIL: public overall average expected 3, got %s', v_public.overall_avg);
    ASSERT v_public.flavor_avg = 3 AND v_public.flavor_n = 2,
        'FAIL: secondary averages must use the same public visibility scope';
    ASSERT v_public.rating_histogram = '[{"r":2,"n":1},{"r":4,"n":1}]'::jsonb,
        pg_catalog.format(
            'FAIL: public histogram leaked a private/NULL-visibility rating: %s',
            v_public.rating_histogram
        );
    ASSERT pg_catalog.jsonb_array_length(v_public.top_cuisines) = 1
        AND v_public.top_cuisines->0->>'cuisine' = 'Ramen'
        AND (v_public.top_cuisines->0->>'n')::integer = 2,
        pg_catalog.format('FAIL: public cuisine aggregate is wrong: %s', v_public.top_cuisines);

    SELECT * INTO v_owner
    FROM public.fn_user_taste(v_user, true);

    ASSERT v_owner.entry_count = 4,
        pg_catalog.format('FAIL: owner Taste must include all four entries, got %s', v_owner.entry_count);
    ASSERT v_owner.overall_avg = 2.875,
        pg_catalog.format('FAIL: owner overall average expected 2.875, got %s', v_owner.overall_avg);
    ASSERT v_owner.flavor_n = 4,
        'FAIL: owner secondary aggregates must include private and NULL-visibility entries';
    ASSERT v_owner.rating_histogram =
        '[{"r":0.5,"n":1},{"r":2,"n":1},{"r":4,"n":1},{"r":5,"n":1}]'::jsonb,
        pg_catalog.format('FAIL: owner histogram did not include every rating: %s', v_owner.rating_histogram);

    -- Migration-before-Edge rollout compatibility: the original overload stays
    -- callable and retains its owner-only/all-entry behavior.
    SELECT * INTO v_legacy
    FROM public.fn_user_taste(v_user);
    ASSERT v_legacy.entry_count = 4 AND v_legacy.overall_avg = 2.875,
        'FAIL: legacy fn_user_taste(uuid) behavior changed during rollout';

    RAISE NOTICE 'PASS user_taste_privacy: public scope, owner scope, grants, rollout compatibility';
END;
$$;

ROLLBACK;
