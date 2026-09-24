-- Clean slate before the App Review resubmission (founder request, 2026-09-24):
-- "clean up the accounts and fake reviews ... it can be clean slate".
--
-- A read-only production pass found what a signed-out reviewer meets first:
-- reviews by the founder's test accounts ("So fucking good" was the first
-- guest row), keyboard-mash reviews from his feature testing ("Gogoggig",
-- "Fifur", "MIDDMIMDIDMDID"), a seeded New York review under his name, an
-- emoji-only test list, and two fake restaurants a guest search for "test"
-- or "heart" returns. Seeded persona and superseded demo accounts were already
-- private (TICKET-251) but still appeared in people search.
--
-- Nothing is deleted. Every change is one column on a row named by id here,
-- so each is reversed by the same statement with the old value:
--
--   1. profiles.is_internal = true (TICKET-251): the account, its reviews,
--      saves and lists leave every surface a non-internal viewer reads, people
--      search included. Accounts: the four April seed personas, the six
--      superseded App Review demo accounts, the eight feed-fixture personas,
--      and six test accounts on the founder's own email or his Sign in with
--      Apple test day (three named "Jacky", "Hi", two unfinished "New User").
--   2. entries.visibility = 'private' on ten of the founder's reviews: the
--      mash and throwaway notes from repeated test logs, and two seeded reviews
--      (Tatiana, Apothéke). Private only takes a review off public paths;
--      the author, Table-mates, companions and supper members still see it
--      (can_view_entry branches 1 to 3 and 5). His other reviews stay public.
--   3. lists.privacy = 'private' on the emoji-only test list.
--   4. restaurants.verification = 'unverified', created_by = the founder, on
--      the two fake rows (external ids "test-curl-round..." and
--      "manual-heart...", no address, no coordinates). Canonical reads, guest
--      search and recent included, skip unverified rows; the founder keeps
--      his own test entry.
--
-- The App Review demo pair (edf516b4, f2f4e458), the CI smoke accounts and
-- the founder's main account (dcfce66a) are guarded by id. On a fresh replay
-- none of these rows exist and every statement updates nothing.

do $clean_slate$
declare
    v_founder constant uuid := 'dcfce66a-28f2-4019-935a-f7421f42e59b';
    v_internal constant uuid[] := array[
        -- April seed personas (Sunday Roast Club fixtures)
        'a1b2c3d4-1111-4aaa-bbbb-000000000001',  -- Elena
        'a1b2c3d4-2222-4aaa-bbbb-000000000002',  -- Derek
        'a1b2c3d4-3333-4aaa-bbbb-000000000003',  -- Priya
        'a1b2c3d4-4444-4aaa-bbbb-000000000004',  -- Tomoko
        -- superseded App Review demo accounts
        '0cd9f534-05a1-447b-b14d-56939c5c750e',  -- alexeats
        '3faa8dec-21ea-4aef-bf82-245731f19118',  -- billietries
        'aadbefb1-fdc5-455a-9c47-56e5d530bdaf',  -- alexreviews
        '3c337ace-b68e-4ae0-bf4c-3c7780d28c6d',  -- billieeats
        '865970fe-6ac7-41db-a788-d4222c0f68e2',  -- alexnapkin
        '53c89303-e0d2-46d7-8e39-fd6d5d1ca4e2',  -- billienapkin
        -- feed-fixture personas
        '9af43a9d-8ed7-5502-9473-2a1eecea6a02',  -- mayachen_ldn
        '7db4b455-6347-5e6c-a4ba-34d5935c9496',  -- theobennett_ldn
        '5295a69d-701e-5f30-9d92-4cbb83f8cd18',  -- amaraokafor_ldn
        'cd543744-9842-5eea-b119-e2eecd591905',  -- lucamoretti_ldn
        '9a342d4a-6fab-523b-9b9c-92ffd136d3ee',  -- ninapatel_ldn
        '37c598ed-e97b-5124-bd76-24cd6e22987d',  -- eliaswong_ldn
        '9159f19d-2b94-505e-9fb0-cb9c6d5746f1',  -- sofiamarin_ldn
        '39c7472a-90e7-5316-ae01-69dbc8b0abf1',  -- rowanblake_ldn
        -- the founder's test accounts
        'f02c3cf6-d3ac-41aa-bd1a-4617453f26a8',  -- "Jacky" (email)
        '8bac3e18-6829-4e8d-9f12-98413e934dec',  -- "Jacky" (email)
        '32bfa399-5319-4c85-b642-d0464095811b',  -- "Jacky" (Sign in with Apple test)
        '311d8e3a-f1cb-492b-93a0-e89affc02b9d',  -- "Hi"
        '4a40d890-ba63-40ec-baf6-e7687c7a0464',  -- "New User", onboarding unfinished
        '233853c1-fae6-49dd-86b1-87743b26b055'   -- "New User", onboarding unfinished
    ]::uuid[];
    v_private_entries constant uuid[] := array[
        '7ddb2655-4580-4494-a4a3-f77b22fd107b',  -- Dorian Restaurant, "Gogoggig"
        '2207942a-42d9-47ce-a9f5-2c8c6ef9f805',  -- Winkel 43, "Fifur"
        '997bd37b-cefc-446c-8618-3a1734057af0',  -- Donia, "MIDDMIMDIDMDID"
        '04fb8a69-8adb-42d5-b603-0499a77c7fcc',  -- Darjeeling Express, keyboard mash
        'c81dcbf7-d7c6-464f-af27-fbff66b4aca9',  -- Darjeeling Express, "Mid" (3 logs in 2 days)
        '238581ff-ebc8-42f3-aaf6-5b6ee91c6033',  -- Donia, "Not bad" (supper test day)
        '7565a3d2-b5d6-474d-89b7-67b2b52e2afd',  -- Donia, "Really mid tbh" (5 Donia logs)
        '4e8e860a-31d6-4562-8e5d-68f6ce68313f',  -- AGORA souvla bar, supper test
        '743c62a6-e13b-4328-9fa0-82fdeafb6ba2',  -- Tatiana (New York), seeded
        'fd6c4d57-1154-4446-904b-8ff6d5856fde'   -- Apothéke, seeded
    ]::uuid[];
    v_private_lists constant uuid[] := array[
        '08328966-8761-4014-bd00-4ff90fc9783a'   -- emoji-only title, 8 places
    ]::uuid[];
    v_fake_restaurants constant uuid[] := array[
        '08b1bcf6-72d6-4980-b913-84807924ef2c',  -- "Test Round Restaurant"
        'b294ae4d-af70-4db3-ac47-aea1a93bc63e'   -- "Heart Test"
    ]::uuid[];
    v_protected constant uuid[] := array[
        'edf516b4-f8ea-4d2e-816f-cf4ca3f402f2',  -- App Review demo: alexreviewer
        'f2f4e458-b8f2-48b7-b60e-4d4d3ddd45e9',  -- App Review demo: billietable
        'dcfce66a-28f2-4019-935a-f7421f42e59b'   -- the founder's main account
    ]::uuid[];
    v_flagged integer;
    v_entries integer;
    v_lists integer;
    v_restaurants integer;
begin
    if v_protected && v_internal then
        raise exception using
            errcode = '55000',
            message = 'clean slate: the demo pair and the founder''s main account must not be flagged internal';
    end if;

    update public.profiles
       set is_internal = true
     where user_id = any(v_internal)
       and not is_internal;
    get diagnostics v_flagged = row_count;

    -- Only the founder's own reviews, whatever the list says.
    update public.entries
       set visibility = 'private'
     where id = any(v_private_entries)
       and user_id = v_founder
       and visibility <> 'private';
    get diagnostics v_entries = row_count;

    update public.lists
       set privacy = 'private'
     where id = any(v_private_lists)
       and owner_id = v_founder
       and privacy <> 'private';
    get diagnostics v_lists = row_count;

    -- Only rows that never matched a Google place (fake external ids, no
    -- address, no coordinates).
    update public.restaurants
       set verification = 'unverified',
           created_by = v_founder
     where id = any(v_fake_restaurants)
       and verification = 'verified'
       and address is null
       and lat is null
       and (external_id like 'test-%' or external_id like 'manual-%');
    get diagnostics v_restaurants = row_count;

    raise notice 'clean slate: % account(s) internal, % review(s) private, % list(s) private, % restaurant(s) unverified',
        v_flagged, v_entries, v_lists, v_restaurants;
end;
$clean_slate$;
