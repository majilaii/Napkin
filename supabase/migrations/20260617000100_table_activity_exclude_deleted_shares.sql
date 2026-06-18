-- Wave 2: exclude soft-deleted (retracted) table_shares from the Table feed.
-- Verbatim from 20260603000500_fn_table_activity_page_shares_floats.sql, with a
-- single added predicate in shares_bucketed: `AND ts.deleted_at IS NULL`. Filtering
-- here (not just in the edge hydration) is required so a retracted share never
-- forms a representative row or inflates a digest's count/child_ids.

CREATE OR REPLACE FUNCTION fn_table_activity_page(
    p_table_id        uuid,
    p_caller_id       uuid,
    p_cursor_date     timestamptz,
    p_cursor_id       uuid,
    p_limit           int,
    p_filter_type     text,
    p_filter_user_id  uuid,
    p_coalesce_hours  int DEFAULT 6
) RETURNS TABLE (
    kind        text,
    id          uuid,
    sort_date   timestamptz,
    payload     jsonb
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
          AND e.table_night_id IS NULL
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
            to_jsonb(n) AS payload
        FROM public.table_nights n
        WHERE n.table_id = p_table_id
          AND (
              (n.kind = 'live'   AND n.status IN ('rating', 'revealed', 'closed')) OR
              (n.kind = 'merged')
          )
          AND (p_filter_type IS NULL OR p_filter_type = 'round')
          AND (
              p_filter_user_id IS NULL
              OR EXISTS (
                  SELECT 1 FROM public.table_night_participants p
                  WHERE p.table_night_id = n.id AND p.user_id = p_filter_user_id
              )
              OR EXISTS (
                  SELECT 1 FROM public.round_entries re
                  JOIN public.entries e ON e.id = re.entry_id
                  WHERE re.round_id = n.id AND e.user_id = p_filter_user_id
              )
          )
    ),
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
    shares_bucketed AS (
        SELECT
            ts.id,
            ts.author_id,
            ts.created_at,
            date_bin(
                (p_coalesce_hours || ' hours')::interval,
                ts.created_at,
                TIMESTAMP '2000-01-01 00:00:00+00'
            ) AS bucket_start
        FROM public.table_shares ts
        WHERE ts.table_id = p_table_id
          AND ts.deleted_at IS NULL
          AND (p_filter_type IS NULL OR p_filter_type = 'shared_save' OR p_filter_type = 'share_digest')
          AND (p_filter_user_id IS NULL OR ts.author_id = p_filter_user_id)
    ),
    shares_grouped AS (
        SELECT
            author_id,
            bucket_start,
            count(*)                               AS share_count,
            array_agg(id ORDER BY created_at ASC)  AS child_ids,
            min(created_at)                        AS first_at,
            max(created_at)                        AS last_at
        FROM shares_bucketed
        GROUP BY author_id, bucket_start
    ),
    shares_representative AS (
        SELECT DISTINCT ON (sg.author_id, sg.bucket_start)
            sb.id,
            sg.author_id,
            sg.bucket_start,
            sg.share_count,
            sg.child_ids,
            sg.last_at AS sort_date
        FROM shares_grouped sg
        JOIN shares_bucketed sb
          ON sb.author_id = sg.author_id
         AND sb.bucket_start = sg.bucket_start
        ORDER BY sg.author_id, sg.bucket_start, sb.created_at ASC
    ),
    shares_stream AS (
        SELECT
            CASE WHEN sr.share_count = 1 THEN 'shared_save' ELSE 'share_digest' END::text AS kind,
            sr.id,
            sr.sort_date,
            jsonb_build_object(
                'id',          sr.id,
                'author_id',   sr.author_id,
                'table_id',    p_table_id,
                'share_count', sr.share_count,
                'child_ids',   sr.child_ids,
                'bucket_start',sr.bucket_start
            ) AS payload
        FROM shares_representative sr
    ),
    floats_stream AS (
        SELECT
            'restaurant_float'::text AS kind,
            tfs.id,
            tfs.surfaced_at AS sort_date,
            jsonb_build_object(
                'id',             tfs.id,
                'table_id',       tfs.table_id,
                'restaurant_id',  tfs.restaurant_id,
                'saver_set_hash', tfs.saver_set_hash,
                'saver_user_ids', tfs.saver_user_ids,
                'distinct_count', tfs.distinct_count,
                'first_crossed_at', tfs.first_crossed_at
            ) AS payload
        FROM public.table_float_state tfs
        WHERE tfs.table_id     = p_table_id
          AND tfs.surfaced_at  IS NOT NULL
          AND tfs.dismissed_at IS NULL
          AND (tfs.suppressed_until IS NULL OR tfs.suppressed_until < now())
          AND (p_filter_type IS NULL OR p_filter_type = 'restaurant_float')
          AND p_filter_user_id IS NULL
    ),
    unified AS (
        SELECT * FROM entries_stream
        UNION ALL
        SELECT * FROM nights_stream
        UNION ALL
        SELECT * FROM tt4_stream
        UNION ALL
        SELECT * FROM shares_stream
        UNION ALL
        SELECT * FROM floats_stream
    )
    SELECT kind, id, sort_date, payload
    FROM unified
    WHERE p_cursor_date IS NULL
       OR (sort_date, id) < (p_cursor_date, p_cursor_id)
    ORDER BY sort_date DESC, id DESC
    LIMIT p_limit;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_table_activity_page(uuid, uuid, timestamptz, uuid, int, text, uuid, int)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_table_activity_page(uuid, uuid, timestamptz, uuid, int, text, uuid, int)
    TO service_role;
