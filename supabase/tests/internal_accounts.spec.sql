-- Internal (smoke / test) accounts stay off public surfaces, TICKET-251.
-- Run after migrations:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/internal_accounts.spec.sql
--
-- profiles.is_internal marks the CI smoke accounts. Their reviews are never
-- publicly eligible (self reads are untouched), their saves are visible only
-- to internal viewers and to themselves, and lists they own never surface.
-- A non-internal author and saver sit beside them so every read is proven to
-- still work for real content.
--
-- Fixture ids use the 251 prefix and never collide with other specs.
--   users        25100000-0000-4000-8000-00000000000N
--   restaurants  251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaN
--   entries      25130000-0000-4000-8000-00000000000N
--   lists        25110000-0000-4000-8000-00000000000N
--   list entries 25120000-0000-4000-8000-00000000000N

BEGIN;

-- 1. auth.users first (FK chains; handle_new_user seeds a profiles row).
INSERT INTO auth.users (
    instance_id, id, aud, role, email, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
)
SELECT
    '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
    u.email, now(), now(), '{"provider":"email","providers":["email"]}',
    jsonb_build_object('display_name', u.dn)
FROM (VALUES
    ('25100000-0000-4000-8000-000000000001'::uuid, 'int-author@internal-test.invalid', 'Internal Author'),
    ('25100000-0000-4000-8000-000000000002'::uuid, 'pub-author@internal-test.invalid', 'Public Author'),
    ('25100000-0000-4000-8000-000000000003'::uuid, 'viewer@internal-test.invalid',     'Real Viewer'),
    ('25100000-0000-4000-8000-000000000004'::uuid, 'int-viewer@internal-test.invalid', 'Internal Viewer'),
    ('25100000-0000-4000-8000-000000000005'::uuid, 'int-saver@internal-test.invalid',  'Internal Saver'),
    ('25100000-0000-4000-8000-000000000006'::uuid, 'pub-saver@internal-test.invalid',  'Public Saver')
) AS u(id, email, dn)
ON CONFLICT (id) DO NOTHING;

-- The column defaults to false for every new profile.
DO $spec$
BEGIN
    ASSERT (
        SELECT count(*) = 6 AND bool_and(NOT is_internal)
        FROM public.profiles
        WHERE user_id::text LIKE '25100000-0000-4000-8000-%'
    ), 'SETUP: handle_new_user must create six profiles with is_internal = false';
END;
$spec$;

-- 2. Profiles: everyone public; the internal ones flagged.
INSERT INTO public.profiles (user_id, display_name, account_privacy, username, is_internal)
VALUES
    ('25100000-0000-4000-8000-000000000001', 'Internal Author',  'public', 'int_author_251', true),
    ('25100000-0000-4000-8000-000000000002', 'Public Author',    'public', 'pub_author_251', false),
    ('25100000-0000-4000-8000-000000000003', 'Real Viewer',      'public', 'viewer_251',     false),
    ('25100000-0000-4000-8000-000000000004', 'Internal Viewer',  'public', 'int_viewer_251', true),
    ('25100000-0000-4000-8000-000000000005', 'Internal Saver',   'public', 'int_saver_251',  true),
    ('25100000-0000-4000-8000-000000000006', 'Public Saver',     'public', 'pub_saver_251',  false)
ON CONFLICT (user_id) DO UPDATE SET
    display_name    = EXCLUDED.display_name,
    account_privacy = EXCLUDED.account_privacy,
    username        = EXCLUDED.username,
    is_internal     = EXCLUDED.is_internal;

-- 3. Restaurants: R1 carries one internal and one public review, R2 only an
--    internal one. Both verified with coordinates (map pins need them).
INSERT INTO public.restaurants (id, name, city, cuisine, verification, lat, lng)
VALUES
    ('251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Internal Spec Trattoria', 'London', 'Italian', 'verified', 51.5, -0.1),
    ('251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Internal Only Bistro',    'London', 'French',  'verified', 51.6, -0.2)
ON CONFLICT (id) DO NOTHING;

-- 4. Entries: all rated, noted, non-private, inside the 30 day people window.
INSERT INTO public.entries (id, user_id, restaurant_id, rating, content, visibility, created_at)
VALUES
    ('25130000-0000-4000-8000-000000000001', '25100000-0000-4000-8000-000000000001',
     '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 4.5, 'Smoke fixture style note by an internal account.', 'friends',
     now() - interval '1 day'),
    ('25130000-0000-4000-8000-000000000002', '25100000-0000-4000-8000-000000000002',
     '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 4.0, 'A real review by a real public account.', 'friends',
     now() - interval '2 days'),
    ('25130000-0000-4000-8000-000000000003', '25100000-0000-4000-8000-000000000001',
     '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 3.5, 'Another internal note, the only review here.', 'friends',
     now() - interval '1 day');

-- 5. The real viewer follows both authors.
INSERT INTO public.follows (follower_id, following_id) VALUES
    ('25100000-0000-4000-8000-000000000003', '25100000-0000-4000-8000-000000000001'),
    ('25100000-0000-4000-8000-000000000003', '25100000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

-- 6. Saves at R1: the internal saver's clip is the most recent.
INSERT INTO public.wishlist_items (user_id, restaurant_id, source, created_at) VALUES
    ('25100000-0000-4000-8000-000000000005', '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@napkinsmoke/video/251","author_handle":"napkinsmoke"}'::jsonb,
     now() - interval '1 day'),
    ('25100000-0000-4000-8000-000000000006', '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@realcreator/video/252","author_handle":"realcreator"}'::jsonb,
     now() - interval '2 days')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- 7. Public lists containing R1, one per author; the real viewer saved both.
INSERT INTO public.lists (id, owner_id, title, ranked, privacy, table_id, created_at, updated_at)
VALUES
    ('25110000-0000-4000-8000-000000000001', '25100000-0000-4000-8000-000000000001', 'Internal spec list', false, 'public', NULL,
     now() - interval '3 days', now() - interval '1 day'),
    ('25110000-0000-4000-8000-000000000002', '25100000-0000-4000-8000-000000000002', 'Public spec list',   false, 'public', NULL,
     now() - interval '3 days', now() - interval '2 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.list_entries (id, list_id, restaurant_id, note, position, created_at)
VALUES
    ('25120000-0000-4000-8000-000000000001', '25110000-0000-4000-8000-000000000001', '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', NULL, 0, now() - interval '2 days'),
    ('25120000-0000-4000-8000-000000000002', '25110000-0000-4000-8000-000000000002', '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', NULL, 0, now() - interval '2 days');

INSERT INTO public.list_saves (list_id, user_id) VALUES
    ('25110000-0000-4000-8000-000000000001', '25100000-0000-4000-8000-000000000003'),
    ('25110000-0000-4000-8000-000000000002', '25100000-0000-4000-8000-000000000003')
ON CONFLICT DO NOTHING;

-- ── Entries: an internal author's review is never publicly eligible ─────────
DO $spec$
DECLARE
    v_int_author uuid := '25100000-0000-4000-8000-000000000001';
    v_pub_author uuid := '25100000-0000-4000-8000-000000000002';
    v_viewer     uuid := '25100000-0000-4000-8000-000000000003';
    v_int_viewer uuid := '25100000-0000-4000-8000-000000000004';
    v_r1 uuid := '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    v_r2 uuid := '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    v_e_int  uuid := '25130000-0000-4000-8000-000000000001';
    v_e_pub  uuid := '25130000-0000-4000-8000-000000000002';
    v_e_int2 uuid := '25130000-0000-4000-8000-000000000003';
    v_ids uuid[];
    v_users uuid[];
    v_count bigint;
    v_counts jsonb;
    v_pin record;
BEGIN
    -- The single source of truth.
    ASSERT NOT public.is_entry_publicly_eligible(v_e_int),
        'FAIL: an internal author''s review must not be publicly eligible';
    ASSERT NOT public.is_entry_publicly_eligible(v_e_int2),
        'FAIL: an internal author''s review must not be publicly eligible (R2)';
    ASSERT public.is_entry_publicly_eligible(v_e_pub),
        'FAIL: a non-internal author''s review must stay publicly eligible';

    -- Restaurant page REVIEWS (signed-in stranger) and its total.
    SELECT array_agg(entry_id), max(total_count) INTO v_ids, v_count
    FROM public.get_public_reviews(v_r1, v_viewer, 20);
    ASSERT v_ids = ARRAY[v_e_pub],
        format('FAIL: get_public_reviews must list only the real review, got %s', v_ids);
    ASSERT v_count = 1,
        format('FAIL: get_public_reviews total_count must exclude internal reviews, got %s', v_count);

    -- The /restaurant-reviews folio.
    SELECT array_agg(entry_id) INTO v_ids
    FROM public.get_public_reviews_page(v_r1, v_viewer, 50, NULL, NULL);
    ASSERT v_ids = ARRAY[v_e_pub],
        format('FAIL: get_public_reviews_page leaked an internal review, got %s', v_ids);

    -- Guest reads (no viewer): page, counts, recent list.
    SELECT array_agg(entry_id) INTO v_ids
    FROM public.get_public_reviews_page_guest(v_r1, 50, NULL, NULL);
    ASSERT v_ids = ARRAY[v_e_pub],
        format('FAIL: guest reviews leaked an internal review, got %s', v_ids);

    SELECT jsonb_object_agg(restaurant_id, review_count) INTO v_counts
    FROM public.fn_guest_public_review_counts(ARRAY[v_r1, v_r2]);
    ASSERT v_counts = jsonb_build_object(v_r1::text, 1),
        format('FAIL: guest review counts must count only real reviews, got %s', v_counts);

    SELECT array_agg(restaurant_id) INTO v_ids FROM public.fn_guest_recent_restaurants(40);
    ASSERT v_r1 = ANY (v_ids), 'FAIL: recently reviewed must keep a restaurant with a real review';
    ASSERT NOT (v_r2 = ANY (v_ids)),
        'FAIL: recently reviewed listed a restaurant whose only review is internal';
    SELECT review_count INTO v_count
    FROM public.fn_guest_recent_restaurants(40) WHERE restaurant_id = v_r1;
    ASSERT v_count = 1,
        format('FAIL: recent review_count must exclude the internal review, got %s', v_count);

    -- Friends feed helper: the viewer follows both authors, sees one entry.
    SELECT array_agg(id) INTO v_ids
    FROM public.fn_public_eligible_entries(v_viewer, ARRAY[v_int_author, v_pub_author], NULL, NULL, 10);
    ASSERT v_ids = ARRAY[v_e_pub],
        format('FAIL: fn_public_eligible_entries leaked an internal author''s entry, got %s', v_ids);

    -- Restaurant page batch predicate: stranger sees the real entry only; the
    -- internal author still sees their own (Branch 1 untouched).
    SELECT array_agg(entry_id) INTO v_ids
    FROM public.fn_visible_entry_ids(v_viewer, ARRAY[v_e_int, v_e_pub], true);
    ASSERT v_ids = ARRAY[v_e_pub],
        format('FAIL: fn_visible_entry_ids leaked an internal author''s entry, got %s', v_ids);
    SELECT array_agg(entry_id) INTO v_ids
    FROM public.fn_visible_entry_ids(v_int_author, ARRAY[v_e_int], true);
    ASSERT v_ids = ARRAY[v_e_int],
        'FAIL: an internal author must still see their own entry';

    -- Network map pins: R1 pinned by the public author only, R2 absent.
    SELECT array_agg(restaurant_id) INTO v_ids FROM public.fn_network_map_pins(v_viewer);
    ASSERT v_ids = ARRAY[v_r1],
        format('FAIL: fn_network_map_pins must pin only restaurants with a real followee log, got %s', v_ids);
    SELECT * INTO v_pin FROM public.fn_network_map_pins(v_viewer) WHERE restaurant_id = v_r1;
    ASSERT v_pin.author_id = v_pub_author AND v_pin.others_count = 0,
        format('FAIL: the R1 pin must credit the real author alone, got author %s others %s',
               v_pin.author_id, v_pin.others_count);

    -- People to follow: an internal author is never a candidate.
    SELECT array_agg(author_id) INTO v_users
    FROM public.fn_recently_active_public_authors(v_int_viewer, '{}'::uuid[], 8);
    ASSERT v_pub_author = ANY (v_users),
        format('FAIL: the real author must stay a people candidate, got %s', v_users);
    ASSERT NOT (v_int_author = ANY (v_users)),
        format('FAIL: an internal author leaked into people candidates, got %s', v_users);

    -- Friends activity: followed internal accounts contribute nothing.
    SELECT count(*) INTO v_count
    FROM public.fn_friends_activity(v_viewer, NULL, NULL, 51)
    WHERE payload->>'user_id' = v_int_author::text;
    ASSERT v_count = 0,
        format('FAIL: fn_friends_activity leaked %s internal-account rows', v_count);
    SELECT count(*) INTO v_count
    FROM public.fn_friends_activity(v_viewer, NULL, NULL, 51)
    WHERE payload->>'user_id' = v_pub_author::text;
    ASSERT v_count = 2,
        format('FAIL: fn_friends_activity must keep the real author''s entry and list, got %s', v_count);

    RAISE NOTICE 'PASS internal_accounts entries: SSOT, reviews page + total, folio, guest page/counts/recent, feed helper, visible ids, map pins, people, activity';
END;
$spec$;

-- ── can_view_entry (entries RLS, Branch 4) as a signed-in stranger ──────────
DO $spec$
DECLARE
    v_seen uuid[];
BEGIN
    PERFORM set_config('request.jwt.claims',
        '{"sub": "25100000-0000-4000-8000-000000000003"}', true);
    SET LOCAL ROLE authenticated;

    SELECT array_agg(id) INTO v_seen
    FROM public.entries
    WHERE id IN ('25130000-0000-4000-8000-000000000001', '25130000-0000-4000-8000-000000000002');

    RESET ROLE;

    ASSERT v_seen = ARRAY['25130000-0000-4000-8000-000000000002'::uuid],
        format('FAIL: entries RLS (can_view_entry Branch 4) leaked an internal author''s entry, got %s', v_seen);

    -- The internal author keeps reading their own row (Branch 1).
    PERFORM set_config('request.jwt.claims',
        '{"sub": "25100000-0000-4000-8000-000000000001"}', true);
    SET LOCAL ROLE authenticated;

    SELECT array_agg(id) INTO v_seen
    FROM public.entries
    WHERE id = '25130000-0000-4000-8000-000000000001';

    RESET ROLE;

    ASSERT v_seen = ARRAY['25130000-0000-4000-8000-000000000001'::uuid],
        'FAIL: an internal author must still read their own entry through RLS';

    RAISE NOTICE 'PASS internal_accounts can_view_entry: stranger sees the real entry only, author sees their own';
END;
$spec$;

-- ── Saves and the socials module: internal savers only for internal viewers ─
DO $spec$
DECLARE
    v_viewer     uuid := '25100000-0000-4000-8000-000000000003';
    v_int_viewer uuid := '25100000-0000-4000-8000-000000000004';
    v_int_saver  uuid := '25100000-0000-4000-8000-000000000005';
    v_pub_saver  uuid := '25100000-0000-4000-8000-000000000006';
    v_r1 uuid := '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    v_savers uuid[];
    v_rel text;
    v_k30 int;
    v_rep uuid;
BEGIN
    -- The doctrine predicate.
    SELECT array_agg(saver_id ORDER BY saver_id) INTO v_savers
    FROM public.fn_restaurant_saves_visible(v_viewer, v_r1);
    ASSERT v_savers = ARRAY[v_pub_saver],
        format('FAIL: a non-internal viewer must see only the real saver, got %s', v_savers);

    SELECT array_agg(saver_id ORDER BY saver_id) INTO v_savers
    FROM public.fn_restaurant_saves_visible(v_int_viewer, v_r1);
    ASSERT v_savers = ARRAY[v_int_saver, v_pub_saver],
        format('FAIL: an internal viewer must see the internal saver too, got %s', v_savers);

    SELECT relationship INTO v_rel
    FROM public.fn_restaurant_saves_visible(v_int_saver, v_r1) WHERE saver_id = v_int_saver;
    ASSERT v_rel = 'self',
        format('FAIL: an internal saver must still see their own save as self, got %L', v_rel);

    -- Stage 1 keeps internal savers in the viewer-agnostic candidate cache
    -- (deny-all grants, re-gated per viewer in stage 2); the smoke user, itself
    -- internal, depends on this to see the second smoke account's clip.
    SELECT c.k30 INTO v_k30 FROM public.fn_compute_socials_candidates() c WHERE c.restaurant_id = v_r1;
    ASSERT v_k30 = 2,
        format('FAIL: stage-1 socials candidates must still count internal savers, got %s', v_k30);

    -- Stage 2: the non-internal viewer sees one saver and the real clip.
    SELECT p.k30, p.rep_saver_id INTO v_k30, v_rep
    FROM public.fn_socials_viewer_pass(v_viewer, ARRAY[v_r1]) p WHERE p.restaurant_id = v_r1;
    ASSERT v_k30 = 1,
        format('FAIL: socials viewer pass must exclude the internal saver for a real viewer, got k30 %s', v_k30);
    ASSERT v_rep = v_pub_saver,
        format('FAIL: the representative clip for a real viewer must never be internal, got %s', v_rep);

    -- Stage 2: the internal viewer sees both, and the newer (internal) clip leads.
    SELECT p.k30, p.rep_saver_id INTO v_k30, v_rep
    FROM public.fn_socials_viewer_pass(v_int_viewer, ARRAY[v_r1]) p WHERE p.restaurant_id = v_r1;
    ASSERT v_k30 = 2,
        format('FAIL: socials viewer pass must keep the internal saver for an internal viewer, got k30 %s', v_k30);
    ASSERT v_rep = v_int_saver,
        format('FAIL: an internal viewer should get the most recent surviving clip (internal), got %s', v_rep);

    RAISE NOTICE 'PASS internal_accounts saves: predicate per viewer, self, stage-1 cache, viewer pass both ways';
END;
$spec$;

-- ── Lists owned by an internal account never surface ────────────────────────
DO $spec$
DECLARE
    v_viewer uuid := '25100000-0000-4000-8000-000000000003';
    v_r1 uuid := '251aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    v_l_int uuid := '25110000-0000-4000-8000-000000000001';
    v_l_pub uuid := '25110000-0000-4000-8000-000000000002';
    v_ids uuid[];
BEGIN
    SELECT array_agg(id) INTO v_ids FROM public.fn_search_public_lists('', NULL, NULL, 20);
    ASSERT v_l_pub = ANY (v_ids) AND NOT (v_l_int = ANY (v_ids)),
        format('FAIL: fn_search_public_lists must hide the internal owner''s list, got %s', v_ids);

    SELECT array_agg(id) INTO v_ids FROM public.fn_browse_public_lists(v_viewer, 20);
    ASSERT v_l_pub = ANY (v_ids) AND NOT (v_l_int = ANY (v_ids)),
        format('FAIL: fn_browse_public_lists must hide the internal owner''s list, got %s', v_ids);

    SELECT array_agg(id) INTO v_ids FROM public.fn_browse_public_lists_with_cover_credit(v_viewer, 20);
    ASSERT v_l_pub = ANY (v_ids) AND NOT (v_l_int = ANY (v_ids)),
        format('FAIL: fn_browse_public_lists_with_cover_credit must hide the internal owner''s list, got %s', v_ids);

    -- Even a list the viewer explicitly saved drops out of their saved rail.
    SELECT array_agg(id) INTO v_ids FROM public.fn_saved_list_cards(v_viewer, 40, NULL, NULL);
    ASSERT v_ids = ARRAY[v_l_pub],
        format('FAIL: fn_saved_list_cards must hide the internal owner''s list, got %s', v_ids);

    SELECT array_agg(id) INTO v_ids FROM public.fn_restaurant_featured_lists(v_viewer, v_r1, 10);
    ASSERT v_ids = ARRAY[v_l_pub],
        format('FAIL: fn_restaurant_featured_lists (signed in) must hide the internal owner''s list, got %s', v_ids);
    SELECT array_agg(id) INTO v_ids FROM public.fn_restaurant_featured_lists(NULL, v_r1, 10);
    ASSERT v_ids = ARRAY[v_l_pub],
        format('FAIL: fn_restaurant_featured_lists (guest) must hide the internal owner''s list, got %s', v_ids);

    ASSERT public.fn_guest_public_list(v_l_int) IS NULL,
        'FAIL: fn_guest_public_list must read an internal owner''s list as NULL';
    ASSERT public.fn_guest_public_list(v_l_pub) IS NOT NULL,
        'FAIL: fn_guest_public_list must still read a real public list';

    RAISE NOTICE 'PASS internal_accounts lists: search, browse (both), saved cards, featured (both), guest list';
END;
$spec$;

-- ── Security posture survives the redefinitions ─────────────────────────────
DO $spec$
DECLARE
    fn text;
    v_config text[];
BEGIN
    -- Service-role-only functions stay service-role-only.
    FOREACH fn IN ARRAY ARRAY[
        'public.fn_public_eligible_entries(uuid,uuid[],timestamptz,uuid,int)',
        'public.fn_network_map_pins(uuid)',
        'public.fn_recently_active_public_authors(uuid,uuid[],int)',
        'public.fn_visible_entry_ids(uuid,uuid[],boolean)',
        'public.fn_friends_activity(uuid,timestamptz,text,int)',
        'public.fn_restaurant_saves_visible(uuid,uuid)',
        'public.fn_search_public_lists(text,timestamptz,uuid,int)',
        'public.fn_browse_public_lists(uuid,int)',
        'public.fn_browse_public_lists_with_cover_credit(uuid,integer)',
        'public.fn_saved_list_cards(uuid,integer,timestamptz,uuid)',
        'public.fn_restaurant_featured_lists(uuid,uuid,int)',
        'public.fn_guest_public_list(uuid)'
    ] LOOP
        ASSERT NOT has_function_privilege('anon', fn, 'execute'),
            format('FAIL: anon must not execute %s', fn);
        ASSERT NOT has_function_privilege('authenticated', fn, 'execute'),
            format('FAIL: authenticated must not execute %s', fn);
        ASSERT has_function_privilege('service_role', fn, 'execute'),
            format('FAIL: service_role must execute %s', fn);
    END LOOP;

    -- The two RLS-reachable helpers stay callable by authenticated (policies
    -- evaluate them as the invoker) and keep the search_path pin restated after
    -- CREATE OR REPLACE.
    FOREACH fn IN ARRAY ARRAY[
        'public.is_entry_publicly_eligible(uuid)',
        'public.can_view_entry(public.entries)'
    ] LOOP
        ASSERT has_function_privilege('authenticated', fn, 'execute'),
            format('FAIL: authenticated must execute %s (RLS policies call it)', fn);
        SELECT proconfig INTO v_config FROM pg_proc WHERE oid = fn::regprocedure;
        ASSERT 'search_path=public, pg_temp' = ANY (v_config),
            format('FAIL: %s lost its search_path pin (20260907190000), got %s', fn, v_config);
        ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = fn::regprocedure),
            format('FAIL: %s must stay SECURITY INVOKER', fn);
    END LOOP;

    -- Definer / invoker split reproduced from the latest definitions.
    ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_restaurant_saves_visible(uuid,uuid)'::regprocedure),
        'FAIL: fn_restaurant_saves_visible must stay SECURITY DEFINER (blocked_users RLS trap)';
    ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_visible_entry_ids(uuid,uuid[],boolean)'::regprocedure),
        'FAIL: fn_visible_entry_ids must stay SECURITY DEFINER';
    ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_guest_public_list(uuid)'::regprocedure),
        'FAIL: fn_guest_public_list must stay SECURITY DEFINER';
    ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_friends_activity(uuid,timestamptz,text,int)'::regprocedure),
        'FAIL: fn_friends_activity must stay SECURITY INVOKER';
    ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.fn_restaurant_featured_lists(uuid,uuid,int)'::regprocedure),
        'FAIL: fn_restaurant_featured_lists must stay SECURITY INVOKER';

    RAISE NOTICE 'PASS internal_accounts posture: grants, RLS helper access, search_path pins, definer flags';
END;
$spec$;

ROLLBACK;
