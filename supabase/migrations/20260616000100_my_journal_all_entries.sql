-- Journal scope fix: the personal Journal (and own-profile Diary) should show
-- ALL of the viewer's own logged meals — feed-only AND ones shared to a Table or
-- logged in a Round — per the "the feed IS your personal journal" doctrine.
--
-- Symptom that prompted this: a tester's Journal was "stuck at April 14" because
-- every recent log had a table_id (shared to their Table), and fn_my_solo_entries
-- excluded anything with table_id / table_night_id / entry_tables. Those meals
-- were in the DB and the Table feed, just filtered out of the personal Journal.
--
-- Change: drop the three table-exclusion predicates so the function returns every
-- entry the viewer authored. The auth.uid() == p_user_id guard is preserved
-- (callers can still only read their OWN entries — SECURITY DEFINER bypasses RLS,
-- so this guard is the access control). A computed `is_shared` boolean is added so
-- the Journal can render a subtle "shared to a Table" badge without needing the
-- table_id column (which authenticated cannot read directly — TICKET-043).
--
-- NOTE: the function name stays `fn_my_solo_entries` even though it is no longer
-- "solo only". Renaming would break already-installed app builds that call this
-- RPC by name; a rename can land opportunistically with a coordinated app release.
--
-- Return type gains a column, so this must DROP + CREATE (CREATE OR REPLACE cannot
-- change RETURNS TABLE). Adding a trailing column is backward-compatible for
-- existing callers (they select named fields and ignore extras), so deploying this
-- migration alone fixes the Journal on already-shipped builds.

drop function if exists public.fn_my_solo_entries(uuid, integer);

create function public.fn_my_solo_entries(p_user_id uuid, p_limit integer default 50)
returns table(
    id uuid,
    user_id uuid,
    restaurant_id uuid,
    rating numeric,
    content text,
    dish_description text,
    visited_at timestamptz,
    created_at timestamptz,
    photo_url text,
    liked boolean,
    is_shared boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
    select
        e.id,
        e.user_id,
        e.restaurant_id,
        e.rating,
        e.content,
        e.dish_description,
        e.visited_at,
        e.created_at,
        e.photo_url,
        e.liked,
        (
            e.table_id is not null
            or e.table_night_id is not null
            or exists (select 1 from public.entry_tables et where et.entry_id = e.id)
        ) as is_shared
    from public.entries e
    where e.user_id = p_user_id
      and p_user_id = auth.uid()   -- security: caller can only read own entries
    order by coalesce(e.visited_at, e.created_at) desc
    limit p_limit;
$function$;

revoke all on function public.fn_my_solo_entries(uuid, integer) from public, anon;
grant execute on function public.fn_my_solo_entries(uuid, integer) to authenticated, service_role;

comment on function public.fn_my_solo_entries(uuid, integer) is
  'Returns ALL of the viewer''s own entries (feed-only + Table-shared + Round) for '
  'the personal Journal / own-profile Diary. SECURITY DEFINER bypasses RLS; the '
  'p_user_id = auth.uid() guard is the access control. is_shared marks entries '
  'attached to a Table/Round so the Journal can badge them. Legacy name (was '
  'solo-only before 20260616000100) kept to avoid breaking installed app builds.';
