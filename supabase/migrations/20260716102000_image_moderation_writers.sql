-- TICKET-196 B-0: flag-aware image sink writers.
-- Existing hot RPC signatures are preserved exactly.  Enforcement ships OFF,
-- so old clients remain compatible until the held B-2 activation migration.

CREATE OR REPLACE FUNCTION public.fn_lock_moderation_enforcement()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enabled boolean;
BEGIN
    SELECT c.enforce INTO STRICT v_enabled
    FROM public.moderation_config c
    WHERE c.key = 'image_moderation'
    FOR SHARE;
    RETURN v_enabled;
EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'moderation_config_missing' USING ERRCODE = '55000';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_lock_grandfather_sweep()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enabled boolean;
BEGIN
    SELECT c.enforce INTO STRICT v_enabled
    FROM public.moderation_config c
    WHERE c.key = 'grandfather_sweep'
    FOR SHARE;
    RETURN v_enabled;
EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'moderation_config_missing' USING ERRCODE = '55000';
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_set_enforcement(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    UPDATE public.moderation_config c
    SET enforce = p_enabled, updated_at = pg_catalog.clock_timestamp()
    WHERE c.key = 'image_moderation';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'moderation_config_missing' USING ERRCODE = '55000';
    END IF;
    RETURN p_enabled;
END;
$fn$;

-- Synchronously remove a ref, then queue object-level GC.  Replacement queues
-- deliberately carry no sink identity: a later worker must never unlink a new
-- ref which reused the same avatar/hero slot.
CREATE OR REPLACE FUNCTION public.fn_unbind_image_ref(
    p_sink_kind text,
    p_sink_id text,
    p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_object_id uuid;
    v_user_id uuid;
BEGIN
    DELETE FROM public.image_object_refs r
    WHERE r.sink_kind = p_sink_kind AND r.sink_id = p_sink_id
    RETURNING r.object_id INTO v_object_id;
    IF v_object_id IS NOT NULL THEN
        SELECT o.user_id INTO v_user_id
        FROM public.user_image_objects o WHERE o.id = v_object_id;
        INSERT INTO public.image_gc_queue (user_id, reason, object_id)
        VALUES (v_user_id, p_reason, v_object_id);
    END IF;
    RETURN v_object_id;
END;
$fn$;

-- Validate and bind one exact sink slot.  Approved storage_path input is
-- canonicalized to the registry's exact public_url before it reaches a sink.
-- OFF accepts legacy raw URLs but still unbinds any replaced approved object.
CREATE OR REPLACE FUNCTION public.fn_bind_image_ref(
    p_user_id uuid,
    p_image_value text,
    p_expected_bucket text,
    p_sink_kind text,
    p_sink_id text,
    p_enforce boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_value text := NULLIF(pg_catalog.btrim(p_image_value), '');
    v_object public.user_image_objects;
    v_existing public.image_object_refs;
    v_approved_namespace boolean := false;
BEGIN
    IF p_expected_bucket NOT IN ('avatars', 'entry-photos')
       OR p_sink_kind NOT IN ('avatar', 'entry_photo', 'entry_hero') THEN
        RAISE EXCEPTION 'invalid_image_sink' USING ERRCODE = '22023';
    END IF;

    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF EXISTS (
        SELECT 1 FROM public.account_deletions d
        WHERE d.user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'account_deleting' USING ERRCODE = '55000';
    END IF;

    IF v_value IS NULL THEN
        SELECT r.* INTO v_existing
        FROM public.image_object_refs r
        WHERE r.sink_kind = p_sink_kind AND r.sink_id = p_sink_id
        FOR UPDATE;
        IF FOUND THEN
            PERFORM public.fn_unbind_image_ref(p_sink_kind, p_sink_id, p_sink_kind || '_removed');
        END IF;
        RETURN NULL;
    END IF;

    -- Bind fencing is object -> exact ref everywhere.  Reconciliation locks the
    -- object before its refs so taking the target object first here prevents a
    -- bind/reconcile deadlock and ensures a missing-byte repair wins cleanly.
    SELECT o.* INTO v_object
    FROM public.user_image_objects o
    WHERE o.user_id = p_user_id
      AND o.bucket = p_expected_bucket
      AND (o.public_url = v_value OR o.storage_path = v_value)
    FOR UPDATE;

    IF NOT FOUND THEN
        -- OFF mode accepts historical raw URLs, never a canonical approved
        -- namespace whose caller-owned registry row is absent.  The latter can
        -- happen when reconciliation removes missing bytes while this binder is
        -- waiting, or when a caller supplies another user's approved URL.  In
        -- both cases treating the value as legacy would create an untracked,
        -- dangling sink.
        v_approved_namespace := pg_catalog.left(v_value, 9) = 'approved/'
            OR EXISTS (
                SELECT 1
                FROM public.image_storage_origins s
                CROSS JOIN (
                    VALUES ('avatars'::text), ('entry-photos'::text)
                ) AS reserved_bucket(bucket)
                WHERE pg_catalog.left(
                    v_value,
                    pg_catalog.length(
                        s.origin || '/storage/v1/object/public/'
                        || reserved_bucket.bucket || '/approved/'
                    )
                ) = s.origin || '/storage/v1/object/public/'
                    || reserved_bucket.bucket || '/approved/'
            );
        IF COALESCE(p_enforce, true) OR v_approved_namespace THEN
            RAISE EXCEPTION 'approved_image_required' USING ERRCODE = 'P0001';
        END IF;
        SELECT r.* INTO v_existing
        FROM public.image_object_refs r
        WHERE r.sink_kind = p_sink_kind AND r.sink_id = p_sink_id
        FOR UPDATE;
        IF v_existing.id IS NOT NULL THEN
            PERFORM public.fn_unbind_image_ref(p_sink_kind, p_sink_id, p_sink_kind || '_legacy_replace');
        END IF;
        RETURN v_value;
    END IF;

    -- A registered URL is never legacy raw input.  Lock it regardless of
    -- lifecycle state so a GC claim and a bind serialize on the same row; if
    -- GC won, OFF-mode compatibility must not turn a deleting object into a
    -- dangling legacy sink.
    IF v_object.state <> 'approved' THEN
        RAISE EXCEPTION 'image_object_not_bindable' USING ERRCODE = '55000';
    END IF;

    SELECT r.* INTO v_existing
    FROM public.image_object_refs r
    WHERE r.sink_kind = p_sink_kind AND r.sink_id = p_sink_id
    FOR UPDATE;

    IF v_existing.id IS NOT NULL AND v_existing.object_id <> v_object.id THEN
        PERFORM public.fn_unbind_image_ref(p_sink_kind, p_sink_id, p_sink_kind || '_replace');
        v_existing := NULL;
    END IF;
    IF v_existing.id IS NULL THEN
        INSERT INTO public.image_object_refs (object_id, sink_kind, sink_id)
        VALUES (v_object.id, p_sink_kind, p_sink_id);
    END IF;
    UPDATE public.user_image_objects o
    SET bound_at = COALESCE(o.bound_at, pg_catalog.clock_timestamp())
    WHERE o.id = v_object.id;
    RETURN v_object.public_url;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_complete_onboarding(
    p_user_id uuid,
    p_display_name text,
    p_home_city text,
    p_avatar_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enforce boolean;
    v_name text := NULLIF(pg_catalog.btrim(p_display_name), '');
    v_city text := NULLIF(pg_catalog.btrim(p_home_city), '');
    v_avatar text := NULLIF(pg_catalog.btrim(p_avatar_url), '');
    v_profile public.profiles;
BEGIN
    v_enforce := public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF p_display_name IS NOT NULL AND (v_name IS NULL OR pg_catalog.length(v_name) > 80) THEN
        RAISE EXCEPTION 'invalid_display_name' USING ERRCODE = '22023';
    END IF;
    IF v_city IS NOT NULL AND pg_catalog.length(v_city) > 120 THEN
        v_city := pg_catalog.left(v_city, 120);
    END IF;
    IF v_avatar IS NOT NULL AND pg_catalog.length(v_avatar) > 500 THEN
        RAISE EXCEPTION 'invalid_avatar_url' USING ERRCODE = '22023';
    END IF;
    IF v_enforce AND v_avatar IS NULL THEN
        RAISE EXCEPTION 'avatar_required' USING ERRCODE = 'P0001';
    END IF;

    v_avatar := public.fn_bind_image_ref(
        p_user_id, v_avatar, 'avatars', 'avatar', p_user_id::text, v_enforce
    );
    -- Pre-B-2 raw compatibility remains own-folder-only.
    IF NOT v_enforce AND v_avatar IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.user_image_objects o
           WHERE o.user_id = p_user_id AND o.bucket = 'avatars'
             AND o.public_url = v_avatar AND o.state = 'approved'
       )
       AND NOT EXISTS (
           SELECT 1 FROM public.image_storage_origins o
           WHERE v_avatar LIKE o.origin || '/storage/v1/object/public/avatars/'
                                  || p_user_id::text || '/%'
       )
    THEN
        RAISE EXCEPTION 'invalid_avatar_url' USING ERRCODE = '22023';
    END IF;

    UPDATE public.profiles p
    SET display_name = CASE WHEN p_display_name IS NULL THEN p.display_name ELSE v_name END,
        home_city = CASE WHEN p_home_city IS NULL THEN NULL ELSE v_city END,
        avatar_url = v_avatar,
        onboarded_at = pg_catalog.clock_timestamp(),
        terms_accepted_at = pg_catalog.clock_timestamp(),
        account_privacy = 'public',
        updated_at = pg_catalog.clock_timestamp()
    WHERE p.user_id = p_user_id
    RETURNING p.* INTO v_profile;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001';
    END IF;
    RETURN pg_catalog.to_jsonb(v_profile);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_commit_avatar(
    p_user_id uuid,
    p_avatar_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enforce boolean;
    v_avatar text := NULLIF(pg_catalog.btrim(p_avatar_url), '');
    v_profile public.profiles;
BEGIN
    v_enforce := public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF v_avatar IS NOT NULL AND pg_catalog.length(v_avatar) > 500 THEN
        RAISE EXCEPTION 'invalid_avatar_url' USING ERRCODE = '22023';
    END IF;
    v_avatar := public.fn_bind_image_ref(
        p_user_id, v_avatar, 'avatars', 'avatar', p_user_id::text, v_enforce
    );
    IF NOT v_enforce AND v_avatar IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM public.user_image_objects o
           WHERE o.user_id = p_user_id AND o.bucket = 'avatars'
             AND o.public_url = v_avatar AND o.state = 'approved'
       )
       AND NOT EXISTS (
           SELECT 1 FROM public.image_storage_origins o
           WHERE v_avatar LIKE o.origin || '/storage/v1/object/public/avatars/'
                                  || p_user_id::text || '/%'
       )
    THEN
        RAISE EXCEPTION 'invalid_avatar_url' USING ERRCODE = '22023';
    END IF;
    UPDATE public.profiles p
    SET avatar_url = v_avatar, updated_at = pg_catalog.clock_timestamp()
    WHERE p.user_id = p_user_id
    RETURNING p.* INTO v_profile;
    IF NOT FOUND THEN RAISE EXCEPTION 'profile_not_found' USING ERRCODE = 'P0001'; END IF;
    RETURN pg_catalog.to_jsonb(v_profile);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_create_entry_with_tables(
    p_user_id uuid,
    p_entry jsonb,
    p_table_ids uuid[],
    p_participant_ids uuid[],
    p_companion_ids uuid[]
)
RETURNS TABLE (entry_id uuid, was_dedup boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
#variable_conflict use_column
DECLARE
    v_entry_id uuid;
    v_nonce uuid;
    v_table_id uuid;
    v_participant uuid;
    v_enforce boolean;
    v_hero_input text;
    v_hero_url text;
    v_photo_input text;
    v_photo_url text;
    v_photo_id uuid;
    v_photo_order integer := 0;
BEGIN
    -- Missing config fails closed even on nonce-dedup requests.
    v_enforce := public.fn_lock_moderation_enforcement();
    -- Take lifecycle before INSERT/FK row locks: a grandfather avatar repair can
    -- hold lifecycle and need the same profile row that an entry FK key-locks.
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    v_nonce := (p_entry ->> 'client_nonce')::uuid;

    IF v_nonce IS NOT NULL THEN
        SELECT e.id INTO v_entry_id
        FROM public.entries e
        WHERE e.user_id = p_user_id AND e.client_nonce = v_nonce;
        IF FOUND THEN
            RETURN QUERY SELECT v_entry_id, true;
            RETURN;
        END IF;
    END IF;

    v_hero_input := NULLIF(pg_catalog.btrim(p_entry ->> 'photo_url'), '');
    BEGIN
        INSERT INTO public.entries (
            user_id, restaurant_id, place_id, user_place_id,
            rating, content, dish_description, cooked_by, value_profile,
            visited_at, table_id, table_night_id, visibility,
            vibe_rating, flavor_rating, service_rating, value_rating,
            liked, photo_url, client_nonce
        ) VALUES (
            p_user_id,
            (p_entry ->> 'restaurant_id')::uuid,
            (p_entry ->> 'place_id')::uuid,
            (p_entry ->> 'user_place_id')::uuid,
            (p_entry ->> 'rating')::numeric,
            p_entry ->> 'content', p_entry ->> 'dish_description', p_entry ->> 'cooked_by',
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
            v_hero_input,
            v_nonce
        ) RETURNING id INTO v_entry_id;
    EXCEPTION WHEN unique_violation THEN
        IF v_nonce IS NULL THEN RAISE; END IF;
        SELECT e.id INTO v_entry_id FROM public.entries e
        WHERE e.user_id = p_user_id AND e.client_nonce = v_nonce;
        IF NOT FOUND THEN RAISE; END IF;
        RETURN QUERY SELECT v_entry_id, true;
        RETURN;
    END;

    IF v_hero_input IS NOT NULL THEN
        v_hero_url := public.fn_bind_image_ref(
            p_user_id, v_hero_input, 'entry-photos', 'entry_hero', v_entry_id::text, v_enforce
        );
        UPDATE public.entries e SET photo_url = v_hero_url WHERE e.id = v_entry_id;
    END IF;

    IF p_entry ? 'photo_urls' AND pg_catalog.jsonb_typeof(p_entry -> 'photo_urls') = 'array' THEN
        FOR v_photo_input IN
            SELECT value FROM pg_catalog.jsonb_array_elements_text(p_entry -> 'photo_urls')
        LOOP
            v_photo_input := NULLIF(pg_catalog.btrim(v_photo_input), '');
            IF v_photo_input IS NULL THEN CONTINUE; END IF;
            INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
            VALUES (v_entry_id, v_photo_input, v_photo_order)
            RETURNING id INTO v_photo_id;
            v_photo_url := public.fn_bind_image_ref(
                p_user_id, v_photo_input, 'entry-photos', 'entry_photo', v_photo_id::text, v_enforce
            );
            UPDATE public.entry_photos p SET photo_url = v_photo_url WHERE p.id = v_photo_id;
            v_photo_order := v_photo_order + 1;
        END LOOP;
    END IF;

    IF p_table_ids IS NOT NULL THEN
        FOREACH v_table_id IN ARRAY p_table_ids LOOP
            IF NOT public.is_table_member(v_table_id, p_user_id) THEN
                RAISE EXCEPTION 'table_not_authorized'
                    USING ERRCODE = 'P0001', DETAIL = pg_catalog.json_build_object('id', v_table_id)::text;
            END IF;
            INSERT INTO public.entry_tables (entry_id, table_id, posted_at)
            VALUES (v_entry_id, v_table_id, pg_catalog.now())
            ON CONFLICT (entry_id, table_id) DO NOTHING;
        END LOOP;
    END IF;

    IF p_participant_ids IS NOT NULL THEN
        FOREACH v_participant IN ARRAY p_participant_ids LOOP
            INSERT INTO public.entry_participants (entry_id, user_id, rating, notes)
            VALUES (
                v_entry_id, v_participant,
                CASE WHEN v_participant = p_user_id THEN (p_entry ->> 'rating')::numeric ELSE NULL END,
                CASE WHEN v_participant = p_user_id THEN p_entry ->> 'content' ELSE NULL END
            ) ON CONFLICT (entry_id, user_id) DO NOTHING;
        END LOOP;
    END IF;

    RETURN QUERY SELECT v_entry_id, false;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.append_entry_photo(
    p_entry_id uuid,
    p_user_id uuid,
    p_photo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enforce boolean;
    v_next_order integer;
    v_row public.entry_photos;
    v_entry public.entries;
    v_canonical text;
BEGIN
    v_enforce := public.fn_lock_moderation_enforcement();
    -- Existing-entry writers must join the lifecycle domain before locking the
    -- entry row.  Grandfather repair takes lifecycle before that same sink.
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    SELECT e.* INTO v_entry FROM public.entries e
    WHERE e.id = p_entry_id AND e.user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501'; END IF;
    IF NULLIF(pg_catalog.btrim(p_photo_url), '') IS NULL THEN
        RAISE EXCEPTION 'photo_url_required' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(pg_catalog.max(p.sort_order) + 1, 0) INTO v_next_order
    FROM public.entry_photos p WHERE p.entry_id = p_entry_id;
    INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
    VALUES (p_entry_id, p_photo_url, v_next_order) RETURNING * INTO v_row;
    v_canonical := public.fn_bind_image_ref(
        p_user_id, p_photo_url, 'entry-photos', 'entry_photo', v_row.id::text, v_enforce
    );
    UPDATE public.entry_photos p SET photo_url = v_canonical WHERE p.id = v_row.id
    RETURNING * INTO v_row;
    IF v_entry.photo_url IS NULL THEN
        v_canonical := public.fn_bind_image_ref(
            p_user_id, v_canonical, 'entry-photos', 'entry_hero', p_entry_id::text, v_enforce
        );
        UPDATE public.entries e SET photo_url = v_canonical WHERE e.id = p_entry_id;
    END IF;
    RETURN pg_catalog.to_jsonb(v_row) || pg_catalog.jsonb_build_object(
        'hero_url', COALESCE(v_entry.photo_url, v_canonical)
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_set_entry_hero(
    p_user_id uuid,
    p_entry_id uuid,
    p_photo_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enforce boolean;
    v_entry public.entries;
    v_canonical text;
BEGIN
    v_enforce := public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    SELECT e.* INTO v_entry FROM public.entries e
    WHERE e.id = p_entry_id AND e.user_id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501'; END IF;
    v_canonical := public.fn_bind_image_ref(
        p_user_id, p_photo_url, 'entry-photos', 'entry_hero', p_entry_id::text, v_enforce
    );
    UPDATE public.entries e SET photo_url = v_canonical, updated_at = pg_catalog.clock_timestamp()
    WHERE e.id = p_entry_id RETURNING e.* INTO v_entry;
    RETURN pg_catalog.to_jsonb(v_entry);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_delete_entry_photo(
    p_user_id uuid,
    p_photo_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_enforce boolean;
    v_entry public.entries;
    v_deleted public.entry_photos;
    v_next public.entry_photos;
    v_hero text;
BEGIN
    v_enforce := public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    SELECT e.* INTO v_entry
    FROM public.entries e JOIN public.entry_photos p ON p.entry_id = e.id
    WHERE p.id = p_photo_id AND e.user_id = p_user_id
    FOR UPDATE OF e;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501'; END IF;
    DELETE FROM public.entry_photos p WHERE p.id = p_photo_id RETURNING p.* INTO v_deleted;

    IF v_entry.photo_url IS NOT DISTINCT FROM v_deleted.photo_url THEN
        SELECT p.* INTO v_next FROM public.entry_photos p
        WHERE p.entry_id = v_entry.id ORDER BY p.sort_order, p.id LIMIT 1;
        v_hero := public.fn_bind_image_ref(
            p_user_id,
            CASE WHEN FOUND THEN v_next.photo_url ELSE NULL END,
            'entry-photos', 'entry_hero', v_entry.id::text, v_enforce
        );
        UPDATE public.entries e SET photo_url = v_hero, updated_at = pg_catalog.clock_timestamp()
        WHERE e.id = v_entry.id;
    ELSE
        v_hero := v_entry.photo_url;
    END IF;
    RETURN pg_catalog.jsonb_build_object(
        'deleted', true, 'photo_id', p_photo_id,
        'entry_id', v_entry.id, 'hero_url', v_hero
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_delete_entry(
    p_user_id uuid,
    p_entry_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    PERFORM public.fn_lock_moderation_enforcement();
    DELETE FROM public.entries e
    WHERE e.id = p_entry_id AND e.user_id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_OWNER' USING ERRCODE = '42501'; END IF;
    RETURN pg_catalog.jsonb_build_object('deleted', true, 'entry_id', p_entry_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_lock_moderation_enforcement() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_lock_grandfather_sweep() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_set_enforcement(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_unbind_image_ref(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_bind_image_ref(uuid, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_complete_onboarding(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_commit_avatar(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.append_entry_photo(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_set_entry_hero(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_delete_entry_photo(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_delete_entry(uuid, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.fn_set_enforcement(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_complete_onboarding(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_commit_avatar(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_entry_photo(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_set_entry_hero(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_entry_photo(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_delete_entry(uuid, uuid) TO service_role;

-- Same signature and all TICKET-044 candidate predicates preserved.  The
-- p_b_payload photo_url/photo_urls values flow through the rewritten entry RPC.
CREATE OR REPLACE FUNCTION public.fn_create_entry_and_merge_round(
    p_actor_user_id uuid,
    p_table_id uuid,
    p_restaurant_id uuid,
    p_visited_at timestamptz,
    p_entry_a_id uuid,
    p_b_payload jsonb,
    p_client_nonce text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_entry_a record;
    v_entry_a_user uuid;
    v_entry_b_id uuid;
    v_was_dedup boolean;
    v_round_id uuid;
BEGIN
    PERFORM public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_actor_user_id);
    SELECT tm.member_id INTO STRICT v_entry_a_user
    FROM public.table_members tm
    WHERE tm.table_id = p_table_id AND tm.member_id = (
        SELECT e.user_id FROM public.entries e WHERE e.id = p_entry_a_id
    ) FOR UPDATE;
    PERFORM 1 FROM public.table_members tm
    WHERE tm.table_id = p_table_id AND tm.member_id = p_actor_user_id
    FOR UPDATE;

    SELECT e.* INTO v_entry_a FROM public.entries e WHERE e.id = p_entry_a_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'round_conflict: entry_a not found' USING ERRCODE = 'P0001';
    END IF;
    IF v_entry_a.restaurant_id IS DISTINCT FROM p_restaurant_id THEN
        RAISE EXCEPTION 'round_conflict: restaurant mismatch' USING ERRCODE = 'P0001';
    END IF;
    IF pg_catalog.abs(pg_catalog.date_part('epoch', v_entry_a.visited_at - p_visited_at)) > 18 * 3600 THEN
        RAISE EXCEPTION 'round_conflict: visited_at outside 18h window' USING ERRCODE = 'P0001';
    END IF;
    IF v_entry_a.user_id = p_actor_user_id THEN
        RAISE EXCEPTION 'round_conflict: same author' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM public.round_entries re WHERE re.entry_id = p_entry_a_id) THEN
        RAISE EXCEPTION 'round_conflict: entry_a already in a merged round' USING ERRCODE = 'P0001';
    END IF;
    IF v_entry_a.table_night_id IS NOT NULL THEN
        RAISE EXCEPTION 'round_conflict: entry_a already in a live round' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.entry_tables et
        WHERE et.entry_id = p_entry_a_id AND et.table_id = p_table_id
    ) THEN
        RAISE EXCEPTION 'round_conflict: entry_a not in target table' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = p_table_id AND tm.member_id = v_entry_a.user_id
    ) THEN
        RAISE EXCEPTION 'round_conflict: entry_a author left the table' USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = p_table_id AND tm.member_id = p_actor_user_id
    ) THEN
        RAISE EXCEPTION 'round_conflict: actor not a member of table' USING ERRCODE = 'P0001';
    END IF;

    SELECT t.entry_id, t.was_dedup INTO v_entry_b_id, v_was_dedup
    FROM public.fn_create_entry_with_tables(
        p_actor_user_id, p_b_payload, ARRAY[p_table_id], ARRAY[p_actor_user_id], NULL
    ) t;

    INSERT INTO public.table_nights (
        table_id, restaurant_id, host_user_id, kind, status, is_async
    ) VALUES (
        p_table_id, p_restaurant_id, p_actor_user_id, 'merged', NULL, false
    ) RETURNING id INTO v_round_id;

    BEGIN
        INSERT INTO public.round_entries (round_id, entry_id, table_id)
        VALUES
            (v_round_id, p_entry_a_id, p_table_id),
            (v_round_id, v_entry_b_id, p_table_id);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'round_conflict' USING ERRCODE = 'P0001';
    END;

    RETURN pg_catalog.jsonb_build_object(
        'entry_b_id', v_entry_b_id, 'round_id', v_round_id, 'was_dedup', v_was_dedup
    );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.start_round(
    p_table_id uuid,
    p_restaurant_id uuid,
    p_host_user_id uuid,
    p_host_rating numeric(2,1),
    p_host_notes text,
    p_host_dish text,
    p_photo_urls text[],
    p_attendee_ids uuid[],
    p_is_async boolean DEFAULT true,
    p_vibe_rating numeric(2,1) DEFAULT NULL,
    p_flavor_rating numeric(2,1) DEFAULT NULL,
    p_service_rating numeric(2,1) DEFAULT NULL,
    p_value_rating numeric(2,1) DEFAULT NULL,
    p_client_nonce uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_night_id uuid;
    v_entry_id uuid;
    v_invalid uuid[];
    v_enforce boolean;
    v_url text;
    v_canonical text;
    v_photo_id uuid;
    v_order integer := 0;
BEGIN
    v_enforce := public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_host_user_id);
    IF NOT EXISTS (
        SELECT 1 FROM public.table_members tm
        WHERE tm.table_id = p_table_id AND tm.member_id = p_host_user_id
    ) THEN
        RAISE EXCEPTION 'NOT_A_TABLE_MEMBER' USING ERRCODE = '42501';
    END IF;
    IF p_attendee_ids IS NOT NULL AND pg_catalog.array_length(p_attendee_ids, 1) > 0 THEN
        SELECT COALESCE(pg_catalog.array_agg(a), '{}') INTO v_invalid
        FROM pg_catalog.unnest(p_attendee_ids) a
        WHERE a <> p_host_user_id
          AND NOT EXISTS (
              SELECT 1 FROM public.table_members tm
              WHERE tm.table_id = p_table_id AND tm.member_id = a
          );
        IF v_invalid IS NOT NULL AND pg_catalog.array_length(v_invalid, 1) > 0 THEN
            RAISE EXCEPTION 'ATTENDEE_NOT_MEMBER: %', v_invalid USING ERRCODE = 'P0001';
        END IF;
    END IF;

    INSERT INTO public.table_nights (table_id, restaurant_id, host_user_id, status, is_async, kind)
    VALUES (p_table_id, p_restaurant_id, p_host_user_id, 'rating', COALESCE(p_is_async, true), 'live')
    RETURNING id INTO v_night_id;
    INSERT INTO public.table_night_participants (
        table_night_id, user_id, rating, ready, notes,
        vibe_rating, flavor_rating, service_rating, value_rating
    ) VALUES (
        v_night_id, p_host_user_id, p_host_rating, true, NULLIF(pg_catalog.btrim(p_host_notes), ''),
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating
    );
    IF p_attendee_ids IS NOT NULL THEN
        INSERT INTO public.table_night_participants (table_night_id, user_id)
        SELECT v_night_id, a FROM pg_catalog.unnest(p_attendee_ids) a
        WHERE a <> p_host_user_id ON CONFLICT DO NOTHING;
    END IF;

    INSERT INTO public.entries (
        user_id, restaurant_id, table_id, table_night_id,
        rating, content, dish_description, visibility,
        vibe_rating, flavor_rating, service_rating, value_rating,
        photo_url, client_nonce
    ) VALUES (
        p_host_user_id, p_restaurant_id, p_table_id, v_night_id,
        p_host_rating, NULLIF(pg_catalog.btrim(p_host_notes), ''),
        NULLIF(pg_catalog.btrim(p_host_dish), ''), 'table',
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating,
        NULL, p_client_nonce
    ) RETURNING id INTO v_entry_id;

    IF p_photo_urls IS NOT NULL THEN
        FOREACH v_url IN ARRAY p_photo_urls LOOP
            IF NULLIF(pg_catalog.btrim(v_url), '') IS NULL THEN CONTINUE; END IF;
            INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
            VALUES (v_entry_id, v_url, v_order) RETURNING id INTO v_photo_id;
            v_canonical := public.fn_bind_image_ref(
                p_host_user_id, v_url, 'entry-photos', 'entry_photo', v_photo_id::text, v_enforce
            );
            UPDATE public.entry_photos p SET photo_url = v_canonical WHERE p.id = v_photo_id;
            IF v_order = 0 THEN
                v_canonical := public.fn_bind_image_ref(
                    p_host_user_id, v_url, 'entry-photos', 'entry_hero', v_entry_id::text, v_enforce
                );
                UPDATE public.entries e SET photo_url = v_canonical WHERE e.id = v_entry_id;
            END IF;
            v_order := v_order + 1;
        END LOOP;
    END IF;

    IF p_attendee_ids IS NULL OR pg_catalog.array_length(p_attendee_ids, 1) = 0
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.unnest(p_attendee_ids) a WHERE a <> p_host_user_id)
    THEN
        UPDATE public.table_nights n SET status = 'revealed', revealed_at = pg_catalog.now()
        WHERE n.id = v_night_id AND n.status = 'rating' AND n.kind = 'live';
    END IF;
    RETURN pg_catalog.jsonb_build_object('night_id', v_night_id, 'entry_id', v_entry_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rate_round(
    p_round_id uuid,
    p_user_id uuid,
    p_rating numeric(2,1),
    p_notes text,
    p_dish text,
    p_photo_urls text[],
    p_vibe_rating numeric(2,1) DEFAULT NULL,
    p_flavor_rating numeric(2,1) DEFAULT NULL,
    p_service_rating numeric(2,1) DEFAULT NULL,
    p_value_rating numeric(2,1) DEFAULT NULL,
    p_client_nonce uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_night public.table_nights;
    v_entry_id uuid;
    v_new_status text;
    v_revealed boolean := false;
    v_enforce boolean;
    v_url text;
    v_canonical text;
    v_photo_id uuid;
    v_order integer := 0;
BEGIN
    v_enforce := public.fn_lock_moderation_enforcement();
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    -- Preserve the TICKET-068 round-row lock: both n and p are locked.
    SELECT n.* INTO v_night
    FROM public.table_nights n
    JOIN public.table_night_participants p
      ON p.table_night_id = n.id AND p.user_id = p_user_id
    WHERE n.id = p_round_id AND n.kind = 'live'
    FOR UPDATE OF n, p;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_A_PARTICIPANT' USING ERRCODE = '42501'; END IF;
    IF v_night.status <> 'rating' THEN RAISE EXCEPTION 'ROUND_NOT_RATING' USING ERRCODE = 'P0001'; END IF;

    UPDATE public.table_night_participants p
    SET rating = p_rating, ready = true, notes = NULLIF(pg_catalog.btrim(p_notes), ''),
        vibe_rating = p_vibe_rating, flavor_rating = p_flavor_rating,
        service_rating = p_service_rating, value_rating = p_value_rating
    WHERE p.table_night_id = p_round_id AND p.user_id = p_user_id AND p.ready = false;
    IF NOT FOUND THEN RAISE EXCEPTION 'ALREADY_SUBMITTED' USING ERRCODE = 'P0001'; END IF;

    INSERT INTO public.entries (
        user_id, restaurant_id, table_id, table_night_id,
        rating, content, dish_description, visibility,
        vibe_rating, flavor_rating, service_rating, value_rating,
        photo_url, client_nonce
    ) VALUES (
        p_user_id, v_night.restaurant_id, v_night.table_id, p_round_id,
        p_rating, NULLIF(pg_catalog.btrim(p_notes), ''), NULLIF(pg_catalog.btrim(p_dish), ''), 'table',
        p_vibe_rating, p_flavor_rating, p_service_rating, p_value_rating,
        NULL, p_client_nonce
    ) RETURNING id INTO v_entry_id;

    IF p_photo_urls IS NOT NULL THEN
        FOREACH v_url IN ARRAY p_photo_urls LOOP
            IF NULLIF(pg_catalog.btrim(v_url), '') IS NULL THEN CONTINUE; END IF;
            INSERT INTO public.entry_photos (entry_id, photo_url, sort_order)
            VALUES (v_entry_id, v_url, v_order) RETURNING id INTO v_photo_id;
            v_canonical := public.fn_bind_image_ref(
                p_user_id, v_url, 'entry-photos', 'entry_photo', v_photo_id::text, v_enforce
            );
            UPDATE public.entry_photos p SET photo_url = v_canonical WHERE p.id = v_photo_id;
            IF v_order = 0 THEN
                v_canonical := public.fn_bind_image_ref(
                    p_user_id, v_url, 'entry-photos', 'entry_hero', v_entry_id::text, v_enforce
                );
                UPDATE public.entries e SET photo_url = v_canonical WHERE e.id = v_entry_id;
            END IF;
            v_order := v_order + 1;
        END LOOP;
    END IF;

    UPDATE public.table_nights n
    SET status = 'revealed', revealed_at = pg_catalog.now()
    WHERE n.id = p_round_id AND n.status = 'rating' AND n.kind = 'live'
      AND NOT EXISTS (
          SELECT 1 FROM public.table_night_participants p
          WHERE p.table_night_id = p_round_id AND p.ready = false
      ) RETURNING n.status INTO v_new_status;
    v_revealed := v_new_status = 'revealed';
    RETURN pg_catalog.jsonb_build_object(
        'entry_id', v_entry_id,
        'round_status', COALESCE(v_new_status, v_night.status),
        'revealed', v_revealed
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_create_entry_and_merge_round(uuid, uuid, uuid, timestamptz, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_round(uuid, uuid, uuid, numeric, text, text, text[], uuid[], boolean, numeric, numeric, numeric, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rate_round(uuid, uuid, numeric, text, text, text[], numeric, numeric, numeric, numeric, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_entry_and_merge_round(uuid, uuid, uuid, timestamptz, uuid, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_round(uuid, uuid, uuid, numeric, text, text, text[], uuid[], boolean, numeric, numeric, numeric, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rate_round(uuid, uuid, numeric, text, text, text[], numeric, numeric, numeric, numeric, uuid) TO service_role;

-- Grandfather helpers are built in B-0 but hard-gated by the separate sweep
-- config row.  Foreign URLs are first persisted in quarantine, then removed
-- from visible sinks in the same transaction.
CREATE OR REPLACE FUNCTION public.fn_quarantine_legacy_image(
    p_sink_kind text,
    p_sink_id text,
    p_user_id uuid,
    p_original_url text,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_id uuid;
BEGIN
    IF NOT public.fn_lock_grandfather_sweep() THEN
        RAISE EXCEPTION 'grandfather_sweep_disabled' USING ERRCODE = '55000';
    END IF;
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    INSERT INTO public.image_quarantine (
        user_id, sink_kind, sink_id, original_url, reason
    ) VALUES (
        p_user_id, p_sink_kind, p_sink_id, p_original_url, p_reason
    ) ON CONFLICT (sink_kind, sink_id) DO UPDATE
      SET original_url = EXCLUDED.original_url, reason = EXCLUDED.reason
    RETURNING id INTO v_id;

    IF p_sink_kind = 'avatar' THEN
        UPDATE public.profiles p SET avatar_url = NULL
        WHERE p.user_id = p_user_id AND p.user_id::text = p_sink_id
          AND p.avatar_url = p_original_url;
    ELSIF p_sink_kind = 'entry_hero' THEN
        UPDATE public.entries e SET photo_url = NULL
        WHERE e.id = p_sink_id::uuid AND e.user_id = p_user_id
          AND e.photo_url = p_original_url;
    ELSIF p_sink_kind = 'entry_photo' THEN
        DELETE FROM public.entry_photos ep
        USING public.entries e
        WHERE ep.id = p_sink_id::uuid AND ep.entry_id = e.id
          AND e.user_id = p_user_id AND ep.photo_url = p_original_url;
    ELSE
        RAISE EXCEPTION 'invalid_image_sink' USING ERRCODE = '22023';
    END IF;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'legacy_sink_not_found' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.fn_unbind_image_ref(
        p_sink_kind, p_sink_id, 'grandfather_quarantine_unbind'
    );
    RETURN pg_catalog.jsonb_build_object('quarantine_id', v_id, 'state', 'pending_review');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_rebind_legacy_image(
    p_sink_kind text,
    p_sink_id text,
    p_user_id uuid,
    p_original_url text,
    p_approved_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
    v_url text;
    v_current text;
BEGIN
    IF NOT public.fn_lock_grandfather_sweep() THEN
        RAISE EXCEPTION 'grandfather_sweep_disabled' USING ERRCODE = '55000';
    END IF;
    -- Normal writers acquire lifecycle before any sink row.  Keep the sweep in
    -- that same order so quick-swap cannot hold lifecycle -> wait on the sink
    -- while this transaction holds the sink -> waits on lifecycle.
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    -- Claim the exact legacy value before binding.  A user replacement that
    -- lands after the sweep listed this row makes the candidate stale; it must
    -- never be overwritten or gain a ref to the old sweep result.
    IF p_sink_kind = 'avatar' THEN
        SELECT p.avatar_url INTO v_current FROM public.profiles p
        WHERE p.user_id = p_user_id AND p.user_id::text = p_sink_id FOR UPDATE;
    ELSIF p_sink_kind = 'entry_hero' THEN
        SELECT e.photo_url INTO v_current FROM public.entries e
        WHERE e.id = p_sink_id::uuid AND e.user_id = p_user_id FOR UPDATE;
    ELSIF p_sink_kind = 'entry_photo' THEN
        SELECT ep.photo_url INTO v_current
        FROM public.entry_photos ep JOIN public.entries e ON e.id = ep.entry_id
        WHERE ep.id = p_sink_id::uuid AND e.user_id = p_user_id
        FOR UPDATE OF ep;
    ELSE
        RAISE EXCEPTION 'invalid_image_sink' USING ERRCODE = '22023';
    END IF;
    IF NOT FOUND OR v_current IS DISTINCT FROM p_original_url THEN
        RETURN pg_catalog.jsonb_build_object('rebound', false, 'stale', true);
    END IF;

    v_url := public.fn_bind_image_ref(
        p_user_id, p_approved_url,
        CASE WHEN p_sink_kind = 'avatar' THEN 'avatars' ELSE 'entry-photos' END,
        p_sink_kind, p_sink_id, true
    );
    IF p_sink_kind = 'avatar' THEN
        UPDATE public.profiles p SET avatar_url = v_url
        WHERE p.user_id = p_user_id AND p.user_id::text = p_sink_id
          AND p.avatar_url = p_original_url;
    ELSIF p_sink_kind = 'entry_hero' THEN
        UPDATE public.entries e SET photo_url = v_url
        WHERE e.id = p_sink_id::uuid AND e.user_id = p_user_id
          AND e.photo_url = p_original_url;
    ELSIF p_sink_kind = 'entry_photo' THEN
        UPDATE public.entry_photos ep SET photo_url = v_url
        FROM public.entries e
        WHERE ep.id = p_sink_id::uuid AND ep.entry_id = e.id AND e.user_id = p_user_id
          AND ep.photo_url = p_original_url;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'legacy_sink_not_found' USING ERRCODE = 'P0001'; END IF;
    INSERT INTO public.image_gc_queue (user_id, reason, bucket, path)
    VALUES (
        p_user_id, 'grandfather_rebound',
        CASE WHEN p_sink_kind = 'avatar' THEN 'avatars' ELSE 'entry-photos' END,
        p_original_url
    );
    DELETE FROM public.image_quarantine q
    WHERE q.sink_kind = p_sink_kind AND q.sink_id = p_sink_id;
    RETURN pg_catalog.jsonb_build_object('rebound', true, 'approved_url', v_url);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.fn_reject_legacy_image(
    p_sink_kind text,
    p_sink_id text,
    p_user_id uuid,
    p_original_url text,
    p_reason text DEFAULT 'moderation_rejected'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
    IF NOT public.fn_lock_grandfather_sweep() THEN
        RAISE EXCEPTION 'grandfather_sweep_disabled' USING ERRCODE = '55000';
    END IF;
    PERFORM public.fn_lock_image_lifecycle(p_user_id);
    IF p_sink_kind = 'avatar' THEN
        UPDATE public.profiles p SET avatar_url = NULL
        WHERE p.user_id = p_user_id AND p.user_id::text = p_sink_id
          AND p.avatar_url = p_original_url;
    ELSIF p_sink_kind = 'entry_hero' THEN
        UPDATE public.entries e SET photo_url = NULL
        WHERE e.id = p_sink_id::uuid AND e.user_id = p_user_id
          AND e.photo_url = p_original_url;
    ELSIF p_sink_kind = 'entry_photo' THEN
        DELETE FROM public.entry_photos ep USING public.entries e
        WHERE ep.id = p_sink_id::uuid AND ep.entry_id = e.id
          AND e.user_id = p_user_id AND ep.photo_url = p_original_url;
    ELSE
        RAISE EXCEPTION 'invalid_image_sink' USING ERRCODE = '22023';
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'legacy_sink_not_found' USING ERRCODE = 'P0001'; END IF;
    PERFORM public.fn_unbind_image_ref(p_sink_kind, p_sink_id, p_reason || '_unbind');
    -- entry_photo DELETE already enqueued the exact sink through its trigger.
    IF p_sink_kind <> 'entry_photo' THEN
        INSERT INTO public.image_gc_queue (user_id, reason, bucket, path)
        VALUES (
            p_user_id, p_reason,
            CASE WHEN p_sink_kind = 'avatar' THEN 'avatars' ELSE 'entry-photos' END,
            p_original_url
        );
    END IF;
    PERFORM public.fn_record_image_rejection(
        p_user_id, p_sink_kind, p_sink_id, p_reason
    );
    UPDATE public.image_quarantine q SET state = 'rejected', reviewed_at = pg_catalog.clock_timestamp()
    WHERE q.sink_kind = p_sink_kind AND q.sink_id = p_sink_id;
    RETURN pg_catalog.jsonb_build_object('rejected', true, 'notified_once', true);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_quarantine_legacy_image(text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_rebind_legacy_image(text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_reject_legacy_image(text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_quarantine_legacy_image(text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_rebind_legacy_image(text, text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fn_reject_legacy_image(text, text, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_claim_grandfather_candidates(
    p_after_cursor text DEFAULT NULL,
    p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE v_rows jsonb;
BEGIN
    IF NOT public.fn_lock_grandfather_sweep() THEN
        RAISE EXCEPTION 'grandfather_sweep_disabled' USING ERRCODE = '55000';
    END IF;
    WITH candidates AS (
        SELECT 'avatar'::text AS sink_kind, p.user_id::text AS sink_id,
               p.user_id, p.avatar_url AS original_url, 'avatars'::text AS bucket
        FROM public.profiles p
        WHERE p.avatar_url IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.user_image_objects o
              WHERE o.user_id = p.user_id AND o.bucket = 'avatars'
                AND o.public_url = p.avatar_url AND o.state = 'approved'
          )
        UNION ALL
        SELECT 'entry_hero', e.id::text, e.user_id, e.photo_url, 'entry-photos'
        FROM public.entries e
        WHERE e.photo_url IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM public.user_image_objects o
              WHERE o.user_id = e.user_id AND o.bucket = 'entry-photos'
                AND o.public_url = e.photo_url AND o.state = 'approved'
          )
        UNION ALL
        SELECT 'entry_photo', ep.id::text, e.user_id, ep.photo_url, 'entry-photos'
        FROM public.entry_photos ep JOIN public.entries e ON e.id = ep.entry_id
        WHERE NOT EXISTS (
              SELECT 1 FROM public.user_image_objects o
              WHERE o.user_id = e.user_id AND o.bucket = 'entry-photos'
                AND o.public_url = ep.photo_url AND o.state = 'approved'
          )
    ), page AS (
        SELECT c.*, c.sink_kind || ':' || c.sink_id AS cursor
        FROM candidates c
        WHERE p_after_cursor IS NULL OR c.sink_kind || ':' || c.sink_id > p_after_cursor
        ORDER BY c.sink_kind, c.sink_id
        LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) ORDER BY page.cursor), '[]'::jsonb)
    INTO v_rows FROM page;
    RETURN v_rows;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_claim_grandfather_candidates(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_grandfather_candidates(text, integer) TO service_role;

COMMENT ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[]) IS
    'TICKET-196: same signature; photo_url + photo_urls sink writes and refs are atomic, nonce/liked invariants preserved.';
COMMENT ON FUNCTION public.rate_round(uuid, uuid, numeric, text, text, text[], numeric, numeric, numeric, numeric, uuid) IS
    'TICKET-196: flag-aware live round writer; preserves FOR UPDATE OF round+participant and binds entry_photo + entry_hero refs.';
