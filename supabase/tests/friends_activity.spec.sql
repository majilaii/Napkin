-- Actual RPC predicates, hydration and keyset traversal. Isolated fixtures, always rolled back.
BEGIN;
INSERT INTO auth.users(id, email, raw_user_meta_data)
SELECT ('66900000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
    'activity-' || i || '@test.invalid', jsonb_build_object('display_name', 'Activity ' || i)
FROM generate_series(1,6) i;
-- 1 private viewer; 2 public followee; 3 private followee/tablemate;
-- 4 public stranger; 5 blocked by viewer; 6 blocks viewer.
INSERT INTO public.profiles(user_id, display_name, account_privacy, username)
SELECT ('66900000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
    'Activity ' || i, CASE WHEN i IN (1,3) THEN 'private' ELSE 'public' END, 'activity_test_' || i
FROM generate_series(1,6) i
ON CONFLICT(user_id) DO UPDATE SET account_privacy=excluded.account_privacy, username=excluded.username;
INSERT INTO public.restaurants(id,name,city) VALUES
    ('66901111-0000-0000-0000-000000000001','Test noodle house','Testville'),
    ('66901111-0000-0000-0000-000000000002','Test cafe','Testville');
INSERT INTO public.follows(follower_id,following_id)
SELECT '66900000-0000-0000-0000-000000000001', user_id FROM public.profiles
WHERE user_id IN ('66900000-0000-0000-0000-000000000002','66900000-0000-0000-0000-000000000003',
    '66900000-0000-0000-0000-000000000005','66900000-0000-0000-0000-000000000006');
INSERT INTO public.blocked_users(blocker_id,blocked_id) VALUES
    ('66900000-0000-0000-0000-000000000001','66900000-0000-0000-0000-000000000005'),
    ('66900000-0000-0000-0000-000000000006','66900000-0000-0000-0000-000000000001');
INSERT INTO public.tables(id,owner_id,name) VALUES
    ('66902222-0000-0000-0000-000000000001','66900000-0000-0000-0000-000000000001','Private table');
INSERT INTO public.table_members(table_id,member_id,role) VALUES
    ('66902222-0000-0000-0000-000000000001','66900000-0000-0000-0000-000000000001','admin'),
    ('66902222-0000-0000-0000-000000000001','66900000-0000-0000-0000-000000000003','member');
INSERT INTO public.entries(id,user_id,restaurant_id,rating,content,visibility,created_at,visited_at,photo_url)
SELECT ('66903333-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
    ('66900000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
    '66901111-0000-0000-0000-000000000001', 4,
    CASE WHEN i=1 THEN NULL WHEN i=2 THEN 'A' ELSE 'A full public review long enough to qualify' END,
    CASE WHEN i=1 THEN 'private' ELSE 'friends' END,
    '2026-09-01T12:00:00.123456Z', '2020-01-01', 'https://test.invalid/primary.jpg'
FROM generate_series(1,6) i;
INSERT INTO public.entry_photos(entry_id,photo_url,sort_order) VALUES
    ('66903333-0000-0000-0000-000000000001','https://test.invalid/extra.jpg',1);
INSERT INTO public.wishlist_items(id,user_id,restaurant_id,created_at,note,source)
SELECT ('66904444-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
    ('66900000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
    '66901111-0000-0000-0000-000000000001','2026-09-01T12:00:00.123456Z',
    'private pin note', '{"type":"tiktok","url":"https://test.invalid/v","caption":"private raw caption"}'::jsonb
FROM generate_series(1,6) i;
INSERT INTO public.lists(id,owner_id,title,privacy,created_at,updated_at)
SELECT ('66905555-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
    ('66900000-0000-0000-0000-' || lpad(i::text,12,'0'))::uuid,
    'List ' || i, CASE WHEN i=1 THEN 'private' ELSE 'public' END,
    '2026-09-01T12:00:00.123456Z','2026-09-01T12:00:00.123456Z'
FROM generate_series(1,6) i;
-- Newer ineligible candidates must never consume page capacity.
INSERT INTO public.wishlist_items(user_id,restaurant_id,created_at,deleted_at) VALUES
    ('66900000-0000-0000-0000-000000000001','66901111-0000-0000-0000-000000000002',now(),now());
INSERT INTO public.wishlist_items(user_id,restaurant_id,extraction_status) VALUES
    ('66900000-0000-0000-0000-000000000001',NULL,'pending'),
    ('66900000-0000-0000-0000-000000000002',NULL,'failed');
INSERT INTO public.lists(owner_id,title,privacy,table_id) VALUES
    ('66900000-0000-0000-0000-000000000001','Table only','private','66902222-0000-0000-0000-000000000001'),
    ('66900000-0000-0000-0000-000000000002','Private peer list','private',NULL);
INSERT INTO public.entries(user_id,restaurant_id,rating,content,visibility)
SELECT '66900000-0000-0000-0000-000000000002','66901111-0000-0000-0000-000000000001',rating,content,visibility
FROM (VALUES (4::float8,'Private review with sufficient length','private'),
    (4,'   ','friends'), (NULL,'Unrated review with sufficient length','friends'),
    (4,'Unknown visibility with sufficient length',NULL)) AS v(rating,content,visibility);

SET LOCAL ROLE service_role;
DO $$
DECLARE
    viewer uuid := '66900000-0000-0000-0000-000000000001';
    peer uuid := '66900000-0000-0000-0000-000000000002';
    r record; keys text[] := '{}'; expected text[]; cursor_date timestamptz; cursor_key text;
BEGIN
    SELECT array_agg(activity_key ORDER BY sort_date DESC,activity_key COLLATE "C" DESC) INTO expected
    FROM public.fn_friends_activity(viewer,NULL,NULL,51);
    ASSERT cardinality(expected)=6, 'Exactly self and public followee across all three kinds';
    ASSERT (SELECT count(*)=3 FROM public.fn_friends_activity(viewer,NULL,NULL,51) WHERE payload->>'user_id'=viewer::text), 'Own private entries and list included';
    ASSERT (SELECT count(*)=3 FROM public.fn_friends_activity(viewer,NULL,NULL,51) WHERE payload->>'user_id'=peer::text), 'Followed public activity included';
    LOOP
        SELECT * INTO r FROM public.fn_friends_activity(viewer,cursor_date,cursor_key,1);
        EXIT WHEN NOT FOUND;
        ASSERT NOT r.activity_key=ANY(keys), 'No duplicate across keyset pages';
        keys := array_append(keys,r.activity_key);
        cursor_date := r.sort_date; cursor_key := r.activity_key;
        ASSERT cardinality(keys)<=6, 'Traversal must terminate';
    END LOOP;
    ASSERT keys=expected, 'Limit 1 same-microsecond cross-kind traversal is exhaustive and ordered';
    ASSERT (SELECT count(*)=2 FROM public.fn_friends_activity(viewer,NULL,NULL,2)), 'Exact SQL page size';
    ASSERT NOT EXISTS(SELECT 1 FROM public.fn_friends_activity(NULL,NULL,NULL,51)), 'Null viewer denied';
    ASSERT NOT EXISTS(SELECT 1 FROM public.fn_friends_feed(viewer,NULL,NULL,51) WHERE user_id=viewer), 'Legacy self exclusion unchanged';
    ASSERT (SELECT array_agg(id ORDER BY id) FROM public.fn_friends_feed(viewer,NULL,NULL,51)) =
        (SELECT array_agg((payload->>'id')::uuid ORDER BY payload->>'id') FROM public.fn_friends_activity(viewer,NULL,NULL,51)
            WHERE kind='entry' AND payload->>'user_id'<>viewer::text), 'Peer entries match current legacy eligibility including one-character notes';
    ASSERT EXISTS(SELECT 1 FROM public.fn_friends_activity(viewer,NULL,NULL,51)
        WHERE kind='entry' AND payload->>'content'='A'), 'One-character peer review is visible';
    ASSERT NOT EXISTS(SELECT 1 FROM public.fn_friends_activity(viewer,NULL,NULL,51)
        WHERE payload ?| ARRAY['table_id','source','note','table_name','table_members']), 'No Table context or raw pin data';
    SELECT * INTO r FROM public.fn_friends_activity(viewer,NULL,NULL,51)
        WHERE activity_key='entry:66903333-0000-0000-0000-000000000001';
    ASSERT r.payload->>'id'='66903333-0000-0000-0000-000000000001', 'Entry cache id preserved';
    ASSERT jsonb_array_length(r.payload->'photos')=2, 'Primary plus extra photo hydrated';
    ASSERT r.sort_date='2026-09-01T12:00:00.123456Z'::timestamptz, 'Activity uses created date, not old visit';
    ASSERT NOT EXISTS(SELECT 1 FROM public.fn_friends_activity(viewer,NULL,NULL,51)
        WHERE kind<>'entry' AND payload->>'id'<>activity_key), 'Other ids namespaced';
END $$;
RESET ROLE;
DO $$
BEGIN
    ASSERT NOT has_function_privilege('anon','public.fn_friends_activity(uuid,timestamptz,text,int)','EXECUTE'), 'Anon cannot call';
    ASSERT NOT has_function_privilege('authenticated','public.fn_friends_activity(uuid,timestamptz,text,int)','EXECUTE'), 'Authenticated cannot spoof viewer';
    ASSERT has_function_privilege('service_role','public.fn_friends_activity(uuid,timestamptz,text,int)','EXECUTE'), 'Service role may call';
    ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.fn_friends_activity(uuid,timestamptz,text,int)'::regprocedure), 'Invoker only';
END $$;
-- A privacy flip must remove all that peer's candidates before pagination.
UPDATE public.profiles SET account_privacy='private' WHERE user_id='66900000-0000-0000-0000-000000000002';
SET LOCAL ROLE service_role;
DO $$ BEGIN
    ASSERT (SELECT count(*)=3 FROM public.fn_friends_activity('66900000-0000-0000-0000-000000000001',NULL,NULL,51)), 'Privacy flip removes all peer activity';
END $$;
RESET ROLE;
ROLLBACK;
