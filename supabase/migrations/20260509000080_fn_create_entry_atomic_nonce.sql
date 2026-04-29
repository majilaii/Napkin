-- TICKET-043 review-fix: atomic client_nonce idempotency in fn_create_entry_with_tables.
-- Codex Review 1 finding #2: SELECT-then-INSERT is racy under concurrent retries
-- (mobile double-submit). Two requests with the same nonce can both miss the SELECT,
-- then one INSERT succeeds and the other surfaces unique_violation as a user-visible
-- error. Fix: keep the SELECT-first as a fast path, then wrap the INSERT in an
-- EXCEPTION block that catches unique_violation, re-selects the existing row, and
-- returns was_dedup=true (skipping fan-out).

CREATE OR REPLACE FUNCTION public.fn_create_entry_with_tables(
    p_user_id         uuid,
    p_entry           jsonb,
    p_table_ids       uuid[],
    p_participant_ids uuid[],
    p_companion_ids   uuid[]
)
RETURNS TABLE (entry_id uuid, was_dedup boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry_id    uuid;
    v_nonce       uuid;
    v_table_id    uuid;
    v_participant uuid;
BEGIN
    v_nonce := (p_entry ->> 'client_nonce')::uuid;

    -- Fast-path idempotency: if a row with (user_id, client_nonce) already exists,
    -- return its id without touching anything.
    IF v_nonce IS NOT NULL THEN
        SELECT e.id INTO v_entry_id
        FROM public.entries e
        WHERE e.user_id = p_user_id AND e.client_nonce = v_nonce;
        IF FOUND THEN
            RETURN QUERY SELECT v_entry_id, true;
            RETURN;
        END IF;
    END IF;

    -- Race-safe path: attempt the INSERT; on unique_violation (a concurrent retry
    -- inserted between our SELECT and our INSERT), re-select the winner's id and
    -- return was_dedup=true. Skips fan-out — the winner already did it.
    BEGIN
        INSERT INTO public.entries (
            user_id, restaurant_id, rating, content, dish_description,
            visited_at, table_id, table_night_id, visibility,
            vibe_rating, flavor_rating, service_rating, value_rating,
            photo_url, client_nonce
        )
        VALUES (
            p_user_id,
            (p_entry ->> 'restaurant_id')::uuid,
            (p_entry ->> 'rating')::numeric,
            p_entry ->> 'content',
            p_entry ->> 'dish_description',
            (p_entry ->> 'visited_at')::timestamptz,
            COALESCE(p_table_ids[1], NULL),
            (p_entry ->> 'table_night_id')::uuid,
            COALESCE(p_entry ->> 'visibility', 'private'),
            (p_entry ->> 'vibe_rating')::numeric,
            (p_entry ->> 'flavor_rating')::numeric,
            (p_entry ->> 'service_rating')::numeric,
            (p_entry ->> 'value_rating')::numeric,
            p_entry ->> 'photo_url',
            v_nonce
        )
        RETURNING id INTO v_entry_id;
    EXCEPTION
        WHEN unique_violation THEN
            -- Concurrent retry won the race. Find the existing row by nonce and return.
            IF v_nonce IS NULL THEN
                -- Should not happen — unique_violation without a nonce means a different
                -- constraint fired. Re-raise.
                RAISE;
            END IF;
            SELECT e.id INTO v_entry_id
            FROM public.entries e
            WHERE e.user_id = p_user_id AND e.client_nonce = v_nonce;
            IF NOT FOUND THEN
                RAISE;
            END IF;
            RETURN QUERY SELECT v_entry_id, true;
            RETURN;
    END;

    -- Fan out into entry_tables (only when we created the row).
    IF p_table_ids IS NOT NULL THEN
        FOREACH v_table_id IN ARRAY p_table_ids LOOP
            IF NOT public.is_table_member(v_table_id, p_user_id) THEN
                RAISE EXCEPTION 'table_not_authorized'
                    USING ERRCODE = 'P0001',
                          DETAIL  = json_build_object('id', v_table_id)::text;
            END IF;
            INSERT INTO public.entry_tables (entry_id, table_id, posted_at)
            VALUES (v_entry_id, v_table_id, now())
            ON CONFLICT (entry_id, table_id) DO NOTHING;
        END LOOP;
    END IF;

    -- entry_participants fan-out.
    IF p_participant_ids IS NOT NULL THEN
        FOREACH v_participant IN ARRAY p_participant_ids LOOP
            INSERT INTO public.entry_participants (entry_id, user_id, rating, notes)
            VALUES (
                v_entry_id,
                v_participant,
                CASE WHEN v_participant = p_user_id THEN (p_entry ->> 'rating')::numeric ELSE NULL END,
                CASE WHEN v_participant = p_user_id THEN p_entry ->> 'content' ELSE NULL END
            )
            ON CONFLICT (entry_id, user_id) DO NOTHING;
        END LOOP;
    END IF;

    RETURN QUERY SELECT v_entry_id, false;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[])
    TO service_role;
