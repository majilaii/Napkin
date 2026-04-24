-- RLS entries test harness — TICKET-034
--
-- Run against a blank local Supabase (after both Migration A and B are applied).
-- Assumes three auth users were pre-created via Supabase admin API:
--   A (Alice): 11111111-1111-1111-1111-111111111111
--   B (Bob):   22222222-2222-2222-2222-222222222222
--   C (Carol): 33333333-3333-3333-3333-333333333333
--
-- To create them before running this file:
--   npx supabase --project-ref ftvmseaqwwlcxtdlvxxz admin create-user \
--       --email alice@rls-test.invalid --password test123 \
--       --user-id 11111111-1111-1111-1111-111111111111
--   (repeat for Bob and Carol)
--
-- Run with:
--   psql "$DATABASE_URL" -f supabase/tests/rls-entries-seed.sql
--
-- Expected assertions at end of file.

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- Profiles: Alice=public, Bob=private, Carol=public.
INSERT INTO public.profiles (user_id, display_name, account_privacy)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'public'),
  ('22222222-2222-2222-2222-222222222222', 'Bob',   'private'),
  ('33333333-3333-3333-3333-333333333333', 'Carol', 'public')
ON CONFLICT (user_id) DO UPDATE SET
  display_name   = EXCLUDED.display_name,
  account_privacy = EXCLUDED.account_privacy;

-- Shared Table T (Alice + Bob; Carol is a stranger).
INSERT INTO public.tables (id, owner_id, name)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Shared')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.table_members (table_id, member_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member')
ON CONFLICT DO NOTHING;

-- Entries authored by Alice (A).
-- e1: private, feed-only           → only A should see
-- e2: table-scoped (shared T)      → A + B should see
-- e3: public + real content + A profile=public  → A + B + C should see
-- e4: public + real content but we'll flip A's profile to private mid-assertion → only A
-- e5: private, feed-only, C tagged as companion → A + C should see
INSERT INTO public.entries (id, user_id, restaurant_id, rating, content, visibility, table_id)
VALUES
  ('e1111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111',
   NULL, 4.5, NULL, 'private', NULL),

  ('e2222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   NULL, 4.0, 'shared table entry text here', 'table',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),

  ('e3333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   NULL, 4.5,
   'This is a real review of at least twenty characters for public eligibility.',
   'public', NULL),

  ('e4444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111',
   NULL, 4.5,
   'Another real review of at least twenty characters for public eligibility.',
   'public', NULL),

  ('e5555555-5555-5555-5555-555555555555',
   '11111111-1111-1111-1111-111111111111',
   NULL, 4.0, NULL, 'private', NULL)
ON CONFLICT (id) DO NOTHING;

-- Tag Carol as companion on Alice's private entry e5.
INSERT INTO public.entry_companions (entry_id, user_id)
VALUES ('e5555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333')
ON CONFLICT DO NOTHING;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- ASSERTIONS (run after both Migration A + B are deployed)
-- ─────────────────────────────────────────────────────────────────────────────
-- Each block sets the JWT sub to impersonate a user, then counts visible entries.
-- Expected counts:
--   As A (Alice/author):                5  (all own entries)
--   As B (Bob/tablemate, private profile): 2  (e2 table-shared + e3 public-with-public-profile)
--   As C (Carol/stranger + companion e5): 2  (e3 public + e5 companion)
--
-- Then we flip Alice's profile to private and re-check B and C:
--   B should see: 1 (only e2, table-shared — e3 no longer eligible: profile=private)
--   C should see: 1 (only e5 companion — e3 no longer eligible)
--
-- ── As Alice ────────────────────────────────────────────────────────────────
DO $$
DECLARE
  visible_count int;
BEGIN
  -- Impersonate Alice
  PERFORM set_config('request.jwt.claims',
    '{"sub": "11111111-1111-1111-1111-111111111111"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_count
  FROM public.entries
  WHERE user_id = '11111111-1111-1111-1111-111111111111';

  RESET ROLE;

  ASSERT visible_count = 5,
    format('FAIL [as Alice]: expected 5 own entries, got %s', visible_count);

  RAISE NOTICE 'PASS [as Alice]: sees all 5 own entries';
END;
$$;

-- ── As Bob (A's tablemate, private profile) ──────────────────────────────────
DO $$
DECLARE
  visible_count int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_count
  FROM public.entries
  WHERE user_id = '11111111-1111-1111-1111-111111111111';

  RESET ROLE;

  -- Bob should see e2 (table) + e3 (public + Alice profile=public) = 2
  -- NOT e1 (private feed-only), e4 (public but we need to verify), e5 (private companion C only)
  -- Note: e4 is also public+content+Alice public profile → Bob should see e3 AND e4 = 2 public + 1 table = 3
  -- Re-checking: Alice profile=public, e3 and e4 both have visibility=public + content >=20 + rating IS NOT NULL
  -- So Bob should see: e2 (table) + e3 (public) + e4 (public) = 3
  ASSERT visible_count = 3,
    format('FAIL [as Bob]: expected 3 entries (e2+e3+e4), got %s', visible_count);

  RAISE NOTICE 'PASS [as Bob]: sees 3 entries (table-shared + 2 public-eligible)';
END;
$$;

-- ── As Carol (stranger + companion on e5) ────────────────────────────────────
DO $$
DECLARE
  visible_count int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "33333333-3333-3333-3333-333333333333"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_count
  FROM public.entries
  WHERE user_id = '11111111-1111-1111-1111-111111111111';

  RESET ROLE;

  -- Carol sees: e3 (public + Alice public profile) + e4 (same) + e5 (companion) = 3
  -- NOT e1 (private, not tagged), e2 (table — Carol is not in shared Table T)
  ASSERT visible_count = 3,
    format('FAIL [as Carol]: expected 3 entries (e3+e4+e5), got %s', visible_count);

  RAISE NOTICE 'PASS [as Carol]: sees 3 entries (2 public-eligible + companion)';
END;
$$;

-- ── Flip Alice's profile to private; re-check Bob and Carol ──────────────────
UPDATE public.profiles
SET account_privacy = 'private'
WHERE user_id = '11111111-1111-1111-1111-111111111111';

DO $$
DECLARE
  visible_count int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_count
  FROM public.entries
  WHERE user_id = '11111111-1111-1111-1111-111111111111';

  RESET ROLE;

  -- With Alice profile=private: e3+e4 public branch fails (profile not public).
  -- Bob only sees e2 (table-shared) = 1.
  ASSERT visible_count = 1,
    format('FAIL [as Bob, Alice private profile]: expected 1 entry (e2), got %s', visible_count);

  RAISE NOTICE 'PASS [as Bob, Alice private]: sees only 1 entry (table-shared)';
END;
$$;

DO $$
DECLARE
  visible_count int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "33333333-3333-3333-3333-333333333333"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO visible_count
  FROM public.entries
  WHERE user_id = '11111111-1111-1111-1111-111111111111';

  RESET ROLE;

  -- With Alice profile=private: e3+e4 public branch fails.
  -- Carol only sees e5 (companion) = 1.
  ASSERT visible_count = 1,
    format('FAIL [as Carol, Alice private profile]: expected 1 entry (e5), got %s', visible_count);

  RAISE NOTICE 'PASS [as Carol, Alice private]: sees only 1 entry (companion)';
END;
$$;

-- Restore Alice's profile for subsequent test runs.
UPDATE public.profiles
SET account_privacy = 'public'
WHERE user_id = '11111111-1111-1111-1111-111111111111';

-- ── Adversarial check: Bob tries to read ALL entries ─────────────────────────
-- Bob must not see Alice's private entries (e1, e5 unless tagged).
DO $$
DECLARE
  private_count int;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub": "22222222-2222-2222-2222-222222222222"}', true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO private_count
  FROM public.entries
  WHERE user_id = '11111111-1111-1111-1111-111111111111'
    AND visibility = 'private';

  RESET ROLE;

  -- Bob is not a companion on e1 or e5, so should see 0 private entries.
  ASSERT private_count = 0,
    format('FAIL [adversarial/Bob]: saw %s private entries from Alice (expected 0)', private_count);

  RAISE NOTICE 'PASS [adversarial/Bob]: zero private entries from Alice leaked';
END;
$$;

RAISE NOTICE 'All RLS assertions passed.';
