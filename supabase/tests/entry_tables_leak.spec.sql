-- TICKET-043: entry_tables leak-prevention test suite
--
-- Validates the core privacy invariant: a member of Table B must NEVER learn
-- that an entry is also posted to Table A, even when entries.table_id = A (legacy).
--
-- Run after all repository migrations are applied. The spec self-seeds these
-- three auth users and their profiles:
--   A (Alice): 11111111-1111-1111-1111-111111111111
--   B (Bob):   22222222-2222-2222-2222-222222222222
--   C (Carol): 33333333-3333-3333-3333-333333333333
--
-- Run with:
--   psql "$DATABASE_URL" -f supabase/tests/entry_tables_leak.spec.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- Fixture users. Replay databases start with auth.users empty, and profiles
-- has a foreign key to auth.users(id), so this seed must precede profiles.
INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, now(), now(), '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', u.dn)
FROM (VALUES
  ('11111111-1111-1111-1111-111111111111'::uuid, 'alice@entry-tables-test.invalid', 'Alice'),
  ('22222222-2222-2222-2222-222222222222'::uuid, 'bob@entry-tables-test.invalid', 'Bob'),
  ('33333333-3333-3333-3333-333333333333'::uuid, 'carol@entry-tables-test.invalid', 'Carol')
) AS u(id, email, dn)
ON CONFLICT (id) DO NOTHING;

-- Ensure profiles exist (idempotent merge).
INSERT INTO public.profiles (user_id, display_name, account_privacy)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'public'),
  ('22222222-2222-2222-2222-222222222222', 'Bob',   'private'),
  ('33333333-3333-3333-3333-333333333333', 'Carol', 'public')
ON CONFLICT (user_id) DO UPDATE SET
  display_name    = EXCLUDED.display_name,
  account_privacy = EXCLUDED.account_privacy;

-- Table A (Alice + Bob).
INSERT INTO public.tables (id, owner_id, name)
VALUES ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', '11111111-1111-1111-1111-111111111111', 'Table A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.table_members (table_id, member_id, role) VALUES
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', '22222222-2222-2222-2222-222222222222', 'member')
ON CONFLICT DO NOTHING;

-- Table B (Alice + Carol).
INSERT INTO public.tables (id, owner_id, name)
VALUES ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', '11111111-1111-1111-1111-111111111111', 'Table B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.table_members (table_id, member_id, role) VALUES
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', '33333333-3333-3333-3333-333333333333', 'member')
ON CONFLICT DO NOTHING;

-- Entry X: Alice posts to BOTH Table A and Table B.
-- Legacy entries.table_id = A (Table A is "primary").
INSERT INTO public.entries (id, user_id, restaurant_id, rating, content, visibility, table_id)
VALUES (
  'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0',
  '11111111-1111-1111-1111-111111111111',
  NULL, 4.0, 'Multi-table entry text here.', 'table',
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1' -- legacy primary = Table A
)
ON CONFLICT (id) DO NOTHING;

-- entry_tables: posted to both A and B.
INSERT INTO public.entry_tables (entry_id, table_id, posted_at) VALUES
  ('e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', now()),
  ('e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', now())
ON CONFLICT DO NOTHING;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 1: Bob (A-only) queries entry_tables for entry X.
-- He must NOT see the (entry, B) row.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  row_count int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222"}', true);
  SET LOCAL ROLE authenticated;

  -- Bob queries all entry_tables rows for entry X.
  SELECT count(*) INTO row_count
  FROM public.entry_tables
  WHERE entry_id = 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0';

  RESET ROLE;

  -- Bob is a member of Table A only → should see only the (X, A) row, NOT (X, B).
  ASSERT row_count = 1,
    format('FAIL [Bob/A-only]: expected 1 entry_tables row (A only), got %s (Table B leaked!)', row_count);

  RAISE NOTICE 'PASS [Test 1/Bob/A-only]: entry_tables returns 1 row (A only, B not leaked)';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 2: Bob (A-only) scans entry_tables for Table B's id in entry X.
-- Any row with table_id = B must be invisible to Bob.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  leaked int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO leaked
  FROM public.entry_tables
  WHERE entry_id = 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0'
    AND table_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';

  RESET ROLE;

  ASSERT leaked = 0,
    format('FAIL [Bob/A-only explicit B lookup]: Table B id leaked to Bob (%s rows)', leaked);

  RAISE NOTICE 'PASS [Test 2/Bob/A-only]: explicit Table-B lookup returns 0 rows for Bob';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 3: Carol (B-only) queries entry_tables for entry X.
-- She must NOT see the (entry, A) row.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  row_count int;
  leaked_table_a int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "33333333-3333-3333-3333-333333333333"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO row_count
  FROM public.entry_tables
  WHERE entry_id = 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0';

  SELECT count(*) INTO leaked_table_a
  FROM public.entry_tables
  WHERE entry_id = 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0'
    AND table_id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';

  RESET ROLE;

  -- Carol is a member of Table B only → sees (X, B) row but NOT (X, A).
  ASSERT row_count = 1,
    format('FAIL [Carol/B-only]: expected 1 entry_tables row (B only), got %s', row_count);
  ASSERT leaked_table_a = 0,
    format('FAIL [Carol/B-only]: Table A id leaked to Carol (%s rows)', leaked_table_a);

  RAISE NOTICE 'PASS [Test 3/Carol/B-only]: sees (X,B) only, (X,A) not leaked';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 4: Author exception — Alice sees BOTH rows.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  row_count int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO row_count
  FROM public.entry_tables
  WHERE entry_id = 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0';

  RESET ROLE;

  ASSERT row_count = 2,
    format('FAIL [Alice/author]: expected 2 entry_tables rows, got %s', row_count);

  RAISE NOTICE 'PASS [Test 4/Alice/author]: sees both (X,A) and (X,B) rows';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 5: Column-level grant check.
-- Bob (authenticated) must NOT be able to SELECT entries.table_id directly.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  caught boolean := false;
  dummy text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222"}', true);
  SET LOCAL ROLE authenticated;

  BEGIN
    -- This should throw "permission denied for column table_id".
    EXECUTE 'SELECT table_id FROM public.entries WHERE id = $1'
      USING 'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0'::uuid
      INTO dummy;
  EXCEPTION WHEN insufficient_privilege THEN
    caught := true;
  END;

  RESET ROLE;

  ASSERT caught = true,
    'FAIL [column-grant]: authenticated can still SELECT entries.table_id — revoke not applied';

  RAISE NOTICE 'PASS [Test 5/column-grant]: entries.table_id SELECT denied for authenticated';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 6: Dual-write trigger — inserting into entries with table_id auto-mirrors into entry_tables.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  et_count int;
BEGIN
  -- Use service_role context to bypass RLS for the insert.
  RESET ROLE;

  INSERT INTO public.entries (id, user_id, restaurant_id, rating, content, visibility, table_id)
  VALUES (
    '12345678-9abc-def0-0000-000000000001',
    '11111111-1111-1111-1111-111111111111',
    NULL, 3.0, 'Trigger test entry', 'table',
    'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'
  )
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO et_count
  FROM public.entry_tables
  WHERE entry_id = '12345678-9abc-def0-0000-000000000001'
    AND table_id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';

  -- Clean up.
  DELETE FROM public.entries WHERE id = '12345678-9abc-def0-0000-000000000001';

  ASSERT et_count >= 1,
    format('FAIL [dual-write trigger]: entry_tables row not auto-created (count=%s)', et_count);

  RAISE NOTICE 'PASS [Test 6/dual-write]: entries.table_id insert mirrored into entry_tables';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 7: Nonce dedup — fn_create_entry_with_tables is idempotent on same nonce.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  result1_id uuid;
  result2_id uuid;
  was_dedup1 boolean;
  was_dedup2 boolean;
  nonce_val text := gen_random_uuid()::text;
BEGIN
  RESET ROLE; -- service_role for RPC

  SELECT entry_id, was_dedup INTO result1_id, was_dedup1
  FROM public.fn_create_entry_with_tables(
    '11111111-1111-1111-1111-111111111111'::uuid,
    jsonb_build_object(
      'restaurant_id', NULL,
      'rating', 4.0,
      'content', 'Dedup test',
      'visibility', 'table',
      'client_nonce', nonce_val
    ),
    ARRAY['a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1']::uuid[],
    ARRAY[]::uuid[],
    ARRAY[]::uuid[]
  );

  -- Second call with same nonce should return same entry_id and was_dedup=true.
  SELECT entry_id, was_dedup INTO result2_id, was_dedup2
  FROM public.fn_create_entry_with_tables(
    '11111111-1111-1111-1111-111111111111'::uuid,
    jsonb_build_object(
      'restaurant_id', NULL,
      'rating', 4.0,
      'content', 'Dedup test',
      'visibility', 'table',
      'client_nonce', nonce_val
    ),
    ARRAY['a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1']::uuid[],
    ARRAY[]::uuid[],
    ARRAY[]::uuid[]
  );

  -- Clean up.
  DELETE FROM public.entries WHERE id = result1_id;

  ASSERT result1_id = result2_id,
    format('FAIL [nonce-dedup]: different entry ids returned (first=%s, second=%s)', result1_id, result2_id);
  ASSERT was_dedup1 = false,
    format('FAIL [nonce-dedup]: first call should not be dedup (got %s)', was_dedup1);
  ASSERT was_dedup2 = true,
    format('FAIL [nonce-dedup]: second call should be dedup (got %s)', was_dedup2);

  RAISE NOTICE 'PASS [Test 7/nonce-dedup]: fn_create_entry_with_tables is idempotent';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- TEST 8: Missing visibility follows the founder default at the SQL boundary.
-- Table-backed writes default to 'table'; solo writes default to 'friends'.
-- ─────────────────────────────────────────────────────────────────────────────
DO $ticket_217_visibility$
DECLARE
  table_entry_id uuid;
  solo_entry_id uuid;
  table_visibility text;
  solo_visibility text;
BEGIN
  RESET ROLE; -- service_role for RPC

  ASSERT (
    SELECT p.pronargdefaults = 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = 'public.fn_visible_entry_ids(uuid,uuid[],boolean)'::regprocedure
  ), 'FAIL [visibility helper]: p_require_content must be the single defaulted argument';

  -- The two-argument form must continue to resolve to p_require_content=true.
  PERFORM *
  FROM public.fn_visible_entry_ids(
    '11111111-1111-1111-1111-111111111111'::uuid,
    ARRAY[]::uuid[]
  );

  SELECT entry_id INTO table_entry_id
  FROM public.fn_create_entry_with_tables(
    '11111111-1111-1111-1111-111111111111'::uuid,
    jsonb_build_object(
      'rating', 4.0,
      'content', 'Table fallback test',
      'client_nonce', gen_random_uuid()::text
    ),
    ARRAY['a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1']::uuid[],
    ARRAY[]::uuid[],
    ARRAY[]::uuid[]
  );

  SELECT entry_id INTO solo_entry_id
  FROM public.fn_create_entry_with_tables(
    '11111111-1111-1111-1111-111111111111'::uuid,
    jsonb_build_object(
      'rating', 4.0,
      'content', 'Solo fallback test',
      'client_nonce', gen_random_uuid()::text
    ),
    ARRAY[]::uuid[],
    ARRAY[]::uuid[],
    ARRAY[]::uuid[]
  );

  SELECT visibility INTO table_visibility
  FROM public.entries WHERE id = table_entry_id;
  SELECT visibility INTO solo_visibility
  FROM public.entries WHERE id = solo_entry_id;

  DELETE FROM public.entries WHERE id IN (table_entry_id, solo_entry_id);

  ASSERT table_visibility = 'table',
    format('FAIL [visibility fallback]: Table entry expected table, got %s', table_visibility);
  ASSERT solo_visibility = 'friends',
    format('FAIL [visibility fallback]: solo entry expected friends, got %s', solo_visibility);

  RAISE NOTICE 'PASS [Test 8/visibility-fallback]: SQL writer derives table/friends defaults';
END;
$ticket_217_visibility$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CLEANUP (safe to re-run test file multiple times)
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

DELETE FROM public.entries WHERE id IN (
  'e0e0e0e0-e0e0-e0e0-e0e0-e0e0e0e0e0e0'
);
DELETE FROM public.table_members WHERE table_id IN (
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'
);
DELETE FROM public.tables WHERE id IN (
  'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1',
  'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'
);

COMMIT;

DO $done$
BEGIN
  RAISE NOTICE 'All entry_tables leak tests passed.';
END;
$done$;
