-- TICKET-233: mirror the companion mutual-follow gate in RLS so direct
-- PostgREST writes cannot bypass the edge function.
--
-- Replay order: follows (20260428000000) and blocked_users
-- (20260704000000) both exist before this migration.

create or replace function public.fn_can_tag_companion(
  p_author uuid,
  p_target uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select
    p_author = auth.uid()
    and p_author <> p_target
    and exists (
      select 1
      from public.follows f
      where f.follower_id = p_author
        and f.following_id = p_target
    )
    and exists (
      select 1
      from public.follows f
      where f.follower_id = p_target
        and f.following_id = p_author
    )
    and not exists (
      select 1
      from public.blocked_users b
      where (b.blocker_id = p_author and b.blocked_id = p_target)
         or (b.blocker_id = p_target and b.blocked_id = p_author)
    );
$function$;

revoke all on function public.fn_can_tag_companion(uuid, uuid) from public;
revoke execute on function public.fn_can_tag_companion(uuid, uuid) from anon;
grant execute on function public.fn_can_tag_companion(uuid, uuid) to authenticated, service_role;

drop policy if exists entry_companions_insert on public.entry_companions;

create policy entry_companions_insert
on public.entry_companions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.entries e
    where e.id = entry_id
      and e.user_id = auth.uid()
  )
  and public.fn_can_tag_companion(auth.uid(), user_id)
);
