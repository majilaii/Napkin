-- TICKET-044: Add kind='live' guards to all live-round SQL RPCs.
--
-- Prevents merged rounds (kind='merged', status=NULL) from leaking into
-- the live state machine. The status=NULL fence is belt; explicit kind='live'
-- guard is suspenders — protects against future status-shape changes.
--
-- Replaced RPCs: start_round, rate_round, maybe_reveal_round.
--
-- [ARCH-REVIEW] verified: no auth.uid() calls; service-role only.
-- All three RPCs use SET search_path = public, pg_temp (SECURITY DEFINER invariant).

-- ── start_round: inserts with kind='live' explicitly ──────────────────────────
-- The start_round RPC already doesn't read existing rows for the kind field,
-- but we add the explicit kind='live' to the INSERT for belt-and-suspenders.

CREATE OR REPLACE FUNCTION public.start_round(
    p_table_id        uuid,
    p_restaurant_id   uuid,
    p_host_user_id    uuid,
    p_host_rating     numeric(2,1),
    p_host_notes      text,
    p_host_dish       text,
    p_photo_urls      text[],
    p_attendee_ids    uuid[],
    p_is_async        boolean DEFAULT true,
    p_vibe_rating     numeric(2,1) DEFAULT NULL,
    p_flavor_rating   numeric(2,1) DEFAULT NULL,
    p_service_rating  numeric(2,1) DEFAULT NULL,
    p_value_rating    numeric(2,1) DEFAULT NULL,
    p_client_nonce    uuid         DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_night_id   uuid;
    v_entry_id   uuid;
    v_invalid    uuid[];
BEGIN
    -- Auth: host must be a member of the table
    IF NOT EXISTS (
        SELECT 1 FROM public.table_members
         WHERE table_id = p_table_id AND member_id = p_host_user_id
    ) THEN
        RAISE EXCEPTION 'NOT_A_TABLE_MEMBER' USING ERRCODE = '42501';
    END IF;

    -- Validate attendees are table members (in one query)
    IF p_attendee_ids IS NOT NULL AND array_length(p_attendee_ids, 1) > 0 THEN
        SELECT COALESCE(array_agg(a), '{}')
          INTO v_invalid
          FROM unnest(p_attendee_ids) a
         WHERE a <> p_host_user_id
           AND NOT EXISTS (
               SELECT 1 FROM public.table_members
                WHERE table_id = p_table_id AND member_id = a
           );
        IF v_invalid IS NOT NULL AND array_length(v_invalid, 1) > 0 THEN
            RAISE EXCEPTION 'ATTENDEE_NOT_MEMBER: %', v_invalid USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- 1. Create round — explicitly kind='live' (TICKET-044 guard)
    INSERT INTO public.table_nights (table_id, restaurant_id, host_user_id, status, is_async, kind)
    VALUES (p_table_id, p_restaurant_id, p_host_user_id, 'rating', COALESCE(p_is_async, true), 'live')
    RETURNING id INTO v_night_id;

    -- 2. Host participant row (ready=true)
    INSERT INTO public.table_night_participants (
        table_night_id, user_id, rating, ready, notes,
        vibe_rating, flavor_rating, service_rating, value_rating
    ) VALUES (
        v_night_id, p_host_user_id, p_host_rating, true, NULLIF(btrim(p_host_notes), ''),
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating
    );

    -- 3. Attendee participant rows (ready=false, excluding host)
    IF p_attendee_ids IS NOT NULL THEN
        INSERT INTO public.table_night_participants (table_night_id, user_id)
        SELECT v_night_id, a
          FROM unnest(p_attendee_ids) a
         WHERE a <> p_host_user_id
        ON CONFLICT DO NOTHING;
    END IF;

    -- 4. Host journal entry
    INSERT INTO public.entries (
        user_id, restaurant_id, table_id, table_night_id,
        rating, content, dish_description, visibility,
        vibe_rating, flavor_rating, service_rating, value_rating,
        photo_url, client_nonce
    ) VALUES (
        p_host_user_id, p_restaurant_id, p_table_id, v_night_id,
        p_host_rating, NULLIF(btrim(p_host_notes), ''), NULLIF(btrim(p_host_dish), ''), 'table',
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating,
        COALESCE(p_photo_urls[1], NULL), p_client_nonce
    )
    RETURNING id INTO v_entry_id;

    -- 5. Host photos with server-computed sort_order
    IF p_photo_urls IS NOT NULL AND array_length(p_photo_urls, 1) > 0 THEN
        INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
        SELECT v_entry_id, url, ord - 1
        FROM unnest(p_photo_urls) WITH ORDINALITY AS u(url, ord);
    END IF;

    -- 6. Solo round (no attendees other than host) → auto-reveal
    IF p_attendee_ids IS NULL OR array_length(p_attendee_ids, 1) = 0
       OR NOT EXISTS (
           SELECT 1 FROM unnest(p_attendee_ids) a WHERE a <> p_host_user_id
       )
    THEN
        -- TICKET-044: guard on kind='live' for belt-and-suspenders
        UPDATE public.table_nights
           SET status = 'revealed', revealed_at = now()
         WHERE id = v_night_id AND status = 'rating' AND kind = 'live';
    END IF;

    RETURN jsonb_build_object(
        'night_id', v_night_id,
        'entry_id', v_entry_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.start_round(uuid, uuid, uuid, numeric, text, text, text[], uuid[], boolean, numeric, numeric, numeric, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_round(uuid, uuid, uuid, numeric, text, text, text[], uuid[], boolean, numeric, numeric, numeric, numeric, uuid) TO service_role;

COMMENT ON FUNCTION public.start_round IS
    'TICKET-037/044: Atomically creates a live round (kind=live). TICKET-044 adds explicit kind=live guard.';


-- ── rate_round: adds kind='live' guard on the initial SELECT and the reveal UPDATE ─

CREATE OR REPLACE FUNCTION public.rate_round(
    p_round_id       uuid,
    p_user_id        uuid,
    p_rating         numeric(2,1),
    p_notes          text,
    p_dish           text,
    p_photo_urls     text[],
    p_vibe_rating    numeric(2,1) DEFAULT NULL,
    p_flavor_rating  numeric(2,1) DEFAULT NULL,
    p_service_rating numeric(2,1) DEFAULT NULL,
    p_value_rating   numeric(2,1) DEFAULT NULL,
    p_client_nonce   uuid         DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_night         public.table_nights;
    v_entry_id      uuid;
    v_new_status    text;
    v_revealed      boolean := false;
BEGIN
    -- Auth: caller must be a participant who has NOT submitted.
    -- TICKET-044: add AND n.kind = 'live' guard — merged rounds (kind='merged')
    -- have no table_night_participants rows and must never enter this path.
    SELECT n.* INTO v_night
    FROM public.table_nights n
    JOIN public.table_night_participants p
      ON p.table_night_id = n.id AND p.user_id = p_user_id
    WHERE n.id = p_round_id
      AND n.kind = 'live'      -- TICKET-044: explicit live guard
    FOR UPDATE OF p;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_A_PARTICIPANT' USING ERRCODE = '42501';
    END IF;

    IF v_night.status <> 'rating' THEN
        RAISE EXCEPTION 'ROUND_NOT_RATING' USING ERRCODE = 'P0001';
    END IF;

    -- 1. Mark ready (idempotent guard via ready=false check)
    UPDATE public.table_night_participants
       SET rating         = p_rating,
           ready          = true,
           notes          = NULLIF(btrim(p_notes), ''),
           vibe_rating    = p_vibe_rating,
           flavor_rating  = p_flavor_rating,
           service_rating = p_service_rating,
           value_rating   = p_value_rating
     WHERE table_night_id = p_round_id
       AND user_id        = p_user_id
       AND ready = false;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ALREADY_SUBMITTED' USING ERRCODE = 'P0001';
    END IF;

    -- 2. Insert journal entry
    INSERT INTO public.entries (
        user_id, restaurant_id, table_id, table_night_id,
        rating, content, dish_description, visibility,
        vibe_rating, flavor_rating, service_rating, value_rating,
        photo_url, client_nonce
    ) VALUES (
        p_user_id, v_night.restaurant_id, v_night.table_id, p_round_id,
        p_rating, NULLIF(btrim(p_notes), ''), NULLIF(btrim(p_dish), ''), 'table',
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating,
        COALESCE(p_photo_urls[1], NULL), p_client_nonce
    )
    RETURNING id INTO v_entry_id;

    -- 3. Photos with server-computed sort_order
    IF p_photo_urls IS NOT NULL AND array_length(p_photo_urls, 1) > 0 THEN
        INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
        SELECT v_entry_id, url, ord - 1
        FROM unnest(p_photo_urls) WITH ORDINALITY AS u(url, ord);
    END IF;

    -- 4. Atomic reveal: TICKET-044 adds kind='live' guard
    UPDATE public.table_nights
       SET status = 'revealed', revealed_at = now()
     WHERE id = p_round_id
       AND status = 'rating'
       AND kind = 'live'      -- TICKET-044: explicit live guard
       AND NOT EXISTS (
           SELECT 1 FROM public.table_night_participants
           WHERE table_night_id = p_round_id AND ready = false
       )
    RETURNING status INTO v_new_status;

    v_revealed := v_new_status = 'revealed';

    RETURN jsonb_build_object(
        'entry_id',     v_entry_id,
        'round_status', COALESCE(v_new_status, v_night.status),
        'revealed',     v_revealed
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rate_round(uuid, uuid, numeric, text, text, text[], numeric, numeric, numeric, numeric, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rate_round(uuid, uuid, numeric, text, text, text[], numeric, numeric, numeric, numeric, uuid) TO service_role;

COMMENT ON FUNCTION public.rate_round IS
    'TICKET-037/044: Atomically rates a live round participant. TICKET-044 adds explicit kind=live guard on SELECT and reveal UPDATE.';


-- ── maybe_reveal_round: adds kind='live' guard on auth check and UPDATE ───────

CREATE OR REPLACE FUNCTION public.maybe_reveal_round(
    p_round_id uuid,
    p_user_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status text;
BEGIN
    -- Auth: caller must be a member of the round's table.
    -- TICKET-044: add AND n.kind = 'live' guard.
    IF NOT EXISTS (
        SELECT 1
          FROM public.table_nights n
          JOIN public.table_members tm ON tm.table_id = n.table_id
         WHERE n.id = p_round_id
           AND n.kind = 'live'      -- TICKET-044: explicit live guard
           AND tm.member_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;

    -- TICKET-044: add kind='live' guard on the UPDATE
    UPDATE public.table_nights
       SET status = 'revealed', revealed_at = now()
     WHERE id = p_round_id
       AND status = 'rating'
       AND kind = 'live'      -- TICKET-044: explicit live guard
       AND NOT EXISTS (
           SELECT 1 FROM public.table_night_participants
            WHERE table_night_id = p_round_id AND ready = false
       )
    RETURNING status INTO v_status;

    IF v_status IS NULL THEN
        SELECT status INTO v_status
        FROM public.table_nights
        WHERE id = p_round_id AND kind = 'live';
    END IF;

    RETURN jsonb_build_object('status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.maybe_reveal_round(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.maybe_reveal_round(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.maybe_reveal_round IS
    'TICKET-037/044: Idempotent nudge to reveal a live round. TICKET-044 adds explicit kind=live guard.';
