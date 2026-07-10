-- TICKET-155 — fn_restaurant_saves_visible five-row visibility matrix.
--
-- The mandatory CI predicate test. Seeds a self-contained fixture and asserts
-- every visibility row the AC pins:
--   1. public stranger        → VISIBLE   (relationship = 'stranger')
--   2. private stranger       → INVISIBLE
--   3. private tablemate      → VISIBLE   (relationship = 'tablemate'), source
--                               SANITIZED (allowlist kept, raw caption/embed stripped)
--   4. block, either direction→ INVISIBLE (viewer→saver AND saver→viewer)
--   5. self                   → VISIBLE   (relationship = 'self'), source RAW,
--                               even though the viewer's OWN account is private
-- Plus: source IS NULL → NULL (ARCH-REVIEW N2), and a total-count invariant.
--
-- ── ARCH-REVIEW W1 (MANDATORY): seed auth.users FIRST ────────────────────────
-- Every fixture user is inserted into auth.users BEFORE any profiles / tables /
-- table_members / wishlist_items / blocked_users row, because those tables carry
-- FK chains to auth.users(id). The design's "no auth users needed" claim was
-- false — without this the replay job dies on the first FK violation. Inserting
-- auth.users also fires handle_new_user() (AFTER INSERT trigger) which auto-seeds
-- a profiles + value_profiles row per user; we then UPSERT profiles to set
-- account_privacy / username. (The pre-existing entry_tables_leak.spec.sql is NOT
-- a working precedent — it is never executed by any workflow and, seeding
-- profiles without auth.users, would itself fail an FK check.)
--
-- Reachability coverage note: this file also stands as the CI coverage for the
-- reachable-private-stub branch per the AC — the stub's logic (private + no
-- shared Table + no block → visible identity, no palate) is the same
-- relationship computation the self / tablemate / stranger rows exercise here.
-- The edge-fn payload SHAPE is separately covered by index.test.ts (ARCH-REVIEW W2).
--
-- Run:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/saves_visible_predicate.spec.sql

BEGIN;

-- Fixed fixture UUIDs.
--   V     viewer            (private account — proves self-visibility ignores own privacy)
--   S_pub public stranger   (no Table, no follow, no block → visible)
--   S_prv private stranger  (private, no Table → invisible)
--   S_tm  private tablemate (private, shares Table T with V → visible, sanitized)
--   S_bbv public, VIEWER blocked them        → invisible (block dir: viewer→saver)
--   S_bv  public, they blocked THE VIEWER     → invisible (block dir: saver→viewer)

-- 1. auth.users FIRST (W1). handle_new_user() auto-creates profiles + value_profiles.
INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', '55550000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'v@saves-test.invalid',      now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Viewer V"}'),
  ('00000000-0000-0000-0000-000000000000', '55551111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'pub@saves-test.invalid',    now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Pub Stranger"}'),
  ('00000000-0000-0000-0000-000000000000', '55552222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'prv@saves-test.invalid',    now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Priv Stranger"}'),
  ('00000000-0000-0000-0000-000000000000', '55553333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'tm@saves-test.invalid',     now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Priv Tablemate"}'),
  ('00000000-0000-0000-0000-000000000000', '55554444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'bbv@saves-test.invalid',    now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Blocked By Viewer"}'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'bv@saves-test.invalid',     now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Blocked The Viewer"}')
ON CONFLICT (id) DO NOTHING;

-- 2. Profiles: set account_privacy + username (display_name already seeded by trigger).
INSERT INTO public.profiles (user_id, display_name, account_privacy, username)
VALUES
  ('55550000-0000-0000-0000-000000000000', 'Viewer V',        'private', 'viewer_v'),
  ('55551111-1111-1111-1111-111111111111', 'Pub Stranger',    'public',  'pub_stranger'),
  ('55552222-2222-2222-2222-222222222222', 'Priv Stranger',   'private', 'priv_stranger'),
  ('55553333-3333-3333-3333-333333333333', 'Priv Tablemate',  'private', 'priv_tablemate'),
  ('55554444-4444-4444-4444-444444444444', 'Blocked By View', 'public',  'blocked_bv'),
  ('55555555-5555-5555-5555-555555555555', 'Blocked Viewer',  'public',  'blocked_v')
ON CONFLICT (user_id) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  account_privacy = EXCLUDED.account_privacy,
  username        = EXCLUDED.username;

-- 3. Restaurant R.
INSERT INTO public.restaurants (id, name, city)
VALUES ('5555aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Predicate Ramen', 'Testville')
ON CONFLICT (id) DO NOTHING;

-- 4. Table T (V + S_tm share it).
INSERT INTO public.tables (id, owner_id, name)
VALUES ('5555bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55550000-0000-0000-0000-000000000000', 'Shared T')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.table_members (table_id, member_id, role) VALUES
  ('5555bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55550000-0000-0000-0000-000000000000', 'admin'),
  ('5555bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '55553333-3333-3333-3333-333333333333', 'member')
ON CONFLICT DO NOTHING;

-- 5. Saves at R.
--    - V (self): tiktok WITH a raw caption → self must see it RAW.
--    - S_pub: NULL source → result source must be NULL (N2).
--    - S_tm (tablemate): tiktok carrying allowlisted fields (url/author_handle/
--      author_name/thumbnail_url) AND raw withheld fields (caption,
--      embed_product_id) inserted directly to bypass the write-time validator —
--      the RPC must KEEP the allowlist and STRIP the withheld keys.
--    - S_prv / S_bbv / S_bv: NULL source (invisible regardless).
INSERT INTO public.wishlist_items (user_id, restaurant_id, source) VALUES
  ('55550000-0000-0000-0000-000000000000', '5555aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '{"type":"tiktok","url":"https://tiktok.com/@me/video/999","caption":"my private raw caption"}'::jsonb),
  ('55551111-1111-1111-1111-111111111111', '5555aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL),
  ('55552222-2222-2222-2222-222222222222', '5555aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL),
  ('55553333-3333-3333-3333-333333333333', '5555aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     '{"type":"tiktok","url":"https://tiktok.com/@chef/video/123","author_handle":"@chef","author_name":"Chef Name","thumbnail_url":"https://cdn.tiktok.test/thumb.jpg","embed_product_id":"SECRET_PRODUCT_ID","caption":"raw secret caption text"}'::jsonb),
  ('55554444-4444-4444-4444-444444444444', '5555aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL),
  ('55555555-5555-5555-5555-555555555555', '5555aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL)
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- 6. Blocks — one in EACH direction vs the viewer V.
INSERT INTO public.blocked_users (blocker_id, blocked_id) VALUES
  ('55550000-0000-0000-0000-000000000000', '55554444-4444-4444-4444-444444444444'),  -- V blocked S_bbv
  ('55555555-5555-5555-5555-555555555555', '55550000-0000-0000-0000-000000000000')   -- S_bv blocked V
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS — call the RPC as p_viewer = V, p_restaurant_id = R.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_viewer  uuid := '55550000-0000-0000-0000-000000000000';
  v_rest    uuid := '5555aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  s_pub     uuid := '55551111-1111-1111-1111-111111111111';
  s_prv     uuid := '55552222-2222-2222-2222-222222222222';
  s_tm      uuid := '55553333-3333-3333-3333-333333333333';
  s_bbv     uuid := '55554444-4444-4444-4444-444444444444';
  s_bv      uuid := '55555555-5555-5555-5555-555555555555';
  v_count   int;
  v_rel     text;
  v_src     jsonb;
BEGIN
  -- Row 1: public stranger VISIBLE as 'stranger'.
  SELECT relationship INTO v_rel
  FROM public.fn_restaurant_saves_visible(v_viewer, v_rest) WHERE saver_id = s_pub;
  ASSERT v_rel = 'stranger',
    format('FAIL [public-stranger]: expected relationship=stranger, got %L', v_rel);

  -- N2: the public stranger saved with a NULL source → result source stays NULL (not {}).
  SELECT source INTO v_src
  FROM public.fn_restaurant_saves_visible(v_viewer, v_rest) WHERE saver_id = s_pub;
  ASSERT v_src IS NULL,
    format('FAIL [N2 null source]: expected NULL source, got %L', v_src);

  -- Row 2: private stranger INVISIBLE.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_restaurant_saves_visible(v_viewer, v_rest) WHERE saver_id = s_prv
  ), 'FAIL [private-stranger]: private, non-tablemate saver must be invisible';

  -- Row 3: private tablemate VISIBLE as 'tablemate', source SANITIZED.
  SELECT relationship, source INTO v_rel, v_src
  FROM public.fn_restaurant_saves_visible(v_viewer, v_rest) WHERE saver_id = s_tm;
  ASSERT v_rel = 'tablemate',
    format('FAIL [private-tablemate]: expected relationship=tablemate, got %L', v_rel);
  ASSERT v_src IS NOT NULL, 'FAIL [tablemate source]: sanitized source must be present';
  ASSERT v_src->>'type' = 'tiktok',
    format('FAIL [tablemate source.type]: expected tiktok, got %L', v_src->>'type');
  ASSERT v_src->>'url' IS NOT NULL, 'FAIL [tablemate source.url]: url must survive';
  ASSERT v_src->>'author_handle' = '@chef', 'FAIL [tablemate source.author_handle]: allowlisted field must survive';
  ASSERT v_src->>'author_name' = 'Chef Name', 'FAIL [tablemate source.author_name]: allowlisted field must survive';
  ASSERT v_src->>'thumbnail_url' IS NOT NULL, 'FAIL [tablemate source.thumbnail_url]: allowlisted (ephemeral) field must survive';
  -- Raw withheld fields MUST be stripped.
  ASSERT v_src->>'caption' IS NULL,
    format('FAIL [tablemate source.caption LEAK]: raw caption must be stripped, got %L', v_src->>'caption');
  ASSERT v_src->>'embed_product_id' IS NULL,
    format('FAIL [tablemate source.embed_product_id LEAK]: raw field must be stripped, got %L', v_src->>'embed_product_id');
  -- The sanitized object carries ONLY the allowlist keys (5 max; here 5 present).
  ASSERT (SELECT count(*) FROM jsonb_object_keys(v_src)) = 5,
    format('FAIL [tablemate source keys]: expected exactly 5 allowlist keys, got %s', (SELECT count(*) FROM jsonb_object_keys(v_src)));

  -- Row 4: block in EITHER direction → INVISIBLE.
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_restaurant_saves_visible(v_viewer, v_rest) WHERE saver_id = s_bbv
  ), 'FAIL [block viewer->saver]: viewer-blocked saver must be invisible';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.fn_restaurant_saves_visible(v_viewer, v_rest) WHERE saver_id = s_bv
  ), 'FAIL [block saver->viewer]: saver-who-blocked-viewer must be invisible (the blocked_users-RLS trap)';

  -- Row 5: self VISIBLE as 'self', source RAW — even though V's own account is private.
  SELECT relationship, source INTO v_rel, v_src
  FROM public.fn_restaurant_saves_visible(v_viewer, v_rest) WHERE saver_id = v_viewer;
  ASSERT v_rel = 'self',
    format('FAIL [self]: expected relationship=self, got %L', v_rel);
  ASSERT v_src->>'caption' = 'my private raw caption',
    format('FAIL [self source raw]: self must see RAW source (caption kept), got %L', v_src->>'caption');

  -- Invariant: exactly 3 rows visible to V — self + public stranger + private tablemate.
  SELECT count(*) INTO v_count FROM public.fn_restaurant_saves_visible(v_viewer, v_rest);
  ASSERT v_count = 3,
    format('FAIL [count]: expected exactly 3 visible saves (self + public stranger + private tablemate), got %s', v_count);

  RAISE NOTICE 'PASS saves_visible_predicate: all 5 visibility rows + N2 + sanitization + count invariant';
END;
$$;

ROLLBACK;
