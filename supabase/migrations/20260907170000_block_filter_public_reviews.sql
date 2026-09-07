-- Make the public-review RPCs viewer-aware so blocking actually hides reviews.
--
-- Apple Guideline 1.2 requires that blocking a user works. It did not on the
-- busiest screen in the app: `get_public_reviews` (restaurant page REVIEWS) and
-- `get_public_reviews_page` (the /restaurant-reviews folio) took NO viewer
-- argument at all, so a viewer-relative block filter was structurally impossible
-- inside them. Their only row gate, `is_entry_publicly_eligible`, is purely
-- author-side. `restaurant-history` calls them with the SERVICE ROLE key, which
-- bypasses RLS, so nothing downstream filtered either. A blocked person's name,
-- avatar, rating, review text and photos all kept rendering to the blocker.
--
-- WHY THE FILTER LIVES IN SQL AND IN A SECURITY DEFINER:
-- `blocked_users`' only SELECT policy is `blocker_id = auth.uid()`, so a check
-- running as INVOKER can see the viewer's own block row but NOT the reverse one.
-- A both-direction check written inline against a user JWT therefore FAILS OPEN
-- for the blocked-by direction. This repo already hit that trap on
-- `fn_restaurant_saves_visible`. The existing `fn_block_between_viewer(p_other)`
-- helper cannot be reused here either: it resolves the viewer from `auth.uid()`,
-- which is NULL under the service role, so it would report "no block" every time.
-- Hence a new helper that takes BOTH ids explicitly.
--
-- FAIL CLOSED: both RPCs now require p_viewer and return NO rows when it is null.
-- A miswired caller loses reviews (visible, fixable) instead of leaking a blocked
-- user's content (invisible, and a rejection). Same posture as fn_visible_entry_ids.
--
-- The signatures change, so the old ones are dropped. `supabase db push` runs
-- before the edge functions redeploy, so between the two the previous
-- restaurant-history build calls a signature that no longer exists and its
-- review sections come back empty for a few seconds. That is deliberate: an
-- empty section briefly is strictly better than a permanent UGC leak, and a
-- default-valued extra parameter is not an option (it would make the 2-arg call
-- ambiguous rather than replacing it).
--
-- Replay-from-zero: pure DDL, no data dependency.

-- ── Shared both-direction block predicate ────────────────────────────────────
create or replace function public.fn_blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
    select p_a is null
        or p_b is null
        or exists (
            select 1
            from public.blocked_users b
            where (b.blocker_id = p_a and b.blocked_id = p_b)
               or (b.blocker_id = p_b and b.blocked_id = p_a)
        );
$fn$;

comment on function public.fn_blocked_between(uuid, uuid) is
    'True when either party has blocked the other, or when either id is null '
    '(callers treat unknown as blocked so an unwired viewer fails closed). '
    'SECURITY DEFINER on purpose: blocked_users RLS hides the reverse row, so an '
    'invoker-side both-direction check fails open.';

revoke all on function public.fn_blocked_between(uuid, uuid) from public;
revoke all on function public.fn_blocked_between(uuid, uuid) from anon;
revoke all on function public.fn_blocked_between(uuid, uuid) from authenticated;
grant execute on function public.fn_blocked_between(uuid, uuid) to service_role;

-- ── Restaurant page REVIEWS ──────────────────────────────────────────────────
drop function if exists public.get_public_reviews(uuid, integer);

create function public.get_public_reviews(
    p_restaurant_id uuid,
    p_viewer uuid,
    p_limit integer default 20
)
returns table(
    entry_id uuid, user_id uuid, display_name text, username text, avatar_url text,
    rating numeric, content text, created_at timestamp with time zone,
    public_reaction_count integer, public_reply_count integer,
    photo_url text, total_count bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
    with eligible as (
        select e.id, e.user_id, e.rating, e.content, e.created_at,
               e.public_reaction_count, e.public_reply_count
        from entries e
        where p_viewer is not null
          and e.restaurant_id = p_restaurant_id
          and is_entry_publicly_eligible(e.id)
          -- Blocked either direction: gone from the rows AND from total_count,
          -- so the `all N reviews` doorway cannot advertise a hidden review.
          and not public.fn_blocked_between(p_viewer, e.user_id)
        order by e.created_at desc
    ),
    total as (select count(*) as c from eligible)
    select
        el.id as entry_id, el.user_id, p.display_name, p.username, p.avatar_url,
        el.rating, el.content, el.created_at,
        el.public_reaction_count, el.public_reply_count,
        (
            select ep.photo_url from entry_photos ep
            where ep.entry_id = el.id
            order by ep.sort_order asc
            limit 1
        ) as photo_url,
        total.c as total_count
    from eligible el
    cross join total
    join profiles p on p.user_id = el.user_id
    limit p_limit;
$fn$;

revoke all on function public.get_public_reviews(uuid, uuid, integer) from public;
revoke all on function public.get_public_reviews(uuid, uuid, integer) from anon;
revoke all on function public.get_public_reviews(uuid, uuid, integer) from authenticated;
grant execute on function public.get_public_reviews(uuid, uuid, integer) to service_role;

-- ── /restaurant-reviews folio (keyset paged) ─────────────────────────────────
drop function if exists public.get_public_reviews_page(uuid, integer, timestamptz, uuid);

create function public.get_public_reviews_page(
    p_restaurant_id uuid,
    p_viewer uuid,
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
    where p_viewer is not null
      and e.restaurant_id = p_restaurant_id
      and is_entry_publicly_eligible(e.id)
      and not public.fn_blocked_between(p_viewer, e.user_id)
      and (
          p_cursor_date is null
          or (e.created_at, e.id) < (p_cursor_date, p_cursor_id)
      )
    order by e.created_at desc, e.id desc
    limit p_limit;
$fn$;

revoke all on function public.get_public_reviews_page(uuid, uuid, integer, timestamptz, uuid) from public;
revoke all on function public.get_public_reviews_page(uuid, uuid, integer, timestamptz, uuid) from anon;
revoke all on function public.get_public_reviews_page(uuid, uuid, integer, timestamptz, uuid) from authenticated;
grant execute on function public.get_public_reviews_page(uuid, uuid, integer, timestamptz, uuid) to service_role;
