-- Public lists that contain a restaurant, for the restaurant-page typographic band.
-- The restaurant-history edge path runs as service_role, so privacy is explicit here:
-- public list + no Table ownership + public owner account + viewer self-exclusion.

create or replace function public.fn_restaurant_featured_lists(
    p_viewer       uuid,
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
    where l.privacy = 'public'
      and l.table_id is null
      and p.account_privacy = 'public'
      and l.owner_id <> p_viewer
      and exists (
          select 1
          from public.list_entries le2
          where le2.list_id = l.id
            and le2.restaurant_id = p_restaurant_id
      )
    order by l.updated_at desc, l.id desc
    limit p_limit;
$fn$;

comment on function public.fn_restaurant_featured_lists(uuid, uuid, int) is
    'Restaurant featured lists: triple-gated to public, non-Table lists owned by '
    'public accounts, with viewer self-exclusion before LIMIT. Explicit projection '
    'omits table_id; service-role-only SECURITY INVOKER.';

revoke all on function public.fn_restaurant_featured_lists(uuid, uuid, int)
    from PUBLIC, anon, authenticated;
grant execute on function public.fn_restaurant_featured_lists(uuid, uuid, int)
    to service_role;
