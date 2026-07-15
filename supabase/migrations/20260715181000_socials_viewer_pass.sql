-- TICKET-189 — "on socials" stage 2: the JWT-bound live viewer pass.
--
-- fn_socials_viewer_pass(p_viewer, p_restaurant_ids): for the bounded candidate
-- id array from stage 1 (fn_get_socials_candidates, ≤30 ids), recompute every
-- viewer-dependent fact LIVE by LATERALing TICKET-155's doctrine predicate
-- fn_restaurant_saves_visible — so blocks in BOTH directions, public→private
-- flips since the cache was computed, and self-exclusion are all honored by
-- the SINGLE authoritative visibility referent (never a re-implemented block
-- check that could drift).
--
-- Layered on top of 155's rows, for the PUBLIC count only:
--   • relationship <> 'self'          — the viewer's own saves never feed their
--                                       counts; k is recomputed post-exclusion
--                                       (spec: self-exclusion demotes k=3→k=2).
--   • fn_public_account(saver) LIVE   — 155 returns private tablemates (their
--                                       saves ARE visible to the viewer on the
--                                       restaurant page), but the socials module
--                                       aggregates PUBLIC savers only, so the
--                                       tablemate residual is closed here, and a
--                                       saver who flipped private since the
--                                       stage-1 compute drops out at read time.
--   • social sources only             — same tiktok | web+IG-host predicate as
--                                       stage 1 (fn_is_instagram_url, SQL copy).
--   • 30d window                      — matches the stage-1 candidate window.
--
-- Returns PER-WINDOW platform facts (platform_7d / platform_30d, each computed
-- over that window's surviving public savers — Codex P1: after the ladder
-- demotes a card from weekly to monthly, the label must reflect the SELECTED
-- window's population, never a platform that only appeared in excluded rows)
-- plus the representative clip = the most recent surviving public social clip.
--
-- rep_saver_id NEVER leaves the edge fn (feed-socials projects it away — the
-- client payload carries counts-or-creator-content only, no Napkin identity).
--
-- A candidate with ZERO surviving social clips for this viewer returns no row
-- (the inner join drops it) — "demote down the ladder, not out" is the edge
-- fn's job across rungs; a candidate leaves entirely only at zero clips.
--
-- Replay-from-zero: references fn_restaurant_saves_visible (20260710160000),
-- fn_public_account (20260704120000) and fn_is_instagram_url (20260715180000 —
-- earlier in this chain). No check_function_bodies toggle needed.

create or replace function public.fn_socials_viewer_pass(
    p_viewer         uuid,
    p_restaurant_ids uuid[]
)
returns table (
    restaurant_id     uuid,
    k7                int,
    k30               int,
    platform_7d       text,
    platform_30d      text,
    rep_saver_id      uuid,
    rep_source_type   text,
    rep_url           text,
    rep_author_handle text,
    rep_created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $fn$
    with social as (
        select
            rid.rid as restaurant_id,
            v.saver_id,
            case
                when v.source->>'type' = 'tiktok' then 'tiktok'
                else 'instagram'
            end as platform,
            v.source->>'url' as url,
            v.source->>'author_handle' as author_handle,
            v.created_at
        from unnest(p_restaurant_ids) as rid(rid)
        cross join lateral public.fn_restaurant_saves_visible(p_viewer, rid.rid) v
        where v.relationship <> 'self'                 -- self-exclusion (k recompute)
          and public.fn_public_account(v.saver_id)     -- live public re-check
          and v.created_at >= now() - interval '30 days'
          and (
              v.source->>'type' = 'tiktok'
              or (v.source->>'type' = 'web' and public.fn_is_instagram_url(v.source->>'url'))
          )
    ),
    agg as (
        select
            s.restaurant_id,
            (count(distinct s.saver_id) filter (
                where s.created_at >= now() - interval '7 days'))::int as k7,
            count(distinct s.saver_id)::int as k30,
            case
                when count(*) filter (where s.platform = 'tiktok'
                        and s.created_at >= now() - interval '7 days') > 0
                 and count(*) filter (where s.platform = 'instagram'
                        and s.created_at >= now() - interval '7 days') > 0 then 'mixed'
                when count(*) filter (where s.platform = 'tiktok'
                        and s.created_at >= now() - interval '7 days') > 0 then 'tiktok'
                when count(*) filter (where s.platform = 'instagram'
                        and s.created_at >= now() - interval '7 days') > 0 then 'instagram'
                else 'none'
            end as platform_7d,
            case
                when count(*) filter (where s.platform = 'tiktok') > 0
                 and count(*) filter (where s.platform = 'instagram') > 0 then 'mixed'
                when count(*) filter (where s.platform = 'tiktok') > 0 then 'tiktok'
                when count(*) filter (where s.platform = 'instagram') > 0 then 'instagram'
                else 'none'
            end as platform_30d
        from social s
        group by s.restaurant_id
    ),
    rep as (
        -- Representative clip = most recent surviving public social clip.
        select distinct on (s.restaurant_id)
            s.restaurant_id, s.saver_id, s.platform, s.url, s.author_handle, s.created_at
        from social s
        order by s.restaurant_id, s.created_at desc, s.saver_id desc
    )
    select
        a.restaurant_id,
        a.k7,
        a.k30,
        a.platform_7d,
        a.platform_30d,
        r.saver_id,
        r.platform,
        r.url,
        r.author_handle,
        r.created_at
    from agg a
    join rep r on r.restaurant_id = a.restaurant_id;
$fn$;

comment on function public.fn_socials_viewer_pass(uuid, uuid[]) is
    'TICKET-189: stage-2 live viewer pass for the socials module. LATERALs '
    'fn_restaurant_saves_visible over the bounded candidate id array, filters '
    'to public accounts (live) + social sources + non-self, returns viewer-'
    'adjusted k7/k30, PER-WINDOW platform facts, and the most-recent surviving '
    'public clip. rep_saver_id never leaves the edge fn. Service-role only — '
    'feed-socials validates the JWT and passes p_viewer = auth.uid().';

revoke all on function public.fn_socials_viewer_pass(uuid, uuid[]) from PUBLIC, anon, authenticated;
grant execute on function public.fn_socials_viewer_pass(uuid, uuid[]) to service_role;
