-- TICKET-189 — people-to-follow v2 + viewer-keyed lists browse (CI contract spec).
--
-- fn_recently_active_public_authors:
--   • 30d lower bound (an eligible 35d-old author never appears).
--   • restaurant_id NOT NULL is part of the predicate — a note-only entry
--     never inflates "places logged"; nor do unrated / short-note / private-
--     visibility / private-account entries.
--   • self / already-followed / either-direction blocks / p_exclude_ids
--     (co-diners) are excluded BEFORE the LIMIT — a viewer whose top public is
--     a co-diner still gets beyond-co-diner rows at p_limit=1.
--   • distinct-place counts + deterministic order (logs_30d DESC, author_id ASC).
--
-- fn_browse_public_lists:
--   • triple gate (public list + non-Table + public owner) + viewer
--     self-exclusion that never consumes the cap.
--   • cover ONLY when the first restaurant is photo_source='places' WITH
--     attribution — a 'user' hero or an attribution-less places hero yields
--     NULL (client falls to emoji/tint). Ranked lists cover from position 1,
--     not recency.
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/people_lists_discovery.spec.sql

BEGIN;

-- ── Fixture users (1891/1892 prefixes — no collision with other specs) ────────
INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, now(), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', u.dn)
FROM (VALUES
  -- people spec
  ('18910000-0000-4000-8000-000000000001'::uuid, 'pv@people-test.invalid', 'People Viewer'),
  ('18910000-0000-4000-8000-000000000002'::uuid, 'a1@people-test.invalid', 'A1 Three Logs'),
  ('18910000-0000-4000-8000-000000000003'::uuid, 'a2@people-test.invalid', 'A2 One Log'),
  ('18910000-0000-4000-8000-000000000004'::uuid, 'a3@people-test.invalid', 'A3 Too Old'),
  ('18910000-0000-4000-8000-000000000005'::uuid, 'a4@people-test.invalid', 'A4 Private'),
  ('18910000-0000-4000-8000-000000000006'::uuid, 'a5@people-test.invalid', 'A5 Followed'),
  ('18910000-0000-4000-8000-000000000007'::uuid, 'a6@people-test.invalid', 'A6 Viewer Blocked'),
  ('18910000-0000-4000-8000-000000000008'::uuid, 'a7@people-test.invalid', 'A7 Blocks Viewer'),
  ('18910000-0000-4000-8000-000000000009'::uuid, 'a8@people-test.invalid', 'A8 CoDiner'),
  -- lists spec
  ('18920000-0000-4000-8000-000000000001'::uuid, 'lv@lists-test.invalid', 'Lists Viewer'),
  ('18920000-0000-4000-8000-000000000002'::uuid, 'o1@lists-test.invalid', 'O1 Public Owner'),
  ('18920000-0000-4000-8000-000000000003'::uuid, 'o2@lists-test.invalid', 'O2 Private Owner')
) AS u(id, email, dn)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (user_id, display_name, account_privacy, username)
SELECT u.id, u.dn, u.priv, u.un
FROM (VALUES
  ('18910000-0000-4000-8000-000000000001'::uuid, 'People Viewer',     'public',  'ppl_viewer'),
  ('18910000-0000-4000-8000-000000000002'::uuid, 'A1 Three Logs',     'public',  'ppl_a1'),
  ('18910000-0000-4000-8000-000000000003'::uuid, 'A2 One Log',        'public',  'ppl_a2'),
  ('18910000-0000-4000-8000-000000000004'::uuid, 'A3 Too Old',        'public',  'ppl_a3'),
  ('18910000-0000-4000-8000-000000000005'::uuid, 'A4 Private',        'private', 'ppl_a4'),
  ('18910000-0000-4000-8000-000000000006'::uuid, 'A5 Followed',       'public',  'ppl_a5'),
  ('18910000-0000-4000-8000-000000000007'::uuid, 'A6 Viewer Blocked', 'public',  'ppl_a6'),
  ('18910000-0000-4000-8000-000000000008'::uuid, 'A7 Blocks Viewer',  'public',  'ppl_a7'),
  ('18910000-0000-4000-8000-000000000009'::uuid, 'A8 CoDiner',        'public',  'ppl_a8'),
  ('18920000-0000-4000-8000-000000000001'::uuid, 'Lists Viewer',      'public',  'lst_viewer'),
  ('18920000-0000-4000-8000-000000000002'::uuid, 'O1 Public Owner',   'public',  'lst_o1'),
  ('18920000-0000-4000-8000-000000000003'::uuid, 'O2 Private Owner',  'private', 'lst_o2')
) AS u(id, dn, priv, un)
ON CONFLICT (user_id) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  account_privacy = EXCLUDED.account_privacy,
  username        = EXCLUDED.username;

-- ── Restaurants ───────────────────────────────────────────────────────────────
INSERT INTO public.restaurants (id, name, city) VALUES
  ('18910000-aaaa-4000-8000-0000000000a1', 'People Test Kitchen',       'Testville'),
  ('18910000-aaaa-4000-8000-0000000000a2', 'People Test Kitchen Annex', 'Testville')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurants (id, name, city, photo_url, photo_source, places_photo_attribution_html) VALUES
  ('18920000-aaaa-4000-8000-0000000000a1', 'Places Hero Cafe',   'Testville',
     'https://cdn.example.invalid/places-hero.jpg', 'places', '<a href="https://maps.google.com/?a">Photo Author</a>'),
  ('18920000-aaaa-4000-8000-0000000000a2', 'User Hero Diner',    'Testville',
     'https://cdn.example.invalid/user-hero.jpg', 'user', NULL),
  ('18920000-aaaa-4000-8000-0000000000a3', 'NoAttr Places Spot', 'Testville',
     'https://cdn.example.invalid/noattr.jpg', 'places', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── People: entries (visibility 'table' = publicly eligible ring) ─────────────
INSERT INTO public.entries (user_id, restaurant_id, rating, content, visibility, created_at) VALUES
  -- A1: three eligible logs at ONE restaurant → logs_30d = 1 place.
  ('18910000-0000-4000-8000-000000000002', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'A perfectly lovely meal, would return for the noodles.', 'table', now() - interval '2 days'),
  ('18910000-0000-4000-8000-000000000002', '18910000-aaaa-4000-8000-0000000000a1', 4.5,
     'Second visit, the broth keeps getting deeper and better.', 'table', now() - interval '9 days'),
  ('18910000-0000-4000-8000-000000000002', '18910000-aaaa-4000-8000-0000000000a1', 3.5,
     'Third visit, a little salty this time but still great.', 'table', now() - interval '20 days'),
  -- A2: ONE eligible log + every ineligible variant → logs_30d = 1.
  ('18910000-0000-4000-8000-000000000003', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'One honest eligible review with plenty of characters.', 'table', now() - interval '3 days'),
  ('18910000-0000-4000-8000-000000000003', NULL, 4.0,
     'Note-only entry without a restaurant must never count.', 'table', now() - interval '3 days'),
  ('18910000-0000-4000-8000-000000000003', '18910000-aaaa-4000-8000-0000000000a1', NULL,
     'Unrated entry with a long enough note must never count.', 'table', now() - interval '4 days'),
  ('18910000-0000-4000-8000-000000000003', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'short', 'table', now() - interval '5 days'),
  ('18910000-0000-4000-8000-000000000003', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'A private-visibility entry must never count either.', 'private', now() - interval '6 days'),
  -- A3: eligible but 35 days old → outside the window entirely.
  ('18910000-0000-4000-8000-000000000004', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'Eligible in every way except being thirty-five days old.', 'table', now() - interval '35 days'),
  -- A4 (private account), A5 (followed), A6/A7 (blocks), A8 (co-diner):
  -- each with an otherwise-eligible fresh log.
  ('18910000-0000-4000-8000-000000000005', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'Private account log that must never surface anywhere.', 'table', now() - interval '2 days'),
  ('18910000-0000-4000-8000-000000000006', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'Already-followed author log, excluded from candidates.', 'table', now() - interval '2 days'),
  ('18910000-0000-4000-8000-000000000007', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'Viewer blocked this author, excluded from candidates.', 'table', now() - interval '2 days'),
  ('18910000-0000-4000-8000-000000000008', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'This author blocked the viewer, excluded from candidates.', 'table', now() - interval '2 days'),
  -- A8: five eligible logs across TWO restaurants — the top candidate by
  -- distinct-place breadth, but a co-diner.
  ('18910000-0000-4000-8000-000000000009', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'Co-diner log number one with plenty of characters here.', 'table', now() - interval '1 day'),
  ('18910000-0000-4000-8000-000000000009', '18910000-aaaa-4000-8000-0000000000a2', 4.0,
     'Co-diner log number two with plenty of characters here.', 'table', now() - interval '2 days'),
  ('18910000-0000-4000-8000-000000000009', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'Co-diner log number three with plenty of characters too.', 'table', now() - interval '3 days'),
  ('18910000-0000-4000-8000-000000000009', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'Co-diner log number four with plenty of characters too.', 'table', now() - interval '4 days'),
  ('18910000-0000-4000-8000-000000000009', '18910000-aaaa-4000-8000-0000000000a1', 4.0,
     'Co-diner log number five with plenty of characters too.', 'table', now() - interval '5 days');

INSERT INTO public.follows (follower_id, following_id) VALUES
  ('18910000-0000-4000-8000-000000000001', '18910000-0000-4000-8000-000000000006')  -- V follows A5
ON CONFLICT DO NOTHING;

INSERT INTO public.blocked_users (blocker_id, blocked_id) VALUES
  ('18910000-0000-4000-8000-000000000001', '18910000-0000-4000-8000-000000000007'),  -- V blocked A6
  ('18910000-0000-4000-8000-000000000008', '18910000-0000-4000-8000-000000000001')   -- A7 blocked V
ON CONFLICT DO NOTHING;

-- ── Lists fixtures ────────────────────────────────────────────────────────────
-- O1: six public lists (fills the cap). Viewer: two public lists with the
-- HIGHEST ids — the ORDER BY tiebreak (updated_at DESC, id DESC) would rank
-- them first if self-exclusion regressed, so their absence is load-bearing.
-- O2 (private owner): one public list — excluded by the owner gate.
-- O1 also holds one private list, and one Table list.
INSERT INTO public.tables (id, owner_id, name)
VALUES ('18920000-bbbb-4000-8000-0000000000b1', '18920000-0000-4000-8000-000000000002', 'Lists Spec Table')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.lists (id, owner_id, title, ranked, privacy, table_id) VALUES
  ('18920000-1111-4000-8000-000000000001', '18920000-0000-4000-8000-000000000002', 'L1 unranked places cover', false, 'public',  NULL),
  ('18920000-1111-4000-8000-000000000002', '18920000-0000-4000-8000-000000000002', 'L2 user hero no cover',    false, 'public',  NULL),
  ('18920000-1111-4000-8000-000000000003', '18920000-0000-4000-8000-000000000002', 'L3 ranked position cover', true,  'public',  NULL),
  ('18920000-1111-4000-8000-000000000004', '18920000-0000-4000-8000-000000000002', 'L4 attributionless spot',  false, 'public',  NULL),
  ('18920000-1111-4000-8000-000000000005', '18920000-0000-4000-8000-000000000002', 'L5 plain public list',     false, 'public',  NULL),
  ('18920000-1111-4000-8000-000000000006', '18920000-0000-4000-8000-000000000002', 'L6 plain public list two', false, 'public',  NULL),
  ('18920000-1111-4000-8000-000000000007', '18920000-0000-4000-8000-000000000002', 'L7 private list',          false, 'private', NULL),
  ('18920000-1111-4000-8000-000000000008', '18920000-0000-4000-8000-000000000002', 'L8 table list',            false, 'private', '18920000-bbbb-4000-8000-0000000000b1'),
  ('18920000-1111-4000-8000-000000000009', '18920000-0000-4000-8000-000000000003', 'LP private owner public',  false, 'public',  NULL),
  ('ffff2000-1111-4000-8000-000000000001', '18920000-0000-4000-8000-000000000001', 'LV1 viewer own list',      false, 'public',  NULL),
  ('ffff2000-1111-4000-8000-000000000002', '18920000-0000-4000-8000-000000000001', 'LV2 viewer own list two',  false, 'public',  NULL);

INSERT INTO public.list_entries (list_id, restaurant_id, position, created_at) VALUES
  -- L1 (unranked): user-hero added first, PLACES-hero added most recently →
  -- recency picks the places cover.
  ('18920000-1111-4000-8000-000000000001', '18920000-aaaa-4000-8000-0000000000a2', 0, now() - interval '2 days'),
  ('18920000-1111-4000-8000-000000000001', '18920000-aaaa-4000-8000-0000000000a1', 0, now() - interval '1 day'),
  -- L2 (unranked): ONLY the user-hero restaurant → cover must be NULL.
  ('18920000-1111-4000-8000-000000000002', '18920000-aaaa-4000-8000-0000000000a2', 0, now() - interval '1 day'),
  -- L3 (ranked): position 1 = PLACES hero (added EARLIER), position 2 = user
  -- hero (added LATER). Position must win over recency → places cover.
  ('18920000-1111-4000-8000-000000000003', '18920000-aaaa-4000-8000-0000000000a1', 1, now() - interval '3 days'),
  ('18920000-1111-4000-8000-000000000003', '18920000-aaaa-4000-8000-0000000000a2', 2, now() - interval '1 day'),
  -- L4: places hero WITHOUT attribution → cover must be NULL.
  ('18920000-1111-4000-8000-000000000004', '18920000-aaaa-4000-8000-0000000000a3', 0, now() - interval '1 day'),
  -- L5/L6/L7/L8/LP/LV1/LV2: one plain entry each (entry_count ≥ 1).
  ('18920000-1111-4000-8000-000000000005', '18920000-aaaa-4000-8000-0000000000a2', 0, now() - interval '1 day'),
  ('18920000-1111-4000-8000-000000000006', '18920000-aaaa-4000-8000-0000000000a2', 0, now() - interval '1 day'),
  ('18920000-1111-4000-8000-000000000007', '18920000-aaaa-4000-8000-0000000000a1', 0, now() - interval '1 day'),
  ('18920000-1111-4000-8000-000000000008', '18920000-aaaa-4000-8000-0000000000a1', 0, now() - interval '1 day'),
  ('18920000-1111-4000-8000-000000000009', '18920000-aaaa-4000-8000-0000000000a1', 0, now() - interval '1 day'),
  ('ffff2000-1111-4000-8000-000000000001', '18920000-aaaa-4000-8000-0000000000a1', 0, now() - interval '1 day'),
  ('ffff2000-1111-4000-8000-000000000002', '18920000-aaaa-4000-8000-0000000000a1', 0, now() - interval '1 day');

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS
-- ─────────────────────────────────────────────────────────────────────────────
DO $spec$
DECLARE
  p_v   uuid := '18910000-0000-4000-8000-000000000001';
  a1    uuid := '18910000-0000-4000-8000-000000000002';
  a2    uuid := '18910000-0000-4000-8000-000000000003';
  a8    uuid := '18910000-0000-4000-8000-000000000009';
  l_v   uuid := '18920000-0000-4000-8000-000000000001';
  o1    uuid := '18920000-0000-4000-8000-000000000002';
  l1    uuid := '18920000-1111-4000-8000-000000000001';
  l2    uuid := '18920000-1111-4000-8000-000000000002';
  l3    uuid := '18920000-1111-4000-8000-000000000003';
  l4    uuid := '18920000-1111-4000-8000-000000000004';
  places_url text := 'https://cdn.example.invalid/places-hero.jpg';
  v_int  int;
  v_int2 int;
  v_uuid uuid;
  v_text text;
BEGIN
  -- ── fn_recently_active_public_authors ─────────────────────────────────────
  -- With A8 excluded as a co-diner: A1 and A2 each have one distinct place;
  -- author_id ASC puts A1 first.
  SELECT count(*) INTO v_int
  FROM public.fn_recently_active_public_authors(p_v, ARRAY[a8], 8);
  ASSERT v_int = 2,
    format('FAIL [people count]: expected exactly A1+A2, got %s rows', v_int);

  SELECT r.author_id, r.logs_30d INTO v_uuid, v_int
  FROM public.fn_recently_active_public_authors(p_v, ARRAY[a8], 8) r
  LIMIT 1;
  ASSERT v_uuid = a1, format('FAIL [people order]: expected A1 first, got %s', v_uuid);
  ASSERT v_int = 1,  format('FAIL [people A1 places]: 3 logs at one restaurant must count as 1 place, got %s', v_int);

  SELECT r.logs_30d INTO v_int
  FROM public.fn_recently_active_public_authors(p_v, ARRAY[a8], 8) r
  WHERE r.author_id = a2;
  ASSERT v_int = 1,
    format('FAIL [people A2 places]: ineligible variants (no-restaurant / unrated / short / private) must not count — expected 1, got %s', v_int);

  -- BEFORE-LIMIT proof: at p_limit=1 with A8 (the top author by distinct-place
  -- count) excluded, the single row is A1 — if exclusion ran after the LIMIT,
  -- A8 would consume the slot and the result would be empty.
  SELECT count(*) INTO v_int
  FROM public.fn_recently_active_public_authors(p_v, ARRAY[a8], 1);
  ASSERT v_int = 1, format('FAIL [people before-limit]: expected 1 row at p_limit=1, got %s', v_int);
  SELECT r.author_id INTO v_uuid
  FROM public.fn_recently_active_public_authors(p_v, ARRAY[a8], 1) r;
  ASSERT v_uuid = a1,
    'FAIL [people before-limit pick]: exclusions must apply BEFORE the LIMIT (expected A1)';

  -- Without the exclusion, A8 leads (2 distinct places) — and a NULL exclude
  -- array is treated as empty.
  SELECT r.author_id, r.logs_30d INTO v_uuid, v_int
  FROM public.fn_recently_active_public_authors(p_v, '{}'::uuid[], 8) r
  LIMIT 1;
  ASSERT v_uuid = a8 AND v_int = 2,
    format('FAIL [people no-exclude]: expected A8 with 2 places first, got %s with %s', v_uuid, v_int);
  SELECT count(*) INTO v_int
  FROM public.fn_recently_active_public_authors(p_v, NULL, 8);
  ASSERT v_int = 3,
    format('FAIL [people null-exclude]: NULL exclude array must behave as empty (A8+A1+A2), got %s rows', v_int);

  -- ── fn_browse_public_lists ────────────────────────────────────────────────
  -- Self-exclusion never consumes the cap: viewer with 2 own + 6 others'
  -- public lists still gets all 6 others', and none of their own.
  SELECT count(*) INTO v_int FROM public.fn_browse_public_lists(l_v, 6);
  ASSERT v_int = 6,
    format('FAIL [browse cap]: expected 6 rows (self-exclusion must not consume the cap), got %s', v_int);
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_browse_public_lists(l_v, 6) b WHERE b.owner_id = l_v
  ), 'FAIL [browse self]: the viewer''s own lists must be excluded server-side';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_browse_public_lists(l_v, 20) b
    WHERE b.title IN ('L7 private list', 'L8 table list', 'LP private owner public')
  ), 'FAIL [browse gates]: private / Table / private-owner lists must never surface';

  -- Covers: L1 (unranked) → most-recent add is the PLACES hero → attributed cover.
  SELECT b.cover_photo_url INTO v_text
  FROM public.fn_browse_public_lists(l_v, 20) b WHERE b.id = l1;
  ASSERT v_text = places_url,
    format('FAIL [L1 cover]: expected the places hero url, got %L', v_text);
  SELECT b.cover_attribution_html INTO v_text
  FROM public.fn_browse_public_lists(l_v, 20) b WHERE b.id = l1;
  ASSERT v_text IS NOT NULL AND v_text LIKE '%Photo Author%',
    'FAIL [L1 attribution]: places cover must carry its attribution html';

  -- L2: user-hero first restaurant → cover NULL (never a user photo on the
  -- public feed).
  SELECT b.cover_photo_url INTO v_text
  FROM public.fn_browse_public_lists(l_v, 20) b WHERE b.id = l2;
  ASSERT v_text IS NULL,
    format('FAIL [L2 cover]: photo_source=user must never back a cover, got %L', v_text);

  -- L3 (ranked): position 1 (places, added earlier) must beat recency.
  SELECT b.cover_photo_url INTO v_text
  FROM public.fn_browse_public_lists(l_v, 20) b WHERE b.id = l3;
  ASSERT v_text = places_url,
    format('FAIL [L3 cover]: ranked lists cover from position 1, got %L', v_text);

  -- L4: places hero WITHOUT attribution → cover NULL.
  SELECT b.cover_photo_url INTO v_text
  FROM public.fn_browse_public_lists(l_v, 20) b WHERE b.id = l4;
  ASSERT v_text IS NULL,
    format('FAIL [L4 cover]: attribution-less places hero must yield NULL, got %L', v_text);

  -- entry_count sanity (L1 holds two entries).
  SELECT b.entry_count::int INTO v_int
  FROM public.fn_browse_public_lists(l_v, 20) b WHERE b.id = l1;
  ASSERT v_int = 2, format('FAIL [L1 entry_count]: expected 2, got %s', v_int);

  RAISE NOTICE 'PASS people_lists_discovery: people predicate + before-limit exclusions + browse gates/covers';
END;
$spec$;

ROLLBACK;
