-- TICKET-095 — "Gather the table": propose a future date at a restaurant to one
-- of your Tables. Tablemates RSVP in/out on the feed card; on (or after) the day,
-- the first feed load dispatches a supper (the existing "empty table" primitive)
-- when >= 2 people are in. The gathering card then points at the supper.
--
-- SECURITY MODEL (mirrors supper_members, 20260615000200):
--   Writes are service-role ONLY — the `gatherings` edge function validates the
--   caller (table_members.member_id) and performs every insert/update. No client
--   write policy exists on either table, so authenticated users cannot self-RSVP
--   or forge proposals by hitting PostgREST directly. SELECT is table-member
--   scoped so feed hydration reads stay consistent with the Table trust ring.
--
-- DUAL-REVIEW (schema + RLS + feed RPC) per CLAUDE.md. Blast radius in the ticket.

-- ── 1. gatherings — the proposal anchor ──────────────────────────────────────
create table public.gatherings (
    id            uuid primary key default gen_random_uuid(),
    table_id      uuid not null references public.tables(id) on delete cascade,
    restaurant_id uuid not null references public.restaurants(id),
    host_user_id  uuid not null references public.profiles(user_id),
    note          text check (char_length(note) <= 140),
    gather_on     date not null,
    status        text not null default 'proposed' check (status in ('proposed','dispatched','cancelled','expired')),
    supper_id     uuid references public.suppers(id) on delete set null,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
alter table public.gatherings enable row level security;

comment on table public.gatherings is
    'TICKET-095: a proposed future gathering at a restaurant, scoped to a Table. '
    'proposed -> dispatched (supper created) | expired (day passed, <2 in) | cancelled (host).';

-- One ACTIVE proposal per spot per table. Re-gathering after cancel/expire/dispatch
-- is allowed (the old row keeps its terminal status and falls out of the index).
create unique index idx_gatherings_one_active_per_spot
    on public.gatherings (table_id, restaurant_id)
    where status = 'proposed';

-- Dispatch scan: fn_dispatch_due_gatherings walks proposed rows for one table by day.
create index idx_gatherings_dispatch_scan
    on public.gatherings (table_id, gather_on)
    where status = 'proposed';

-- ── 2. gathering_rsvps — who's in / who can't ────────────────────────────────
create table public.gathering_rsvps (
    gathering_id uuid not null references public.gatherings(id) on delete cascade,
    user_id      uuid not null references public.profiles(user_id) on delete cascade,
    response     text not null check (response in ('in','out')),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    primary key (gathering_id, user_id)
);
alter table public.gathering_rsvps enable row level security;

-- ── 3. RLS: table members read; writes are service-role only ─────────────────
-- No INSERT/UPDATE/DELETE policy for authenticated → denied (RLS on, no write
-- policy). All writes go through the service-role `gatherings` edge function,
-- same doctrine as supper_members. NOTE: table_members' user column is
-- member_id, NOT user_id (CLAUDE.md doctrine — tm.user_id is a bug).
create policy gatherings_select on public.gatherings
    for select to authenticated
    using (
        exists (
            select 1 from public.table_members tm
            where tm.table_id = gatherings.table_id
              and tm.member_id = auth.uid()
        )
    );

create policy gathering_rsvps_select on public.gathering_rsvps
    for select to authenticated
    using (
        exists (
            select 1
            from public.gatherings g
            join public.table_members tm
              on tm.table_id = g.table_id
             and tm.member_id = auth.uid()
            where g.id = gathering_rsvps.gathering_id
        )
    );

-- Supabase default privileges GRANT ALL on new public tables to anon + authenticated.
-- RLS already denies writes, but align the privilege layer with intent so a future
-- RLS regression can't expose writes (supper-schema idiom). Revoke the defaults,
-- then re-grant only the intended SELECT (authenticated) + ALL (service_role).
revoke all on table public.gatherings      from PUBLIC, anon, authenticated;
revoke all on table public.gathering_rsvps from PUBLIC, anon, authenticated;
grant select on public.gatherings      to authenticated;
grant select on public.gathering_rsvps to authenticated;
grant all    on public.gatherings      to service_role;
grant all    on public.gathering_rsvps to service_role;

-- ── 4. fn_dispatch_due_gatherings — dispatch-on-read ─────────────────────────
-- Called by the table-activity edge fn on the FIRST feed page load (no cursor).
-- For each due proposed gathering of this table:
--   confirmed = users who RSVP'd 'in' AND are STILL current table members
--   >= 2 confirmed → create the supper (empty-table primitive) + seed
--     supper_members with the confirmed roster; mark 'dispatched'.
--   day fully passed with < 2 → 'expired'.
--   day-of with < 2 → leave 'proposed' (people can still RSVP that day).
-- FOR UPDATE SKIP LOCKED: two concurrent feed loads never double-dispatch —
-- the second caller skips rows the first already holds.
-- Timezone: friend-test cohort is HK/Macau; 'Asia/Hong_Kong' is hardcoded.
-- Per-table timezones are a later ticket.
create or replace function public.fn_dispatch_due_gatherings(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    g           record;
    v_today     date;
    v_confirmed uuid[];
    v_supper_id uuid;
begin
    v_today := (now() at time zone 'Asia/Hong_Kong')::date;

    for g in
        select * from public.gatherings
        where table_id = p_table_id
          and status = 'proposed'
          and gather_on <= v_today
        for update skip locked
    loop
        -- Confirmed roster: 'in' RSVPs intersected with CURRENT table members
        -- (member_id doctrine). Someone who RSVP'd then left the Table drops out.
        select coalesce(array_agg(r.user_id), '{}') into v_confirmed
        from public.gathering_rsvps r
        join public.table_members tm
          on tm.table_id = g.table_id
         and tm.member_id = r.user_id
        where r.gathering_id = g.id
          and r.response = 'in';

        if coalesce(array_length(v_confirmed, 1), 0) >= 2 then
            insert into public.suppers (restaurant_id, host_user_id, table_id)
            values (g.restaurant_id, g.host_user_id, g.table_id)
            returning id into v_supper_id;

            insert into public.supper_members (supper_id, user_id)
            select v_supper_id, u from unnest(v_confirmed) as u;

            update public.gatherings
            set status = 'dispatched', supper_id = v_supper_id, updated_at = now()
            where id = g.id;
        elsif g.gather_on < v_today then
            -- The day fully passed and it never came together.
            update public.gatherings
            set status = 'expired', updated_at = now()
            where id = g.id;
        end if;
        -- else: day-of with < 2 in — leave proposed, RSVPs still open today.
    end loop;
end;
$$;

-- Lock down: SECDEF writer must not be callable by clients (top4-lockdown /
-- supper-schema idiom — revoke explicit default grants, not just PUBLIC).
revoke all on function public.fn_dispatch_due_gatherings(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.fn_dispatch_due_gatherings(uuid) to service_role;

-- ── 5. fn_table_activity_page — add the gathering card ───────────────────────
-- Verbatim from 20260620000000 (verified latest replacement), with one change
-- (marked GATHERING): new gatherings_stream + its UNION ALL leg. Membership
-- visibility is guaranteed by the table-activity edge fn (caller validated as a
-- table member before the RPC runs) — same trust model as suppers_stream.
-- Cancelled gatherings are excluded server-side; dispatched/expired still render
-- (as "gathered — see the table" / "didn't come together" cards).
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
