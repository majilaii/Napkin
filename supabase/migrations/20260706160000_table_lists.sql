-- TICKET-115 — Table lists: a list can belong to a Table (shared, collaborative).
-- Additive: table_id on lists, added_by on list_entries. Member RLS via the
-- existing is_table_member SECDEF helper (keys on table_members.member_id — the
-- standing member_id-not-user_id trap). Tables-never-public invariant enforced
-- by a coercion trigger. Feed ledger line consumed by fn_table_activity_page.

-- ── (a) columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.lists
    ADD COLUMN IF NOT EXISTS table_id uuid NULL
        REFERENCES public.tables(id) ON DELETE CASCADE;

ALTER TABLE public.list_entries
    ADD COLUMN IF NOT EXISTS added_by uuid NULL
        REFERENCES auth.users(id) ON DELETE SET NULL;

-- table lists lookup (Table screen: "my Tables' lists")
CREATE INDEX IF NOT EXISTS lists_table_id_idx
    ON public.lists(table_id) WHERE table_id IS NOT NULL;
-- ledger-line source: adds by member in a table list, time-ordered
CREATE INDEX IF NOT EXISTS list_entries_added_by_created_idx
    ON public.list_entries(added_by, created_at DESC) WHERE added_by IS NOT NULL;

COMMENT ON COLUMN public.lists.table_id IS
    'TICKET-115: non-null → this list belongs to a Table (shared). Forced privacy=private.';
COMMENT ON COLUMN public.list_entries.added_by IS
    'TICKET-115: attribution for table-list adds ("added by Clara"). NULL on personal lists / legacy rows.';

-- ── (b) Tables-never-public coercion trigger ─────────────────────────────────
-- A table list can NEVER be public. Coerce rather than error so no caller path
-- can leak one into public search / public profile surfaces (TICKET-106 gate).
CREATE OR REPLACE FUNCTION public.enforce_table_list_private()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.table_id IS NOT NULL THEN
        NEW.privacy := 'private';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lists_force_table_private ON public.lists;
CREATE TRIGGER lists_force_table_private
    BEFORE INSERT OR UPDATE ON public.lists
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_table_list_private();

-- ── (c) RLS — table-list member path (personal-list policies UNCHANGED) ──────
-- The column on table_members is member_id, NOT user_id. is_table_member()
-- (SECURITY DEFINER, STABLE) keys on member_id internally — reuse it to avoid
-- recursive RLS and to keep the member_id trap in one place.

-- lists SELECT: owner OR public OR (table list AND caller is a member)
DROP POLICY IF EXISTS "lists_select" ON public.lists;
CREATE POLICY "lists_select" ON public.lists FOR SELECT
    USING (
        auth.uid() = owner_id
        OR privacy = 'public'
        OR (table_id IS NOT NULL AND public.is_table_member(table_id, auth.uid()))
    );

-- lists UPDATE/DELETE stay creator-only (v1) — unchanged owner_id predicate.
-- (lists_update / lists_delete from 20260421000000_lists.sql are correct as-is:
--  creator = owner_id; table lists are edited/deleted by their creator only.)

-- list_entries SELECT: parent visible to caller (owner OR public OR table member)
DROP POLICY IF EXISTS "list_entries_select" ON public.list_entries;
CREATE POLICY "list_entries_select" ON public.list_entries FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.lists l
        WHERE l.id = list_entries.list_id
          AND (
              l.owner_id = auth.uid()
              OR l.privacy = 'public'
              OR (l.table_id IS NOT NULL AND public.is_table_member(l.table_id, auth.uid()))
          )
    ));

-- list_entries write: list owner (personal) OR any member of the owning Table.
DROP POLICY IF EXISTS "list_entries_write" ON public.list_entries;
CREATE POLICY "list_entries_write" ON public.list_entries FOR ALL
    USING (EXISTS (
        SELECT 1 FROM public.lists l
        WHERE l.id = list_entries.list_id
          AND (
              l.owner_id = auth.uid()
              OR (l.table_id IS NOT NULL AND public.is_table_member(l.table_id, auth.uid()))
          )
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.lists l
        WHERE l.id = list_entries.list_id
          AND (
              l.owner_id = auth.uid()
              OR (l.table_id IS NOT NULL AND public.is_table_member(l.table_id, auth.uid()))
          )
    ));

-- ── (d) fn_table_activity_page — copy-forward + new 'list_add' ledger leg ─────
-- Verbatim from 20260704090000_gatherings.sql (verified latest replacement),
-- with ONE addition (marked LIST-ADD): the list_adds_stream CTE + its UNION ALL
-- leg. Every existing leg is preserved: entries / table_night / supper /
-- gathering / top_4_edited (2 branches) / shared_save·share_digest /
-- restaurant_float. Membership visibility is guaranteed by the table-activity
-- edge fn (caller validated as a table member before this RPC runs).
--
-- LIST-ADD: a member adding a spot to one of THIS table's lists emits a quiet
-- ledger line, event-sourced from list_entries JOIN lists WHERE lists.table_id =
-- p_table_id AND added_by IS NOT NULL. Bucketed by (added_by, list_id, hour)
-- exactly like shares_bucketed so N rapid adds coalesce to one line.
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
          -- SUPPER-V2 (currently DEFENSIVE): a take in THIS table's supper should be
          -- represented by the supper card, not a standalone entry card. Today this is a
          -- no-op — v2 takes are created via `add-take` with p_table_ids=null, so they
          -- carry NO entry_tables row and never enter entries_stream (which JOINs
          -- entry_tables). It becomes load-bearing the moment a take is ever shared to its
          -- Table (gets an entry_tables row): then it collapses the duplicate. NULL
          -- supper_id, legacy (table_id IS NULL) suppers, and suppers scoped to OTHER
          -- tables all keep showing as normal entry cards regardless.
          AND NOT EXISTS (
              SELECT 1 FROM public.suppers s
              WHERE s.id = e.supper_id AND s.table_id = p_table_id
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
    -- SUPPER-V2: one card per table-scoped supper the VIEWER is a member of.
    -- is_supper_member (SECDEF) makes the card viewer-relative — a Table member who
    -- is NOT in the supper never sees it (mirrors the Wave-2c privacy gate). sort_date
    -- = created_at so a freshly-set empty table lands at the top of the feed.
    suppers_stream AS (
        SELECT
            'supper'::text AS kind,
            s.id,
            s.created_at AS sort_date,
            jsonb_build_object(
                'id',            s.id,
                'table_id',      s.table_id,
                'restaurant_id', s.restaurant_id,
                'host_user_id',  s.host_user_id,
                'created_at',    s.created_at
            ) AS payload
        FROM public.suppers s
        WHERE s.table_id = p_table_id
          AND public.is_supper_member(s.id, p_caller_id)
          AND (p_filter_type IS NULL OR p_filter_type = 'supper')
          AND (
              p_filter_user_id IS NULL
              OR s.host_user_id = p_filter_user_id
              OR EXISTS (
                  SELECT 1 FROM public.supper_members m
                  WHERE m.supper_id = s.id AND m.user_id = p_filter_user_id
              )
          )
    ),
    -- GATHERING (TICKET-095): one card per non-cancelled gathering of this table.
    -- All table members see it (roster = the whole table; RSVPs shape the seats).
    -- Caller membership is enforced by the edge fn before this RPC runs.
    gatherings_stream AS (
        SELECT
            'gathering'::text AS kind,
            g.id,
            g.created_at AS sort_date,
            jsonb_build_object(
                'id',            g.id,
                'table_id',      g.table_id,
                'restaurant_id', g.restaurant_id,
                'host_user_id',  g.host_user_id,
                'note',          g.note,
                'gather_on',     g.gather_on,
                'status',        g.status,
                'supper_id',     g.supper_id,
                'created_at',    g.created_at
            ) AS payload
        FROM public.gatherings g
        WHERE g.table_id = p_table_id
          AND g.status <> 'cancelled'
          AND (p_filter_type IS NULL OR p_filter_type = 'gathering')
          AND (p_filter_user_id IS NULL OR g.host_user_id = p_filter_user_id)
    ),
    -- LIST-ADD (TICKET-115): a member adding spots to one of this table's lists.
    -- Event-sourced from list_entries → lists WHERE lists.table_id = p_table_id.
    -- Bucketed by (added_by, list_id, hour) like shares_bucketed so N rapid adds
    -- by the same member to the same list collapse into one ledger line.
    list_adds_bucketed AS (
        SELECT
            le.id,
            le.added_by,
            le.list_id,
            le.restaurant_id,
            le.created_at,
            date_bin(
                (p_coalesce_hours || ' hours')::interval,
                le.created_at,
                TIMESTAMP '2000-01-01 00:00:00+00'
            ) AS bucket_start
        FROM public.list_entries le
        JOIN public.lists l ON l.id = le.list_id
        WHERE l.table_id = p_table_id
          AND le.added_by IS NOT NULL
          AND (p_filter_type IS NULL OR p_filter_type = 'list_add')
          AND (p_filter_user_id IS NULL OR le.added_by = p_filter_user_id)
    ),
    list_adds_grouped AS (
        SELECT
            added_by,
            list_id,
            bucket_start,
            count(*)                                        AS add_count,
            (array_agg(id ORDER BY created_at DESC))[1]     AS rep_entry_id,
            array_agg(restaurant_id ORDER BY created_at DESC) AS sample_restaurant_ids,
            max(created_at)                                 AS last_at
        FROM list_adds_bucketed
        GROUP BY added_by, list_id, bucket_start
    ),
    list_adds_stream AS (
        SELECT
            'list_add'::text AS kind,
            g.rep_entry_id AS id,
            g.last_at AS sort_date,
            jsonb_build_object(
                'list_id',               g.list_id,
                'list_title',            l.title,
                'list_emoji',            l.emoji,
                'added_by',              g.added_by,
                'add_count',             g.add_count,
                'sample_restaurant_ids', g.sample_restaurant_ids
            ) AS payload
        FROM list_adds_grouped g
        JOIN public.lists l ON l.id = g.list_id
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
        SELECT * FROM suppers_stream
        UNION ALL
        SELECT * FROM gatherings_stream
        UNION ALL
        SELECT * FROM list_adds_stream
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
