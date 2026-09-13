-- The current meal composer can enrich one exact check-in in one transaction.
-- Patch omissions preserve existing fields; explicit audience arrays replace
-- only that set. No entry identity, visit count, chronology, visibility default,
-- gathering conversion, image moderation or undo contract changes.
-- Rollback: restore fn_save_visit from 20260905210957_reviews_visit_actions.sql
-- after rolling the app back to its original patch shape. No data is dropped.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_save_visit(p_user_id uuid, p_entry_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $save$
DECLARE
    v_entry public.entries;
    v_key text;
    v_table_ids uuid[];
    v_companion_ids uuid[];
    v_membership_count integer;
    v_photo record;
    v_url text;
    v_urls text[];
    v_photo_ids uuid[] := '{}'::uuid[];
    v_photo_id uuid;
    v_order integer := 0;
    v_sort_offset integer;
    v_date timestamptz;
    v_legacy_hero text;
    v_current_hero text;
BEGIN
    IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object'
        OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) k
            WHERE k NOT IN ('rating','content','visited_at','photo_urls','liked',
                'vibe_rating','flavor_rating','service_rating','value_rating','table_ids','companion_ids')) THEN
        RAISE EXCEPTION 'invalid_visit_patch' USING ERRCODE = '22023';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['rating','vibe_rating','flavor_rating','service_rating','value_rating'] LOOP
        IF p_patch ? v_key AND p_patch -> v_key <> 'null'::jsonb THEN
            IF pg_catalog.jsonb_typeof(p_patch -> v_key) <> 'number'
                OR (p_patch ->> v_key)::numeric NOT BETWEEN 0.5 AND 5
                OR mod((p_patch ->> v_key)::numeric * 2, 1) <> 0 THEN
                RAISE EXCEPTION 'invalid_visit_rating' USING ERRCODE = '22023';
            END IF;
        END IF;
    END LOOP;
    IF p_patch ? 'liked' AND pg_catalog.jsonb_typeof(p_patch -> 'liked') <> 'boolean' THEN
        RAISE EXCEPTION 'invalid_visit_liked' USING ERRCODE = '22023';
    END IF;
    FOREACH v_key IN ARRAY ARRAY['table_ids','companion_ids'] LOOP
        IF p_patch ? v_key THEN
            IF pg_catalog.jsonb_typeof(p_patch -> v_key) <> 'array' THEN
                RAISE EXCEPTION 'invalid_visit_audience' USING ERRCODE = '22023';
            END IF;
            IF (v_key = 'table_ids' AND pg_catalog.jsonb_array_length(p_patch -> v_key) > 10)
                OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_patch -> v_key) x
                    WHERE pg_catalog.jsonb_typeof(x) <> 'string'
                        OR (x #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
                RAISE EXCEPTION 'invalid_visit_audience' USING ERRCODE = '22023';
            END IF;
            IF pg_catalog.jsonb_array_length(p_patch -> v_key) <>
                (SELECT count(DISTINCT (value #>> '{}')::uuid)
                    FROM pg_catalog.jsonb_array_elements(p_patch -> v_key)) THEN
                RAISE EXCEPTION 'invalid_visit_audience' USING ERRCODE = '22023';
            END IF;
        END IF;
    END LOOP;
    IF p_patch ? 'table_ids' THEN
        SELECT COALESCE(pg_catalog.array_agg(value::uuid ORDER BY ord), '{}'::uuid[]) INTO v_table_ids
        FROM pg_catalog.jsonb_array_elements_text(p_patch -> 'table_ids') WITH ORDINALITY a(value, ord);
    END IF;
    IF p_patch ? 'companion_ids' THEN
        SELECT COALESCE(pg_catalog.array_agg(value::uuid ORDER BY ord), '{}'::uuid[]) INTO v_companion_ids
        FROM pg_catalog.jsonb_array_elements_text(p_patch -> 'companion_ids') WITH ORDINALITY a(value, ord);
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
    -- Match the gathering writer's membership-before-entry lock order. Holding
    -- the current member rows prevents a concurrent leave from authorizing a
    -- new share after membership has disappeared.
    IF v_table_ids IS NOT NULL THEN
        PERFORM 1 FROM public.table_members tm
        WHERE tm.member_id = p_user_id AND tm.table_id = ANY(v_table_ids)
        ORDER BY tm.table_id FOR KEY SHARE;
        GET DIAGNOSTICS v_membership_count = ROW_COUNT;
        IF v_membership_count <> pg_catalog.cardinality(v_table_ids) THEN
            RAISE EXCEPTION 'TABLE_NOT_AUTHORIZED' USING ERRCODE = '42501';
        END IF;
    END IF;
    SELECT e.* INTO v_entry FROM public.entries e
    WHERE e.id = p_entry_id AND e.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501'; END IF;
    IF v_entry.restaurant_id IS NULL OR v_entry.supper_id IS NOT NULL OR v_entry.table_night_id IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.round_entries r WHERE r.entry_id = p_entry_id)
        OR EXISTS (SELECT 1 FROM public.entry_participants p WHERE p.entry_id = p_entry_id AND p.user_id <> p_user_id) THEN
        RAISE EXCEPTION 'VISIT_NOT_SOLO' USING ERRCODE = 'P0001';
    END IF;
    -- Tagging grants access to the entry. Repeat the existing service writer's
    -- mutual-follow and both-direction block gate inside this transaction. A
    -- stale choice refuses the entire save, so no requested review is lost.
    IF v_companion_ids IS NOT NULL AND EXISTS (
        SELECT 1 FROM unnest(v_companion_ids) target_id
        WHERE target_id = p_user_id
            OR NOT EXISTS (SELECT 1 FROM public.follows f
                WHERE f.follower_id = p_user_id AND f.following_id = target_id)
            OR NOT EXISTS (SELECT 1 FROM public.follows f
                WHERE f.follower_id = target_id AND f.following_id = p_user_id)
            OR EXISTS (SELECT 1 FROM public.blocked_users b
                WHERE (b.blocker_id = p_user_id AND b.blocked_id = target_id)
                    OR (b.blocker_id = target_id AND b.blocked_id = p_user_id))
    ) THEN
        RAISE EXCEPTION 'COMPANION_NOT_AUTHORIZED' USING ERRCODE = '42501';
    END IF;
    UPDATE public.entries e SET
        rating = CASE WHEN p_patch ? 'rating' THEN (p_patch ->> 'rating')::numeric ELSE e.rating END,
        content = CASE WHEN p_patch ? 'content' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'content'), '') ELSE e.content END,
        visited_at = CASE WHEN p_patch ? 'visited_at' THEN v_date ELSE e.visited_at END,
        liked = CASE WHEN p_patch ? 'liked' THEN (p_patch ->> 'liked')::boolean ELSE e.liked END,
        vibe_rating = CASE WHEN p_patch ? 'vibe_rating' THEN (p_patch ->> 'vibe_rating')::numeric ELSE e.vibe_rating END,
        flavor_rating = CASE WHEN p_patch ? 'flavor_rating' THEN (p_patch ->> 'flavor_rating')::numeric ELSE e.flavor_rating END,
        service_rating = CASE WHEN p_patch ? 'service_rating' THEN (p_patch ->> 'service_rating')::numeric ELSE e.service_rating END,
        value_rating = CASE WHEN p_patch ? 'value_rating' THEN (p_patch ->> 'value_rating')::numeric ELSE e.value_rating END,
        updated_at = pg_catalog.clock_timestamp()
    WHERE e.id = p_entry_id;
    -- Keep the existing author's take aligned without creating a gathering.
    UPDATE public.entry_participants p SET
        rating = CASE WHEN p_patch ? 'rating' THEN (p_patch ->> 'rating')::numeric ELSE p.rating END,
        notes = CASE WHEN p_patch ? 'content' THEN NULLIF(pg_catalog.btrim(p_patch ->> 'content'), '') ELSE p.notes END
    WHERE p.entry_id = p_entry_id AND p.user_id = p_user_id;

    IF v_companion_ids IS NOT NULL THEN
        DELETE FROM public.entry_companions c
        WHERE c.entry_id = p_entry_id AND NOT (c.user_id = ANY(v_companion_ids));
        INSERT INTO public.entry_companions(entry_id, user_id)
        SELECT p_entry_id, target_id FROM unnest(v_companion_ids) target_id
        ON CONFLICT (entry_id, user_id) DO NOTHING;
    END IF;
    IF v_table_ids IS NOT NULL THEN
        -- Retained shares keep their posted_at cursor; only new shares get now.
        INSERT INTO public.entry_tables(entry_id, table_id, posted_at)
        SELECT p_entry_id, target_id, pg_catalog.now() FROM unnest(v_table_ids) target_id
        ON CONFLICT (entry_id, table_id) DO NOTHING;
        UPDATE public.entries SET table_id = v_table_ids[1] WHERE id = p_entry_id;
        DELETE FROM public.entry_tables t
        WHERE t.entry_id = p_entry_id AND NOT (t.table_id = ANY(v_table_ids));
        -- Visibility is intentionally preserved, including existing private logs.
    END IF;

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
        -- The real schema has a unique (entry_id, sort_order) index. Move
        -- retained rows above the occupied range before assigning final slots.
        SELECT COALESCE(max(p.sort_order), -1) + 1 INTO v_sort_offset
        FROM public.entry_photos p WHERE p.entry_id = p_entry_id;
        UPDATE public.entry_photos p SET sort_order = p.sort_order + v_sort_offset
        WHERE p.entry_id = p_entry_id;
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
    RETURN public.fn_visit_entry_result(p_entry_id) || pg_catalog.jsonb_build_object(
        'table_ids', COALESCE((SELECT pg_catalog.jsonb_agg(t.table_id ORDER BY t.posted_at, t.table_id)
            FROM public.entry_tables t WHERE t.entry_id = p_entry_id), '[]'::jsonb),
        'companion_ids', COALESCE((SELECT pg_catalog.jsonb_agg(c.user_id ORDER BY c.user_id)
            FROM public.entry_companions c WHERE c.entry_id = p_entry_id), '[]'::jsonb)
    );
END;
$save$;

REVOKE ALL ON FUNCTION public.fn_save_visit(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_save_visit(uuid, uuid, jsonb) TO service_role;
COMMIT;
