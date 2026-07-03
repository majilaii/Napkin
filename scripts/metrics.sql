-- TICKET-088 — loop metrics (the launch gate).
-- Run with service role (RLS on public.events is insert-own; no select policy):
--   psql "$PROD_DB_URL" -f scripts/metrics.sql
-- or paste blocks into the Supabase SQL editor.
--
-- Gate (LAUNCH-RUNBOOK): D7 ≥ 40% · ≥30% of entries tag a companion ·
-- ≥1 Table forms organically — measured on a cluster the founder is NOT in.

-- ── 1. Logs per user per week ────────────────────────────────────────────────
select
    date_trunc('week', created_at)::date as week,
    count(*) filter (where name = 'entry_logged') as entries,
    count(distinct user_id) filter (where name = 'entry_logged') as loggers,
    round(
        count(*) filter (where name = 'entry_logged')::numeric
        / nullif(count(distinct user_id) filter (where name = 'entry_logged'), 0),
        2
    ) as logs_per_logger
from events
group by 1
order by 1 desc;

-- ── 2. % of entries tagging a companion (gate: ≥30%) ─────────────────────────
select
    date_trunc('week', created_at)::date as week,
    count(*) as entries,
    count(*) filter (where (props->>'companions_n')::int > 0) as with_companions,
    round(
        100.0 * count(*) filter (where (props->>'companions_n')::int > 0)
        / nullif(count(*), 0),
        1
    ) as pct_tagging
from events
where name = 'entry_logged'
group by 1
order by 1 desc;

-- ── 3. Table formation + membership growth ───────────────────────────────────
select
    date_trunc('week', created_at)::date as week,
    count(*) filter (where name = 'table_formed') as tables_formed,
    count(*) filter (where name = 'table_member_added') as members_added,
    count(*) filter (where name = 'invite_sent') as invites_sent
from events
where name in ('table_formed', 'table_member_added', 'invite_sent')
group by 1
order by 1 desc;

-- ── 4. D1 / D7 / D30 retention by signup cohort (gate: D7 ≥ 40%) ─────────────
-- Cohort = auth.users.created_at week; return = any app_open N days after signup.
with cohorts as (
    select id as user_id, created_at::date as signup_date,
           date_trunc('week', created_at)::date as cohort_week
    from auth.users
),
opens as (
    select user_id, created_at::date as open_date
    from events
    where name = 'app_open'
    group by 1, 2
)
select
    c.cohort_week,
    count(distinct c.user_id) as signups,
    round(100.0 * count(distinct o1.user_id) / nullif(count(distinct c.user_id), 0), 1) as d1_pct,
    round(100.0 * count(distinct o7.user_id) / nullif(count(distinct c.user_id), 0), 1) as d7_pct,
    round(100.0 * count(distinct o30.user_id) / nullif(count(distinct c.user_id), 0), 1) as d30_pct
from cohorts c
left join opens o1  on o1.user_id = c.user_id and o1.open_date = c.signup_date + 1
left join opens o7  on o7.user_id = c.user_id and o7.open_date between c.signup_date + 5 and c.signup_date + 9
left join opens o30 on o30.user_id = c.user_id and o30.open_date between c.signup_date + 27 and c.signup_date + 33
group by 1
order by 1 desc;

-- ── 5. Capture funnel: saves + imports ───────────────────────────────────────
select
    date_trunc('week', created_at)::date as week,
    count(*) filter (where name = 'spot_saved') as spots_saved,
    count(*) filter (where name = 'import_completed') as imports,
    coalesce(sum((props->>'spot_count')::int) filter (where name = 'import_completed'), 0) as imported_spots,
    count(*) filter (where name = 'import_review_edits') as reviews_edited,
    coalesce(sum((props->>'fixed_n')::int) filter (where name = 'import_review_edits'), 0) as spots_fixed,
    coalesce(sum((props->>'removed_n')::int) filter (where name = 'import_review_edits'), 0) as spots_removed
from events
group by 1
order by 1 desc;

-- ── 6. Client errors (no crash SDK yet — this IS the crash report) ───────────
select created_at, user_id, props->>'context' as context,
       left(props->>'message', 120) as message
from events
where name = 'client_error'
order by created_at desc
limit 50;
