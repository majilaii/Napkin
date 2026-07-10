-- TICKET-159 — Close the gathering→supper loop: day-of sweep, morning-after
-- nudge, rescue, stitching, provenance.
--
-- One migration carries every schema change (design decision — everything else
-- depends on it):
--   1.  Preflights (deterministic RAISE, never silent) for the two new unique
--       indexes.
--   2.  idx_gatherings_due_sweep — global sweep scan index.
--   3.  fn_dispatch_one_gathering — the per-gathering atomic dispatch unit
--       (claim FOR UPDATE SKIP LOCKED → confirmed roster → supper +
--       supper_members + one supper_set inbox row per confirmed seat, or
--       expire — all in ONE transaction).
--   4.  fn_dispatch_due_gatherings — on-read entry point rewritten to loop the
--       unit (belt-and-braces; signature unchanged, table-activity untouched).
--   5.  fn_dispatch_all_due_gatherings — global driver for the hourly pg_cron
--       sweep; per-row BEGIN/EXCEPTION isolation so one poison row can neither
--       roll back the sweep nor stall the fleet.
--   6.  notifications: kind CHECK gains 'supper_set' + shape CHECK + the
--       person-level exactly-once expression unique index.
--   7.  idx_gatherings_one_supper — a supper reverse-maps to at most ONE gather
--       (provenance reads this one row).
--   8.  idx_entries_one_take_per_supper — one take per member per supper.
--   9.  entries.supper_id write lockdown — column-list GRANT UPDATE so the
--       SECDEF RPCs are the only writers of the binding.
--   10. fn_rescue_expired_gathering — atomic, idempotent expired-gather rescue.
--   11. fn_attach_take_to_supper — validated stray-log stitch attach.
--   12. fn_supper_stitch_suggestion — suggest-only stitch candidacy (one RPC,
--       used by both the fresh-create and dedup paths of the entry fn).
--   13. pg_cron: hourly 'gathering-sweep' job (extension-guarded for replay;
--       prod presence is enforced by the prod-deploy.yml smoke gate).
--
-- SECURITY: every new/rewritten SECURITY DEFINER function pins
-- search_path = public, pg_temp, schema-qualifies every relation, and is
-- revoked from PUBLIC/anon/authenticated (service_role-only; the sweep driver
-- also grants the cron owner). Writes to suppers / supper_members /
-- notifications / gatherings.supper_id / entries.supper_id remain service-role
-- or SECDEF only — no client RLS surface changes.
--
-- REPLAYABILITY (locked doctrine): timestamp 20260711090000 is strictly after
-- the current head (20260710160000) — no rename of any applied version.
-- Distinct dollar-quote tags throughout ($fn$ / $do$ / $job$) — never nested
-- $$. The pg_cron block no-ops when the extension is unavailable (throwaway
-- replay DB), matching the 20260504000001 idiom.
--
-- DUAL-REVIEW (schema + migrations + RLS-adjacent + grants) per CLAUDE.md.
-- Blast radius: TICKET-159 Technical Design, Changes A–F.

-- ── 1. Preflights — resolve duplicates BEFORE the unique indexes ─────────────
-- Deterministic failure text (never a silent IF NOT EXISTS): if prod carries a
-- duplicate, the deploy fails loudly here and the operator resolves the rows
-- before re-applying. Fresh replays trivially pass (empty tables).
do $do$
declare
    v_count bigint;
begin
    select count(*) into v_count from (
        select supper_id
        from public.gatherings
        where supper_id is not null
        group by supper_id
        having count(*) > 1
    ) dup;
    if v_count > 0 then
        raise exception 'TICKET-159 preflight failed: % supper_id value(s) are linked by more than one gathering. Resolve the duplicate gatherings.supper_id rows before applying idx_gatherings_one_supper.', v_count;
    end if;

    select count(*) into v_count from (
        select supper_id, user_id
        from public.entries
        where supper_id is not null
        group by supper_id, user_id
        having count(*) > 1
    ) dup;
    if v_count > 0 then
        raise exception 'TICKET-159 preflight failed: % (supper_id, user_id) pair(s) carry more than one take. Resolve the duplicate entries before applying idx_entries_one_take_per_supper.', v_count;
    end if;
end
$do$;

-- ── 2. Global sweep scan index ────────────────────────────────────────────────
-- Leads with gather_on (the global driver scans ALL tables by due date);
-- the existing (table_id, gather_on) partial keeps serving the on-read path.
create index if not exists idx_gatherings_due_sweep
    on public.gatherings (gather_on, table_id)
    where status = 'proposed';

-- ── 3. fn_dispatch_one_gathering — the atomic per-gathering unit ─────────────
-- Claims ONE proposed+due row under FOR UPDATE SKIP LOCKED (concurrent sweep +
-- feed loads never double-dispatch — the second caller skips), computes the
-- confirmed roster ('in' RSVPs ∩ CURRENT table_members.member_id — CLAUDE.md
-- doctrine: NEVER tm.user_id), then either dispatches (supper + supper_members
-- + one supper_set notification per confirmed seat + the one-way status flip,
-- all in THIS transaction — a failure rolls the whole dispatch back, never a
-- partial supper) or expires a fully-passed day. Timezone: HKT hardcoded
-- (friend-test cohort; per-table timezones are a later ticket).
create or replace function public.fn_dispatch_one_gathering(p_gathering_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    g           public.gatherings%rowtype;
    v_today     date;
    v_confirmed uuid[];
    v_host      uuid;
    v_supper_id uuid;
begin
    v_today := (now() at time zone 'Asia/Hong_Kong')::date;

    select * into g
    from public.gatherings
    where id = p_gathering_id
      and status = 'proposed'
      and gather_on <= v_today
    for update skip locked;

    if not found then
        -- Not due, not proposed anymore, or claimed by a concurrent dispatcher.
        -- NEGATIVE hard constraint: a future gather_on never reaches this point,
        -- so no path creates a supper before the day (HKT).
        return;
    end if;

    -- Confirmed roster, ordered by RSVP created_at so the earliest-joined
    -- confirmed member is v_confirmed[1] (the departed-host fallback).
    select coalesce(array_agg(r.user_id order by r.created_at), '{}') into v_confirmed
    from public.gathering_rsvps r
    join public.table_members tm
      on tm.table_id = g.table_id
     and tm.member_id = r.user_id          -- member_id, NOT user_id (doctrine)
    where r.gathering_id = g.id
      and r.response = 'in';

    if coalesce(array_length(v_confirmed, 1), 0) >= 2 then
        -- Departed-host guard: the supper host must be IN the roster (the roster
        -- is the sole access boundary — a non-member host would break
        -- is_supper_member). Gathering host if still confirmed, else the
        -- earliest-joined confirmed member.
        if g.host_user_id = any (v_confirmed) then
            v_host := g.host_user_id;
        else
            v_host := v_confirmed[1];
        end if;

        insert into public.suppers (restaurant_id, host_user_id, table_id)
        values (g.restaurant_id, v_host, g.table_id)
        returning id into v_supper_id;

        insert into public.supper_members (supper_id, user_id)
        select v_supper_id, u from unnest(v_confirmed) as u;

        -- Inbox nudge IN the dispatch transaction (AC): one self-directed
        -- supper_set row per confirmed seat. Exactly-once is enforced by the
        -- one-way status flip AND idx_notif_supper_set_once; ON CONFLICT DO
        -- NOTHING so a defensive collision can never abort the dispatch.
        insert into public.notifications
            (user_id, kind, actor_user_id, subject_restaurant_id, subject_meta)
        select u, 'supper_set', null, g.restaurant_id,
               jsonb_build_object('supper_id', v_supper_id)
        from unnest(v_confirmed) as u
        on conflict do nothing;

        update public.gatherings
        set status = 'dispatched', supper_id = v_supper_id, updated_at = now()
        where id = g.id;
    elsif g.gather_on < v_today then
        -- The day fully passed and it never came together (TICKET-095 behaviour
        -- unchanged). Day-of with < 2 in stays proposed — RSVPs still open today.
        update public.gatherings
        set status = 'expired', updated_at = now()
        where id = g.id;
    end if;
end;
$fn$;

revoke all on function public.fn_dispatch_one_gathering(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.fn_dispatch_one_gathering(uuid) to service_role;

-- ── 4. fn_dispatch_due_gatherings — on-read entry point, rewritten ───────────
-- Same signature; table-activity/index.ts:120 keeps calling it unchanged (and
-- is NOT redeployed for this). Now loops the per-gathering unit with the same
-- per-row isolation as the sweep, so one poison row can't block a whole
-- table's other due gatherings on feed load.
create or replace function public.fn_dispatch_due_gatherings(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    r record;
begin
    for r in
        select id
        from public.gatherings
        where table_id = p_table_id
          and status = 'proposed'
          and gather_on <= v_today
        order by gather_on
    loop
        begin
            perform public.fn_dispatch_one_gathering(r.id);
        exception when others then
            raise warning 'fn_dispatch_due_gatherings: gathering % failed: %', r.id, sqlerrm;
        end;
    end loop;
end;
$fn$;

revoke all on function public.fn_dispatch_due_gatherings(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.fn_dispatch_due_gatherings(uuid) to service_role;

-- ── 5. fn_dispatch_all_due_gatherings — the hourly sweep driver ──────────────
-- Bounded (LIMIT 200, oldest first over idx_gatherings_due_sweep) and isolated
-- per row: each gathering dispatches in its own subtransaction, so a poison
-- row raises a WARNING and the loop continues — it can neither roll back the
-- sweep nor hold the other rows' locks (each unit claims SKIP LOCKED).
create or replace function public.fn_dispatch_all_due_gatherings()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    r record;
begin
    for r in
        select id
        from public.gatherings
        where status = 'proposed'
          and gather_on <= v_today
        order by gather_on
        limit 200
    loop
        begin
            perform public.fn_dispatch_one_gathering(r.id);
        exception when others then
            raise warning 'fn_dispatch_all_due_gatherings: gathering % failed: %', r.id, sqlerrm;
        end;
    end loop;
end;
$fn$;

revoke all on function public.fn_dispatch_all_due_gatherings() from PUBLIC, anon, authenticated;
grant execute on function public.fn_dispatch_all_due_gatherings() to service_role;
-- The cron job runs as the role that scheduled it (the migration runner —
-- postgres on Supabase and on the local stack). Grant it explicitly so the
-- sweep never depends on implicit owner privileges.
grant execute on function public.fn_dispatch_all_due_gatherings() to postgres;

-- ── 6. notifications: 'supper_set' kind + shape + exactly-once ───────────────
-- A CHECK cannot be ALTERed in place — drop + recreate (precedents
-- 20260707170000, 20260708000000). Replay: 20260708000000 sets 8 kinds; this
-- relaxes to 9. Adding a value to an IN-list validates trivially.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in (
    'friend_logged',
    'friend_pinned',
    'top_four_swap',
    'table_invite',
    'claim_city',
    'reservation_reminder',
    'import_done',
    'table_invite_accepted',
    'supper_set'
));

-- Shape hygiene: supper_set is self-directed ("the table gathered", not
-- "someone did X to you") — null actor, a restaurant subject for hydration,
-- and a uuid-shaped supper_id in meta for the deep link. No typed FK column:
-- the link is self-produced in the dispatch transaction; a later-deleted
-- supper just dead-ends the tap (accepted trade-off).
alter table public.notifications drop constraint if exists notifications_supper_set_shape;
alter table public.notifications add constraint notifications_supper_set_shape check (
    kind <> 'supper_set' or (
        actor_user_id is null
        and subject_restaurant_id is not null
        and subject_meta->>'supper_id' ~ '^[0-9a-f-]{36}$'
    )
);

comment on constraint notifications_supper_set_shape on public.notifications is
    'TICKET-159: supper_set rows are self-directed (null actor), carry the restaurant '
    'for hydration and a uuid-shaped subject_meta.supper_id for the /supper/[id] deep link.';

-- Person-level exactly-once: one supper_set row per (recipient, supper) — a
-- re-run sweep / re-loaded feed can never emit a second row for the same
-- person + supper (the dispatch insert uses ON CONFLICT DO NOTHING).
create unique index if not exists idx_notif_supper_set_once
    on public.notifications (user_id, (subject_meta->>'supper_id'))
    where kind = 'supper_set';

-- ── 7. Provenance: a supper reverse-maps to at most one gather ───────────────
-- Both dispatch and rescue set gatherings.supper_id; provenance (supper-detail
-- lineage, fn_supper_stitch_suggestion's night join, rescue read-back) reads
-- this ONE row. Preflight (§1) guarantees this CREATE cannot fail on dupes.
create unique index if not exists idx_gatherings_one_supper
    on public.gatherings (supper_id)
    where supper_id is not null;

-- ── 8. One take per member per supper ────────────────────────────────────────
-- The attach RPC validates before writing, but the index is the authoritative
-- guard (races included). add-take / attach-take map its 23505 to a clean 409.
create unique index if not exists idx_entries_one_take_per_supper
    on public.entries (supper_id, user_id)
    where supper_id is not null;

-- ── 9. entries.supper_id write lockdown (column-list GRANT) ──────────────────
-- entries.supper_id was left client-writable by TICKET-082 ("harmless" because
-- branch-5 requires author membership) — but a member could still self-attach
-- an arbitrary entry to a supper they belong to, bypassing the attach
-- validations. Close the privilege-layer hole: revoke table-wide UPDATE, then
-- re-grant a column list of EVERY column except supper_id (the sole omission —
-- ordinary entry edits keep working; useUpdateEntry writes rating/content/
-- dish_description/secondary ratings/photo_url/updated_at). The SECDEF RPCs
-- (fn_attach_take_to_supper) and service-role paths (add-take, supper-open)
-- become the only writers of the binding. RLS (entries_update_own) unchanged —
-- the grant is the complementary privilege-layer lock.
-- Column list = the full entries column set as of this migration (schema-drift
-- safety: a future column is NOT client-updatable until listed here —
-- intentional, mirrors the 20260509000100 SELECT-grant idiom).
revoke update on table public.entries from authenticated;
grant update (
    id,
    user_id,
    restaurant_id,
    place_id,
    user_place_id,
    rating,
    content,
    dish_description,
    cooked_by,
    value_profile,
    visited_at,
    created_at,
    updated_at,
    table_id,
    table_night_id,
    visibility,
    photo_url,
    vibe_rating,
    flavor_rating,
    service_rating,
    value_rating,
    reaction_count,
    comment_count,
    top_emojis,
    public_reaction_count,
    public_reply_count,
    public_top_emojis,
    client_nonce,
    liked
) on public.entries to authenticated;

comment on column public.entries.supper_id is
    'TICKET-082 group key; TICKET-159: service-role/SECDEF-write-only (column-list '
    'GRANT UPDATE excludes it). Bindings go through add-take, supper-open, or '
    'fn_attach_take_to_supper — never a direct client PATCH.';

-- ── 10. fn_rescue_expired_gathering — "it happened anyway" ───────────────────
-- Lock by (gathering id, host), verify status = 'expired', THEN branch:
-- an existing supper_id returns as-is (idempotent — a repeat or concurrent
-- completion converges on the ONE supper), else create the table-scoped supper,
-- seed supper_members (host ∪ picked members, intersected with CURRENT
-- table_members), and link gatherings.supper_id. The gather stays 'expired'.
-- NULL return = not found / not the host / not expired (edge fn maps to
-- 404/403/409 off its own pre-read; NULL after the pre-read = lost a race).
create or replace function public.fn_rescue_expired_gathering(
    p_gathering_id uuid,
    p_host         uuid,
    p_member_ids   uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    g           public.gatherings%rowtype;
    v_roster    uuid[];
    v_supper_id uuid;
begin
    select * into g
    from public.gatherings
    where id = p_gathering_id
      and host_user_id = p_host
    for update;

    if not found then
        return null;              -- no such gathering, or caller is not the host
    end if;
    if g.status <> 'expired' then
        return null;              -- only an expired plan can be rescued (never proposed/dispatched)
    end if;
    if g.supper_id is not null then
        return g.supper_id;       -- idempotent: the EXISTING supper, never a second one
    end if;

    -- Roster = host ∪ picked members, all still CURRENT table members
    -- (member_id doctrine — an ex-member cannot be seated, incl. the host).
    select coalesce(array_agg(distinct tm.member_id), '{}') into v_roster
    from public.table_members tm
    where tm.table_id = g.table_id
      and tm.member_id = any (array_append(coalesce(p_member_ids, '{}'::uuid[]), p_host));

    if not (p_host = any (v_roster)) then
        return null;              -- host left the table → rescue unavailable (accepted)
    end if;

    insert into public.suppers (restaurant_id, host_user_id, table_id)
    values (g.restaurant_id, p_host, g.table_id)
    returning id into v_supper_id;

    insert into public.supper_members (supper_id, user_id)
    select v_supper_id, u from unnest(v_roster) as u;

    update public.gatherings
    set supper_id = v_supper_id, updated_at = now()
    where id = g.id;

    return v_supper_id;
end;
$fn$;

revoke all on function public.fn_rescue_expired_gathering(uuid, uuid, uuid[]) from PUBLIC, anon, authenticated;
grant execute on function public.fn_rescue_expired_gathering(uuid, uuid, uuid[]) to service_role;

-- ── 11. fn_attach_take_to_supper — validated stitch attach ───────────────────
-- The ONLY path that binds an EXISTING entry to a supper. Locks the entry,
-- revalidates everything server-side (a stale or manipulated confirmation is
-- rejected), then sets supper_id. Raised messages are typed for the edge fn:
--   attach_denied:*   → 403 (not owner / not a member / restaurant mismatch)
--   attach_conflict:* → 409 (already attached / already has a take)
-- The unique index also guards the race — unique_violation maps to the same
-- conflict. Returns the updated entries row.
create or replace function public.fn_attach_take_to_supper(
    p_user      uuid,
    p_entry_id  uuid,
    p_supper_id uuid
)
returns public.entries
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
    e            public.entries%rowtype;
    v_restaurant uuid;
begin
    select * into e
    from public.entries
    where id = p_entry_id
    for update;

    if not found or e.user_id is distinct from p_user then
        raise exception 'attach_denied: entry not found or not owned by caller';
    end if;
    if e.supper_id is not null then
        raise exception 'attach_conflict: entry already belongs to a supper';
    end if;
    if not exists (
        select 1 from public.supper_members m
        where m.supper_id = p_supper_id
          and m.user_id = p_user
    ) then
        raise exception 'attach_denied: caller is not a member of this supper';
    end if;

    select s.restaurant_id into v_restaurant
    from public.suppers s
    where s.id = p_supper_id;
    if v_restaurant is null or e.restaurant_id is distinct from v_restaurant then
        raise exception 'attach_denied: entry restaurant does not match the supper';
    end if;

    if exists (
        select 1 from public.entries t
        where t.supper_id = p_supper_id
          and t.user_id = p_user
    ) then
        raise exception 'attach_conflict: caller already has a take in this supper';
    end if;

    update public.entries
    set supper_id = p_supper_id, updated_at = now()
    where id = p_entry_id
    returning * into e;

    return e;
exception
    when unique_violation then
        raise exception 'attach_conflict: caller already has a take in this supper';
end;
$fn$;

revoke all on function public.fn_attach_take_to_supper(uuid, uuid, uuid) from PUBLIC, anon, authenticated;
grant execute on function public.fn_attach_take_to_supper(uuid, uuid, uuid) to service_role;

-- ── 12. fn_supper_stitch_suggestion — suggest-only candidacy ─────────────────
-- One RPC used by BOTH the fresh-create and dedup paths of the entry fn. A
-- suggestion exists iff ALL hold: the author is a supper_members row for a
-- supper at the SAME canonical restaurant_id; the author has no take in that
-- supper yet; and the HKT calendar-day distance between the entry's visited_at
-- and the supper's night (linked gather's gather_on via the unique reverse
-- link, else supper created_at) is <= 1 inclusive. At most ONE row: nearest by
-- day distance, tie-broken by the most recently created supper. The server
-- NEVER attaches on its own — the client confirms via attach-take.
create or replace function public.fn_supper_stitch_suggestion(
    p_user          uuid,
    p_restaurant_id uuid,
    p_visited_at    timestamptz,
    p_entry_id      uuid
)
returns table (
    supper_id       uuid,
    restaurant_name text,
    gathered_count  int,
    night           date
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
    select
        s.id                        as supper_id,
        r.name                      as restaurant_name,
        (
            select count(*)::int
            from public.supper_members mc
            where mc.supper_id = s.id
        )                           as gathered_count,
        coalesce(g.gather_on, (s.created_at at time zone 'Asia/Hong_Kong')::date) as night
    from public.supper_members m
    join public.suppers s     on s.id = m.supper_id
    join public.restaurants r on r.id = s.restaurant_id
    left join public.gatherings g on g.supper_id = s.id
    where m.user_id = p_user
      and s.restaurant_id = p_restaurant_id
      and not exists (
          select 1 from public.entries e
          where e.supper_id = s.id
            and e.user_id = p_user
            and e.id <> p_entry_id
      )
      and abs(
          (p_visited_at at time zone 'Asia/Hong_Kong')::date
          - coalesce(g.gather_on, (s.created_at at time zone 'Asia/Hong_Kong')::date)
      ) <= 1
    order by
        abs(
            (p_visited_at at time zone 'Asia/Hong_Kong')::date
            - coalesce(g.gather_on, (s.created_at at time zone 'Asia/Hong_Kong')::date)
        ) asc,
        s.created_at desc
    limit 1;
$fn$;

revoke all on function public.fn_supper_stitch_suggestion(uuid, uuid, timestamptz, uuid) from PUBLIC, anon, authenticated;
grant execute on function public.fn_supper_stitch_suggestion(uuid, uuid, timestamptz, uuid) to service_role;

-- ── 13. pg_cron: the hourly gathering sweep ──────────────────────────────────
-- pg_cron is a HARD prerequisite on prod (the prod-deploy.yml gate fails smoke
-- → auto-revert when cron.job lacks 'gathering-sweep'). The replay/CI
-- throwaway DB may lack the extension binary entirely, so BOTH the CREATE
-- EXTENSION and the schedule are guarded — replay stays green while prod gets
-- the job. Distinct dollar-quote tags ($do$ / $job$ — 20260504000001 idiom).
-- cron.schedule upserts by jobname, so re-applying never duplicates the job.
do $do$
begin
    begin
        create extension if not exists pg_cron;
    exception when others then
        raise warning 'TICKET-159: pg_cron unavailable in this database (%) — gathering-sweep NOT scheduled here. Prod presence is enforced by the deploy gate.', sqlerrm;
    end;

    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule(
            'gathering-sweep',
            '0 * * * *',
            $job$select public.fn_dispatch_all_due_gatherings();$job$
        );
    end if;
end
$do$;
