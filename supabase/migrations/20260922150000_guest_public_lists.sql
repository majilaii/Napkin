-- TICKET-247 (adversarial review, round 2): signed-out guests may read public lists.
--
-- A guest can read a list exactly when a signed-in stranger could read it through
-- lists?action=get: privacy = 'public', not a Table list (table_id is null) and
-- owned by a public account. A guest has no viewer id, so there is no block check.
-- Entries follow the guest rule for restaurants (20260922120000): only verified,
-- non-tombstoned restaurants appear, because unverified ghosts are owner-scoped
-- (TICKET-060). Only a Places photo leaves the database; a member's own meal photo
-- in restaurants.photo_url never reaches a guest.
--
-- One security definer function returns the whole read as jsonb, shaped like the
-- signed-in ListDetailData, or NULL when the list is not public. It is callable
-- only by service_role: the public-browse edge function is the single caller.
-- Additive migration, no table, column or policy changes.

create or replace function public.fn_guest_public_list(p_list_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
    select jsonb_build_object(
        'list', jsonb_build_object(
            'id', l.id,
            'owner_id', l.owner_id,
            'title', l.title,
            'description', l.description,
            'ranked', l.ranked,
            'privacy', l.privacy,
            'emoji', l.emoji,
            'table_id', null,
            'created_at', l.created_at,
            'updated_at', l.updated_at
        ),
        'owner_profile', jsonb_build_object(
            'display_name', p.display_name,
            'avatar_url', p.avatar_url,
            'username', p.username,
            'account_privacy', p.account_privacy
        ),
        'save_count', (select count(*) from list_saves s where s.list_id = l.id),
        'entries', coalesce((
            select jsonb_agg(
                jsonb_build_object(
                    'id', le.id,
                    'list_id', le.list_id,
                    'restaurant_id', le.restaurant_id,
                    'note', le.note,
                    'position', le.position,
                    'created_at', le.created_at,
                    'restaurant', jsonb_build_object(
                        'id', r.id,
                        'name', r.name,
                        'address', r.address,
                        'city', r.city,
                        'country', r.country,
                        'cuisine', r.cuisine,
                        'price_level', r.price_level,
                        'photo_url', case when r.photo_source = 'places' then r.photo_url end,
                        'photo_source', r.photo_source,
                        'places_photo_attribution_html',
                            case when r.photo_source = 'places' then r.places_photo_attribution_html end,
                        'google_rating', r.google_rating,
                        'external_id', r.external_id,
                        'verification', r.verification,
                        'lat', r.lat,
                        'lng', r.lng
                    )
                )
                -- Same order as lists?action=get: ranked by position, else newest first.
                order by
                    case when l.ranked then le.position end asc nulls last,
                    case when l.ranked then null else le.created_at end desc nulls last,
                    le.id asc
            )
            from list_entries le
            join restaurants r on r.id = le.restaurant_id
            where le.list_id = l.id
              and r.verification = 'verified'
              and r.merged_into is null
        ), '[]'::jsonb)
    )
    from lists l
    join profiles p on p.user_id = l.owner_id
    where l.id = p_list_id
      and l.privacy = 'public'
      and l.table_id is null
      and p.account_privacy = 'public';
$fn$;

revoke all on function public.fn_guest_public_list(uuid) from public;
revoke all on function public.fn_guest_public_list(uuid) from anon;
revoke all on function public.fn_guest_public_list(uuid) from authenticated;
grant execute on function public.fn_guest_public_list(uuid) to service_role;

comment on function public.fn_guest_public_list(uuid) is
    'TICKET-247 guest reads: one public, non-Table list of a public account with its '
    'verified, non-tombstoned entries (Places photos only), as jsonb; NULL otherwise. '
    'service_role only (public-browse).';
