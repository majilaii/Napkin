-- Unknown visit dates cannot establish a shared meal. Preserve the existing writer and grants.
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
    IF v_entry_a.visited_at IS NULL OR p_visited_at IS NULL
       OR pg_catalog.abs(pg_catalog.date_part('epoch', v_entry_a.visited_at - p_visited_at)) > 18 * 3600 THEN
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
