-- TICKET-026 — Professional critics on restaurant pages.
--
-- Stores ingested critic reviews (NYT / Infatuation / Eater ...) for render
-- on the Visits tab of the restaurant page. Rows are ingested by a service-role
-- scraper (TICKET-033); clients only read. Latest review per (restaurant, publication)
-- is the current verdict — re-reviews are upserted on the unique key below.

create table if not exists public.professional_critic_reviews (
    id               uuid primary key default gen_random_uuid(),
    restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
    publication      text not null,                               -- 'nyt' | 'infatuation' | 'eater' | ...
    kind             text not null check (kind in ('stars', 'score', 'essential', 'feature')),
    score            text,                                        -- '★★★' | '9.1' | null
    score_out_of     text,                                        -- '10' | null
    author           text,
    published_date   date,
    excerpt          text,
    source_url       text,
    scraped_at       timestamptz not null default now(),
    scrape_confidence int not null default 100 check (scrape_confidence between 0 and 100),
    suppressed       boolean not null default false,              -- operator takedown flag; NEVER deleted (audit)
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

-- One row per (restaurant, publication). Re-reviews upsert on this key;
-- latest-by-published_date is enforced in ingestion (TICKET-033), not here —
-- clients trust whatever row survives upsert.
create unique index if not exists professional_critic_reviews_restaurant_pub_uidx
    on public.professional_critic_reviews (restaurant_id, publication);

-- Read-path index — the page endpoint filters by restaurant_id and ignores
-- suppressed rows server-side (see restaurant-history/index.ts action=page).
create index if not exists professional_critic_reviews_restaurant_idx
    on public.professional_critic_reviews (restaurant_id)
    where suppressed = false;

-- Ordering tiebreaker inside a single publication (rare, but supports
-- "latest-wins" filtering if ingestion ever loosens the unique key).
create index if not exists professional_critic_reviews_published_desc_idx
    on public.professional_critic_reviews (restaurant_id, publication, published_date desc);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.professional_critic_reviews enable row level security;

-- Any authenticated user can SELECT. No INSERT / UPDATE / DELETE policies are
-- defined — that makes writes implicit-deny for anon + authenticated, and the
-- scraper (service role) bypasses RLS entirely. This is the same posture as
-- other operator-owned tables.
drop policy if exists "critics_select_authenticated" on public.professional_critic_reviews;
create policy "critics_select_authenticated"
    on public.professional_critic_reviews
    for select
    to authenticated
    using (true);

-- ── updated_at trigger ──────────────────────────────────────────────────────
create or replace function public.tg_critic_reviews_touch_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_critic_reviews_touch_updated_at on public.professional_critic_reviews;
create trigger trg_critic_reviews_touch_updated_at
    before update on public.professional_critic_reviews
    for each row execute function public.tg_critic_reviews_touch_updated_at();
