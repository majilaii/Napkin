-- Fix: "permission denied for table entries" 403s on entry_photos /
-- entry_companions / entry_participants reads (broke photo + companion loading on
-- every review screen; flooded the postgres logs).
--
-- Root cause: those tables' SELECT RLS policies called `can_view_entry(e.*)` —
-- passing the WHOLE entries row — inside a cross-table subquery
-- `EXISTS (SELECT 1 FROM entries e WHERE e.id = <fk> AND can_view_entry(e.*))`.
-- Materializing the whole-row `e.*` requires TABLE-LEVEL SELECT on entries, but
-- `authenticated` only has COLUMN-level grants (table_id is revoked — TICKET-043).
-- Postgres therefore raised `42501 permission denied for table entries` whenever an
-- authenticated user read a photo/companion/participant row for an entry.
-- (Granting individual columns does NOT help: a whole-row reference needs the
-- table-level privilege specifically.)
--
-- Fix: a SECURITY DEFINER wrapper that reads the entries row with OWNER privileges
-- and returns the visibility boolean. The policies now pass only the entry_id
-- (always readable) — never the whole row — so no table-level grant is needed and
-- the column-restriction model (TICKET-043) stays intact.
--
-- entries_select_v2 is deliberately NOT changed: its `can_view_entry(entries.*)` is
-- a self-row reference on the table being scanned, which works under the existing
-- column grants (verified: entries reads return 200).
--
-- NOTE: this was hotfixed directly on prod via the dashboard SQL editor during an
-- active friend-test fire; this migration records that change idempotently.

create or replace function public.can_view_entry_id(p_entry_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_entry(e.*) from public.entries e where e.id = p_entry_id;
$$;

revoke all on function public.can_view_entry_id(uuid) from public, anon;
grant execute on function public.can_view_entry_id(uuid) to authenticated, service_role;

comment on function public.can_view_entry_id(uuid) is
  'SECURITY DEFINER wrapper around can_view_entry(entries) — lets RLS policies pass '
  'only an entry_id instead of the whole entries row, which authenticated cannot '
  'materialize (table_id column-revoked, TICKET-043). Fixes "permission denied for '
  'table entries" on entry_photos/entry_companions/entry_participants reads.';

-- entry_photos
drop policy if exists entry_photos_select_v2 on public.entry_photos;
create policy entry_photos_select_v2 on public.entry_photos
  for select to authenticated
  using (public.can_view_entry_id(entry_id));

-- entry_companions
drop policy if exists entry_companions_select_v2 on public.entry_companions;
create policy entry_companions_select_v2 on public.entry_companions
  for select to authenticated
  using ((user_id = auth.uid()) or public.can_view_entry_id(entry_id));

-- entry_participants
drop policy if exists entry_participants_select_v2 on public.entry_participants;
create policy entry_participants_select_v2 on public.entry_participants
  for select to authenticated
  using ((user_id = auth.uid()) or public.can_view_entry_id(entry_id));
