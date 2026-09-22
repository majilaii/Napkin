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

-- ── Public lists (20260922150000_guest_public_lists) ─────────────────────────
-- R5: verified, but its photo is a member's own ('user'), which a guest must not get.
-- R1 gets a credited Places photo, which a guest may get.
INSERT INTO public.restaurants (id, name, city, cuisine, verification, photo_url, photo_source)
VALUES ('247eeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Guest Member Photo Cafe', 'London', 'Cafe', 'verified',
        'https://example.invalid/entry-photos/member/meal.jpg', 'user')
ON CONFLICT (id) DO NOTHING;
UPDATE public.restaurants
SET photo_url = 'https://example.invalid/restaurant-photos/trattoria.jpg',
    photo_source = 'places',
    places_photo_attribution_html = '<a href="https://maps.example">A. Author</a>'
WHERE id = '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

INSERT INTO public.tables (id, owner_id, name)
VALUES ('247f0000-0000-4000-8000-0000000000f0', '24700000-0000-4000-8000-00000000000a', 'Guest spec Table')
ON CONFLICT (id) DO NOTHING;

-- L1 public ranked (public owner); L2 private; L4 public but private owner;
-- L5 public unranked. L3 is a Table list forced public with the coercion
-- trigger off, to prove the guest read refuses Table lists on its own.
INSERT INTO public.lists (id, owner_id, title, ranked, privacy, table_id, created_at, updated_at)
VALUES
    ('24710000-0000-4000-8000-000000000001', '24700000-0000-4000-8000-00000000000a', 'Guest spec ranked', true,  'public',  NULL,
     '2026-09-01T00:00:00Z', '2026-09-10T00:00:00Z'),
    ('24710000-0000-4000-8000-000000000002', '24700000-0000-4000-8000-00000000000a', 'Guest spec private', false, 'private', NULL,
     '2026-09-01T00:00:00Z', '2026-09-11T00:00:00Z'),
    ('24710000-0000-4000-8000-000000000004', '24700000-0000-4000-8000-00000000000b', 'Guest spec private owner', false, 'public', NULL,
     '2026-09-01T00:00:00Z', '2026-09-12T00:00:00Z'),
    ('24710000-0000-4000-8000-000000000005', '24700000-0000-4000-8000-00000000000a', 'Guest spec unranked', false, 'public', NULL,
     '2026-09-01T00:00:00Z', '2026-09-09T00:00:00Z');
ALTER TABLE public.lists DISABLE TRIGGER lists_force_table_private;
INSERT INTO public.lists (id, owner_id, title, ranked, privacy, table_id, created_at, updated_at)
VALUES ('24710000-0000-4000-8000-000000000003', '24700000-0000-4000-8000-00000000000a', 'Guest spec Table list', false, 'public',
        '247f0000-0000-4000-8000-0000000000f0', '2026-09-01T00:00:00Z', '2026-09-13T00:00:00Z');

-- The trigger stays off until the entries are in: an entry insert can touch its
-- parent list, and that UPDATE would coerce L3 back to private.
INSERT INTO public.list_entries (id, list_id, restaurant_id, note, position, created_at)
VALUES
    -- L1 ranked: R5 (pos 0), R2 unverified (pos 1), R1 (pos 2), R3 tombstone (pos 3)
    ('24720000-0000-4000-8000-000000000015', '24710000-0000-4000-8000-000000000001', '247eeeee-eeee-4eee-8eee-eeeeeeeeeeee', NULL, 0, '2026-09-02T00:00:00Z'),
    ('24720000-0000-4000-8000-000000000012', '24710000-0000-4000-8000-000000000001', '247bbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'a friend''s flat', 1, '2026-09-03T00:00:00Z'),
    ('24720000-0000-4000-8000-000000000011', '24710000-0000-4000-8000-000000000001', '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'order the pici', 2, '2026-09-04T00:00:00Z'),
    ('24720000-0000-4000-8000-000000000013', '24710000-0000-4000-8000-000000000001', '247ccccc-cccc-4ccc-8ccc-cccccccccccc', NULL, 3, '2026-09-05T00:00:00Z'),
    -- L2, L3, L4 each contain R1 so the featured-lists band can be checked.
    ('24720000-0000-4000-8000-000000000021', '24710000-0000-4000-8000-000000000002', '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 0, '2026-09-04T00:00:00Z'),
    ('24720000-0000-4000-8000-000000000031', '24710000-0000-4000-8000-000000000003', '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 0, '2026-09-04T00:00:00Z'),
    ('24720000-0000-4000-8000-000000000041', '24710000-0000-4000-8000-000000000004', '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 0, '2026-09-04T00:00:00Z'),
    -- L5 unranked: newest first means R4 then R1.
    ('24720000-0000-4000-8000-000000000051', '24710000-0000-4000-8000-000000000005', '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL, 0, '2026-09-04T00:00:00Z'),
    ('24720000-0000-4000-8000-000000000054', '24710000-0000-4000-8000-000000000005', '247ddddd-dddd-4ddd-8ddd-dddddddddddd', NULL, 0, '2026-09-06T00:00:00Z');

ALTER TABLE public.lists ENABLE TRIGGER lists_force_table_private;

INSERT INTO public.list_saves (list_id, user_id)
VALUES ('24710000-0000-4000-8000-000000000001', '24700000-0000-4000-8000-00000000000b');

DO $$
DECLARE
    v_r1 uuid := '247aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    v_l1 jsonb;
    v_l5 jsonb;
    v_ids text[];
    v_restaurant_keys text[];
    v_featured uuid[];
BEGIN
    ASSERT NOT pg_catalog.has_function_privilege('anon', 'public.fn_guest_public_list(uuid)', 'execute'),
        'FAIL: anon must not execute fn_guest_public_list';
    ASSERT NOT pg_catalog.has_function_privilege('authenticated', 'public.fn_guest_public_list(uuid)', 'execute'),
        'FAIL: authenticated must not execute fn_guest_public_list';
    ASSERT pg_catalog.has_function_privilege('service_role', 'public.fn_guest_public_list(uuid)', 'execute'),
        'FAIL: service_role must execute fn_guest_public_list';

    ASSERT EXISTS (
        SELECT 1 FROM public.lists
        WHERE id = '24710000-0000-4000-8000-000000000003' AND privacy = 'public' AND table_id IS NOT NULL
    ), 'SETUP: the Table-list fixture must stay public, or it cannot prove the table_id guard';

    -- Only a public, non-Table list of a public account is readable.
    ASSERT public.fn_guest_public_list('24710000-0000-4000-8000-000000000002') IS NULL,
        'FAIL: a private list leaked to a guest';
    ASSERT public.fn_guest_public_list('24710000-0000-4000-8000-000000000003') IS NULL,
        'FAIL: a Table list leaked to a guest';
    ASSERT public.fn_guest_public_list('24710000-0000-4000-8000-000000000004') IS NULL,
        'FAIL: a private account''s public list leaked to a guest';
    ASSERT public.fn_guest_public_list('24710000-0000-4000-8000-0000000000ff') IS NULL,
        'FAIL: a missing list must read as NULL';

    v_l1 := public.fn_guest_public_list('24710000-0000-4000-8000-000000000001');
    ASSERT v_l1 IS NOT NULL, 'FAIL: the public list must be readable';
    ASSERT v_l1->'list'->>'title' = 'Guest spec ranked', 'FAIL: list header';
    ASSERT v_l1->'list'->'table_id' = 'null'::jsonb, 'FAIL: table_id must be JSON null';
    ASSERT v_l1->'owner_profile'->>'account_privacy' = 'public', 'FAIL: owner profile';
    ASSERT (v_l1->>'save_count')::integer = 1,
        pg_catalog.format('FAIL: save_count, got %s', v_l1->>'save_count');

    -- Ranked order, verified and live entries only.
    SELECT pg_catalog.array_agg(e->>'id' ORDER BY ord) INTO v_ids
    FROM pg_catalog.jsonb_array_elements(v_l1->'entries') WITH ORDINALITY AS t(e, ord);
    ASSERT v_ids = ARRAY['24720000-0000-4000-8000-000000000015', '24720000-0000-4000-8000-000000000011'],
        pg_catalog.format('FAIL: ranked guest entries (unverified and tombstoned excluded), got %s', v_ids);

    -- Photos: the member photo is dropped, the credited Places photo survives.
    ASSERT v_l1->'entries'->0->'restaurant'->'photo_url' = 'null'::jsonb,
        'FAIL: a member photo reached a guest through a list';
    ASSERT v_l1->'entries'->1->'restaurant'->>'photo_url' = 'https://example.invalid/restaurant-photos/trattoria.jpg',
        'FAIL: the Places photo must survive';
    ASSERT v_l1->'entries'->1->>'note' = 'order the pici', 'FAIL: entry note';

    -- No owner-only restaurant fields ride along.
    SELECT pg_catalog.array_agg(k ORDER BY k) INTO v_restaurant_keys
    FROM pg_catalog.jsonb_object_keys(v_l1->'entries'->0->'restaurant') AS k;
    ASSERT NOT ('created_by' = ANY (v_restaurant_keys))
        AND NOT ('merged_into' = ANY (v_restaurant_keys))
        AND NOT ('completeness_version' = ANY (v_restaurant_keys)),
        pg_catalog.format('FAIL: owner-only restaurant fields leaked: %s', v_restaurant_keys);

    -- Unranked lists read newest first.
    v_l5 := public.fn_guest_public_list('24710000-0000-4000-8000-000000000005');
    SELECT pg_catalog.array_agg(e->>'id' ORDER BY ord) INTO v_ids
    FROM pg_catalog.jsonb_array_elements(v_l5->'entries') WITH ORDINALITY AS t(e, ord);
    ASSERT v_ids = ARRAY['24720000-0000-4000-8000-000000000054', '24720000-0000-4000-8000-000000000051'],
        pg_catalog.format('FAIL: unranked guest entries must be newest first, got %s', v_ids);

    -- The restaurant-page band with no viewer: only the two readable lists.
    SELECT pg_catalog.array_agg(id ORDER BY id) INTO v_featured
    FROM public.fn_restaurant_featured_lists(NULL, v_r1, 10);
    ASSERT v_featured = ARRAY[
        '24710000-0000-4000-8000-000000000001'::uuid,
        '24710000-0000-4000-8000-000000000005'::uuid
    ], pg_catalog.format('FAIL: guest featured lists, got %s', v_featured);

    RAISE NOTICE 'PASS guest_public_reads lists: grants, public-only gate, Table refusal, verified entries, photos, order, band';
END;
$$;

ROLLBACK;
