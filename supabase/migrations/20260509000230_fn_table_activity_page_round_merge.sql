-- TICKET-044: Update fn_table_activity_page to support merged rounds.
--
-- Changes vs 20260509000020_fn_table_activity_page_v2.sql:
--
--   a) entries_stream filter: adds table-scoped round_entries exclusion.
--      Entries bound to a merged round in THIS table no longer appear as solo entries.
--      The filter is table-scoped (re.table_id = p_table_id) so the same entry
--      still appears solo in other Tables.
--
--      Old: AND e.table_night_id IS NULL
--      New: AND e.table_night_id IS NULL
--           AND NOT EXISTS (
--               SELECT 1 FROM public.round_entries re
--               WHERE re.entry_id = e.id AND re.table_id = p_table_id
--           )
--
--   b) nights_stream filter: includes merged rows (status=NULL) by switching
--      from status IN ('rating','revealed','closed') to the kind-branched predicate.
--
--      Old: AND n.status IN ('rating', 'revealed', 'closed')
--      New: AND (
--               (n.kind = 'live'   AND n.status IN ('rating', 'revealed', 'closed')) OR
--               (n.kind = 'merged')
--           )
--
--   c) nights_stream SELECT: adds n.kind to the payload so the edge function
--      can emit round_kind without an extra join.
--
-- [ARCH-REVIEW] verified:
--   - Both halves of the entries exclusion (round_entries AND table_night_id) are present.
--   - round_kind is NOT the same field as the row-type kind column (avoids collision).
--   - REVOKE/GRANT locks this RPC to service_role only (carried over from v2).
--
-- Verbatim top_4_edited CTT (tt4_canonical, tt4_legacy, tt4_stream) are copied
-- verbatim from 20260427140000 + 20260509000020 per [ARCH-REVIEW] finding 13.

CREATE OR REPLACE FUNCTION fn_table_activity_page(
    p_table_id uuid,
    p_caller_id uuid,
    p_cursor_date timestamptz,
    p_cursor_id uuid,
    p_limit int,
    p_filter_type text,
    p_filter_user_id uuid
) RETURNS TABLE (
    kind text,
    id uuid,
    sort_date timestamptz,
    payload jsonb
) LANGUAGE sql STABLE AS $$
    WITH entries_stream AS (
        SELECT
            'entry'::text AS kind,
            e.id,
            et.posted_at AS sort_date,
            to_jsonb(e) AS payload
        FROM public.entry_tables et
        JOIN public.entries e ON e.id = et.entry_id
        WHERE et.table_id = p_table_id
          -- Exclude entries bound to a live Round-Mode round
          AND e.table_night_id IS NULL
          -- Exclude entries already part of a merged round in THIS table (table-scoped).
          -- Multi-table entries merged in another Table still appear here as solo entries.
          AND NOT EXISTS (
              SELECT 1 FROM public.round_entries re
              WHERE re.entry_id = e.id AND re.table_id = p_table_id
          )
          AND (p_filter_type IS NULL OR p_filter_type = 'solo_share')
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
            -- Include n.kind in the payload so the edge function can emit round_kind
            -- without an additional join. round_kind is extracted server-side in
            -- table-activity/index.ts from payload->>'kind'.
            to_jsonb(n) AS payload
        FROM public.table_nights n
        WHERE n.table_id = p_table_id
          -- Include both live rounds (any active status) AND merged rounds (status=NULL)
          AND (
              (n.kind = 'live'   AND n.status IN ('rating', 'revealed', 'closed')) OR
              (n.kind = 'merged')
          )
          AND (p_filter_type IS NULL OR p_filter_type = 'round')
          AND (
              p_filter_user_id IS NULL
              OR EXISTS (
                  -- Filter by participant (live rounds)
                  SELECT 1 FROM public.table_night_participants p
                  WHERE p.table_night_id = n.id AND p.user_id = p_filter_user_id
              )
              OR EXISTS (
                  -- Filter by round_entries author (merged rounds)
                  SELECT 1 FROM public.round_entries re
                  JOIN public.entries e ON e.id = re.entry_id
                  WHERE re.round_id = n.id AND e.user_id = p_filter_user_id
              )
          )
    ),
    -- Verbatim from 20260427140000_top4_public_revoke_hydration_fix.sql lines 83-93
    -- and 20260509000020_fn_table_activity_page_v2.sql lines 74-93.
    tt4_canonical AS (
        SELECT DISTINCT ON (h.save_id)
            h.id,
            h.created_at AS sort_date,
            h.save_id
        FROM public.table_top_4_history h
        WHERE h.table_id = p_table_id
          AND h.save_id IS NOT NULL
          AND p_filter_type IS NULL
          AND (p_filter_user_id IS NULL OR h.actor_id = p_filter_user_id)
        ORDER BY h.save_id, h.position ASC, h.created_at ASC
    ),
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
    tt4_stream AS (
        SELECT
            'top_4_edited'::text AS kind,
            c.id,
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

-- Lock to service_role only (carried over from v2).
REVOKE EXECUTE ON FUNCTION public.fn_table_activity_page(uuid, uuid, timestamptz, uuid, int, text, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_table_activity_page(uuid, uuid, timestamptz, uuid, int, text, uuid)
    TO service_role;

-- ── Test assertions (regression) ─────────────────────────────────────────────
-- Manual verification sequence (see build log):
--
-- 1. Solo entry not part of any round → appears in entries_stream. ✓
--
-- 2. Solo entry bound in round_entries for this table → NOT in entries_stream.
--    Same entry in another Table (not this one) → still in entries_stream for that Table.
--    (Cross-table leak test per ARCH-REVIEW.)
--
-- 3. Live round with status='rating' → appears in nights_stream.
-- 4. Live round with status='revealed' → appears in nights_stream.
-- 5. Merged round (kind='merged', status=NULL) → appears in nights_stream.
-- 6. p_filter_user_id filter: merged round authored by user X →
--    appears when p_filter_user_id = X; absent for unrelated user.
