-- TICKET-033 — Critics ingestion admin + audit schema.
-- Folds TICKET-033a into TICKET-033.
--
-- Changes from [ARCH-REVIEW]:
--   P0-1: admin_users table instead of profiles.is_admin (prevents self-escalation)
--   P1-1: column-level revoke of audit columns from authenticated role
--   P1-3: critic_scrape_attempts table (prevents hammering publishers on misses)
--   P1-4: last_seen_on_source_at column (Eater fall-off visibility)
--
-- No RLS changes to professional_critic_reviews SELECT beyond column grants.
-- Writes remain service-role only (no new write policies).

-- ── admin_users ─────────────────────────────────────────────────────────────
-- Separate table for operator flags (P0-1). Service-role-only writes.
-- No RLS: reads happen via service role in critics-admin edge function.
create table if not exists public.admin_users (
    user_id uuid primary key references auth.users(id) on delete cascade
);

-- Deny all client-role access (table has no RLS policies, so implicit-deny
-- already applies — this comment documents the intent explicitly).
alter table public.admin_users enable row level security;
-- No policies: authenticated users cannot read or write this table.
-- The critics-admin edge function reads it via service role (bypasses RLS).

-- ── professional_critic_reviews — audit columns ──────────────────────────────
alter table public.professional_critic_reviews
    add column if not exists suppressed_by uuid references auth.users(id),
    add column if not exists suppressed_at  timestamptz,
    add column if not exists suppression_reason text,
    add column if not exists last_seen_on_source_at timestamptz;   -- P1-4: Eater fall-off

-- ── Column-level grants (P1-1) ───────────────────────────────────────────────
-- Revoke audit columns from the authenticated role so a hand-rolled supabase-js
-- SELECT won't return them. The critics-admin edge function (service role) reads
-- them fine. The normal read path (restaurant-history edge function, also service
-- role) does not SELECT these columns, so this is defence-in-depth with no
-- operational impact.
revoke select (suppressed_by, suppressed_at, suppression_reason)
    on public.professional_critic_reviews
    from authenticated;

-- ── critic_scrape_attempts (P1-3) ────────────────────────────────────────────
-- One row per (restaurant_id, publication) per scrape cycle.
-- Drip eligibility queries this table rather than professional_critic_reviews
-- so restaurants with no critic match are not re-hammered every day.
create table if not exists public.critic_scrape_attempts (
    restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
    publication     text not null,
    last_attempted_at timestamptz not null default now(),
    status          text not null default 'pending'
        check (status in ('hit', 'miss', 'error')),
    primary key (restaurant_id, publication)
);

alter table public.critic_scrape_attempts enable row level security;
-- No client-facing policies: authenticated users cannot read or write.
-- Service role only (scraper + edge function).

-- ── Indexes ──────────────────────────────────────────────────────────────────

-- Admin list: scraped_at desc, id desc — supports cursor-paged admin query.
create index if not exists idx_critic_reviews_scraped_at_desc
    on public.professional_critic_reviews (scraped_at desc, id desc);

-- Drip eligibility: join against critic_scrape_attempts.
create index if not exists idx_scrape_attempts_last_attempted
    on public.critic_scrape_attempts (last_attempted_at);
