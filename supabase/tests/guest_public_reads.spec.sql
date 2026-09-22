-- Guest (signed-out) public reads contract, TICKET-247.
-- Run after migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/guest_public_reads.spec.sql
--
-- A guest must see exactly what a signed-in stranger sees on a verified
-- restaurant, and nothing on an unverified (owner-scoped) or tombstoned one.

BEGIN;

INSERT INTO auth.users (
    instance_id, id, aud, role, email, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
)
VALUES
    ('00000000-0000-0000-0000-000000000000', '24700000-0000-4000-8000-00000000000a',
     'authenticated', 'authenticated', 'guest-reads-public@napkin.invalid',
     pg_catalog.now(), pg_catalog.now(), '{"provider":"email","providers":["email"]}',
     '{"display_name":"Public Reviewer"}'),
    ('00000000-0000-0000-0000-000000000000', '24700000-0000-4000-8000-00000000000b',
     'authenticated', 'authenticated', 'guest-reads-private@napkin.invalid',
     pg_catalog.now(), pg_catalog.now(), '{"provider":"email","providers":["email"]}',
     '{"display_name":"Private Reviewer"}')
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    UPDATE public.profiles SET account_privacy = 'public'
    WHERE user_id = '24700000-0000-4000-8000-00000000000a';
    ASSERT FOUND, 'SETUP: handle_new_user must create the public reviewer profile';
    UPDATE public.profiles SET account_privacy = 'private'
    WHERE user_id = '24700000-0000-4000-8000-00000000000b';
    ASSERT FOUND, 'SETUP: handle_new_user must create the private reviewer profile';
END;
$$;

-- R1 verified, R2 unverified (owner-scoped ghost), R3 verified but merged into
-- R1 (tombstone), R4 verified with no reviews.
INSERT INTO public.restaurants (id, name, city, cuisine, verification, created_by)
VALUES
    ('247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Guest Verified Trattoria', 'London', 'Italian', 'verified', NULL),
    ('247bbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Guest Unverified Kitchen', 'London', NULL, 'unverified',
     '24700000-0000-4000-8000-00000000000a'),
    ('247ccccc-cccc-4ccc-8ccc-cccccccccccc', 'Guest Tombstone Diner', 'London', 'Diner', 'verified', NULL),
    ('247ddddd-dddd-4ddd-8ddd-dddddddddddd', 'Guest Quiet Bistro', 'Paris', 'French', 'verified', NULL)
ON CONFLICT (id) DO NOTHING;

UPDATE public.restaurants
SET merged_into = '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
WHERE id = '247ccccc-cccc-4ccc-8ccc-cccccccccccc';

INSERT INTO public.entries (id, user_id, restaurant_id, rating, content, visibility, created_at)
VALUES
    -- eligible: public account, rated, note, friends
    ('24700000-0000-4000-8000-0000000000e1', '24700000-0000-4000-8000-00000000000a',
     '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 4.5, 'The cacio e pepe is worth the queue.', 'friends',
     '2026-09-01T12:00:00Z'),
    -- eligible: table-shared review of a public account (doctrine 2026-07-22)
    ('24700000-0000-4000-8000-0000000000e7', '24700000-0000-4000-8000-00000000000a',
     '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 4, 'Second visit, the ragu held up well.', 'table',
     '2026-09-02T12:00:00Z'),
    -- excluded: explicit private visibility
    ('24700000-0000-4000-8000-0000000000e2', '24700000-0000-4000-8000-00000000000a',
     '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 4, 'A private note about this place.', 'private',
     '2026-09-03T12:00:00Z'),
    -- excluded: private account
    ('24700000-0000-4000-8000-0000000000e3', '24700000-0000-4000-8000-00000000000b',
     '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 5, 'Written by a private account holder.', 'friends',
     '2026-09-04T12:00:00Z'),
    -- excluded: unrated
    ('24700000-0000-4000-8000-0000000000e4', '24700000-0000-4000-8000-00000000000a',
     '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 'An unrated note that is long enough.', 'friends',
     '2026-09-05T12:00:00Z'),
    -- excluded for guests: eligible review on an unverified restaurant
    ('24700000-0000-4000-8000-0000000000e5', '24700000-0000-4000-8000-00000000000a',
     '247bbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 4, 'Dinner at a friend''s flat, lovely.', 'friends',
     '2026-09-06T12:00:00Z'),
    -- excluded for guests: eligible review on a tombstoned restaurant
    ('24700000-0000-4000-8000-0000000000e6', '24700000-0000-4000-8000-00000000000a',
     '247ccccc-cccc-4ccc-8ccc-cccccccccccc', 3.5, 'Before the merge, a decent burger.', 'friends',
     '2026-09-07T12:00:00Z');

DO $$
DECLARE
    v_r1 uuid := '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_r2 uuid := '247bbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    v_r3 uuid := '247ccccc-cccc-4ccc-8ccc-cccccccccccc';
    v_r4 uuid := '247ddddd-dddd-4ddd-8ddd-dddddddddddd';
    v_stranger uuid := '24700000-0000-4000-8000-0000000000ff';
    v_guest uuid[];
    v_signed_in uuid[];
    v_first record;
    v_count integer;
    v_counts jsonb;
    v_recent uuid[];
    fn text;
BEGIN
    -- Grants: only the edge function (service_role) may call these.
    FOREACH fn IN ARRAY ARRAY[
        'public.get_public_reviews_page_guest(uuid,integer,timestamptz,uuid)',
        'public.fn_guest_public_review_counts(uuid[])',
        'public.fn_guest_recent_restaurants(integer)'
    ] LOOP
        ASSERT NOT pg_catalog.has_function_privilege('anon', fn, 'execute'),
            pg_catalog.format('FAIL: anon must not execute %s', fn);
        ASSERT NOT pg_catalog.has_function_privilege('authenticated', fn, 'execute'),
            pg_catalog.format('FAIL: authenticated must not execute %s', fn);
        ASSERT pg_catalog.has_function_privilege('service_role', fn, 'execute'),
            pg_catalog.format('FAIL: service_role must execute %s', fn);
    END LOOP;

    -- Verified restaurant: exactly the two eligible reviews, newest first.
    SELECT pg_catalog.array_agg(entry_id) INTO v_guest
    FROM public.get_public_reviews_page_guest(v_r1, 50, NULL, NULL);
    ASSERT v_guest = ARRAY[
        '24700000-0000-4000-8000-0000000000e7'::uuid,
        '24700000-0000-4000-8000-0000000000e1'::uuid
    ], pg_catalog.format('FAIL: guest reviews on a verified restaurant, got %s', v_guest);

    -- Parity: a guest sees what an unrelated signed-in viewer sees there.
    SELECT pg_catalog.array_agg(entry_id) INTO v_signed_in
    FROM public.get_public_reviews_page(v_r1, v_stranger, 50, NULL, NULL);
    ASSERT v_signed_in = v_guest,
        pg_catalog.format('FAIL: guest %s differs from signed-in stranger %s', v_guest, v_signed_in);

    -- Unverified and tombstoned restaurants: nothing, even with eligible reviews.
    SELECT pg_catalog.count(*) INTO v_count
    FROM public.get_public_reviews_page_guest(v_r2, 50, NULL, NULL);
    ASSERT v_count = 0, 'FAIL: guest reviews leaked from an unverified restaurant';
    SELECT pg_catalog.count(*) INTO v_count
    FROM public.get_public_reviews_page_guest(v_r3, 50, NULL, NULL);
    ASSERT v_count = 0, 'FAIL: guest reviews leaked from a tombstoned restaurant';

    -- Keyset paging walks the same rows one at a time.
    SELECT * INTO v_first FROM public.get_public_reviews_page_guest(v_r1, 1, NULL, NULL);
    ASSERT v_first.entry_id = '24700000-0000-4000-8000-0000000000e7'::uuid,
        'FAIL: first guest page must be the newest eligible review';
    SELECT pg_catalog.array_agg(entry_id) INTO v_guest
    FROM public.get_public_reviews_page_guest(v_r1, 5, v_first.created_at, v_first.entry_id);
    ASSERT v_guest = ARRAY['24700000-0000-4000-8000-0000000000e1'::uuid],
        pg_catalog.format('FAIL: second guest page after the cursor, got %s', v_guest);

    -- Counts: only the verified restaurant, only eligible reviews.
    SELECT pg_catalog.jsonb_object_agg(restaurant_id, review_count) INTO v_counts
    FROM public.fn_guest_public_review_counts(ARRAY[v_r1, v_r2, v_r3, v_r4]);
    ASSERT v_counts = pg_catalog.jsonb_build_object(v_r1::text, 2),
        pg_catalog.format('FAIL: guest review counts, got %s', v_counts);

    -- Recently reviewed: includes the verified restaurant, never the others.
    SELECT pg_catalog.array_agg(restaurant_id) INTO v_recent
    FROM public.fn_guest_recent_restaurants(40);
    ASSERT v_r1 = ANY (v_recent), 'FAIL: recently reviewed must include the verified restaurant';
    ASSERT NOT (v_r2 = ANY (v_recent)), 'FAIL: recently reviewed leaked an unverified restaurant';
    ASSERT NOT (v_r3 = ANY (v_recent)), 'FAIL: recently reviewed leaked a tombstoned restaurant';
    ASSERT NOT (v_r4 = ANY (v_recent)), 'FAIL: recently reviewed listed a restaurant with no reviews';
    SELECT review_count INTO v_count
    FROM public.fn_guest_recent_restaurants(40) WHERE restaurant_id = v_r1;
    ASSERT v_count = 2, pg_catalog.format('FAIL: recent review_count for the verified restaurant, got %s', v_count);

    RAISE NOTICE 'PASS guest_public_reads: grants, verified-only, eligibility parity, paging, counts, recent';
END;
$$;

ROLLBACK;
