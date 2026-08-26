-- TICKET-217 P1-3: restaurant-history uses the service role and therefore
-- cannot rely on entries RLS. Resolve the hot page's photo and aggregate
-- candidates in one call while preserving the canonical can_view_entry branch
-- semantics. Blocks are deliberately global across every non-self branch;
-- blocked_users RLS cannot safely enforce the reverse direction for a service
-- endpoint with an explicit viewer.
CREATE OR REPLACE FUNCTION public.fn_visible_entry_ids(
    p_viewer uuid,
    p_entry_ids uuid[],
    p_require_content boolean DEFAULT true
)
RETURNS TABLE (entry_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $visible_entry_ids$
    SELECT e.id AS entry_id
    FROM public.entries e
    WHERE p_viewer IS NOT NULL
      AND e.id = ANY (COALESCE(p_entry_ids, ARRAY[]::uuid[]))
      AND (
          -- Branch 1: the author always sees their own entry.
          public.fn_user_authored_entry(e.id, p_viewer)

          OR (
              -- Unlike the older row predicate, blocks protect Table,
              -- companion, public-account, and Supper branches alike.
              NOT EXISTS (
                  SELECT 1
                  FROM public.blocked_users b
                  WHERE (b.blocker_id = p_viewer AND b.blocked_id = e.user_id)
                     OR (b.blocker_id = e.user_id AND b.blocked_id = p_viewer)
              )
              AND (
                  -- Branch 2: Tablemate via entry_tables.
                  EXISTS (
                      SELECT 1
                      FROM public.entry_tables et
                      WHERE et.entry_id = e.id
                        AND public.is_table_member(et.table_id, p_viewer)
                  )

                  -- Branch 3: tagged companion.
                  OR public.is_entry_companion(e.id, p_viewer)

                  -- Branch 4: public-account entry. Photo rails keep exact
                  -- can_view_entry content parity; rating aggregates opt out
                  -- because silent ratings are still valid palate signals.
                  OR (
                      e.visibility <> 'private'
                      AND e.restaurant_id IS NOT NULL
                      AND e.rating IS NOT NULL
                      AND (
                          NOT COALESCE(p_require_content, true)
                          OR pg_catalog.char_length(pg_catalog.btrim(COALESCE(e.content, ''))) >= 1
                      )
                      AND EXISTS (
                          SELECT 1
                          FROM public.profiles p
                          WHERE p.user_id = e.user_id
                            AND p.account_privacy = 'public'
                      )
                  )

                  -- Branch 5: both viewer and author belong to the Supper.
                  OR (
                      e.supper_id IS NOT NULL
                      AND public.is_supper_member(e.supper_id, p_viewer)
                      AND public.is_supper_member(e.supper_id, e.user_id)
                  )
              )
          )
      );
$visible_entry_ids$;

COMMENT ON FUNCTION public.fn_visible_entry_ids(uuid, uuid[], boolean) IS
    'TICKET-217 service-role batch counterpart to can_view_entry: returns only '
    'requested entries visible to p_viewer, with bidirectional blocks enforced '
    'across every non-author branch. p_require_content defaults true for exact '
    'can_view_entry photo parity; rating aggregates pass false so silent ratings '
    'remain valid. Keep the remaining five-branch predicate synchronized.';

REVOKE ALL ON FUNCTION public.fn_visible_entry_ids(uuid, uuid[], boolean)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_visible_entry_ids(uuid, uuid[], boolean) TO service_role;

-- TICKET-217 P1-4: newest definition copied from
-- 20260716123000_image_moderation_writers.sql. The only behavioral change is
-- the missing-visibility fallback: Table when at least one Table id is present,
-- friends otherwise.
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
AS $create_entry$
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
            COALESCE(
                p_entry ->> 'visibility',
                CASE
                    WHEN COALESCE(pg_catalog.array_length(p_table_ids, 1), 0) > 0 THEN 'table'
                    ELSE 'friends'
                END
            ),
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
$create_entry$;

COMMENT ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[]) IS
    'Atomic entry writer with image lifecycle binding. Missing visibility defaults '
    'to table when p_table_ids is nonempty and friends otherwise.';

REVOKE ALL ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[])
    TO service_role;
