-- TICKET-189 — socials module privacy matrix + IG-host parity (CI contract spec).
--
-- Covers, per the ticket's Test Plan:
--   (a) block in EITHER direction → the blocked saver never feeds the count or
--       the clip (restaurant R4: only block-affected savers → NO row at all).
--   (b) a private Tablemate's save never feeds the module — the live
--       fn_public_account re-check drops them even though TICKET-155's
--       predicate returns them as 'tablemate' (restaurant R3).
--   (c) a saver flipping public→private BETWEEN cache and read → excluded
--       live (restaurant R5: cache warmed at k7=3, flip, stale cache still
--       says 3, viewer pass says 2 and re-picks the representative clip).
--   (d) self-exclusion demotes k: the viewer is one of three savers →
--       stage-1 k7=3, viewer pass k7=2 (restaurant R2).
-- Plus:
--   - stage-1 gating: public accounts only, verifiable social sources only
--     (video/screenshot/vision/handoff and non-IG web rows never qualify —
--     restaurant R6 is absent from the compute entirely).
--   - per-window platform facts ('mixed' when tiktok+IG share a window).
--   - the fn_is_instagram_url ↔ isInstagramUrl parity fixture table (SQL
--     side; the TS side lives in _shared/socialHost.test.ts — the two files
--     duplicate the SAME rows from _shared/socialHost.ts
--     SOCIAL_HOST_FIXTURES and must stay in sync).
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/socials_privacy.spec.sql

BEGIN;

-- Fixture UUIDs (18 9x prefix — never collides with other specs' 5555/…):
--   V   18900000-…-0001  viewer, PUBLIC (their own saves feed stage 1 — the
--                         self-exclusion test needs exactly that)
--   S1  …0002  public, tiktok @ R1 (2d)
--   S2  …0003  public, web+Instagram @ R1 (3d)
--   S3  …0004  public → FLIPPED PRIVATE mid-test, tiktok @ R1 (4d)
--   S4  …0005  PRIVATE tablemate of V, tiktok @ R1 (1d) + @ R3 (1d)
--   S5  …0006  public, V blocked S5, tiktok @ R1 (1d) + @ R4 (1d)
--   S6  …0007  public, S6 blocked V, tiktok @ R1 (1d) + @ R4 (1d)
--   S7  …0008  public, tiktok @ R1 (20d — 30d window only)
--   P1  …0009  public, tiktok @ R2 (2d)
--   P2  …000a  public, tiktok @ R2 (3d)
--   F1  …000b  public, tiktok @ R5 (2d)
--   F2  …000c  public, tiktok @ R5 (3d)
--   F3  …000d  public → FLIPPED PRIVATE mid-test, tiktok @ R5 (1d, most recent)
--   N1–N5 …000e–…0012  public, NON-QUALIFYING sources @ R6

-- 1. auth.users FIRST (FK chains; handle_new_user seeds profiles).
INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, now(), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', u.dn)
FROM (VALUES
  ('18900000-0000-4000-8000-000000000001'::uuid, 'v@socials-test.invalid',  'Socials Viewer'),
  ('18900000-0000-4000-8000-000000000002'::uuid, 's1@socials-test.invalid', 'S1 Pub TikTok'),
  ('18900000-0000-4000-8000-000000000003'::uuid, 's2@socials-test.invalid', 'S2 Pub IG'),
  ('18900000-0000-4000-8000-000000000004'::uuid, 's3@socials-test.invalid', 'S3 Flips Private'),
  ('18900000-0000-4000-8000-000000000005'::uuid, 's4@socials-test.invalid', 'S4 Priv Tablemate'),
  ('18900000-0000-4000-8000-000000000006'::uuid, 's5@socials-test.invalid', 'S5 Viewer Blocked'),
  ('18900000-0000-4000-8000-000000000007'::uuid, 's6@socials-test.invalid', 'S6 Blocks Viewer'),
  ('18900000-0000-4000-8000-000000000008'::uuid, 's7@socials-test.invalid', 'S7 Pub Month'),
  ('18900000-0000-4000-8000-000000000009'::uuid, 'p1@socials-test.invalid', 'P1 Pub'),
  ('18900000-0000-4000-8000-00000000000a'::uuid, 'p2@socials-test.invalid', 'P2 Pub'),
  ('18900000-0000-4000-8000-00000000000b'::uuid, 'f1@socials-test.invalid', 'F1 Pub'),
  ('18900000-0000-4000-8000-00000000000c'::uuid, 'f2@socials-test.invalid', 'F2 Pub'),
  ('18900000-0000-4000-8000-00000000000d'::uuid, 'f3@socials-test.invalid', 'F3 Flips Private'),
  ('18900000-0000-4000-8000-00000000000e'::uuid, 'n1@socials-test.invalid', 'N1 Video'),
  ('18900000-0000-4000-8000-00000000000f'::uuid, 'n2@socials-test.invalid', 'N2 Screenshot'),
  ('18900000-0000-4000-8000-000000000010'::uuid, 'n3@socials-test.invalid', 'N3 Vision'),
  ('18900000-0000-4000-8000-000000000011'::uuid, 'n4@socials-test.invalid', 'N4 Handoff'),
  ('18900000-0000-4000-8000-000000000012'::uuid, 'n5@socials-test.invalid', 'N5 Plain Web')
) AS u(id, email, dn)
ON CONFLICT (id) DO NOTHING;

-- 2. Profiles: everyone public EXCEPT S4 (private tablemate). S3/F3 start
--    public and flip later.
INSERT INTO public.profiles (user_id, display_name, account_privacy, username)
SELECT u.id, u.dn, u.priv, u.un
FROM (VALUES
  ('18900000-0000-4000-8000-000000000001'::uuid, 'Socials Viewer',    'public',  'soc_viewer'),
  ('18900000-0000-4000-8000-000000000002'::uuid, 'S1 Pub TikTok',     'public',  'soc_s1'),
  ('18900000-0000-4000-8000-000000000003'::uuid, 'S2 Pub IG',         'public',  'soc_s2'),
  ('18900000-0000-4000-8000-000000000004'::uuid, 'S3 Flips Private',  'public',  'soc_s3'),
  ('18900000-0000-4000-8000-000000000005'::uuid, 'S4 Priv Tablemate', 'private', 'soc_s4'),
  ('18900000-0000-4000-8000-000000000006'::uuid, 'S5 Viewer Blocked', 'public',  'soc_s5'),
  ('18900000-0000-4000-8000-000000000007'::uuid, 'S6 Blocks Viewer',  'public',  'soc_s6'),
  ('18900000-0000-4000-8000-000000000008'::uuid, 'S7 Pub Month',      'public',  'soc_s7'),
  ('18900000-0000-4000-8000-000000000009'::uuid, 'P1 Pub',            'public',  'soc_p1'),
  ('18900000-0000-4000-8000-00000000000a'::uuid, 'P2 Pub',            'public',  'soc_p2'),
  ('18900000-0000-4000-8000-00000000000b'::uuid, 'F1 Pub',            'public',  'soc_f1'),
  ('18900000-0000-4000-8000-00000000000c'::uuid, 'F2 Pub',            'public',  'soc_f2'),
  ('18900000-0000-4000-8000-00000000000d'::uuid, 'F3 Flips Private',  'public',  'soc_f3'),
  ('18900000-0000-4000-8000-00000000000e'::uuid, 'N1 Video',          'public',  'soc_n1'),
  ('18900000-0000-4000-8000-00000000000f'::uuid, 'N2 Screenshot',     'public',  'soc_n2'),
  ('18900000-0000-4000-8000-000000000010'::uuid, 'N3 Vision',         'public',  'soc_n3'),
  ('18900000-0000-4000-8000-000000000011'::uuid, 'N4 Handoff',        'public',  'soc_n4'),
  ('18900000-0000-4000-8000-000000000012'::uuid, 'N5 Plain Web',      'public',  'soc_n5')
) AS u(id, dn, priv, un)
ON CONFLICT (user_id) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  account_privacy = EXCLUDED.account_privacy,
  username        = EXCLUDED.username;

-- 3. Restaurants R1–R6.
INSERT INTO public.restaurants (id, name, city) VALUES
  ('18900000-aaaa-4000-8000-0000000000a1', 'Socials Matrix Ramen',   'Testville'),
  ('18900000-aaaa-4000-8000-0000000000a2', 'Self Exclusion Diner',   'Testville'),
  ('18900000-aaaa-4000-8000-0000000000a3', 'Tablemate Only Bar',     'Testville'),
  ('18900000-aaaa-4000-8000-0000000000a4', 'Blocked Only Bistro',    'Testville'),
  ('18900000-aaaa-4000-8000-0000000000a5', 'Flip Mid Read Cafe',     'Testville'),
  ('18900000-aaaa-4000-8000-0000000000a6', 'Non Qualifying Kitchen', 'Testville')
ON CONFLICT (id) DO NOTHING;

-- 4. Table T: V + S4 share it (the tablemate residual, closed by the module).
INSERT INTO public.tables (id, owner_id, name)
VALUES ('18900000-bbbb-4000-8000-0000000000b1', '18900000-0000-4000-8000-000000000001', 'Socials Shared T')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.table_members (table_id, member_id, role) VALUES
  ('18900000-bbbb-4000-8000-0000000000b1', '18900000-0000-4000-8000-000000000001', 'admin'),
  ('18900000-bbbb-4000-8000-0000000000b1', '18900000-0000-4000-8000-000000000005', 'member')
ON CONFLICT DO NOTHING;

-- 5. Blocks — one in EACH direction vs the viewer.
INSERT INTO public.blocked_users (blocker_id, blocked_id) VALUES
  ('18900000-0000-4000-8000-000000000001', '18900000-0000-4000-8000-000000000006'),  -- V blocked S5
  ('18900000-0000-4000-8000-000000000007', '18900000-0000-4000-8000-000000000001')   -- S6 blocked V
ON CONFLICT DO NOTHING;

-- 6. Saves. One row per (user, restaurant) — unique index.
INSERT INTO public.wishlist_items (user_id, restaurant_id, source, created_at) VALUES
  -- R1 — the main matrix.
  ('18900000-0000-4000-8000-000000000001', '18900000-aaaa-4000-8000-0000000000a1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@vv/video/111","author_handle":"vv"}'::jsonb,      now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000002', '18900000-aaaa-4000-8000-0000000000a1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s1/video/222","author_handle":"s1creator"}'::jsonb, now() - interval '2 days'),
  ('18900000-0000-4000-8000-000000000003', '18900000-aaaa-4000-8000-0000000000a1',
     '{"type":"web","url":"https://www.instagram.com/reel/ABC123/","author_handle":"s2creator"}'::jsonb,  now() - interval '3 days'),
  ('18900000-0000-4000-8000-000000000004', '18900000-aaaa-4000-8000-0000000000a1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s3/video/333"}'::jsonb,                             now() - interval '4 days'),
  ('18900000-0000-4000-8000-000000000005', '18900000-aaaa-4000-8000-0000000000a1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s4/video/444"}'::jsonb,                             now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000006', '18900000-aaaa-4000-8000-0000000000a1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s5/video/555"}'::jsonb,                             now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000007', '18900000-aaaa-4000-8000-0000000000a1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s6/video/666"}'::jsonb,                             now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000008', '18900000-aaaa-4000-8000-0000000000a1',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s7/video/777"}'::jsonb,                             now() - interval '20 days'),
  -- R2 — self-exclusion demote (V + P1 + P2, all public, all in 7d).
  ('18900000-0000-4000-8000-000000000001', '18900000-aaaa-4000-8000-0000000000a2',
     '{"type":"tiktok","url":"https://www.tiktok.com/@vv/video/888"}'::jsonb,                             now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000009', '18900000-aaaa-4000-8000-0000000000a2',
     '{"type":"tiktok","url":"https://www.tiktok.com/@p1/video/999"}'::jsonb,                             now() - interval '2 days'),
  ('18900000-0000-4000-8000-00000000000a', '18900000-aaaa-4000-8000-0000000000a2',
     '{"type":"tiktok","url":"https://www.tiktok.com/@p2/video/1010"}'::jsonb,                            now() - interval '3 days'),
  -- R3 — ONLY the private tablemate.
  ('18900000-0000-4000-8000-000000000005', '18900000-aaaa-4000-8000-0000000000a3',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s4/video/1111"}'::jsonb,                            now() - interval '1 day'),
  -- R4 — ONLY block-affected savers (one each direction).
  ('18900000-0000-4000-8000-000000000006', '18900000-aaaa-4000-8000-0000000000a4',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s5/video/1212"}'::jsonb,                            now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000007', '18900000-aaaa-4000-8000-0000000000a4',
     '{"type":"tiktok","url":"https://www.tiktok.com/@s6/video/1313"}'::jsonb,                            now() - interval '1 day'),
  -- R5 — the flip-between-cache-and-read matrix (F3 most recent → pre-flip rep).
  ('18900000-0000-4000-8000-00000000000b', '18900000-aaaa-4000-8000-0000000000a5',
     '{"type":"tiktok","url":"https://www.tiktok.com/@f1/video/1414","author_handle":"f1creator"}'::jsonb, now() - interval '2 days'),
  ('18900000-0000-4000-8000-00000000000c', '18900000-aaaa-4000-8000-0000000000a5',
     '{"type":"tiktok","url":"https://www.tiktok.com/@f2/video/1515"}'::jsonb,                            now() - interval '3 days'),
  ('18900000-0000-4000-8000-00000000000d', '18900000-aaaa-4000-8000-0000000000a5',
     '{"type":"tiktok","url":"https://www.tiktok.com/@f3/video/1616","author_handle":"f3creator"}'::jsonb, now() - interval '1 day'),
  -- R6 — non-qualifying sources ONLY (no verifiable platform URL / non-IG web).
  ('18900000-0000-4000-8000-00000000000e', '18900000-aaaa-4000-8000-0000000000a6',
     '{"type":"video"}'::jsonb,                                                                           now() - interval '1 day'),
  ('18900000-0000-4000-8000-00000000000f', '18900000-aaaa-4000-8000-0000000000a6',
     '{"type":"screenshot"}'::jsonb,                                                                      now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000010', '18900000-aaaa-4000-8000-0000000000a6',
     '{"type":"vision"}'::jsonb,                                                                          now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000011', '18900000-aaaa-4000-8000-0000000000a6',
     '{"type":"handoff","sharer_name":"Someone"}'::jsonb,                                                 now() - interval '1 day'),
  ('18900000-0000-4000-8000-000000000012', '18900000-aaaa-4000-8000-0000000000a6',
     '{"type":"web","url":"https://notinstagram.com/x"}'::jsonb,                                          now() - interval '1 day')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS
-- ─────────────────────────────────────────────────────────────────────────────
DO $spec$
DECLARE
  v_viewer uuid := '18900000-0000-4000-8000-000000000001';
  s3       uuid := '18900000-0000-4000-8000-000000000004';
  s4       uuid := '18900000-0000-4000-8000-000000000005';
  f1       uuid := '18900000-0000-4000-8000-00000000000b';
  f3       uuid := '18900000-0000-4000-8000-00000000000d';
  r1 uuid := '18900000-aaaa-4000-8000-0000000000a1';
  r2 uuid := '18900000-aaaa-4000-8000-0000000000a2';
  r3 uuid := '18900000-aaaa-4000-8000-0000000000a3';
  r4 uuid := '18900000-aaaa-4000-8000-0000000000a4';
  r5 uuid := '18900000-aaaa-4000-8000-0000000000a5';
  r6 uuid := '18900000-aaaa-4000-8000-0000000000a6';
  all_ids uuid[];
  v_int    int;
  v_int2   int;
  v_text   text;
  v_uuid   uuid;
  v_jsonb  jsonb;
BEGIN
  all_ids := ARRAY[r1, r2, r3, r4, r5, r6];

  -- ── fn_is_instagram_url parity fixtures (SQL side of SOCIAL_HOST_FIXTURES;
  --    keep byte-identical with _shared/socialHost.ts + socialHost.test.ts) ──
  ASSERT public.fn_is_instagram_url('https://instagram.com/reel/x') = true,           'FAIL [ig 1]';
  ASSERT public.fn_is_instagram_url('https://www.instagram.com/p/x') = true,          'FAIL [ig 2]';
  ASSERT public.fn_is_instagram_url('http://instagr.am/p/x') = true,                  'FAIL [ig 3]';
  ASSERT public.fn_is_instagram_url('https://m.instagram.com/p/x') = true,            'FAIL [ig 4]';
  ASSERT public.fn_is_instagram_url('https://instagram.com:443/reel/x') = true,       'FAIL [ig 5 — explicit port must be stripped]';
  ASSERT public.fn_is_instagram_url('https://user:pass@instagram.com/p/x') = true,    'FAIL [ig 6 — userinfo before a real IG host]';
  ASSERT public.fn_is_instagram_url('HTTPS://INSTAGRAM.COM/reel/x') = true,           'FAIL [ig 7 — case-insensitive]';
  ASSERT public.fn_is_instagram_url('instagram.com/reel/x') = false,                  'FAIL [ig 8 — scheme-less must be false]';
  ASSERT public.fn_is_instagram_url('https://instagram.com@evil.com/x') = false,      'FAIL [ig 9 — userinfo deception: host is evil.com]';
  ASSERT public.fn_is_instagram_url('https://notinstagram.com/x') = false,            'FAIL [ig 10 — substring trap]';
  ASSERT public.fn_is_instagram_url('https://example.com/?next=instagram.com/x') = false, 'FAIL [ig 11 — IG only in query]';
  ASSERT public.fn_is_instagram_url('https://instagram.com.evil.com/x') = false,      'FAIL [ig 12 — suffix spoof]';
  ASSERT public.fn_is_instagram_url('https://tiktok.com/@x/video/1') = false,         'FAIL [ig 13 — wrong platform]';
  ASSERT public.fn_is_instagram_url('ftp://instagram.com/p/x') = false,               'FAIL [ig 14 — non-http scheme]';
  ASSERT public.fn_is_instagram_url('instagramXcom') = false,                         'FAIL [ig 15 — garbage]';
  ASSERT public.fn_is_instagram_url('https://') = false,                              'FAIL [ig 16 — empty authority]';
  ASSERT public.fn_is_instagram_url('') = false,                                      'FAIL [ig 17 — empty string]';
  ASSERT public.fn_is_instagram_url(NULL) = false,                                    'FAIL [ig 18 — NULL]';

  -- ── Stage 1 (viewer-agnostic compute) — gating facts ──────────────────────
  -- R1: public savers V,S1,S2,S3,S5,S6,S7 = 7 in 30d, 6 in 7d (S7 is 20d out);
  -- S4 (private) and every video/screenshot row are excluded.
  SELECT c.k7, c.k30 INTO v_int, v_int2
  FROM public.fn_compute_socials_candidates() c WHERE c.restaurant_id = r1;
  ASSERT v_int = 6,
    format('FAIL [stage1 R1 k7]: expected 6 public savers in 7d, got %s', v_int);
  ASSERT v_int2 = 7,
    format('FAIL [stage1 R1 k30]: expected 7 public savers in 30d (private tablemate excluded), got %s', v_int2);

  SELECT c.platform_7d INTO v_text
  FROM public.fn_compute_socials_candidates() c WHERE c.restaurant_id = r1;
  ASSERT v_text = 'mixed',
    format('FAIL [stage1 R1 platform_7d]: tiktok + IG in window → mixed, got %L', v_text);

  -- R6 (non-qualifying sources only) must be ABSENT from the candidate set.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_compute_socials_candidates() c WHERE c.restaurant_id = r6
  ), 'FAIL [stage1 R6]: video/screenshot/vision/handoff/non-IG-web rows must never qualify';

  -- R2 stage-1 k7 = 3 (V + P1 + P2 — the viewer''s own save DOES feed the
  -- viewer-agnostic cache; the self-exclusion happens in stage 2).
  SELECT c.k7 INTO v_int
  FROM public.fn_compute_socials_candidates() c WHERE c.restaurant_id = r2;
  ASSERT v_int = 3,
    format('FAIL [stage1 R2 k7]: expected 3 (viewer included pre-exclusion), got %s', v_int);

  -- ── Warm the cache (pre-flip), then flip S3 + F3 private ──────────────────
  v_jsonb := public.fn_get_socials_candidates();
  SELECT (elem->>'k7')::int INTO v_int
  FROM jsonb_array_elements(v_jsonb) elem
  WHERE elem->>'restaurant_id' = r5::text;
  ASSERT v_int = 3,
    format('FAIL [cache R5 k7 pre-flip]: expected 3, got %s', v_int);

  UPDATE public.profiles SET account_privacy = 'private' WHERE user_id IN (s3, f3);

  -- The stale cache still serves the pre-flip candidate facts (1h TTL) —
  -- proving the flip really happened BETWEEN cache and read…
  v_jsonb := public.fn_get_socials_candidates();
  SELECT (elem->>'k7')::int INTO v_int
  FROM jsonb_array_elements(v_jsonb) elem
  WHERE elem->>'restaurant_id' = r5::text;
  ASSERT v_int = 3,
    format('FAIL [cache R5 k7 post-flip]: stale cache expected to still say 3, got %s', v_int);

  -- ── Stage 2 (viewer pass) — the four privacy tests ─────────────────────────
  -- (c) FLIP: R5 live k7 = 2 (F3 dropped by the live fn_public_account
  --     re-check), and the representative clip is re-picked (never F3''s).
  SELECT p.k7, p.rep_saver_id INTO v_int, v_uuid
  FROM public.fn_socials_viewer_pass(v_viewer, all_ids) p WHERE p.restaurant_id = r5;
  ASSERT v_int = 2,
    format('FAIL [flip R5 k7]: expected 2 after the live private flip, got %s', v_int);
  ASSERT v_uuid <> f3,
    'FAIL [flip R5 rep]: the flipped-private saver''s clip must not be the representative';
  ASSERT v_uuid = f1,
    format('FAIL [flip R5 rep pick]: expected F1 (most recent surviving), got %s', v_uuid);

  -- (d) SELF-EXCLUSION: R2 k7 demotes 3 → 2, and the rep is never the viewer.
  SELECT p.k7, p.rep_saver_id INTO v_int, v_uuid
  FROM public.fn_socials_viewer_pass(v_viewer, all_ids) p WHERE p.restaurant_id = r2;
  ASSERT v_int = 2,
    format('FAIL [self R2 k7]: expected 2 (k recomputed post-exclusion), got %s', v_int);
  ASSERT v_uuid <> v_viewer,
    'FAIL [self R2 rep]: the viewer''s own clip must never be the representative';

  -- (b) PRIVATE TABLEMATE: 155 returns S4''s save at R3 (relationship
  --     tablemate — it IS visible on the restaurant page)…
  SELECT v.relationship INTO v_text
  FROM public.fn_restaurant_saves_visible(v_viewer, r3) v WHERE v.saver_id = s4;
  ASSERT v_text = 'tablemate',
    format('FAIL [tablemate 155]: expected 155 to return the tablemate row, got %L', v_text);
  -- …but the socials module aggregates PUBLIC savers only → NO row for R3.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_socials_viewer_pass(v_viewer, all_ids) p WHERE p.restaurant_id = r3
  ), 'FAIL [tablemate module]: a private tablemate''s save must never feed the module';

  -- (a) BLOCKS (both directions): R4 has only block-affected savers → NO row;
  --     neither a count contribution nor a representative clip survives.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_socials_viewer_pass(v_viewer, all_ids) p WHERE p.restaurant_id = r4
  ), 'FAIL [blocks R4]: block in either direction must drop the saver from counts AND clips';

  -- R1 combined: post-flip survivors are S1 (tiktok 2d), S2 (IG 3d), S7
  -- (tiktok 20d) — V self-excluded, S4 private, S5/S6 blocked, S3 flipped.
  SELECT p.k7, p.k30 INTO v_int, v_int2
  FROM public.fn_socials_viewer_pass(v_viewer, all_ids) p WHERE p.restaurant_id = r1;
  ASSERT v_int = 2,
    format('FAIL [R1 k7]: expected 2 (S1+S2), got %s', v_int);
  ASSERT v_int2 = 3,
    format('FAIL [R1 k30]: expected 3 (S1+S2+S7), got %s', v_int2);

  SELECT p.platform_7d INTO v_text
  FROM public.fn_socials_viewer_pass(v_viewer, all_ids) p WHERE p.restaurant_id = r1;
  ASSERT v_text = 'mixed',
    format('FAIL [R1 platform_7d]: surviving 7d rows are tiktok+IG → mixed, got %L', v_text);

  SELECT p.rep_saver_id INTO v_uuid
  FROM public.fn_socials_viewer_pass(v_viewer, all_ids) p WHERE p.restaurant_id = r1;
  ASSERT v_uuid = '18900000-0000-4000-8000-000000000002',
    format('FAIL [R1 rep]: expected S1 (most recent SURVIVING clip), got %s', v_uuid);

  -- R6 in the viewer pass: non-qualifying sources → no row.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_socials_viewer_pass(v_viewer, all_ids) p WHERE p.restaurant_id = r6
  ), 'FAIL [R6 pass]: non-qualifying sources must never produce a module row';

  RAISE NOTICE 'PASS socials_privacy: IG parity table + stage-1 gating + blocks/tablemate/flip/self-exclusion';
END;
$spec$;

ROLLBACK;
