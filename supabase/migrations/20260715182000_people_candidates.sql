-- TICKET-189 — people-to-follow v2: the second honest candidate source.
--
-- fn_recently_active_public_authors(p_viewer, p_exclude_ids, p_limit):
-- recently-active PUBLIC profiles — public accounts with ≥1 publicly-eligible
-- log in the last 30 days — minus self / already-followed / either-direction
-- blocks / the co-diner set, ALL applied BEFORE the LIMIT.
--
-- The eligibility predicate mirrors fn_public_eligible_entries
-- (20260704120000) clause-for-clause, INCLUDING restaurant_id IS NOT NULL
-- (Codex P1: the NOT NULL clause is part of the named predicate — without it
-- non-restaurant entries inflate "places logged"):
--   restaurant_id IS NOT NULL AND visibility <> 'private'
--   AND rating IS NOT NULL AND char_length(trim(content)) >= 20
--   AND fn_public_account(author) AND no either-direction block vs the viewer.
-- fn_public_eligible_entries itself is NOT called — it is a cursor-paged
-- chronological ROW function and cannot produce grouped per-author counts
-- without an unbounded walk (spec AC§3).
--
-- p_exclude_ids = the viewer's co-diner candidate set (fn_co_diner_candidates
-- output). Excluding co-diners INSIDE the RPC before LIMIT guarantees the
-- LIMIT publics are genuinely BEYOND co-diners, so the edge-fn dedup can never
-- zero out discovery (Codex P1).
--
-- Only (author_id, logs_30d) leaves — the honest relationship-free context
-- line ("N places logged", distinct restaurants among public-eligible logs).
-- Ring-2 taste calibration stays deferred.
--
-- Replay-from-zero: references entries / follows / blocked_users /
-- fn_public_account — all pre-2026-07-15. No toggle needed.

create or replace function public.fn_recently_active_public_authors(
    p_viewer      uuid,
    p_exclude_ids uuid[],
    p_limit       int default 8
)
returns table (
    author_id uuid,
    logs_30d  int
)
language sql
stable
security definer
set search_path = public
as $fn$
    select
        e.user_id as author_id,
        count(distinct e.restaurant_id)::int as logs_30d
    from public.entries e
    where e.created_at >= now() - interval '30 days'
      -- the friends-feed public-eligibility predicate, clause-for-clause
      and e.restaurant_id is not null
      and e.visibility <> 'private'
      and e.rating is not null
      and char_length(trim(coalesce(e.content, ''))) >= 20
      and public.fn_public_account(e.user_id)
      -- exclusions — ALL before the LIMIT
      and e.user_id <> p_viewer
      and e.user_id <> all (coalesce(p_exclude_ids, '{}'::uuid[]))
      and not exists (
          select 1 from public.follows f
          where f.follower_id = p_viewer and f.following_id = e.user_id
      )
      and not exists (
          select 1 from public.blocked_users b
          where (b.blocker_id = p_viewer and b.blocked_id = e.user_id)
             or (b.blocker_id = e.user_id and b.blocked_id = p_viewer)
      )
    group by e.user_id
    order by logs_30d desc, author_id asc
    limit p_limit;
$fn$;

comment on function public.fn_recently_active_public_authors(uuid, uuid[], int) is
    'TICKET-189: people-to-follow v2 second source — public authors with >=1 '
    'publicly-eligible log (restaurant_id NOT NULL + visibility<>private + '
    'rating + >=20-char note + public account) in 30d, minus self / follows / '
    'either-direction blocks / p_exclude_ids (co-diners), all BEFORE LIMIT. '
    'Returns (author_id, logs_30d), where logs_30d counts distinct restaurants. '
    'Service-role only; the user-profile '
    'edge fn authenticates and passes p_viewer.';

revoke all on function public.fn_recently_active_public_authors(uuid, uuid[], int)
    from PUBLIC, anon, authenticated;
grant execute on function public.fn_recently_active_public_authors(uuid, uuid[], int)
    to service_role;

-- ── Supporting partial index (Codex P2) ──────────────────────────────────────
-- The query's only global predicate is the 30-day created_at range —
-- created_at LEADS (with user_id leading the index cannot bound the scan and
-- walks the whole partial); user_id second serves the grouping. The partial
-- predicate uses only IMMUTABLE-safe clauses that mirror the query's static
-- filters. Existing entries indexes do not lead on created_at.
create index if not exists entries_public_recent_idx
    on public.entries (created_at, user_id)
    where restaurant_id is not null
      and rating is not null
      and visibility <> 'private';
