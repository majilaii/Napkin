-- TICKET-088: loop-metrics events. The go/no-go launch gate (D7 ≥40% ·
-- ≥30% entries tag a companion · ≥1 organic Table) is unmeasurable without
-- these. Lean by design: no analytics SaaS, one table + insert-own RLS.
--
-- Blast radius: brand-new table, no FKs from existing tables, no PostgREST
-- embeds, no edge-function changes. Client inserts directly (fire-and-forget
-- via lib/track.ts); reads happen ONLY via service role (scripts/metrics.sql),
-- so no select policy exists on purpose.
create table public.events (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    props jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index events_user_created_idx on public.events (user_id, created_at desc);
create index events_name_created_idx on public.events (name, created_at);

alter table public.events enable row level security;

create policy events_insert_own on public.events
    for insert to authenticated
    with check (auth.uid() = user_id);
