-- TICKET-127 — Gather v2: counter-dates.
--
-- Two questions the group chat actually negotiates that the binary RSVP can't
-- carry: "that date doesn't work — Saturday?" This migration widens the RSVP to a
-- third answer, 'counter' ("can't that day — here's one that works"), which rides
-- a `counter_on` date; and gives `gatherings` a `rescheduled_from` breadcrumb so a
-- host re-date can render "date moved · was <date>".
--
-- SECURITY MODEL unchanged (TICKET-095): writes are service-role ONLY — the
-- `gatherings` edge fn validates the caller (table_members.member_id) and performs
-- every insert/update. No client write policy exists on either table. RLS and
-- grants are untouched here (additive column + widened checks only).
--
-- REPLAYABILITY: from-zero replay creates gathering_rsvps with an inline
-- ('in','out') check auto-named `gathering_rsvps_response_check`; this migration
-- drops that by name (IF EXISTS) and re-adds the widened check under the same
-- name, then adds the paired counter_on invariant. `add column if not exists`
-- keeps the column add idempotent. No version rename — content edits only.

-- ── 1. gathering_rsvps: 'counter' response + counter_on date ──────────────────
-- Drop the inline ('in','out') check (single-column ⇒ auto-named
-- gathering_rsvps_response_check) and re-add it widened to include 'counter'.
alter table public.gathering_rsvps
    drop constraint if exists gathering_rsvps_response_check;

alter table public.gathering_rsvps
    add column if not exists counter_on date;

alter table public.gathering_rsvps
    add constraint gathering_rsvps_response_check
        check (response in ('in', 'out', 'counter'));

-- Paired invariant: a counter MUST name a date; in/out MUST NOT carry one.
-- (A prior in/out flipped to counter, or vice versa, must set/clear counter_on in
-- the same write — the edge fn does exactly this.)
alter table public.gathering_rsvps
    add constraint gathering_rsvps_counter_on_pairing
        check (
            (response = 'counter' and counter_on is not null)
            or (response in ('in', 'out') and counter_on is null)
        );

comment on column public.gathering_rsvps.counter_on is
    'TICKET-127: the date a member counter-proposed (set iff response = ''counter''). '
    'A host re-date flips counters whose counter_on = the new date to ''in''.';

-- ── 2. gatherings: rescheduled_from (host re-date breadcrumb) ─────────────────
alter table public.gatherings
    add column if not exists rescheduled_from date;

comment on column public.gatherings.rescheduled_from is
    'TICKET-127: the previous gather_on before the host last re-dated this gathering '
    '(null = never re-dated). Renders the card''s "date moved · was <date>" meta line.';

-- ── 3. fn_reschedule_gathering — atomic host re-date (TICKET-127 AC8) ──────────
-- The edge fn used to run the row-claim, the prior-'in' delete, and the counter
-- flip as THREE sequential service-role writes. A crash/timeout between them left
-- the gathering moved but its RSVPs half-reset (review P2). Fold the whole re-date
-- into one SECURITY DEFINER function so it commits atomically. Amended AC8:
--   (a) claim the row: host-owned, still 'proposed', actually moving to a new day;
--       rescheduled_from captures the OLD gather_on (SET reads pre-update values).
--   (b) delete EVERY prior 'in' — they said yes to the old day, so re-ask them.
--   (c) counters naming the NEW date become confirmed 'in' (counter_on cleared).
--   (d) UPSERT the host 'in' — the host chose the new date. Without this the host's
--       own 'in' was deleted in (b) and never restored (the stuck-unanswered-host
--       state the review found); step (d) is the fix.
-- Returns the moved gatherings row, or NULL when the claim matched nothing (lost
-- the race to dispatch/cancel/expiry, or not the host) → edge fn maps NULL to 409.
-- Service-role only (mirrors fn_dispatch_due_gatherings hardening).
create or replace function public.fn_reschedule_gathering(
    p_gathering_id uuid,
    p_host         uuid,
    p_new_date     date
)
returns public.gatherings
language plpgsql
security definer
set search_path = public
as $fn$
declare
    v_row public.gatherings;
begin
    -- (a) Claim + move in one guarded UPDATE. rescheduled_from = g.gather_on reads
    -- the OLD value (SET expressions see the pre-update row).
    update public.gatherings g
    set gather_on        = p_new_date,
        rescheduled_from = g.gather_on,
        updated_at       = now()
    where g.id = p_gathering_id
      and g.host_user_id = p_host
      and g.status = 'proposed'
      and g.gather_on <> p_new_date
    returning g.* into v_row;

    if not found then
        return null;
    end if;

    -- (b) Every prior 'in' answered for the OLD day → reset to unanswered.
    delete from public.gathering_rsvps
    where gathering_id = p_gathering_id
      and response = 'in';

    -- (c) Counters that named the NEW date become confirmed 'in' (counter_on cleared).
    update public.gathering_rsvps
    set response   = 'in',
        counter_on = null,
        updated_at = now()
    where gathering_id = p_gathering_id
      and response = 'counter'
      and counter_on = p_new_date;

    -- (d) The host chose the new date → (re)assert their 'in'.
    insert into public.gathering_rsvps (gathering_id, user_id, response, counter_on, updated_at)
    values (p_gathering_id, p_host, 'in', null, now())
    on conflict (gathering_id, user_id)
    do update set response = 'in', counter_on = null, updated_at = now();

    return v_row;
end;
$fn$;

revoke all on function public.fn_reschedule_gathering(uuid, uuid, date) from PUBLIC, anon, authenticated;
grant execute on function public.fn_reschedule_gathering(uuid, uuid, date) to service_role;
