-- Quick check-ins are dated today (founder order 2026-09-06). A bare visit no
-- longer means "undated": the date is metadata, not review content, so the
-- undo guard keeps refusing only rated/written/photographed/shared entries.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_visit_entry_result(p_entry_id uuid)
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
            AND e.rating IS NULL
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

CREATE OR REPLACE FUNCTION public.fn_record_visit(p_user_id uuid, p_restaurant_id uuid, p_client_nonce uuid)
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

    -- A check-in is dated today. The user can move it if it was retrospective.
    SELECT * INTO v_created FROM public.fn_create_entry_with_tables(
        p_user_id, pg_catalog.jsonb_build_object(
            'restaurant_id', v_restaurant_id, 'client_nonce', p_client_nonce,
            'visited_at', pg_catalog.now(), 'rating', NULL, 'content', NULL,
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

COMMIT;
