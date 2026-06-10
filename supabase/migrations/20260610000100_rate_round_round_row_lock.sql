-- Reland the rate_round round-row lock (race fix).
--
-- History: the original fix (lock BOTH the round row and the participant row)
-- was applied directly to the remote DB in April 2026 but the migration edit
-- only lived on an unmerged branch (commit 24bbce1). TICKET-044's rewrite in
-- 20260509000250_rpc_live_round_kind_guards.sql then CREATE OR REPLACE'd
-- rate_round from the un-fixed base — silently reverting the lock in prod.
--
-- The race: under READ COMMITTED, two concurrent rate_round calls that only
-- lock their own participant rows (FOR UPDATE OF p) can each miss the other's
-- ready-flag flip, both fail the reveal NOT EXISTS predicate, and the round
-- sticks in 'rating' forever. Locking the round row (FOR UPDATE OF n, p)
-- serializes every rate_round call for the round, so the last committer's
-- reveal check sees all ready flags.
--
-- Body below is identical to 20260509000250 (kind='live' guards intact)
-- except the FOR UPDATE clause.

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
    -- TICKET-044: AND n.kind = 'live' guard — merged rounds (kind='merged')
    -- have no table_night_participants rows and must never enter this path.
    -- Lock BOTH the round row AND the participant row: the round-row lock
    -- serializes concurrent rate_round calls so the reveal NOT EXISTS check
    -- below sees every committed ready-flag flip.
    SELECT n.* INTO v_night
    FROM public.table_nights n
    JOIN public.table_night_participants p
      ON p.table_night_id = n.id AND p.user_id = p_user_id
    WHERE n.id = p_round_id
      AND n.kind = 'live'      -- TICKET-044: explicit live guard
    FOR UPDATE OF n, p;

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
    'TICKET-037/044: Atomically rates a live round participant. kind=live guards on SELECT and reveal UPDATE; FOR UPDATE OF n, p serializes concurrent raters so the reveal predicate sees all ready flags.';
