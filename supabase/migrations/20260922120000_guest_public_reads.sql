-- TICKET-247: guest (signed-out) public reads for the App Store 5.1.1(v) fix.
--
-- A guest is NOT a user: there is no viewer id, so the block filter that the
-- signed-in reviews RPCs fail-closed on (20260907170000) does not apply. These
-- three functions expose ONLY what the public layer already exposes to any
-- signed-in stranger: public-eligible reviews (is_entry_publicly_eligible:
-- public account, visibility <> 'private', rated, with a note) on verified,
-- non-tombstoned restaurants. Unverified restaurants are owner-scoped ghosts
-- (TICKET-060) and must never surface to a guest, so every function joins
-- restaurants and checks verification itself. Nothing here reads tables,
-- wishlists, follows or private entries.
--
-- All three are security definer and callable ONLY by service_role: the
-- public-browse edge function is the single caller. Additive migration, no
-- table, column or policy changes.

-- ── Paged public reviews, no viewer ─────────────────────────────────────────
create or replace function public.get_public_reviews_page_guest(
    p_restaurant_id uuid,
    p_limit integer,
    p_cursor_date timestamp with time zone default null,
    p_cursor_id uuid default null
)
returns table(
    entry_id uuid, user_id uuid, display_name text, username text, avatar_url text,
    rating numeric, content text, created_at timestamp with time zone,
    public_reaction_count integer, public_reply_count integer, photo_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
    select
        e.id as entry_id, e.user_id, p.display_name, p.username, p.avatar_url,
        e.rating, e.content, e.created_at,
        e.public_reaction_count, e.public_reply_count,
        (
            select ep.photo_url from entry_photos ep
            where ep.entry_id = e.id
            order by ep.sort_order asc
            limit 1
        ) as photo_url
    from entries e
    join profiles p on p.user_id = e.user_id
    join restaurants r on r.id = e.restaurant_id
    where e.restaurant_id = p_restaurant_id
      and r.verification = 'verified'
      and r.merged_into is null
      and is_entry_publicly_eligible(e.id)
      and (
          p_cursor_date is null
          or (e.created_at, e.id) < (p_cursor_date, p_cursor_id)
      )
    order by e.created_at desc, e.id desc
    limit least(greatest(coalesce(p_limit, 1), 1), 51);
$fn$;

revoke all on function public.get_public_reviews_page_guest(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.get_public_reviews_page_guest(uuid, integer, timestamptz, uuid) from anon;
revoke all on function public.get_public_reviews_page_guest(uuid, integer, timestamptz, uuid) from authenticated;
grant execute on function public.get_public_reviews_page_guest(uuid, integer, timestamptz, uuid) to service_role;

comment on function public.get_public_reviews_page_guest(uuid, integer, timestamptz, uuid) is
    'TICKET-247 guest reads: public-eligible reviews for one verified, non-tombstoned restaurant, '
    'keyset paged, no viewer and therefore no block filter. service_role only (public-browse).';

-- ── Public review counts for a batch of restaurants ─────────────────────────
create or replace function public.fn_guest_public_review_counts(p_restaurant_ids uuid[])
returns table(restaurant_id uuid, review_count integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
    select e.restaurant_id, count(*)::integer as review_count
    from entries e
    join restaurants r on r.id = e.restaurant_id
    where e.restaurant_id = any (p_restaurant_ids)
      and r.verification = 'verified'
      and r.merged_into is null
      and is_entry_publicly_eligible(e.id)
    group by e.restaurant_id;
$fn$;

revoke all on function public.fn_guest_public_review_counts(uuid[]) from public;
revoke all on function public.fn_guest_public_review_counts(uuid[]) from anon;
revoke all on function public.fn_guest_public_review_counts(uuid[]) from authenticated;
grant execute on function public.fn_guest_public_review_counts(uuid[]) to service_role;

comment on function public.fn_guest_public_review_counts(uuid[]) is
    'TICKET-247 guest reads: public-eligible review count per verified, non-tombstoned restaurant. '
    'service_role only.';

-- ── Recently reviewed restaurants (the guest Places zero-query list) ────────
-- Ordered by the latest public-eligible review. Restaurants must be verified
-- and not tombstoned (merged_into is null, TICKET-195).
create or replace function public.fn_guest_recent_restaurants(p_limit integer)
returns table(restaurant_id uuid, latest_review_at timestamp with time zone, review_count integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
    select
        e.restaurant_id,
        max(e.created_at) as latest_review_at,
        count(*)::integer as review_count
    from entries e
    join restaurants r on r.id = e.restaurant_id
    where e.restaurant_id is not null
      and r.verification = 'verified'
      and r.merged_into is null
      and is_entry_publicly_eligible(e.id)
    group by e.restaurant_id
    order by max(e.created_at) desc, e.restaurant_id desc
    limit least(greatest(coalesce(p_limit, 1), 1), 40);
$fn$;

revoke all on function public.fn_guest_recent_restaurants(integer) from public;
revoke all on function public.fn_guest_recent_restaurants(integer) from anon;
revoke all on function public.fn_guest_recent_restaurants(integer) from authenticated;
grant execute on function public.fn_guest_recent_restaurants(integer) to service_role;

comment on function public.fn_guest_recent_restaurants(integer) is
    'TICKET-247 guest reads: verified restaurants ordered by their latest public-eligible review. '
    'service_role only.';
