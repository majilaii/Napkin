-- Account deletion cascade: the auth.users delete must sweep clean when it is
-- issued the way GoTrue issues it, as supabase_auth_admin.
--
-- Why this spec exists (2026-09-09): the App Review recording's "delete
-- account" step left the account alive in prod. GoTrue's
--   DELETE FROM auth.users WHERE id = $1
-- cascades into public.entries; PostgreSQL runs the cascade DELETE as the
-- table owner but queues the entries AFTER DELETE triggers with
-- fire_triggers=false, so they fire at the end of the OUTER statement as the
-- session user, supabase_auth_admin. That role has no grant on public tables,
-- so a SECURITY INVOKER trigger body fails with 42501 and the whole delete
-- aborts. 20260909120000 makes the six table-touching trigger functions on
-- that path SECURITY DEFINER.
--
-- Test 0 proves the spec bites: with the observed function flipped back to
-- SECURITY INVOKER inside a savepoint, the delete raises insufficient_privilege.
-- Tests 1-6 run the delete under the migrated definitions and assert every
-- path the migration names: post interactions swept (1), reaction/reply counts
-- and comment like counts resynced on the surviving user's rows (2, 3), list
-- touch on the SET NULL of list_entries.added_by (4), Table-shared entry at
-- the deleted host's supper updated without the entry_tables mirror insert
-- failing (5), and the auth row itself gone (6).
--
-- Runs after all repository migrations, against the CI replay database, and
-- needs a SUPERUSER session: it SET ROLEs to supabase_auth_admin and grants
-- on auth.users. In the Supabase image that is `supabase_admin`, not
-- `postgres` (which is a plain CREATEROLE member of the API roles and gets
-- "permission denied to set role"). Everything is rolled back at the end.
--
-- Run with:
--   psql "postgresql://supabase_admin:postgres@127.0.0.1:54329/postgres" \
--     -v ON_ERROR_STOP=1 -f supabase/tests/account_deletion_cascade.spec.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED
--   A (ad0a…) is deleted. B (ad0b…) survives and owns the rows A's deletion
--   must touch but not destroy.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, now(), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', u.dn)
FROM (VALUES
  ('ad0a0000-0000-0000-0000-00000000000a'::uuid, 'deleted@account-deletion-test.invalid', 'Deleted'),
  ('ad0b0000-0000-0000-0000-00000000000b'::uuid, 'peer@account-deletion-test.invalid',    'Peer')
) AS u(id, email, dn)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (user_id, display_name, account_privacy)
VALUES
  ('ad0a0000-0000-0000-0000-00000000000a', 'Deleted', 'public'),
  ('ad0b0000-0000-0000-0000-00000000000b', 'Peer',    'public')
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.restaurants (id, name, city)
VALUES ('ad0c0000-0000-0000-0000-00000000000c', 'Cascade test kitchen', 'Testville');

-- B's Table, A is a member. Needed for the Table-shared entry in Test 5.
INSERT INTO public.tables (id, owner_id, name)
VALUES ('ad0d0000-0000-0000-0000-00000000000d', 'ad0b0000-0000-0000-0000-00000000000b', 'Peer table');
INSERT INTO public.table_members (table_id, member_id, role) VALUES
  ('ad0d0000-0000-0000-0000-00000000000d', 'ad0b0000-0000-0000-0000-00000000000b', 'admin'),
  ('ad0d0000-0000-0000-0000-00000000000d', 'ad0a0000-0000-0000-0000-00000000000a', 'member');

-- A hosts a supper; B's Table-shared entry sits at it (entries.supper_id is
-- ON DELETE SET NULL, and the SET NULL is an UPDATE that fires the AFTER
-- UPDATE entry_tables mirror trigger).
INSERT INTO public.suppers (id, restaurant_id, host_user_id)
VALUES ('ad0e0000-0000-0000-0000-00000000000e', 'ad0c0000-0000-0000-0000-00000000000c', 'ad0a0000-0000-0000-0000-00000000000a');

INSERT INTO public.entries (id, user_id, restaurant_id, rating, content, visibility, table_id, supper_id) VALUES
  -- EA: A's own entry. B reacts to and replies on it.
  ('ad010000-0000-0000-0000-0000000000a1', 'ad0a0000-0000-0000-0000-00000000000a', 'ad0c0000-0000-0000-0000-00000000000c', 4,
   'Entry by the account that will be deleted', 'friends', NULL, NULL),
  -- EB: B's feed entry. A reacts to it and likes B's reply on it.
  ('ad010000-0000-0000-0000-0000000000b1', 'ad0b0000-0000-0000-0000-00000000000b', 'ad0c0000-0000-0000-0000-00000000000c', 4,
   'Entry by the surviving peer', 'friends', NULL, NULL),
  -- EBT: B's Table-shared entry at A's supper.
  ('ad010000-0000-0000-0000-0000000000b2', 'ad0b0000-0000-0000-0000-00000000000b', 'ad0c0000-0000-0000-0000-00000000000c', 4,
   'Table entry by the surviving peer at the deleted host''s supper', 'table',
   'ad0d0000-0000-0000-0000-00000000000d', 'ad0e0000-0000-0000-0000-00000000000e');

INSERT INTO public.post_reactions (target_type, target_id, user_id, emoji, scope) VALUES
  ('entry', 'ad010000-0000-0000-0000-0000000000a1', 'ad0b0000-0000-0000-0000-00000000000b', '❤️', 'public'),
  ('entry', 'ad010000-0000-0000-0000-0000000000b1', 'ad0a0000-0000-0000-0000-00000000000a', '❤️', 'public');

INSERT INTO public.post_comments (id, target_type, target_id, user_id, body, scope) VALUES
  ('ad020000-0000-0000-0000-0000000000c1', 'entry', 'ad010000-0000-0000-0000-0000000000a1', 'ad0b0000-0000-0000-0000-00000000000b', 'Reply by B on A''s entry', 'public'),
  ('ad020000-0000-0000-0000-0000000000c2', 'entry', 'ad010000-0000-0000-0000-0000000000b1', 'ad0b0000-0000-0000-0000-00000000000b', 'Reply by B on B''s own entry', 'public');

INSERT INTO public.post_comment_likes (comment_id, user_id)
VALUES ('ad020000-0000-0000-0000-0000000000c2', 'ad0a0000-0000-0000-0000-00000000000a');

-- B's list with a spot A added. updated_at is pinned in the past so the
-- touch trigger's now() is observable inside this transaction.
INSERT INTO public.lists (id, owner_id, title, privacy, updated_at)
VALUES ('ad030000-0000-0000-0000-0000000000d1', 'ad0b0000-0000-0000-0000-00000000000b', 'Peer list', 'public', '2020-01-01T00:00:00Z');
INSERT INTO public.list_entries (list_id, restaurant_id, added_by)
VALUES ('ad030000-0000-0000-0000-0000000000d1', 'ad0c0000-0000-0000-0000-00000000000c', 'ad0a0000-0000-0000-0000-00000000000a');
UPDATE public.lists SET updated_at = '2020-01-01T00:00:00Z' WHERE id = 'ad030000-0000-0000-0000-0000000000d1';

-- Seed sanity: the count-sync triggers ran on insert, so the surviving rows
-- carry the counters the deletion must later bring back down.
DO $seed$
BEGIN
  ASSERT (SELECT public_reaction_count FROM public.entries WHERE id = 'ad010000-0000-0000-0000-0000000000b1') = 1,
    'seed: EB.public_reaction_count should be 1';
  ASSERT (SELECT public_reply_count FROM public.entries WHERE id = 'ad010000-0000-0000-0000-0000000000b1') = 1,
    'seed: EB.public_reply_count should be 1';
  ASSERT (SELECT like_count FROM public.post_comments WHERE id = 'ad020000-0000-0000-0000-0000000000c2') = 1,
    'seed: CB2.like_count should be 1';
  ASSERT EXISTS (SELECT 1 FROM public.entry_tables WHERE entry_id = 'ad010000-0000-0000-0000-0000000000b2'
                   AND table_id = 'ad0d0000-0000-0000-0000-00000000000d'),
    'seed: EBT should be mirrored into entry_tables';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.cascade_delete_post_interactions_extended()'::regprocedure),
    'seed: cascade_delete_post_interactions_extended must be SECURITY DEFINER after 20260909120000';
END;
$seed$;

-- GoTrue's role. In prod it owns auth.users; the replay image may or may not,
-- so the grant below is a no-op there and a harness aid here. It confers
-- nothing on public.*, which is the whole point of the test.
GRANT SELECT, DELETE ON auth.users TO supabase_auth_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 0: the spec bites. Flip the observed function back to SECURITY INVOKER
-- inside a savepoint and the GoTrue-style delete must raise 42501.
-- ─────────────────────────────────────────────────────────────────────────────
SAVEPOINT invoker_repro;
ALTER FUNCTION public.cascade_delete_post_interactions_extended() SECURITY INVOKER;
SET LOCAL ROLE supabase_auth_admin;
DO $t0$
BEGIN
  DELETE FROM auth.users WHERE id = 'ad0a0000-0000-0000-0000-00000000000a';
  RAISE EXCEPTION 'TEST 0 FAILED: delete succeeded under SECURITY INVOKER; the spec no longer reproduces the defect';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'TEST 0 PASSED: SECURITY INVOKER reproduces 42501 (%)', SQLERRM;
END;
$t0$;
RESET ROLE;
ROLLBACK TO SAVEPOINT invoker_repro;

DO $t0b$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM auth.users WHERE id = 'ad0a0000-0000-0000-0000-00000000000a'),
    'TEST 0: the failed delete must have left the auth row in place';
  ASSERT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.cascade_delete_post_interactions_extended()'::regprocedure),
    'TEST 0: savepoint rollback must restore SECURITY DEFINER';
END;
$t0b$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TESTS 1-6: the migrated definitions sweep clean as supabase_auth_admin.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE supabase_auth_admin;
DELETE FROM auth.users WHERE id = 'ad0a0000-0000-0000-0000-00000000000a';
RESET ROLE;

DO $t1$
BEGIN
  -- 1. cascade_delete_post_interactions_extended: B's reaction and reply on
  --    A's entry are gone with the entry.
  ASSERT NOT EXISTS (SELECT 1 FROM public.entries WHERE id = 'ad010000-0000-0000-0000-0000000000a1'),
    'TEST 1: A''s entry must be deleted';
  ASSERT NOT EXISTS (SELECT 1 FROM public.post_reactions WHERE target_id = 'ad010000-0000-0000-0000-0000000000a1'),
    'TEST 1: reactions on A''s entry must be swept';
  ASSERT NOT EXISTS (SELECT 1 FROM public.post_comments WHERE target_id = 'ad010000-0000-0000-0000-0000000000a1'),
    'TEST 1: replies on A''s entry must be swept';
  RAISE NOTICE 'TEST 1 PASSED: post interactions on the deleted user''s entry swept';

  -- 2. sync_post_counts_and_top_emojis: A's reaction on B's entry cascaded
  --    away and B's counters were resynced.
  ASSERT NOT EXISTS (SELECT 1 FROM public.post_reactions WHERE user_id = 'ad0a0000-0000-0000-0000-00000000000a'),
    'TEST 2: A''s own reactions must cascade';
  ASSERT (SELECT public_reaction_count FROM public.entries WHERE id = 'ad010000-0000-0000-0000-0000000000b1') = 0,
    'TEST 2: EB.public_reaction_count must resync to 0';
  ASSERT (SELECT public_reply_count FROM public.entries WHERE id = 'ad010000-0000-0000-0000-0000000000b1') = 1,
    'TEST 2: EB.public_reply_count must stay 1 (B''s own reply survives)';
  RAISE NOTICE 'TEST 2 PASSED: reaction counters resynced on the surviving entry';

  -- 3. sync_comment_like_count: A's like on B's reply cascaded away and the
  --    reply's like_count was resynced.
  ASSERT NOT EXISTS (SELECT 1 FROM public.post_comment_likes WHERE user_id = 'ad0a0000-0000-0000-0000-00000000000a'),
    'TEST 3: A''s comment likes must cascade';
  ASSERT (SELECT like_count FROM public.post_comments WHERE id = 'ad020000-0000-0000-0000-0000000000c2') = 0,
    'TEST 3: CB2.like_count must resync to 0';
  RAISE NOTICE 'TEST 3 PASSED: comment like counter resynced';

  -- 4. touch_list_updated_at: list_entries.added_by SET NULL is an UPDATE
  --    that touches the list; the list and its spot survive.
  ASSERT EXISTS (SELECT 1 FROM public.lists WHERE id = 'ad030000-0000-0000-0000-0000000000d1'),
    'TEST 4: B''s list must survive';
  ASSERT (SELECT added_by FROM public.list_entries WHERE list_id = 'ad030000-0000-0000-0000-0000000000d1') IS NULL,
    'TEST 4: list_entries.added_by must be set to NULL';
  ASSERT (SELECT updated_at FROM public.lists WHERE id = 'ad030000-0000-0000-0000-0000000000d1') > '2020-01-01T00:00:00Z',
    'TEST 4: the list must be touched by the SET NULL update';
  RAISE NOTICE 'TEST 4 PASSED: list touched on added_by SET NULL';

  -- 5. fn_entries_mirror_table_id_to_join: the supper is gone, B's Table
  --    entry lost its supper_id, and the AFTER UPDATE mirror insert
  --    (ON CONFLICT DO NOTHING) did not fail.
  ASSERT NOT EXISTS (SELECT 1 FROM public.suppers WHERE id = 'ad0e0000-0000-0000-0000-00000000000e'),
    'TEST 5: the deleted host''s supper must cascade';
  ASSERT (SELECT supper_id FROM public.entries WHERE id = 'ad010000-0000-0000-0000-0000000000b2') IS NULL,
    'TEST 5: EBT.supper_id must be set to NULL';
  ASSERT EXISTS (SELECT 1 FROM public.entry_tables WHERE entry_id = 'ad010000-0000-0000-0000-0000000000b2'
                   AND table_id = 'ad0d0000-0000-0000-0000-00000000000d'),
    'TEST 5: EBT must keep its entry_tables mirror';
  RAISE NOTICE 'TEST 5 PASSED: Table-shared entry at the deleted host''s supper survives';

  -- 6. The auth row and profile are gone; the peer is untouched.
  ASSERT NOT EXISTS (SELECT 1 FROM auth.users WHERE id = 'ad0a0000-0000-0000-0000-00000000000a'),
    'TEST 6: A''s auth.users row must be deleted';
  ASSERT NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = 'ad0a0000-0000-0000-0000-00000000000a'),
    'TEST 6: A''s profile must cascade';
  ASSERT EXISTS (SELECT 1 FROM auth.users WHERE id = 'ad0b0000-0000-0000-0000-00000000000b'),
    'TEST 6: B''s auth.users row must survive';
  ASSERT (SELECT count(*) FROM public.entries WHERE user_id = 'ad0b0000-0000-0000-0000-00000000000b') = 2,
    'TEST 6: B''s two entries must survive';
  RAISE NOTICE 'TEST 6 PASSED: auth row gone, peer intact';
END;
$t1$;

ROLLBACK;

DO $done$
BEGIN
  RAISE NOTICE 'All account deletion cascade tests passed.';
END;
$done$;
