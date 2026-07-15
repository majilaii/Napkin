-- TICKET-189 — "on socials this week" For You module, stage 1 (viewer-agnostic
-- cached candidates).
--
-- Two-stage privacy contract (spec AC§2):
--   Stage 1 (THIS FILE): a global, viewer-agnostic candidate cache — the
--     expensive un-indexed wishlist_items scan (source->>'type' / created_at
--     have no index) runs at most once per hour via the trending_cache
--     dispatch-on-read dance. PUBLIC ACCOUNTS ONLY feed the candidate set.
--   Stage 2 (20260715181000_socials_viewer_pass.sql): a JWT-bound live pass
--     that re-gates every candidate through fn_restaurant_saves_visible for
--     THE viewer (blocks both directions, public→private flips, self-exclusion
--     with k recompute). Nothing from this cache reaches a client un-re-gated.
--
-- ── socials_cache stores SAVER IDS → deny-all table grants ───────────────────
-- The cached payload's clips[] carry saver_id (stage 2 needs nothing from it,
-- but the candidate preview keeps the compute inspectable). That makes this
-- table MORE sensitive than trending_cache's counts-only payload, so it gets
-- the same explicit posture: RLS ON with NO policies PLUS table-level REVOKE
-- from PUBLIC/anon/authenticated + GRANT to service_role (Codex P2 — policy-
-- less RLS alone still leaves PostgREST default grants in place).
-- Saver ids NEVER enter the feed-socials client projection.
--
-- ── fn_is_instagram_url — SQL copy #1 of the IG-host predicate ───────────────
-- TWO SYNCED COPIES (the fn_user_taste junk-list pattern):
--   SQL:  public.fn_is_instagram_url(text)               ← this file
--   TS:   supabase/functions/_shared/socialHost.ts       ← isInstagramUrl()
-- Parity contract (Codex P1 — identical in both copies, byte-identical verdicts
-- on the shared fixture table in supabase/tests/socials_privacy.spec.sql +
-- _shared/socialHost.test.ts):
--   (1) only absolute http(s):// URLs qualify — scheme-less input is FALSE;
--   (2) authority = the substring between '://' and the first '/', '?' or '#';
--   (3) host = the part of the authority after the LAST '@' (userinfo stripped —
--       'https://instagram.com@evil.com/x' is host evil.com, NOT instagram),
--       then strip a trailing ':port', lowercase, strip leading 'www.';
--   (4) match host = 'instagram.com' OR host LIKE '%.instagram.com'
--       OR host = 'instagr.am'.
-- Substring matching is BANNED (must reject notinstagram.com and
-- example.com/?next=instagram.com). Any edit here must be mirrored in
-- socialHost.ts and re-asserted against the fixture table.
--
-- ── Replay-from-zero safety ──────────────────────────────────────────────────
-- References only wishlist_items / profiles (both ancient) and objects created
-- earlier in THIS file. Forward-dated after 20260713083346 (latest applied).
-- No DO blocks; single $fn$-tagged bodies; no check_function_bodies toggle
-- needed.

-- ── 1. fn_is_instagram_url ────────────────────────────────────────────────────
create or replace function public.fn_is_instagram_url(p_url text)
returns boolean
language sql
immutable
as $fn$
    select case
        -- (1) absolute http(s):// only; NULL and scheme-less → false
        when p_url is null or p_url !~* '^https?://' then false
        else (
            with authority as (
                -- (2) between '://' and the first '/', '?' or '#'
                select split_part(split_part(split_part(
                    substring(p_url from position('://' in p_url) + 3),
                    '/', 1), '?', 1), '#', 1) as a
            ),
            host as (
                -- (3) after the LAST '@', strip trailing :port, lowercase,
                --     strip leading www.
                select regexp_replace(
                    lower(
                        regexp_replace(
                            regexp_replace((select a from authority), '^.*@', ''),
                            ':[0-9]*$', ''
                        )
                    ),
                    '^www\.', ''
                ) as h
            )
            -- (4) exact-hostname match
            select h.h = 'instagram.com'
                or h.h like '%.instagram.com'
                or h.h = 'instagr.am'
            from host h
        )
    end;
$fn$;

comment on function public.fn_is_instagram_url(text) is
    'TICKET-189: exact-hostname Instagram URL predicate — SQL copy #1 of the '
    'two-synced-copies pair with _shared/socialHost.ts (TS copy #2). Absolute '
    'http(s) URLs only; userinfo/port stripped per the parity contract; '
    'substring matching banned. Sync both copies + the shared fixture table.';

revoke all on function public.fn_is_instagram_url(text) from PUBLIC, anon, authenticated;
grant execute on function public.fn_is_instagram_url(text) to service_role;

-- ── 2. socials_cache — one global kv row, deny-all grants ────────────────────
create table public.socials_cache (
    id          text primary key default 'global',
    payload     jsonb not null default '[]'::jsonb,
    computed_at timestamptz not null default now()
);

comment on table public.socials_cache is
    'TICKET-189: single global cached socials-candidate payload (id=''global''). '
    'Payload rows carry saver ids (clips preview) → deny-all table grants, not '
    'policy-less RLS alone. Written/read only by fn_get_socials_candidates '
    'under service role. Stage-2 (fn_socials_viewer_pass) re-gates everything '
    'per viewer before any client projection.';

alter table public.socials_cache enable row level security;
-- Deny-all: RLS with zero policies AND explicit grant revocation (the payload
-- stores saver ids — Codex P2).
revoke all on table public.socials_cache from PUBLIC, anon, authenticated;
grant all on table public.socials_cache to service_role;

-- ── 3. fn_compute_socials_candidates — the viewer-agnostic aggregation ───────
-- Qualifying sources ONLY: type='tiktok', or type='web' with an Instagram URL
-- host (fn_is_instagram_url). video / screenshot / vision / handoff have no
-- verifiable platform URL and are EXCLUDED (spec AC§2). Public accounts only.
-- Per restaurant: per-window distinct-saver counts (k7/k30), per-window
-- platform facts (tiktok|instagram|mixed|none — Codex P1: the label must be
-- computable for the SELECTED window after stage-2 demotion), and a bounded
-- clips[] preview. Orders by k30 desc, caps candidates at 30.
create or replace function public.fn_compute_socials_candidates()
returns table (
    restaurant_id uuid,
    k7            int,
    k30           int,
    platform_7d   text,
    platform_30d  text,
    clips         jsonb
)
language sql
stable
security definer
set search_path = public
as $fn$
    with social as (
        select
            w.restaurant_id,
            w.user_id as saver_id,
            case
                when w.source->>'type' = 'tiktok' then 'tiktok'
                else 'instagram'
            end as platform,
            w.source->>'url' as url,
            w.source->>'author_handle' as author_handle,
            w.created_at
        from public.wishlist_items w
        join public.profiles p on p.user_id = w.user_id
        where w.restaurant_id is not null
          and w.deleted_at is null
          and w.created_at >= now() - interval '30 days'
          and p.account_privacy = 'public'          -- public accounts ONLY
          and (
              w.source->>'type' = 'tiktok'
              or (w.source->>'type' = 'web' and public.fn_is_instagram_url(w.source->>'url'))
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
            end as platform_30d,
            max(s.created_at) as last_saved_at
        from social s
        group by s.restaurant_id
    ),
    clip_previews as (
        select
            c.restaurant_id,
            jsonb_agg(
                jsonb_build_object(
                    'saver_id',      c.saver_id,
                    'source_type',   c.platform,
                    'url',           c.url,
                    'author_handle', c.author_handle,
                    'created_at',    c.created_at
                ) order by c.created_at desc
            ) as clips
        from (
            select s.*,
                   row_number() over (
                       partition by s.restaurant_id order by s.created_at desc
                   ) as rn
            from social s
        ) c
        where c.rn <= 10       -- bounded preview per candidate
        group by c.restaurant_id
    )
    select a.restaurant_id, a.k7, a.k30, a.platform_7d, a.platform_30d, cp.clips
    from agg a
    join clip_previews cp on cp.restaurant_id = a.restaurant_id
    order by a.k30 desc, a.last_saved_at desc, a.restaurant_id asc
    limit 30;
$fn$;

comment on function public.fn_compute_socials_candidates() is
    'TICKET-189: stage-1 socials candidates — public accounts only, verifiable '
    'social sources only (tiktok | web+IG-host), 30d window. Per restaurant: '
    'k7/k30 distinct-saver counts, per-window platform facts, bounded clips '
    'preview. Cap 30, k30 desc. Viewer-agnostic — stage 2 (fn_socials_viewer_'
    'pass) re-gates per viewer. Service-role only.';

revoke all on function public.fn_compute_socials_candidates() from PUBLIC, anon, authenticated;
grant execute on function public.fn_compute_socials_candidates() to service_role;

-- ── 4. fn_get_socials_candidates — dispatch-on-read cache dance ──────────────
-- Byte-for-byte the fn_get_trending pattern: fast path → advisory xact lock →
-- re-check → compute → upsert, lock_timeout bounds the wait.
create or replace function public.fn_get_socials_candidates(p_max_age_seconds int default 3600)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '8s'
as $fn$
declare
    v_row     public.socials_cache%rowtype;
    v_payload jsonb;
begin
    -- Fast path: fresh cache, no lock taken.
    select * into v_row from public.socials_cache where id = 'global';
    if found and v_row.computed_at > now() - make_interval(secs => p_max_age_seconds) then
        return v_row.payload;
    end if;

    -- Stale or missing: serialize recompute on a global advisory lock.
    perform pg_advisory_xact_lock(hashtext('socials_cache'));

    -- Re-check — the winner may have refreshed while we blocked.
    select * into v_row from public.socials_cache where id = 'global';
    if found and v_row.computed_at > now() - make_interval(secs => p_max_age_seconds) then
        return v_row.payload;
    end if;

    select coalesce(
        jsonb_agg(
            jsonb_build_object(
                'restaurant_id', t.restaurant_id,
                'k7',            t.k7,
                'k30',           t.k30,
                'platform_7d',   t.platform_7d,
                'platform_30d',  t.platform_30d,
                'clips',         t.clips
            )
            order by t.k30 desc, t.restaurant_id asc
        ),
        '[]'::jsonb
    )
    into v_payload
    from public.fn_compute_socials_candidates() t;

    insert into public.socials_cache as sc (id, payload, computed_at)
    values ('global', v_payload, now())
    on conflict (id) do update
        set payload = excluded.payload, computed_at = excluded.computed_at;

    return v_payload;
end;
$fn$;

comment on function public.fn_get_socials_candidates(int) is
    'TICKET-189: read-through 1h socials-candidate cache (global row). '
    'Advisory-xact-lock serialized recompute; lock_timeout bounds the wait. '
    'The 1h TTL lives HERE only — the viewer-filtered stage-2 read is always '
    'live. Service-role only.';

revoke all on function public.fn_get_socials_candidates(int) from PUBLIC, anon, authenticated;
grant execute on function public.fn_get_socials_candidates(int) to service_role;

-- ── 5. Cache-bust so the first read after deploy recomputes ──────────────────
-- No-op on a fresh replay (table just created, no row) — harmless either way.
update public.socials_cache set computed_at = 'epoch' where id = 'global';
