-- Dedicated visits preserve unknown dates and never change legacy been/pin state.
-- All entry/image mutations keep moderation -> lifecycle -> entry lock order.
BEGIN;

CREATE FUNCTION public.fn_visit_entry_result(p_entry_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $result$
    SELECT pg_catalog.to_jsonb(e) || pg_catalog.jsonb_build_object(
        'photos', CASE WHEN e.photo_url IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.entry_photos p WHERE p.entry_id=e.id AND p.photo_url=e.photo_url
        ) THEN pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id','hero:' || e.id::text,'url',e.photo_url))
          ELSE '[]'::jsonb END || COALESCE((
            SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.id, 'url', p.photo_url)
                ORDER BY p.sort_order, p.id)
            FROM public.entry_photos p WHERE p.entry_id = e.id
        ), '[]'::jsonb),
        'is_bare', e.restaurant_id IS NOT NULL AND e.place_id IS NULL AND e.user_place_id IS NULL
            AND e.visited_at IS NULL AND e.rating IS NULL
            AND e.vibe_rating IS NULL AND e.flavor_rating IS NULL
            AND e.service_rating IS NULL AND e.value_rating IS NULL
            AND e.content IS NULL AND e.dish_description IS NULL AND e.cooked_by IS NULL
            AND e.value_profile IS NULL AND e.photo_url IS NULL AND NOT COALESCE(e.liked, false)
            AND e.table_id IS NULL AND e.table_night_id IS NULL AND e.supper_id IS NULL
            AND e.visibility = 'friends'
            AND NOT EXISTS (SELECT 1 FROM public.entry_photos p WHERE p.entry_id = e.id)
            AND NOT EXISTS (SELECT 1 FROM public.entry_tables t WHERE t.entry_id = e.id)
            AND NOT EXISTS (SELECT 1 FROM public.entry_companions c WHERE c.entry_id = e.id)
            AND NOT EXISTS (SELECT 1 FROM public.entry_participants p WHERE p.entry_id = e.id
                AND (p.user_id <> e.user_id OR p.rating IS NOT NULL OR p.notes IS NOT NULL))
            AND NOT EXISTS (SELECT 1 FROM public.round_entries r WHERE r.entry_id = e.id)
    ) FROM public.entries e WHERE e.id = p_entry_id;
$result$;

CREATE FUNCTION public.fn_record_visit(p_user_id uuid, p_restaurant_id uuid, p_client_nonce uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $record$
DECLARE
    v_restaurant_id uuid;
    v_existing public.entries;
    v_created record;
BEGIN
    IF p_user_id IS NULL OR p_restaurant_id IS NULL OR p_client_nonce IS NULL THEN
        RAISE EXCEPTION 'visit_input_required' USING ERRCODE = '22023';
    END IF;
    PERFORM public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    v_restaurant_id := public.fn_resolve_canonical(p_restaurant_id);
    -- Resolver fallback is not evidence of existence. Private import ghosts
    -- are writable only by their creator until canonicalised.
    PERFORM 1 FROM public.restaurants r WHERE r.id = v_restaurant_id
        AND r.merged_into IS NULL
        AND (r.verification IS DISTINCT FROM 'unverified' OR r.created_by = p_user_id)
        FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND' USING ERRCODE = 'P0001'; END IF;

    SELECT e.* INTO v_existing FROM public.entries e
    WHERE e.user_id = p_user_id AND e.client_nonce = p_client_nonce FOR UPDATE;
    IF FOUND THEN
        IF v_existing.restaurant_id IS NULL OR
            public.fn_resolve_canonical(v_existing.restaurant_id) IS DISTINCT FROM v_restaurant_id THEN
            RAISE EXCEPTION 'VISIT_NONCE_MISMATCH' USING ERRCODE = 'P0001';
        END IF;
        RETURN public.fn_visit_entry_result(v_existing.id) || pg_catalog.jsonb_build_object('was_dedup', true);
    END IF;

    SELECT * INTO v_created FROM public.fn_create_entry_with_tables(
        p_user_id, pg_catalog.jsonb_build_object(
            'restaurant_id', v_restaurant_id, 'client_nonce', p_client_nonce,
            'visited_at', NULL, 'rating', NULL, 'content', NULL,
            'liked', false, 'visibility', 'friends'
        ), '{}'::uuid[], ARRAY[p_user_id], '{}'::uuid[]
    );
    -- The existing writer also dedups old-client races; check that row too.
    SELECT e.* INTO v_existing FROM public.entries e WHERE e.id = v_created.entry_id FOR UPDATE;
    IF v_existing.restaurant_id IS NULL OR
        public.fn_resolve_canonical(v_existing.restaurant_id) IS DISTINCT FROM v_restaurant_id THEN
        RAISE EXCEPTION 'VISIT_NONCE_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN public.fn_visit_entry_result(v_created.entry_id)
        || pg_catalog.jsonb_build_object('was_dedup', v_created.was_dedup);
END;
$record$;

CREATE FUNCTION public.fn_save_visit(p_user_id uuid, p_entry_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $save$
DECLARE
    v_entry public.entries;
    v_photo record;
    v_url text;
    v_urls text[];
    v_photo_ids uuid[] := '{}'::uuid[];
    v_photo_id uuid;
    v_order integer := 0;
    v_date timestamptz;
    v_legacy_hero text;
    v_current_hero text;
BEGIN
    IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
        OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) k
            WHERE k NOT IN ('rating','content','visited_at','photo_urls')) THEN
        RAISE EXCEPTION 'invalid_visit_patch' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'rating' AND p_patch -> 'rating' <> 'null'::jsonb THEN
        IF pg_catalog.jsonb_typeof(p_patch -> 'rating') <> 'number'
            OR (p_patch ->> 'rating')::numeric NOT BETWEEN 0.5 AND 5
            OR mod((p_patch ->> 'rating')::numeric * 2, 1) <> 0 THEN
            RAISE EXCEPTION 'invalid_visit_rating' USING ERRCODE = '22023';
        END IF;
    END IF;
    IF p_patch ? 'content' AND p_patch -> 'content' <> 'null'::jsonb AND
        (pg_catalog.jsonb_typeof(p_patch -> 'content') <> 'string' OR pg_catalog.length(p_patch ->> 'content') > 10000) THEN
        RAISE EXCEPTION 'invalid_visit_content' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'visited_at' AND p_patch -> 'visited_at' <> 'null'::jsonb THEN
        IF pg_catalog.jsonb_typeof(p_patch -> 'visited_at') <> 'string' OR
            (p_patch ->> 'visited_at') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
            RAISE EXCEPTION 'invalid_visit_date' USING ERRCODE = '22023';
        END IF;
        BEGIN
            v_date := (p_patch ->> 'visited_at')::timestamptz;
        EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
            RAISE EXCEPTION 'invalid_visit_date' USING ERRCODE = '22023';
        END;
        IF NOT pg_catalog.isfinite(v_date) OR
            (v_date AT TIME ZONE 'UTC')::date > (pg_catalog.now() AT TIME ZONE 'UTC')::date THEN
            RAISE EXCEPTION 'invalid_visit_date' USING ERRCODE = '22023';
        END IF;
    END IF;
    IF p_patch ? 'photo_urls' THEN
        IF pg_catalog.jsonb_typeof(p_patch -> 'photo_urls') <> 'array' THEN
            RAISE EXCEPTION 'invalid_visit_photos' USING ERRCODE = '22023';
        END IF;
        IF pg_catalog.jsonb_array_length(p_patch -> 'photo_urls') > 10 OR EXISTS (
            SELECT 1 FROM pg_catalog.jsonb_array_elements(p_patch -> 'photo_urls') x
            WHERE pg_catalog.jsonb_typeof(x) <> 'string' OR pg_catalog.length(x #>> '{}') > 2048
                OR (x #>> '{}') !~ '^https?://[^[:space:]]+$'
        ) THEN RAISE EXCEPTION 'invalid_visit_photos' USING ERRCODE = '22023'; END IF;
        SELECT COALESCE(pg_catalog.array_agg(value ORDER BY ord), '{}'::text[]) INTO v_urls
        FROM pg_catalog.jsonb_array_elements_text(p_patch -> 'photo_urls') WITH ORDINALITY a(value, ord);
        IF pg_catalog.cardinality(v_urls) <> (SELECT count(DISTINCT u) FROM unnest(v_urls) u) THEN
            RAISE EXCEPTION 'invalid_visit_photos' USING ERRCODE = '22023';
        END IF;
    END IF;

    PERFORM public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    SELECT e.* INTO v_entry FROM public.entries e
    WHERE e.id = p_entry_id AND e.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501'; END IF;
    IF v_entry.restaurant_id IS NULL OR v_entry.supper_id IS NOT NULL OR v_entry.table_night_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.round_entries r WHERE r.entry_id = p_entry_id)
        OR EXISTS (SELECT 1 FROM public.entry_participants p WHERE p.entry_id = p_entry_id AND p.user_id <> p_user_id) THEN
        RAISE EXCEPTION 'VISIT_NOT_SOLO' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.entries e SET
        rating = CASE WHEN p_patch ? 'rating' THEN (p_patch ->> 'rating')::numeric ELSE e.rating END,
        content = CASE WHEN p_patch ? 'content' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'content'), '') ELSE e.content END,
        visited_at = CASE WHEN p_patch ? 'visited_at' THEN v_date ELSE e.visited_at END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE e.id = p_entry_id;
    -- Keep the existing author's take aligned without creating a gathering.
    UPDATE public.entry_participants p SET
        rating = CASE WHEN p_patch ? 'rating' THEN (p_patch ->> 'rating')::numeric ELSE p.rating END,
        notes = CASE WHEN p_patch ? 'content' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'content'), '') ELSE p.notes END
    WHERE p.entry_id = p_entry_id AND p.user_id = p_user_id;

    IF p_patch ? 'photo_urls' THEN
        IF v_entry.photo_url IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM public.entry_photos p WHERE p.entry_id=p_entry_id AND p.photo_url=v_entry.photo_url
        ) THEN
            v_legacy_hero := v_entry.photo_url;
            IF v_legacy_hero=ANY(v_urls) AND v_urls[1] IS DISTINCT FROM v_legacy_hero THEN
                RAISE EXCEPTION 'invalid_visit_photo_order' USING ERRCODE='22023';
            END IF;
        END IF;
        -- Keep an existing legacy hero in its original sink. Copying an old
        -- unregistered URL into a new photo sink would bypass moderation.
        -- Keep retained photo IDs stable, append through the moderated writer,
        -- then delete removed photos and set the final hero through its writer.
        FOREACH v_url IN ARRAY v_urls LOOP
            IF v_url = v_legacy_hero THEN CONTINUE; END IF;
            SELECT p.id INTO v_photo_id FROM public.entry_photos p
            WHERE p.entry_id = p_entry_id AND p.photo_url = v_url ORDER BY p.sort_order, p.id LIMIT 1;
            IF NOT FOUND THEN
                v_photo_id := (public.append_entry_photo(p_entry_id, p_user_id, v_url) ->> 'id')::uuid;
            END IF;
            v_photo_ids := pg_catalog.array_append(v_photo_ids, v_photo_id);
        END LOOP;
        FOR v_photo IN SELECT p.id FROM public.entry_photos p
            WHERE p.entry_id = p_entry_id AND NOT (p.id = ANY(v_photo_ids)) ORDER BY p.sort_order, p.id LOOP
            PERFORM public.fn_delete_entry_photo(p_user_id, v_photo.id);
        END LOOP;
        FOREACH v_photo_id IN ARRAY v_photo_ids LOOP
            UPDATE public.entry_photos p SET sort_order = v_order WHERE p.id = v_photo_id;
            v_order := v_order + 1;
        END LOOP;
        v_url := v_urls[1];
        SELECT e.photo_url INTO v_current_hero FROM public.entries e WHERE e.id=p_entry_id;
        IF v_url IS DISTINCT FROM v_current_hero THEN
            PERFORM public.fn_set_entry_hero(p_user_id, p_entry_id, v_url);
        END IF;
    END IF;
    RETURN public.fn_visit_entry_result(p_entry_id);
END;
$save$;

CREATE FUNCTION public.fn_undo_visit(p_user_id uuid, p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $undo$
DECLARE
    v_entry public.entries;
BEGIN
    PERFORM public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    -- FOR UPDATE conflicts with scalar edits and FK key-share locks on new
    -- photos, companions, participants, shares and round membership.
    SELECT e.* INTO v_entry FROM public.entries e
    WHERE e.id = p_entry_id AND e.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501'; END IF;
    IF NOT COALESCE((public.fn_visit_entry_result(p_entry_id) ->> 'is_bare')::boolean, false)
        OR EXISTS (SELECT 1 FROM public.entries e
            WHERE e.user_id = p_user_id AND e.restaurant_id = v_entry.restaurant_id
                AND (e.created_at, e.id) > (v_entry.created_at, v_entry.id)) THEN
        RAISE EXCEPTION 'VISIT_UNDO_REFUSED' USING ERRCODE = 'P0001';
    END IF;
    RETURN public.fn_delete_entry(p_user_id, p_entry_id)
        || pg_catalog.jsonb_build_object('restaurant_id', v_entry.restaurant_id);
END;
$undo$;

REVOKE ALL ON FUNCTION public.fn_visit_entry_result(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_record_visit(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_save_visit(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_undo_visit(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_visit_entry_result(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_record_visit(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_save_visit(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_undo_visit(uuid, uuid) TO service_role;
COMMIT;
