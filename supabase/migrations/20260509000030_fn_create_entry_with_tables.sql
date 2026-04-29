-- TICKET-043: atomic create-entry-with-tables RPC.
-- Wraps the entries insert + N entry_tables inserts + entry_participants in a
-- single transaction so partial-write rollback is automatic.
-- The edge function calls this AFTER it has validated membership for every table_id.
--
-- client_nonce idempotency: SELECT-first approach (v2 final). If a row with
-- (user_id, client_nonce) already exists, return its id without re-fanning
-- into entry_tables (preserves prior fan-out).
--
-- entry_companions are intentionally NOT in this RPC (finding 16 — preserve v1
-- non-fatal behavior). Edge fn calls this RPC, then attempts entry_companions
-- inserts in a try/catch; failures log a warning but do not roll back the entry.
--
-- service_role only (finding 3): REVOKE/GRANT at bottom.
-- Addresses [ARCH-REVIEW] findings 3, 8.

CREATE OR REPLACE FUNCTION public.fn_create_entry_with_tables(
    p_user_id         uuid,
    p_entry           jsonb,         -- entries row payload; whitelisted columns only (see INSERT below)
    p_table_ids       uuid[],        -- normalized, deduped, membership-validated upstream
    p_participant_ids uuid[],        -- raters; includes author conventionally
    p_companion_ids   uuid[]         -- companions (unused inside RPC — handled non-fatally by edge fn)
)
RETURNS TABLE (entry_id uuid, was_dedup boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_entry_id   uuid;
    v_was_dedup  boolean := false;
    v_nonce      uuid;
    v_table_id   uuid;
    v_participant uuid;
BEGIN
    v_nonce := (p_entry ->> 'client_nonce')::uuid;

    -- ── Idempotency check: SELECT-first approach (v2 final — more robust than xmax) ──
    -- If a row with (user_id, client_nonce) already exists, return its id.
    -- Do NOT re-fan into entry_tables (preserves prior fan-out exactly).
    IF v_nonce IS NOT NULL THEN
        SELECT e.id INTO v_entry_id
        FROM public.entries e
        WHERE e.user_id = p_user_id AND e.client_nonce = v_nonce;
        IF FOUND THEN
            RETURN QUERY SELECT v_entry_id, true;
            RETURN;
        END IF;
    END IF;

    -- ── Insert entry. table_id mirror = p_table_ids[1] when present. ──
    -- The dual-write trigger trg_entries_mirror_table_id_to_join will mirror
    -- entries.table_id into entry_tables, so the explicit insert for the primary id
    -- below may hit a conflict — ON CONFLICT DO NOTHING handles it.
    -- Whitelist of columns: no arbitrary jsonb passthrough.
    INSERT INTO public.entries (
        user_id, restaurant_id, rating, content, dish_description,
        visited_at, table_id, table_night_id, visibility,
        vibe_rating, flavor_rating, service_rating, value_rating,
        photo_url, client_nonce
    )
    VALUES (
        p_user_id,
        (p_entry ->> 'restaurant_id')::uuid,
        (p_entry ->> 'rating')::numeric,
        p_entry ->> 'content',
        p_entry ->> 'dish_description',
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

    -- ── Fan out into entry_tables ──
    -- Trigger already handled p_table_ids[1] when entries.table_id was set above;
    -- ON CONFLICT DO NOTHING skips the dup. We still loop so secondary ids land.
    IF p_table_ids IS NOT NULL THEN
        FOREACH v_table_id IN ARRAY p_table_ids LOOP
            -- Belt-and-suspenders membership check (edge fn already validated).
            -- Prevents a service-role caller from attaching to a Table they're not in.
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

    -- ── entry_participants fan-out (atomic — any failure rolls back the entry) ──
    -- p_participant_ids is expected to include the author (edge fn adds user_id).
    -- Duplicates are harmless due to the unique constraint on (entry_id, user_id).
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

-- Companion fan-out is intentionally NOT in this RPC (finding 16 — preserve v1
-- non-fatal behavior). Edge fn calls fn_create_entry_with_tables, then attempts
-- entry_companions inserts in a try/catch; failures log a warning but do not
-- roll back the entry.

-- TICKET-043 finding 3: lock RPC to service-role only.
-- Clients must go through the entry edge fn, which validates auth and membership.
REVOKE EXECUTE ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[])
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_entry_with_tables(uuid, jsonb, uuid[], uuid[], uuid[])
    TO service_role;
