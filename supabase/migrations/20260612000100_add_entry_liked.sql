-- TICKET-075: Letterboxd-style "like" on entries.
--
-- A like is DISTINCT from the rating — you can rate 3.5 AND heart it. It is the
-- author's own like only (v1); social likes on other users' entries are out of scope.
--
-- 1) Add the column (idempotent, NOT NULL DEFAULT false so existing rows read false).
ALTER TABLE public.entries
    ADD COLUMN IF NOT EXISTS liked boolean NOT NULL DEFAULT false;

-- 2) CREATE OR REPLACE fn_create_entry_with_tables to carry `liked` from p_entry.
--
--    CRITICAL: the body below is byte-identical to 20260611000200 EXCEPT for the two
--    added lines that thread `liked` into the INSERT (column list + VALUES). The
--    `#variable_conflict use_column` pragma MUST stay — without it the ON CONFLICT
--    targets reference the ambiguous OUT-column `entry_id` and EVERY entry create 500s
--    with SQLSTATE 42702 (the outage 20260611000200 fixed). Do not regress it.

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
            liked,
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
            COALESCE((p_entry ->> 'liked')::boolean, false),
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

-- 3) CREATE OR REPLACE fn_my_solo_entries to surface `liked` in the journal feed.
--    Body byte-identical to 20260509000070 except the added `liked` column in both
--    the RETURNS TABLE signature and the SELECT list. Same REVOKE/GRANT.
CREATE OR REPLACE FUNCTION public.fn_my_solo_entries(p_user_id uuid, p_limit int DEFAULT 50)
RETURNS TABLE (
    id uuid,
    user_id uuid,
    restaurant_id uuid,
    rating numeric,
    content text,
    dish_description text,
    visited_at timestamptz,
    created_at timestamptz,
    photo_url text,
    liked boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        e.id,
        e.user_id,
        e.restaurant_id,
        e.rating,
        e.content,
        e.dish_description,
        e.visited_at,
        e.created_at,
        e.photo_url,
        e.liked
    FROM public.entries e
    WHERE e.user_id = p_user_id
      AND p_user_id = auth.uid()   -- security: caller can only read own entries
      AND e.table_id IS NULL
      AND e.table_night_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.entry_tables et WHERE et.entry_id = e.id)
    ORDER BY COALESCE(e.visited_at, e.created_at) DESC
    LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_my_solo_entries(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_solo_entries(uuid, int) TO authenticated;
