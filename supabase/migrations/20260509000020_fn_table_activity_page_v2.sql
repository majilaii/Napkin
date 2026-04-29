-- TICKET-043: rewrite fn_table_activity_page to JOIN entry_tables instead of
-- filtering entries.table_id. Cursor keys on et.posted_at for stable per-Table
-- ordering. Each Table's stream is independent — same entry appears in two
-- Tables' streams without dedup.
--
-- top_4_edited CTE copied verbatim from 20260427140000_top4_public_revoke_hydration_fix.sql
-- lines 79-122 per [ARCH-REVIEW] finding 13. Do not paraphrase; literal copy.
--
-- REVOKE/GRANT locks this RPC to service_role only per [ARCH-REVIEW] finding 2.
-- Edge fns invoke via service-role; direct-client callers cannot bypass the
-- response scrub.

CREATE OR REPLACE FUNCTION fn_table_activity_page(
    p_table_id uuid,
    p_caller_id uuid,         -- used for companion-widening; always the authenticated user
    p_cursor_date timestamptz,   -- null → first page
    p_cursor_id uuid,            -- null → first page
    p_limit int,                 -- caller passes pageSize + 1
    p_filter_type text,          -- null | 'round' | 'solo_share'
    p_filter_user_id uuid        -- null for no filter
) RETURNS TABLE (
    kind text,                   -- 'entry' | 'table_night' | 'top_4_edited'
    id uuid,
    sort_date timestamptz,
    payload jsonb                -- full row as jsonb — edge function hydrates
) LANGUAGE sql STABLE AS $$
    WITH entries_stream AS (
        SELECT
            'entry'::text AS kind,
            e.id,
            et.posted_at AS sort_date,  -- TICKET-043: cursor keys on et.posted_at, not e.created_at
            to_jsonb(e) AS payload
        FROM public.entry_tables et
        JOIN public.entries e ON e.id = et.entry_id
        WHERE et.table_id = p_table_id
          AND e.table_night_id IS NULL
          AND (p_filter_type IS NULL OR p_filter_type = 'solo_share')
          -- author match OR companion-widening for the caller
          AND (
              p_filter_user_id IS NULL
              OR e.user_id = p_filter_user_id
              OR (
                  e.user_id = p_caller_id
                  OR EXISTS (
                      SELECT 1 FROM public.entry_companions ec
                      WHERE ec.entry_id = e.id AND ec.user_id = p_caller_id
                  )
              )
          )
    ),
    nights_stream AS (
        SELECT
            'table_night'::text AS kind,
            n.id,
            COALESCE(n.revealed_at, n.created_at) AS sort_date,
            to_jsonb(n) AS payload
        FROM public.table_nights n
        WHERE n.table_id = p_table_id
          AND n.status IN ('rating', 'revealed', 'closed')
          AND (p_filter_type IS NULL OR p_filter_type = 'round')
          AND (
              p_filter_user_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM public.table_night_participants p
                  WHERE p.table_night_id = n.id AND p.user_id = p_filter_user_id
              )
          )
    ),
    -- One card per save: DISTINCT ON (save_id) ordered by (save_id, position asc)
    -- picks the lowest-position history row as the canonical card. Its h.id is a
    -- real table_top_4_history PK — the consumer .in('id', tt4Ids) matches it
    -- directly. Collapses N slot rows per save into 1 feed card.
    -- Copied verbatim from 20260427140000_top4_public_revoke_hydration_fix.sql lines 83-93.
    tt4_canonical AS (
        SELECT DISTINCT ON (h.save_id)
            h.id,                              -- real history row PK; consumer hydrates with .in('id', ...)
            h.created_at AS sort_date,
            h.save_id
        FROM public.table_top_4_history h
        WHERE h.table_id = p_table_id
          AND h.save_id IS NOT NULL
          AND p_filter_type IS NULL
          AND (p_filter_user_id IS NULL OR h.actor_id = p_filter_user_id)
        ORDER BY h.save_id, h.position ASC, h.created_at ASC
    ),
    -- Legacy rows (save_id IS NULL) each surface individually.
    -- Copied verbatim from 20260427140000_top4_public_revoke_hydration_fix.sql lines 96-104.
    tt4_legacy AS (
        SELECT
            h.id,
            h.created_at AS sort_date
        FROM public.table_top_4_history h
        WHERE h.table_id = p_table_id
          AND h.save_id IS NULL
          AND p_filter_type IS NULL
          AND (p_filter_user_id IS NULL OR h.actor_id = p_filter_user_id)
    ),
    -- Copied verbatim from 20260427140000_top4_public_revoke_hydration_fix.sql lines 106-121.
    tt4_stream AS (
        SELECT
            'top_4_edited'::text AS kind,
            c.id,                              -- real row PK — hydrator can .in('id', ...)
            c.sort_date,
            to_jsonb(h) AS payload
        FROM tt4_canonical c
        JOIN public.table_top_4_history h ON h.id = c.id
        UNION ALL
        SELECT
            'top_4_edited'::text AS kind,
            l.id,
            l.sort_date,
            to_jsonb(h) AS payload
        FROM tt4_legacy l
        JOIN public.table_top_4_history h ON h.id = l.id
    ),
    unified AS (
        SELECT * FROM entries_stream
        UNION ALL
        SELECT * FROM nights_stream
        UNION ALL
        SELECT * FROM tt4_stream
    )
    SELECT kind, id, sort_date, payload
    FROM unified
    WHERE p_cursor_date IS NULL
       OR (sort_date, id) < (p_cursor_date, p_cursor_id)
    ORDER BY sort_date DESC, id DESC
    LIMIT p_limit;
$$;

-- TICKET-043 finding 2: lock RPC down to service-role only.
-- Edge fns invoke; direct-client invokers cannot bypass the response scrub.
-- The index (table_id, posted_at DESC, entry_id DESC) from entry_tables migration
-- covers the entries_stream filter+order.
REVOKE EXECUTE ON FUNCTION public.fn_table_activity_page(uuid, uuid, timestamptz, uuid, int, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_table_activity_page(uuid, uuid, timestamptz, uuid, int, text, uuid)
    TO service_role;
