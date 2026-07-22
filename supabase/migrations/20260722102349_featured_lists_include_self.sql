-- Lists that contain a restaurant, for the restaurant-page typographic band.
-- The restaurant-history edge path runs as service_role, so privacy is explicit here:
-- the viewer's own non-Table lists always qualify; everyone else's require a public
-- list and public owner account. Viewer-owned lists sort first.

create or replace function public.fn_restaurant_featured_lists(
    p_viewer        uuid,
    p_restaurant_id uuid,
    p_limit         int default 3
)
returns table (
    id                 uuid,
    owner_id           uuid,
    title              text,
    ranked             boolean,
    emoji              text,
    entry_count        bigint,
    updated_at         timestamptz,
    owner_display_name text,
    owner_username     text,
    total_count        bigint
)
language sql
stable
security invoker
as $fn$
    select
        l.id,
        l.owner_id,
        l.title,
        l.ranked,
        l.emoji,
        (select count(*) from public.list_entries le where le.list_id = l.id) as entry_count,
        l.updated_at,
        p.display_name as owner_display_name,
        p.username as owner_username,
        count(*) over () as total_count
    from public.lists l
    join public.profiles p on p.user_id = l.owner_id
    where l.table_id is null
      and (
          l.owner_id = p_viewer
          or (l.privacy = 'public' and p.account_privacy = 'public')
      )
      and exists (
          select 1
          from public.list_entries le2
          where le2.list_id = l.id
            and le2.restaurant_id = p_restaurant_id
      )
    order by (l.owner_id = p_viewer) desc, l.updated_at desc, l.id desc
    limit p_limit;
$fn$;

comment on function public.fn_restaurant_featured_lists(uuid, uuid, int) is
    'Restaurant featured lists: viewer-owned non-Table lists (including private) '
    'first, plus public lists owned by public accounts, ordered before LIMIT. '
    'Explicit projection omits table_id; service-role-only SECURITY INVOKER.';

revoke all on function public.fn_restaurant_featured_lists(uuid, uuid, int)
    from PUBLIC, anon, authenticated;
grant execute on function public.fn_restaurant_featured_lists(uuid, uuid, int)
    to service_role;
