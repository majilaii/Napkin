-- TICKET-114 — trending rail v2.
-- Import saves become the HEADLINE signal (weight 2.0, was 0.5). Window 30d.
-- Adds list_entries as a third signal. Returns three per-restaurant counts.
-- Old fn_compute_trending() is left defined (dead after this release; dropped
-- in a later cleanup). fn_get_trending switched to v2 here.
--
-- Column facts (verified against defining migrations 2026-07-06):
--   wishlist_items: user_id, restaurant_id, job_id, deleted_at, created_at
--     (deleted_at added in a later migration; guarded here like fn_compute_trending).
--   list_entries:   list_id, restaurant_id, note, position, created_at
--     — NO user_id, NO deleted_at. The actor is the LIST OWNER, reached via
--       lists.owner_id (NOT lists.user_id — that column does not exist).
--   lists:          id, owner_id, title, ...

-- ── 1. fn_compute_trending_v2 — new signature (3 extra count columns) ─────────
create or replace function public.fn_compute_trending_v2()
returns table (
    restaurant_id  uuid,
    score          double precision,
    imports_30d    int,
    saves_30d      int,
    list_adds_30d  int
)
language sql
stable
security definer
set search_path = public
as $$
    with wl as (
        -- one save per (user, restaurant); job_id marks an import batch.
        select distinct on (w.user_id, w.restaurant_id)
            w.user_id,
            w.restaurant_id,
            (w.job_id is not null) as is_import,
            w.created_at
        from public.wishlist_items w
        where w.restaurant_id is not null
          and w.deleted_at is null
          and w.created_at >= now() - interval '30 days'
        order by w.user_id, w.restaurant_id, w.created_at asc
    ),
    le as (
        -- list_entries in window; distinct (owner, restaurant). Join list_entries
        -- → lists to attribute the actor (list OWNER = lists.owner_id).
        -- list_entries has no deleted_at column, so no soft-delete guard here.
        select distinct l.owner_id as user_id, le.restaurant_id
        from public.list_entries le
        join public.lists l on l.id = le.list_id
        where le.restaurant_id is not null
          and le.created_at >= now() - interval '30 days'
    ),
    import_counts as (
        select restaurant_id, count(distinct user_id)::int as imports_30d
        from wl where is_import group by restaurant_id
    ),
    save_counts as (
        select restaurant_id, count(distinct user_id)::int as saves_30d
        from wl where not is_import group by restaurant_id
    ),
    list_counts as (
        select restaurant_id, count(distinct user_id)::int as list_adds_30d
        from le group by restaurant_id
    ),
    -- distinct actors across ALL signal types, last 7 days, for the k-floor.
    actors_7d as (
        select restaurant_id, user_id from wl where created_at >= now() - interval '7 days'
        union
        -- restrict list adds to 7d for the actor floor; actor = list owner.
        select le2.restaurant_id, l2.owner_id
        from public.list_entries le2
        join public.lists l2 on l2.id = le2.list_id
        where le2.restaurant_id is not null
          and le2.created_at >= now() - interval '7 days'
    ),
    qualifying as (
        select restaurant_id, count(distinct user_id)::int as actors_7d
        from actors_7d group by restaurant_id
        having count(distinct user_id) >= 3
    ),
    all_ids as (
        select restaurant_id from import_counts
        union select restaurant_id from save_counts
        union select restaurant_id from list_counts
    ),
    scored as (
        select
            a.restaurant_id,
            2.0 * coalesce(ic.imports_30d, 0)
          + 1.0 * coalesce(sc.saves_30d, 0)
          + 1.0 * coalesce(lc.list_adds_30d, 0) as score,
            coalesce(ic.imports_30d, 0)   as imports_30d,
            coalesce(sc.saves_30d, 0)     as saves_30d,
            coalesce(lc.list_adds_30d, 0) as list_adds_30d
        from all_ids a
        left join import_counts ic on ic.restaurant_id = a.restaurant_id
        left join save_counts   sc on sc.restaurant_id = a.restaurant_id
        left join list_counts   lc on lc.restaurant_id = a.restaurant_id
    )
    select s.restaurant_id, s.score, s.imports_30d, s.saves_30d, s.list_adds_30d
    from scored s
    join qualifying q on q.restaurant_id = s.restaurant_id
    where (select count(*) from qualifying) >= 3   -- rail hides below 3 qualifiers
    order by s.score desc, s.imports_30d desc, s.restaurant_id asc
    limit 10;
$$;

revoke all on function public.fn_compute_trending_v2() from public, anon, authenticated;
grant execute on function public.fn_compute_trending_v2() to service_role;

comment on function public.fn_compute_trending_v2() is
  'TICKET-114: trending v2 — 30d window; score = 2*imports + saves + list_adds '
  '(distinct users each; list actor = lists.owner_id); k-floor >=3 distinct '
  'actors in 7d; empty below 3 qualifiers; cap 10. Aggregate counts only.';

-- ── 2. fn_get_trending — switch to v2 + hydrate the three counts ─────────────
-- Same cache dance; only the compute call + jsonb_build_object payload change.
create or replace function public.fn_get_trending(p_max_age_seconds int default 3600)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '8s'
as $$
declare
    v_row     public.trending_cache%rowtype;
    v_payload jsonb;
begin
    select * into v_row from public.trending_cache where id = 'global';
    if found and v_row.computed_at > now() - make_interval(secs => p_max_age_seconds) then
        return v_row.payload;
    end if;

    perform pg_advisory_xact_lock(hashtext('trending_cache'));

    select * into v_row from public.trending_cache where id = 'global';
    if found and v_row.computed_at > now() - make_interval(secs => p_max_age_seconds) then
        return v_row.payload;
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'restaurant_id', t.restaurant_id,
                'name',          r.name,
                'cuisine',       r.cuisine,
                'neighborhood',  r.city,
                'photo_url',     r.photo_url,
                'imports_30d',   t.imports_30d,
                'saves_30d',     t.saves_30d,
                'list_adds_30d', t.list_adds_30d
            )
            order by t.score desc, t.imports_30d desc, t.restaurant_id asc
        ),
        '[]'::jsonb
    )
    into v_payload
    from public.fn_compute_trending_v2() t
    join public.restaurants r on r.id = t.restaurant_id;

    insert into public.trending_cache as tc (id, payload, computed_at)
    values ('global', v_payload, now())
    on conflict (id) do update
        set payload = excluded.payload, computed_at = excluded.computed_at;

    return v_payload;
end;
$$;

revoke all on function public.fn_get_trending(int) from public, anon, authenticated;
grant execute on function public.fn_get_trending(int) to service_role;

comment on function public.fn_get_trending(int) is
    'TICKET-114: read-through 1h trending cache (global row). Now calls '
    'fn_compute_trending_v2 and hydrates imports_30d/saves_30d/list_adds_30d. '
    'Advisory-xact-lock serialized recompute; lock_timeout bounds the wait. '
    'Service-role only.';

-- ── 3. Bust the cache so the first read recomputes with the v2 shape ──────────
-- Without this the old-shape row (saver_count_7d) is served for up to 1h and the
-- client sees no counts.
update public.trending_cache set computed_at = 'epoch' where id = 'global';
