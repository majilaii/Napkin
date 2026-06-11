-- Fix: fn_create_entry_with_tables — 42702 "column reference entry_id is ambiguous".
--
-- ROOT CAUSE: the function RETURNS TABLE (entry_id uuid, ...) — PL/pgSQL turns
-- output columns into variables. The ON CONFLICT targets in the entry_tables
-- and entry_participants inserts reference the bare column name `entry_id`,
-- which is ambiguous against that variable → SQLSTATE 42702 at runtime.
--
-- WHY IT SLEPT: PL/pgSQL parses statements lazily, on first execution of the
-- statement path. The deployed `entry` edge function was April-vintage (pre-RPC
-- direct inserts) until the 2026-06-10 function-drift sweep deployed current
-- main — whose create path calls this RPC with p_participant_ids=[author] on
-- EVERY entry. First real execution → every "post a review" 500s.
--
-- FIX: `#variable_conflict use_column` — inside SQL statements, ambiguous
-- names resolve to columns (the correct reading for both ON CONFLICT targets).
-- All intentional variable references are v_-prefixed or parameters, so the
-- pragma changes nothing else. The OUT-column names stay, preserving the wire
-- shape ({entry_id, was_dedup}) the entry edge function reads.
--
-- Body below is byte-identical to 20260509000110 except the pragma line.

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
#variable_conflict use_column
DECLARE
    v_entry_id    uuid;
    v_nonce       uuid;
    v_table_id    uuid;
    v_participant uuid;
BEGIN
    v_nonce := (p_entry ->> 'client_nonce')::uuid;

    -- Fast-path idempotency.
    IF v_nonce IS NOT NULL THEN
        SELECT e.id INTO v_entry_id
        FROM public.entries e
        WHERE e.user_id = p_user_id AND e.client_nonce = v_nonce;
        IF FOUND THEN
            RETURN QUERY SELECT v_entry_id, true;
            RETURN;
        END IF;
    END IF;

    -- Race-safe INSERT.
    BEGIN
        INSERT INTO public.entries (
            user_id, restaurant_id, place_id, user_place_id,
            rating, content, dish_description,
            cooked_by, value_profile,
            visited_at, table_id, table_night_id, visibility,
            vibe_rating, flavor_rating, service_rating, value_rating,
            photo_url, client_nonce
        )
        VALUES (
            p_user_id,
            (p_entry ->> 'restaurant_id')::uuid,
            (p_entry ->> 'place_id')::uuid,
            (p_entry ->> 'user_place_id')::uuid,
            (p_entry ->> 'rating')::numeric,
            p_entry ->> 'content',
            p_entry ->> 'dish_description',
            p_entry ->> 'cooked_by',
            CASE WHEN p_entry ? 'value_profile' AND (p_entry -> 'value_profile') <> 'null'::jsonb
                 THEN p_entry -> 'value_profile' ELSE NULL END,
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
            IF v_nonce IS NULL THEN
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

    -- Fan out into entry_tables.
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
