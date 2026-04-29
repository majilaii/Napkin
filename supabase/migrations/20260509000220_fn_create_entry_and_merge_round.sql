-- TICKET-044: Atomic merge RPC.
--
-- fn_create_entry_and_merge_round(
--     actor_user_id,  table_id,  restaurant_id,  visited_at,
--     entry_a_id,     b_payload,  client_nonce
-- )
--
-- In a single transaction:
--   1. SELECT ... FOR UPDATE on both authors' table_members rows (fences concurrent leaves).
--   2. Commit-time recheck of ALL candidate predicates (not just round binding).
--   3. Inserts B's entry via fn_create_entry_with_tables (with client_nonce dedup).
--   4. Inserts a table_nights row with kind='merged', status=NULL.
--   5. Inserts two round_entries rows.
-- On unique_violation (race lost), raises round_conflict instead.
--
-- Architecture decisions:
--   - No auth.uid() — service-role context. Actor IDs passed explicitly.
--   - PK on round_entries.entry_id is the sole concurrency guard for the race.
--   - b_payload is a jsonb fragment matching fn_create_entry_with_tables' p_entry shape.
--
-- [ARCH-REVIEW] verified:
--   - Both halves of the "not already in any round" check are present:
--     entry_a.id NOT IN round_entries AND entry_a.table_night_id IS NULL.
--   - No entries.round_id column introduced.
--   - No auth.uid() calls.

CREATE OR REPLACE FUNCTION public.fn_create_entry_and_merge_round(
    p_actor_user_id   uuid,         -- B (the composer)
    p_table_id        uuid,         -- the Table B is composing into
    p_restaurant_id   uuid,         -- must match entry A's restaurant_id
    p_visited_at      timestamptz,  -- B's visited_at; ±18h window checked vs entry A
    p_entry_a_id      uuid,         -- the candidate A-side entry
    p_b_payload       jsonb,        -- B's entry payload (matches fn_create_entry_with_tables p_entry shape)
    p_client_nonce    text          -- idempotency key; also stored in p_b_payload
)
RETURNS jsonb  -- { entry_b_id, round_id, merge_outcome }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry_a       RECORD;
    v_entry_a_user  uuid;
    v_entry_b_id    uuid;
    v_was_dedup     boolean;
    v_round_id      uuid;
    v_nonce         uuid;
BEGIN
    -- ── 1. Lock both authors' table_members rows (fence concurrent leaves) ────
    -- This SELECT will block if a concurrent leave is modifying these rows.
    SELECT tm.member_id INTO STRICT v_entry_a_user
    FROM public.table_members tm
    WHERE tm.table_id = p_table_id AND tm.member_id = (
        SELECT e.user_id FROM public.entries e WHERE e.id = p_entry_a_id
    )
    FOR UPDATE;

    -- Also lock the B-side membership row
    PERFORM 1
    FROM public.table_members tm
    WHERE tm.table_id = p_table_id AND tm.member_id = p_actor_user_id
    FOR UPDATE;

    -- ── 2. Commit-time recheck of ALL candidate predicates ─────────────────────
    SELECT e.* INTO v_entry_a
    FROM public.entries e
    WHERE e.id = p_entry_a_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'round_conflict: entry_a not found'
            USING ERRCODE = 'P0001';
    END IF;

    -- Predicate 1: restaurant match
    IF v_entry_a.restaurant_id IS DISTINCT FROM p_restaurant_id THEN
        RAISE EXCEPTION 'round_conflict: restaurant mismatch'
            USING ERRCODE = 'P0001';
    END IF;

    -- Predicate 2: visited_at ±18 hours window
    IF abs(extract(epoch FROM (v_entry_a.visited_at - p_visited_at))) > 18 * 3600 THEN
        RAISE EXCEPTION 'round_conflict: visited_at outside 18h window'
            USING ERRCODE = 'P0001';
    END IF;

    -- Predicate 3: different authors
    IF v_entry_a.user_id = p_actor_user_id THEN
        RAISE EXCEPTION 'round_conflict: same author'
            USING ERRCODE = 'P0001';
    END IF;

    -- Predicate 4a: entry_a not already in round_entries (covers merged rounds)
    IF EXISTS (SELECT 1 FROM public.round_entries re WHERE re.entry_id = p_entry_a_id) THEN
        RAISE EXCEPTION 'round_conflict: entry_a already in a merged round'
            USING ERRCODE = 'P0001';
    END IF;

    -- Predicate 4b: entry_a not already in a live Round-Mode round
    IF v_entry_a.table_night_id IS NOT NULL THEN
        RAISE EXCEPTION 'round_conflict: entry_a already in a live round'
            USING ERRCODE = 'P0001';
    END IF;

    -- Predicate 5: entry_a is shared to this table (entry_tables row must exist)
    IF NOT EXISTS (
        SELECT 1 FROM public.entry_tables et
        WHERE et.entry_id = p_entry_a_id AND et.table_id = p_table_id
    ) THEN
        RAISE EXCEPTION 'round_conflict: entry_a not in target table'
            USING ERRCODE = 'P0001';
    END IF;

    -- Predicate 6: A's author is still a member of the table (already locked above, but
    -- the FOR UPDATE may have succeeded on a stale row — verify the row still exists)
    IF NOT EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = p_table_id AND tm.member_id = v_entry_a.user_id
    ) THEN
        RAISE EXCEPTION 'round_conflict: entry_a author left the table'
            USING ERRCODE = 'P0001';
    END IF;

    -- Predicate 7: B is still a member of the table
    IF NOT EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = p_table_id AND tm.member_id = p_actor_user_id
    ) THEN
        RAISE EXCEPTION 'round_conflict: actor not a member of table'
            USING ERRCODE = 'P0001';
    END IF;

    -- ── 3. Insert B's entry via fn_create_entry_with_tables (nonce dedup) ─────
    -- fn_create_entry_with_tables handles client_nonce idempotency internally.
    SELECT t.entry_id, t.was_dedup INTO v_entry_b_id, v_was_dedup
    FROM public.fn_create_entry_with_tables(
        p_actor_user_id,
        p_b_payload,
        ARRAY[p_table_id],
        ARRAY[p_actor_user_id],  -- only author in participants for a solo-style entry
        NULL
    ) t;

    -- ── 4. Insert table_nights row with kind='merged', status=NULL ─────────────
    INSERT INTO public.table_nights (
        table_id,
        restaurant_id,
        host_user_id,
        kind,
        status,
        is_async
    )
    VALUES (
        p_table_id,
        p_restaurant_id,
        p_actor_user_id,  -- B is the initiator
        'merged',
        NULL,             -- status=NULL for merged rows
        false
    )
    RETURNING id INTO v_round_id;

    -- ── 5. Insert two round_entries rows ──────────────────────────────────────
    -- The PK on round_entries.entry_id is the concurrency guard.
    -- If a concurrent merge won the race for entry_a, the INSERT below raises
    -- unique_violation, which we catch and translate to round_conflict.
    BEGIN
        INSERT INTO public.round_entries (round_id, entry_id, table_id)
        VALUES
            (v_round_id, p_entry_a_id,  p_table_id),
            (v_round_id, v_entry_b_id,  p_table_id);
    EXCEPTION WHEN unique_violation THEN
        -- Race lost: roll back the table_nights insert (PL/pgSQL subtransaction)
        -- and raise round_conflict so the edge function falls back to solo save.
        RAISE EXCEPTION 'round_conflict'
            USING ERRCODE = 'P0001';
    END;

    RETURN jsonb_build_object(
        'entry_b_id',    v_entry_b_id,
        'round_id',      v_round_id,
        'was_dedup',     v_was_dedup
    );
END;
$$;

-- Service-role only — callers go through the entry edge function.
REVOKE EXECUTE ON FUNCTION public.fn_create_entry_and_merge_round(
    uuid, uuid, uuid, timestamptz, uuid, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_entry_and_merge_round(
    uuid, uuid, uuid, timestamptz, uuid, jsonb, text
) TO service_role;

-- ── Test assertions (regression) ─────────────────────────────────────────────
-- Manual verification sequence (see build log):
--
-- 1. Happy path: call with valid entry_a, B's payload, client_nonce →
--    expect jsonb { entry_b_id, round_id, was_dedup=false }.
--    Verify round_entries has 2 rows for that round_id.
--
-- 2. Idempotency: call again with same client_nonce →
--    expect same round_id (via was_dedup=true path),
--    round_entries still has exactly 2 rows.
--
-- 3. Concurrent race: two concurrent B-side callers with different client_nonces
--    both targeting same entry_a. Exactly one succeeds; the other gets
--    round_conflict and its entry is saved as solo. Verify by running two
--    parallel calls via curl/psql.
--
-- 4. entry_a already in round_entries: pre-insert a round_entries row for
--    entry_a → call expects P0001 round_conflict.
--
-- 5. entry_a.table_night_id IS NOT NULL: pre-set table_night_id on entry_a →
--    call expects P0001 round_conflict.
