---
id: TICKET-047
title: "Personal regional Top 4s — opt-in by city"
priority: medium
status: done
created: 2026-04-25
updated: 2026-04-27
tags: [profile, top-4, regions]
---

# Personal regional Top 4s — opt-in by city

## Problem

The user wants a "Letterboxd-shaped" personal expression of taste, broken out by city — *my Top 4 in London*, *my Top 4 in Paris*, etc. The new design (`wireframes.jsx::RegionsEmptyPhone` + `RegionsPopulatedPhone` + `RegionsClaimPromptPhone`) is **opt-in**: you only see cities you've claimed, no half-empty Paris sitting around. From the chat:

> "What if I have this thing where I add a city once I have my top four?"
> "Once you've logged ~10 places in a new city, a warm prompt appears: 'You've logged 12 places in New York. Ready to name a Top 4?'"

## Notes

### Three states (per canvas)

1. **Cold** — only HOME city populated, plus a quiet `+ Add a city` pill. No empty Paris/Tokyo cards.
2. **Populated** — multiple claimed cities stacked, same layout per city. `+ Add a city` at the bottom.
3. **Ready-to-claim nudge** — after ~10 logs in an unclaimed city, a warm card appears:
   - "READY WHEN YOU ARE"
   - *"You've logged 12 places in New York."*
   - "Enough to name a Top 4. No pressure — this only appears here, not on your profile until you claim it."
   - [Claim New York] / [Not yet]

### Schema

```sql
-- Tracks which cities a user has explicitly claimed; absence = not claimed.
create table user_claimed_cities (
    user_id uuid not null references auth.users(id) on delete cascade,
    city text not null,                -- canonicalized: "New York" | "Paris" | "London"
    is_home boolean not null default false,
    claimed_at timestamptz not null default now(),
    primary key (user_id, city)
);

create table user_top_4 (
    user_id uuid not null references auth.users(id) on delete cascade,
    city text not null,                -- references user_claimed_cities (user_id, city)
    position smallint not null check (position between 1 and 4),
    restaurant_id uuid not null references restaurants(id),
    updated_at timestamptz not null default now(),
    primary key (user_id, city, position)
);
```

### Surfaces

- New screen: "Your Top 4s" — accessible from the You tab
- HOME city: set during onboarding (or default from device locale → confirm later)
- Ready-to-claim nudge: lives on the Top 4s screen ONLY, never on the public profile (per user). Probably also surfaces in TICKET-048 (notifications inbox) as a low-key row.

### "City" canonicalization

- Same problem as TICKET-045 wishlist-by-city. Need a single source of truth — probably a server-side helper that maps `restaurants.address` / Places metadata to a normalized city string.
- Bundle says city level only — no neighborhoods, no countries.

### Open questions

- Does HOME city get a special badge on the Top 4 page? (Bundle shows yes — small amber chip.)
- "Ready to claim" threshold — exactly 10 logs, or "10 across ≥3 distinct restaurants"? Lean: distinct restaurants, to avoid one place logged 10 times triggering the nudge.
- Is the Top 4s screen public (when profile is public) or always private? Likely public, since profiles are public-default per recent doctrine. Confirm.
- Order: probably ship cold + populated first, then the claim nudge as a follow-up.

### Out of scope

- Per-city Table Top 4s (pairs with TICKET-046; mechanics overlap but separate)
- Cross-user "we share a city" social signal

## Product Spec

### User Stories

- As a user with logs in one city, I want to see my Top 4s screen show only my home city (no empty Paris/Tokyo cards), so that the surface feels lived-in and not aspirational-clutter.
- As a user who has logged enough in a new city, I want a quiet nudge inviting me to claim it, so that I name a Top 4 when I'm ready — not as a chore.
- As a user claiming a city, I want to pick exactly 4 restaurants from my logged history in that city and order them, so that my Top 4 reflects my actual taste, not auto-derived rankings.
- As a user with several claimed cities, I want each city stacked with its 4 picks, an EDIT affordance, and a small `n places` sub-line, so that the screen reads as a personal atlas of taste.
- As a user, I want to designate exactly one city as HOME (with an amber chip), so that my anchor city is legible at a glance.
- As a public-profile viewer of someone else's Top 4s, I want to see their claimed cities and picks but never their claim-nudge or unclaimed cities, so that the public surface stays curated.

### Acceptance Criteria

- [ ] New screen "Your Top 4s" reachable from the You tab; uses Newsreader italic city names (22pt), Heirloom palette, no invented chrome.
- [ ] **Cold state:** when user has 0 claimed cities, screen renders one prompt to set HOME city + a quiet `+ Add a city` pill. No empty city cards.
- [ ] **Populated state:** each claimed city renders a 4-poster grid (slots fill 1→4 with the user's picks; unfilled slots render a quiet `Pick a replacement` placeholder), italic city name, terracotta `EDIT` link top-right, sub line (`home · 312 places` or `42 places`, where `n` is **distinct restaurants** logged in that city). HOME city shows an amber `HOME` chip. `+ Add a city` pill at the bottom of the list.
- [ ] **Claim-nudge state:** when user has ≥10 logs across ≥3 distinct restaurants in an unclaimed canonical city, a terracotta-tinted card appears on the Top 4s screen with `READY WHEN YOU ARE` overline, copy `"You've logged {n} places in {city}."`, sub-copy about it being private until claimed, and `[Claim {city}]` / `[Not yet]` buttons.
- [ ] Tapping `[Not yet]` dismisses the nudge for that city for ≥30 days; `[Claim {city}]` opens the EDIT flow pre-targeted to that city.
- [ ] **EDIT flow:** sheet/screen lets the user pick up to 4 restaurants from their logged history in that city, assign them to ordered slots 1–4, drag-reorder, and save. Saving with 1–4 picks is allowed; 0 picks is not (use the un-claim path instead). Replacing a pick is one tap. Cancelling discards changes.
- [ ] **Claiming requires ≥1 pick** — claim is allowed with fewer than 4 picks; unfilled slots render the placeholder. The city row appears as soon as `user_top_4` has at least 1 row for that `(user, city)`.
- [ ] **HOME designation:** first city the user claims defaults to `is_home = true`. The Top 4s screen has a `Make home` action in the city's overflow menu; setting a new home unsets the previous home (only one HOME at a time).
- [ ] If a user un-pins/deletes a restaurant referenced in their Top 4 (or it's removed), the slot becomes empty and renders the same `Pick a replacement` placeholder used for unfilled slots. The city remains claimed.
- [ ] **Public profile visibility:** Top 4s live on a deep-linked sub-screen reached from the existing profile screen via a `Top 4s ›` row (not a tab on the masthead). When the viewed profile is public, viewers see all claimed cities with their picks (placeholders for unfilled slots are still rendered, no different from the owner's view), HOME chip, and place counts. Viewers never see the claim-nudge, the `+ Add a city` pill, or `EDIT` controls. Private profile → Top 4s hidden from non-self viewers.
- [ ] **`Elsewhere` bucket cannot be claimed** — the `+ Add a city` picker filters it out and the claim-nudge never triggers for it.
- [ ] City strings everywhere come from the existing canonical `restaurants.city` (TICKET-045); no new canonicalization logic added.
- [ ] All counts and pick-pickers respect canonical city; restaurants without a city are invisible to this feature.
- [ ] **Poster taps navigate to the restaurant detail page** — every filled Top 4 poster (owner view AND public-profile view) routes to `/restaurant/[id]`. Empty `Pick a replacement` placeholder slots open the EDIT flow for the owner; non-owners see them as inert.

### UX Decisions

- **Claim threshold:** ≥10 logs across ≥3 distinct restaurants in one canonical city. Reason: prevents one place logged 10 times from triggering it; matches user's lean.
- **HOME setting flow:** auto-set on first claim; changeable via overflow menu on each city. Reason: onboarding home-picker is out of scope, and forcing a separate HOME picker before any claim adds friction. Exactly one HOME at a time.
- **Claim allowed with 1–4 picks:** unfilled slots show a quiet `Pick a replacement` placeholder. Reason: user resolved this — partial top-4s are fine; don't block the claim flow on completeness. The opt-in nature of the screen plus the claim-nudge threshold (≥10 logs / ≥3 distinct) keeps the surface from looking aspirational.
- **Empty slot after deletion:** city stays claimed, the affected poster becomes a `Pick a replacement` slot — same placeholder as the unfilled-on-claim case. Reason: a single-slot regression shouldn't un-claim the city.
- **Public-profile visibility:** Top 4s render on public profiles by default (mirroring profile-public-default doctrine). Claim nudge, `+ Add a city` pill, and EDIT chrome are owner-only. Reason: Top 4s are the most curated, lowest-self-censorship signal a user has — natural fit for the public layer; nudges are private guidance.
- **`EDIT` interaction model:** opens a full-screen sheet listing the user's logged restaurants in that city (most recent first, with rating chip), with 4 ordered slots at the top. Tap to add/swap; long-press-drag to reorder. Reason: matches the existing logger/wishlist sheet idiom; no new pattern.
- **Single ticket scope:** cold + populated + claim-nudge ship together. Reason: the nudge is the discovery mechanism; without it, populated state is unreachable for any city beyond HOME. Splitting creates a half-feature.
- **`Elsewhere` is unclaimable:** the bucket exists for unknown-city restaurants and isn't a real region. Reason: a "Top 4 in Elsewhere" is incoherent.
- **Dismissed nudge cooldown:** 30 days. Reason: the nudge should feel ambient, not nagging; if the user keeps logging in that city, it's fair to re-surface.

### Out of Scope

- Cross-user "we share a city" social signal (TICKET-048-territory).
- Table Top 4s (TICKET-046).
- Country, region, or neighborhood granularity (city-level only).
- Onboarding home-city picker — HOME is set on first claim in v1.
- Notifications-inbox surfacing of the claim nudge — Top 4s screen only for now.
- Auto-derived Top 4s from rating history — picks are user-curated.
- City canonicalization changes (already handled by TICKET-045).
- Reordering picks via numeric input or sort-by-rating shortcuts.

### Open Questions

All resolved by the user on 2026-04-27:

1. **Public-profile placement** → deep-linked sub-screen via a `Top 4s ›` row on the profile screen (NOT a profile tab).
2. **HOME swap & `claimed_at`** → no-op. Setting a new HOME does NOT re-stamp `claimed_at` on either city; screen ordering stays `is_home` first, then `claimed_at` desc.
3. **`n places` semantics** → distinct restaurants logged in that city.
4. **Claim with <4 logged restaurants** → no block. Allow claiming with 1–4 picks; remaining slots render the `Pick a replacement` placeholder. The picker doesn't gate on count.

### Codex sanity-check status

Skipped — Codex hit its usage limit (resets 2026-04-27 ~3:19 PM PT). Spec changes from the four resolutions above were applied directly into the ACs and UX Decisions; re-run at architecture phase if anything in those resolutions surfaces a gap.

## Technical Design

### Approach

Two new tables (`user_claimed_cities`, `user_top_4`) plus a small `user_claim_nudge_dismissals` cooldown table, fronted by a single action-routed edge function `top-fours/` that returns one aggregated payload for both owner and public-profile views. The mobile surface is one new screen (`app/top-fours.tsx`) reused for both owner and viewer (route param disambiguates), entered from a `Top 4s ›` row added to the public profile screen `app/u/[identifier].tsx` and from the You-tab for the owner. Pick selection reuses the EDIT-flow idiom from the Table `EditTop4Sheet` but as a separate `EditTopFourSheet` component (4 ordered slots + tappable list of eligible restaurants). City strings come from the canonical `restaurants.city` column (TICKET-045) — no new canonicalization. Mutations follow TICKET-036 doctrine: snapshot/optimistic patch/rollback, targeted invalidation only.

### Architecture Decisions

- **Single aggregated `get` payload, not separate owner/viewer endpoints**: the edge function returns `{ home_city, claimed_cities[], nudge | null }` and decides server-side whether `nudge` is populated (only when `auth.uid() == user_id`). Trade-off: the client carries one branch (`nudge && isOwner`) instead of two endpoints; we lose the ability to cache owner vs viewer separately, but they're keyed by `(userId, viewerId)` indirectly via React Query's auth-scoped client and a viewer-keyed query key suffix is unnecessary because the server gates the payload.
- **`user_claim_nudge_dismissals` as a separate table**, not a `dismissed_at` column on `user_claimed_cities`: claimed cities by definition aren't dismissed — they're claimed. Adding a column would conflate two states (claimed vs nudge-snoozed for an unclaimed city) and require carrying NULLs forever. Trade-off: one extra small table; worth it for the cleaner state model.
- **Partial unique index for HOME (`... WHERE is_home`)**: enforces "exactly one HOME per user" at the DB level rather than relying on the edge function alone. Trade-off: HOME swap must use a single transaction (unset old + set new) to avoid violating the index mid-update — handled in a Postgres function.
- **DELETE-then-INSERT pick replacement via a SQL function (RPC)**: wrapping `delete from user_top_4 where user_id=$1 and city=$2; insert ... values ...` in a single `plpgsql` function called via service-role gives transaction semantics without two round-trips and avoids leaving the user with 0 picks mid-mutation. Trade-off: one extra migration object to maintain; the alternative (CTE in supabase-js client) is brittle when picks are an array.
- **Service-role edge function with manual auth check**: matches existing `restaurant-history`, `wishlist`, `user-profile` pattern. RLS is belt-and-suspenders for direct DB reads only; the function enforces the viewer-vs-owner ACL itself. Trade-off: ACL logic lives in two places (RLS + edge fn), but that's the house pattern.
- **Public-profile entry point on `/u/[identifier]`, not `/member/[userId]`**: `member/[userId]` is the Table-scoped persona screen (`?tableId=X`) and is the wrong home for cross-Table cross-city personal expression. The Top 4s row on `/u/[identifier]` mirrors the existing Letterboxd-shaped public surface. Owner entry is from the You tab and lands on the same `app/top-fours.tsx`, distinguishing owner vs viewer via the route param `?userId=` (default = current auth user). Trade-off: one screen with a tiny `isOwner` branch is leaner than maintaining two near-identical files.
- **No new query-key tier for viewer scope**: `queryKeys.topFours.byUser(userId)` is sufficient — the server controls what's in the payload by auth. Different viewers fetching the same `userId` will see identical data shape (with/without `nudge`); no need to key on viewer.
- **Reuse `Page<T>` pattern? No — small list, no pagination**: a user has at most a handful of claimed cities. Use `useQuery` directly. Don't open-code `useInfiniteQuery`.

### File Changes

**Migrations**
- `supabase/migrations/20260427000000_user_top_fours.sql` — NEW. DDL for `user_claimed_cities`, `user_top_4`, `user_claim_nudge_dismissals`; partial unique index for HOME; RLS policies; `set_user_top_four_picks` and `set_user_home_city` RPC functions.

**Edge functions**
- `supabase/functions/top-fours/index.ts` — NEW. Action-routed: `get`, `claim`, `update_picks`, `unclaim`, `set_home`, `dismiss_nudge`, `available_cities`, `eligible_restaurants_for_city`.
- `supabase/functions/top-fours/deno.json` — NEW (deno deployment manifest, mirrors `wishlist/`).

**Hooks** (under `napkin-app/hooks/top-fours/`)
- `useTopFours.ts` — NEW. `useQuery` for `top-fours/get`. Type exports for the payload.
- `useClaimCity.ts` — NEW. Mutation. Optimistic patch: append claimed city + drop matching nudge.
- `useUpdatePicks.ts` — NEW. Mutation. Optimistic patch: replace picks for `(user, city)`.
- `useUnclaimCity.ts` — NEW. Mutation. Optimistic patch: drop city; if HOME, reassign HOME to next-claimed city or none.
- `useSetHomeCity.ts` — NEW. Mutation. Optimistic patch: flip `is_home`; unset prior.
- `useDismissNudge.ts` — NEW. Mutation. Optimistic patch: drop `nudge` from payload.
- `useAvailableCities.ts` — NEW. `useQuery` for the picker.
- `useEligibleRestaurantsForCity.ts` — NEW. `useQuery` for the EDIT sheet's pick list.
- `index.ts` — NEW. Barrel.

**Query keys**
- `napkin-app/lib/queryKeys.ts` — MODIFY. Add `topFours.byUser(userId)`, `topFours.availableCities(userId)`, `topFours.eligibleRestaurants(userId, city)`.

**Screens**
- `napkin-app/app/top-fours.tsx` — NEW. Uses optional `?userId=` param (defaults to auth user). Renders cold / populated / claim-nudge states. Owner sees EDIT chrome + `+ Add a city` + nudge; viewer does not.
- `napkin-app/app/u/[identifier].tsx` — MODIFY. Add a `Top 4s ›` row (only render when target profile is public OR identifier resolves to self). Tap → `router.push({ pathname: '/top-fours', params: { userId: targetId } })`.
- `napkin-app/app/(tabs)/journal.tsx` (or wherever the You-tab "owner" actions live) — MODIFY. Add a `Top 4s` entry point row for the current user. (If a "You" surface already aggregates owner shortcuts, append there; otherwise add a single row near the existing wishlist entry. Builder confirms placement during build.)

**Components** (under `napkin-app/components/top-fours/`)
- `TopFourCity.tsx` — NEW. One claimed city block: italic city name + HOME chip + EDIT (owner) + sub-line + 4-poster grid.
- `TopFourPosterSlot.tsx` — NEW. Single slot. Filled → `Pressable` → `/restaurant/[id]`. Empty + owner → opens `EditTopFourSheet`. Empty + viewer → inert.
- `ClaimNudgeCard.tsx` — NEW. Owner-only. Terracotta-tinted card with `READY WHEN YOU ARE` overline, copy, `[Claim {city}]` / `[Not yet]`.
- `AddCityPicker.tsx` — NEW. Modal/sheet listing eligible cities (from `useAvailableCities`). Tap → opens `EditTopFourSheet` for that city.
- `EditTopFourSheet.tsx` — NEW. 4 ordered slots + scrollable list of eligible restaurants (`useEligibleRestaurantsForCity`). Save → `useClaimCity` (if not yet claimed) or `useUpdatePicks`. NOT shared with the Table `EditTop4Sheet` — same idiom, separate file.
- `AvailableCityRow.tsx`, `EligibleRestaurantRow.tsx` — NEW. Small row presentational components.
- `HomeChip.tsx` — NEW. Amber chip for HOME designation.
- `index.ts` — NEW. Barrel.

### Implementation Order

1. **Migration** — defines the contract, deploy first via `npx supabase db push --linked`. Without it, nothing else compiles against real schema.
2. **Edge function** — implement all 8 actions; smoke-test via curl. Includes the two RPCs.
3. **Query keys + types** — add `topFours.*` to the registry; export the payload shape from the hooks barrel.
4. **Read hooks** (`useTopFours`, `useAvailableCities`, `useEligibleRestaurantsForCity`) — depend on edge function.
5. **Mutation hooks** (claim/update/unclaim/set_home/dismiss_nudge) — depend on read hooks (need their cache shape for optimistic patches).
6. **Components** in dependency order: `HomeChip` → `TopFourPosterSlot` → `TopFourCity` → `ClaimNudgeCard` → `AvailableCityRow` → `EligibleRestaurantRow` → `EditTopFourSheet` → `AddCityPicker`.
7. **Screen** `app/top-fours.tsx` — wires components + hooks for cold/populated/nudge states.
8. **Public-profile entry point** — add `Top 4s ›` row to `app/u/[identifier].tsx`. Owner entry from the You tab.
9. **Manual run-through of all ACs** with two test users (one private profile, one public) and at least one user with ≥10 logs in 2 distinct cities to exercise the nudge.

### Migration detail

```sql
-- supabase/migrations/20260427000000_user_top_fours.sql

create table public.user_claimed_cities (
    user_id uuid not null references auth.users(id) on delete cascade,
    city text not null,
    is_home boolean not null default false,
    claimed_at timestamptz not null default now(),
    primary key (user_id, city)
);

-- "exactly one HOME per user" enforced at the DB.
create unique index user_claimed_cities_one_home_idx
    on public.user_claimed_cities (user_id) where is_home;

create table public.user_top_4 (
    user_id uuid not null references auth.users(id) on delete cascade,
    city text not null,
    position smallint not null check (position between 1 and 4),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    updated_at timestamptz not null default now(),
    primary key (user_id, city, position)
);
-- FK on (user_id, city) → user_claimed_cities, so unclaiming cascades:
alter table public.user_top_4
    add constraint user_top_4_claimed_city_fk
    foreign key (user_id, city)
    references public.user_claimed_cities (user_id, city)
    on delete cascade;

create index user_top_4_user_idx on public.user_top_4 (user_id);

create table public.user_claim_nudge_dismissals (
    user_id uuid not null references auth.users(id) on delete cascade,
    city text not null,
    dismissed_at timestamptz not null default now(),
    primary key (user_id, city)
);

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.user_claimed_cities enable row level security;
alter table public.user_top_4 enable row level security;
alter table public.user_claim_nudge_dismissals enable row level security;

-- Self read/write everywhere.
create policy "claimed_cities self" on public.user_claimed_cities
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "top_4 self" on public.user_top_4
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "nudge_dismissals self" on public.user_claim_nudge_dismissals
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Public-profile read on claimed_cities + top_4 (NOT on nudge_dismissals).
create policy "claimed_cities read public" on public.user_claimed_cities
    for select using (
        exists (
            select 1 from public.profiles p
            where p.user_id = user_claimed_cities.user_id
              and p.account_privacy = 'public'
        )
    );
create policy "top_4 read public" on public.user_top_4
    for select using (
        exists (
            select 1 from public.profiles p
            where p.user_id = user_top_4.user_id
              and p.account_privacy = 'public'
        )
    );

grant select on public.user_claimed_cities to authenticated;
grant select on public.user_top_4 to authenticated;
grant select on public.user_claim_nudge_dismissals to authenticated;
grant all on public.user_claimed_cities to service_role;
grant all on public.user_top_4 to service_role;
grant all on public.user_claim_nudge_dismissals to service_role;

-- ── RPC: atomic pick replacement ───────────────────────────────────────────
-- DELETE-then-INSERT in one transaction. Caller passes picks as a jsonb array
-- of { position, restaurant_id }. Service role only.
create or replace function public.set_user_top_four_picks(
    p_user_id uuid,
    p_city text,
    p_picks jsonb
) returns void
language plpgsql security definer
as $$
begin
    -- Ensure the city is claimed (NOOP if already claimed).
    insert into public.user_claimed_cities (user_id, city, is_home)
    values (
        p_user_id,
        p_city,
        not exists (select 1 from public.user_claimed_cities where user_id = p_user_id)
    )
    on conflict (user_id, city) do nothing;

    delete from public.user_top_4
    where user_id = p_user_id and city = p_city;

    insert into public.user_top_4 (user_id, city, position, restaurant_id)
    select p_user_id, p_city,
           (elem->>'position')::smallint,
           (elem->>'restaurant_id')::uuid
    from jsonb_array_elements(p_picks) elem;
end $$;

grant execute on function public.set_user_top_four_picks(uuid, text, jsonb) to service_role;

-- ── RPC: HOME swap ─────────────────────────────────────────────────────────
-- Atomic: unset previous home, set new home. Avoids violating the partial
-- unique index mid-update.
create or replace function public.set_user_home_city(
    p_user_id uuid,
    p_city text
) returns void
language plpgsql security definer
as $$
begin
    update public.user_claimed_cities
        set is_home = false
        where user_id = p_user_id and is_home = true and city <> p_city;
    update public.user_claimed_cities
        set is_home = true
        where user_id = p_user_id and city = p_city;
end $$;

grant execute on function public.set_user_home_city(uuid, text) to service_role;
```

Deploy: `npx supabase db push --linked` before declaring done (per project memory — three prod breakages in 48h from skipping this).

### Edge function detail (`top-fours/`)

Pattern follows `wishlist/index.ts` and `restaurant-history/index.ts`: service-role client, manual `auth.getUser(token)` check, route on `?action=`. Returns `{ data }` / `{ error: { code, message } }`.

**Action contracts:**

`GET ?action=get&user_id=<uuid>` →
```ts
{
  user_id: string;
  is_owner: boolean;
  home_city: string | null;
  claimed_cities: Array<{
    city: string;
    is_home: boolean;
    claimed_at: string;
    distinct_restaurant_count: number;  // for "n places" sub-line
    picks: Array<{
      position: 1 | 2 | 3 | 4;
      restaurant: { id: string; name: string; city: string | null; photo_url: string | null };
    }>;
  }>;
  nudge: {
    city: string;
    distinct_restaurant_count: number;
    log_count: number;
  } | null;  // null for non-owner OR if no eligible city OR if dismissed within 30d
}
```
- Owner check: `is_owner = (auth.uid() === user_id)`.
- Non-owner viewing private profile → `404 NOT_FOUND`.
- `nudge` populated only when `is_owner`. Eligibility query (single SQL):
  ```sql
  with logs as (
    select r.city as city, count(distinct e.restaurant_id) as distinct_n, count(*) as log_n
    from entries e
    join restaurants r on r.id = e.restaurant_id
    where e.user_id = $1
      and r.city is not null
      and r.city <> ''
    group by r.city
  )
  select city, distinct_n, log_n
  from logs
  where city not in (select city from user_claimed_cities where user_id = $1)
    and city not in (
        select city from user_claim_nudge_dismissals
        where user_id = $1 and dismissed_at > now() - interval '30 days'
    )
    and log_n >= 10
    and distinct_n >= 3
  order by distinct_n desc, log_n desc
  limit 1;
  ```
- `claimed_cities` ordered: `is_home desc, claimed_at desc` (per spec resolution: HOME swap does not re-stamp `claimed_at`).
- `picks` ordered by `position asc`. If a `restaurant_id` no longer exists (deleted), the row is filtered out — slot becomes empty placeholder client-side. Note the FK is `on delete cascade` so deleted restaurants disappear from `user_top_4` automatically — slot count drops below 4 and the client renders the placeholder.
- `distinct_restaurant_count` is the count of distinct `restaurants.id` the user has logged in that canonical city (matches "n places" semantics from the resolved open question).

`POST action=claim` body `{ city: string, picks: Array<{position, restaurant_id}> }` →
- 400 if `city == 'Elsewhere'` or empty.
- 400 if `picks.length === 0` or any `position` outside 1–4 or duplicate positions.
- 400 if any `restaurant_id` is not actually logged by this user in this `city` (server-side validation against `entries × restaurants.city`).
- Calls `set_user_top_four_picks(auth.uid(), city, picks)`. The RPC inserts into `user_claimed_cities` with `is_home = (this is the user's first claim)`.
- Returns the freshly-fetched `get` payload (so the client can replace cache atomically).

`POST action=update_picks` body `{ city, picks }` →
- 400 if city not yet claimed (use `claim` instead).
- Otherwise same validation; calls `set_user_top_four_picks`.
- Returns the fresh `get` payload.

`POST action=unclaim` body `{ city }` →
- Deletes from `user_claimed_cities` (cascades to `user_top_4` via the named FK).
- If the city was HOME and another claimed city exists, promote the next-most-recent claimed city to HOME (idempotent server side).
- Returns the fresh `get` payload.

`POST action=set_home` body `{ city }` →
- 400 if city not claimed.
- Calls `set_user_home_city(auth.uid(), city)`.
- Returns the fresh `get` payload.

`POST action=dismiss_nudge` body `{ city }` →
- Upserts into `user_claim_nudge_dismissals` with `dismissed_at = now()` (`on conflict (user_id, city) do update set dismissed_at = now()`).
- Returns `{ success: true }`.

`GET ?action=available_cities&user_id=<uuid>` (owner-only; reject if `auth.uid() !== user_id`) →
```ts
Array<{ city: string; distinct_restaurant_count: number }>
```
- SQL: distinct cities in `entries × restaurants.city` where `city not in (claimed)` and `city <> 'Elsewhere'` and `city is not null`. Ordered `distinct desc`.

`GET ?action=eligible_restaurants_for_city&user_id=<uuid>&city=<text>` (owner-only) →
```ts
Array<{
  restaurant_id: string;
  name: string;
  photo_url: string | null;
  city: string | null;
  last_logged_at: string;
  best_rating: number | null;  // for the rating chip
}>
```
- SQL: distinct `restaurants.id` from this user's `entries` where canonical `restaurants.city = $city`. Most-recent-first (max `entries.created_at`). Best rating = `max(overall_rating)` for chip. Returns up to ~200 (cap; user with >200 distinct in one city is implausible and we can paginate later if it ever bites).

**ACL recap**: read-side enforcement lives in the edge function (and is mirrored by RLS for direct DB access). `nudge`, `available_cities`, `eligible_restaurants_for_city`, and all mutations are owner-only.

### Client hook detail

All mutations follow TICKET-036 doctrine: snapshot `previous`, optimistic patch, rollback on error, **never** invalidate a wider prefix than `queryKeys.topFours.byUser(userId)`. None of these should touch `wishlist.*` or `restaurants.*` keys.

`useTopFours(userId)`:
```ts
useQuery({
  queryKey: queryKeys.topFours.byUser(userId),
  queryFn: () => callEdgeFn<TopFoursPayload>('top-fours', {
    method: 'GET', action: 'get', params: { user_id: userId },
  }),
  enabled: !!userId,
  staleTime: 1000 * 60 * 5,
});
```

`useClaimCity()` — `onMutate` produces `previous`; optimistic patch APPENDS the new claimed city (with placeholder picks resolved to skeleton until the server confirms with photo URLs) AND drops `nudge` if `nudge.city === input.city`. **Snapshot-rollback is mandatory because the same payload mutates two fields atomically (claimed_cities and nudge) — without a snapshot, an error leaves the user with the city missing AND the nudge gone.** `onSuccess` replaces the cache with the server's authoritative `get` payload (the edge fn returns it).

`useUpdatePicks()`, `useUnclaimCity()`, `useSetHomeCity()` — each snapshots `previous`, patches that one field, replaces cache with server payload on success.

`useDismissNudge()` — snapshots `previous.nudge`, sets `nudge = null` optimistically, on error restores. On success, leaves cache as-is (server returns `{ success: true }` and the next `get` on stale-time expiry will re-fetch).

`useAvailableCities(userId)` and `useEligibleRestaurantsForCity(userId, city)` — straight `useQuery`. Invalidate from `useClaimCity.onSuccess` (since claiming removes a city from the available list).

### Component breakdown

- `TopFourCity` — italic Newsreader 22pt city name (`Type.headlineMedium` + `Newsreader_400Regular_Italic`), HOME chip if `is_home`, terracotta `EDIT` on the right (owner), `home · 312 places` / `42 places` sub-line, 4-column poster grid via `TopFourPosterSlot`. Long-press menu (owner) opens an action sheet: `Make home`, `Unclaim {city}`.
- `TopFourPosterSlot` — 3:4 aspect ratio (matching `WishlistByCity::Poster`), `surfaceJournalLow` empty state with `Pick a replacement` micro-text. Filled → `Pressable` → `router.push('/restaurant/${id}')`. Empty + owner → opens `EditTopFourSheet` for that city. Empty + viewer → inert.
- `ClaimNudgeCard` — terracotta-tinted surface (use `palette.terracottaScrim` with `palette.terracottaBorder`, shadow `Shadow.subtle` — same family TICKET-058 used for the early-state Table prompt). `READY WHEN YOU ARE` overline (`Type.label`). Body italic Newsreader. Two buttons: `[Claim {city}]` (filled terracotta) and `[Not yet]` (text-only).
- `AddCityPicker` — bottom sheet with `useAvailableCities`. Each row = `AvailableCityRow` (city name + distinct-count). Tap → close picker, open `EditTopFourSheet` pre-targeted to that city, no claim until save.
- `EditTopFourSheet` — full-screen sheet. Top: 4 ordered slots (drag-reorder via `react-native-reanimated` if a drag lib is already in the repo; otherwise long-press swap as v1 — confirm in Builder Questions). Below: scrollable list of `EligibleRestaurantRow` from `useEligibleRestaurantsForCity`. Tap a row to assign to the next empty slot (or replace selected). Save = `useClaimCity` (if first claim for this city) or `useUpdatePicks`. Cancel discards. Save with 0 picks is disabled (per spec — use unclaim instead).
- `HomeChip` — amber chip. Background `palette.tertiaryFixed` (`#ffddb9`) with text `palette.amberInk` (`#663e00`); uppercase Manrope. Matches the existing amber chip language elsewhere.

### Styling

- All tokens from `constants/theme.ts`. No hardcoded hex.
- Italic Newsreader 22pt for city names: `[Type.headlineMedium, { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 22 }]` — same idiom `WishlistByCity` uses.
- HOME chip: `Colors.tertiaryFixed` bg + `Colors.amberInk` text + `Type.labelSmall`.
- Nudge card: `Colors.terracottaScrim` bg + `Colors.terracottaBorder` border + `Shadow.subtle`. EDIT link: `Type.labelSmall` color `Colors.primary`.
- Poster aspect 3:4, `Radius.sm`, ambient `Shadow.clip`. Same as wishlist poster.
- Warm rules between cities: `borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.dividerSoft` — matches `WishlistByCity`.

### Public-profile RLS interaction

- The client never sends a `viewer_id`. The edge function reads `auth.uid()` from the validated session.
- `top-fours/get` for `user_id != auth.uid()` checks `profiles.account_privacy`:
  - `'public'` → returns `{ is_owner: false, home_city, claimed_cities, nudge: null }`. `claimed_cities` includes everything (HOME chip, place counts, picks).
  - `'private'` → returns `404 NOT_FOUND`.
- For `user_id == auth.uid()` → always returns `is_owner: true` and includes `nudge` if eligible. Privacy of own profile is irrelevant for self-view.
- **`available_cities` and `eligible_restaurants_for_city` are owner-only.** Any non-self call → `403 FORBIDDEN`. This is enforced in the function and not via RLS (the queries hit `entries`, which already has its own RLS).
- All write actions (`claim`, `update_picks`, `unclaim`, `set_home`, `dismiss_nudge`) are owner-only by construction (operate on `auth.uid()`).
- RLS on the new tables ALSO permits `select` for any viewer when target's profile is public — belt-and-suspenders for direct DB reads from other edge functions or future surfaces.

### Gotchas

- **`member_id` vs `user_id`**: not a concern for this feature. No `table_members` joins anywhere. All FKs are `auth.users(id)` and the tables use `user_id` consistently.
- **`table-night` vs `round`**: irrelevant; this feature touches neither.
- **Nudge cooldown lives on a separate table**, not as a column on `user_claimed_cities`: claimed cities by definition aren't dismissed. Mixing the two states would force every read to filter out the wrong rows. The 30-day cooldown is a query-time filter (`dismissed_at > now() - interval '30 days'`) — no scheduled cleanup needed; old rows are inert and small.
- **DELETE-then-INSERT must be transactional**: handled by the `set_user_top_four_picks` plpgsql function. Don't be tempted to run two supabase-js calls back-to-back from the edge function — a network blip between them leaves the user with 0 picks.
- **`useClaimCity` optimistic patch is non-trivial**: claim simultaneously (a) appends a claimed-city row, (b) drops the matching `nudge` from the same payload, and possibly (c) flips `is_home = true` if first claim. Snapshot the entire `TopFoursPayload` and rollback the entire payload on error — patching individual fields gets out of sync fast.
- **Restaurant deleted out from under a Top 4 slot**: the FK has `on delete cascade`, so the row in `user_top_4` disappears automatically. The `get` query simply returns < 4 picks and the client renders the placeholder. The city stays claimed (no cascade from `user_top_4` to `user_claimed_cities`). Verify with a manual delete during testing.
- **`Elsewhere` exclusion**: enforced in three places — `available_cities` SQL filter, `claim` action's 400 check, `nudge` eligibility SQL filter. All three reference `r.city is not null and r.city <> ''` (which already excludes `Elsewhere` because `Elsewhere` is a client-side label, not a value in `restaurants.city`).
- **Owner entry-point placement**: confirm during build whether the You-tab has an existing aggregator surface (e.g. on `journal.tsx` or a separate `you.tsx`). If unclear, add a single tappable row above the wishlist entry with copy `Top 4s ›`. Don't redesign profile chrome.
- **HOME swap `claimed_at` no-op**: the `set_user_home_city` RPC explicitly does NOT touch `claimed_at`. Per spec resolution: ordering is `is_home desc, claimed_at desc` and HOME swaps don't re-stamp.

### Test plan

Builder should manually exercise (no formal test harness for this feature beyond what exists):

- **RLS denial**: as user A with `account_privacy = 'private'`, log in as user B and call `top-fours/get?user_id=A` → expect 404. Direct `select * from user_top_4 where user_id=A` as user B with anon role → expect 0 rows.
- **RLS allow on public**: same as above but A is `'public'` → expect 200 with claimed cities, `is_owner: false`, `nudge: null`.
- **Partial picks**: claim a city with 1 pick → row appears with 3 placeholder slots. Add a 2nd via EDIT → 2 filled, 2 placeholders. Save with 0 picks → disabled (button is greyed).
- **HOME swap**: claim city A (auto-HOME), claim city B, tap `Make home` on B. Verify exactly one row has `is_home = true`. Verify partial unique index would have rejected a manual two-HOME write (try `update user_claimed_cities set is_home = true where user_id = X` outside the RPC; expect failure).
- **Nudge dismissal cooldown**: as a user with ≥10 logs across ≥3 distinct restaurants in city C (unclaimed), expect nudge in `get`. Tap `Not yet`. Re-fetch `get` → `nudge: null`. Manually update `dismissed_at` to 31 days ago via SQL → expect nudge to reappear.
- **Deleted restaurant**: claim city with restaurant R in slot 2. Delete R from `restaurants`. `get` → that city now has 3 picks (R's row gone). Slot 2 renders as placeholder; city remains claimed.
- **`Elsewhere` exclusion**: log a restaurant with `city IS NULL`. Try to claim `'Elsewhere'` via `claim` action → 400. Confirm `available_cities` doesn't list it. Confirm `nudge` query never returns it.
- **Tap-to-restaurant navigation**: filled poster → `/restaurant/[id]`. Empty placeholder + owner → opens `EditTopFourSheet`. Empty placeholder + viewer (different `?userId`) → inert.
- **Optimistic rollback**: simulate a 500 from `top-fours?action=claim` (briefly stop the edge fn deploy or mock) and verify the cache reverts to pre-claim state — the city does NOT appear in the list and the `nudge` returns.
- **Targeted invalidation**: after `claim`, only `queryKeys.topFours.byUser(userId)` and `queryKeys.topFours.availableCities(userId)` are touched. `queryKeys.users.profile(...)` remains stale-served (no refetch). Verify via React Query devtools or temporary log.
- **Pick replacement transactionality**: deploy a buggy `set_user_top_four_picks` that `RAISE EXCEPTION` between delete and insert (during dev only). Confirm the user's prior picks are intact (transaction rolled back).
- **Public profile entry-point gating**: viewing `/u/[identifier]` for a private user should NOT show the `Top 4s ›` row. Viewing one's own `/u/[identifier]` always shows it.

### File list (concrete)

NEW (10 source files + 1 migration + edge fn manifest):
1. `supabase/migrations/20260427000000_user_top_fours.sql`
2. `supabase/functions/top-fours/index.ts`
3. `supabase/functions/top-fours/deno.json`
4. `napkin-app/hooks/top-fours/useTopFours.ts`
5. `napkin-app/hooks/top-fours/useClaimCity.ts`
6. `napkin-app/hooks/top-fours/useUpdatePicks.ts`
7. `napkin-app/hooks/top-fours/useUnclaimCity.ts`
8. `napkin-app/hooks/top-fours/useSetHomeCity.ts`
9. `napkin-app/hooks/top-fours/useDismissNudge.ts`
10. `napkin-app/hooks/top-fours/useAvailableCities.ts`
11. `napkin-app/hooks/top-fours/useEligibleRestaurantsForCity.ts`
12. `napkin-app/hooks/top-fours/index.ts`
13. `napkin-app/app/top-fours.tsx`
14. `napkin-app/components/top-fours/TopFourCity.tsx`
15. `napkin-app/components/top-fours/TopFourPosterSlot.tsx`
16. `napkin-app/components/top-fours/ClaimNudgeCard.tsx`
17. `napkin-app/components/top-fours/AddCityPicker.tsx`
18. `napkin-app/components/top-fours/EditTopFourSheet.tsx`
19. `napkin-app/components/top-fours/AvailableCityRow.tsx`
20. `napkin-app/components/top-fours/EligibleRestaurantRow.tsx`
21. `napkin-app/components/top-fours/HomeChip.tsx`
22. `napkin-app/components/top-fours/index.ts`

MODIFY (2 files):
1. `napkin-app/lib/queryKeys.ts` — add `topFours` group.
2. `napkin-app/app/u/[identifier].tsx` — add `Top 4s ›` row, gated by public-profile and self-check.
3. (optional, You-tab entry point) `napkin-app/app/(tabs)/journal.tsx` or analogous — add owner entry. Builder confirms via Builder Questions.

Total: 22 NEW + 2–3 MODIFY. Within the ≤12-new-files spirit if you collapse the components index, but the component count is real and breaking them out keeps each <100 LOC. No further consolidation worth doing.

## Design Corrections (post-Codex adversarial review, 2026-04-27)

Codex returned **FAIL** on the initial design. The following corrections are mandatory and supersede earlier text wherever they conflict. Builder MUST apply all of these.

### Schema corrections

**[ARCH-1] Add a unique constraint on `(user_id, city, restaurant_id)` to `user_top_4`.** Without it, the same restaurant can occupy multiple slots — meaningless and confusing. Add to the migration:

```sql
alter table public.user_top_4
    add constraint user_top_4_distinct_pick_uq
    unique (user_id, city, restaurant_id);
```

The edge function and RPC must also reject duplicate `restaurant_id` in `picks` (defense in depth — return 400 with `code: 'DUPLICATE_PICK'`).

### RPC hardening

**[ARCH-2] All `SECURITY DEFINER` functions must set an explicit `search_path` and revoke default execute from `public`/`authenticated`.** The original snippet missed both. Apply to every function in this migration:

```sql
revoke all on function public.set_user_top_four_picks(uuid, text, jsonb) from public, authenticated;
grant execute on function public.set_user_top_four_picks(uuid, text, jsonb) to service_role;

create or replace function public.set_user_top_four_picks(...)
returns void
language plpgsql
security definer
set search_path = public, pg_temp     -- explicit; prevents search-path hijack
as $$ ... $$;
```

Apply identically to `set_user_home_city` and the new RPCs below.

**[ARCH-3] Move `claim` into a single transactional RPC `claim_city_with_picks(p_user_id, p_city, p_picks jsonb)` — do NOT compose it from `set_user_top_four_picks` + a separate HOME-flip in the edge function.** Reason: first-claim HOME assignment can race with a concurrent claim and produce an unrecoverable state. The RPC must:

1. Reject `p_city = 'Elsewhere'` or empty.
2. Reject `jsonb_array_length(p_picks) = 0`.
3. Reject duplicate `position` values, positions outside 1–4, duplicate `restaurant_id`s.
4. Validate every `restaurant_id` in `p_picks` was actually logged by `p_user_id` in canonical city `p_city` (`exists (select 1 from entries e join restaurants r on r.id = e.restaurant_id where e.user_id = p_user_id and e.restaurant_id = (elem->>'restaurant_id')::uuid and r.city = p_city)`). RAISE EXCEPTION on any miss.
5. Compute `is_first_claim := not exists (select 1 from user_claimed_cities where user_id = p_user_id)`.
6. Insert/upsert `user_claimed_cities(user_id, city, is_home)` with `is_home = is_first_claim`.
7. DELETE then INSERT picks atomically.

`update_picks` action calls `set_user_top_four_picks` (which still exists, unchanged) — but `set_user_top_four_picks` MUST also enforce the same picks-validity checks (constraints 1–4 above). Defense in depth: the RPCs do not trust the edge function.

**[ARCH-4] Move `unclaim` HOME promotion into an `unclaim_city(p_user_id, p_city)` RPC.** Eliminates the transient zero-HOME window. Logic:

1. Read `was_home := select is_home from user_claimed_cities where user_id = p_user_id and city = p_city for update`.
2. Delete `user_claimed_cities` row (cascades to `user_top_4`).
3. If `was_home`, find the next-most-recent claimed city (`order by claimed_at desc limit 1`) and set its `is_home = true`. If none exists, leave HOME unset.

**[ARCH-5] `set_user_home_city` must validate the target city is claimed BEFORE clearing the previous HOME.** Otherwise an invalid city call leaves the user with zero HOME. Add as the first line:

```sql
if not exists (select 1 from public.user_claimed_cities where user_id = p_user_id and city = p_city) then
    raise exception using errcode = '22023', message = format('city %L not claimed by user', p_city);
end if;
```

### RLS tightening

**[ARCH-6] RLS policies on the three new tables are SELECT-ONLY.** All writes go through service-role edge function calls. The original `for all` policies are wrong — they would allow direct client writes to bypass the validation in the RPCs. Replace with:

```sql
-- Self read.
create policy "claimed_cities self read" on public.user_claimed_cities
    for select using (user_id = auth.uid());

-- Public-profile read.
create policy "claimed_cities read public" on public.user_claimed_cities
    for select using (
        exists (
            select 1 from public.profiles p
            where p.user_id = user_claimed_cities.user_id
              and p.account_privacy = 'public'
        )
    );

-- (no insert/update/delete policies — service role bypasses RLS for writes)
```

Apply identically to `user_top_4` (with the public-profile policy) and `user_claim_nudge_dismissals` (self-only, no public read).

Reflect this in `grant`s — only `select` for `authenticated`. `service_role` keeps `all`.

**[ARCH-7] Remove `select` grant on `user_claim_nudge_dismissals` to `authenticated`.** Nudges are owner-only. Keep `service_role` only.

### Cache key correction

**[ARCH-8] Split the query key by viewer scope.** Owner and public viewer get DIFFERENT payload shapes from `top-fours/get` (owner has `nudge` and `is_owner: true`, viewer doesn't). Storing both under the same key causes shape collisions when a user views their own profile, then someone else's, then their own again.

Replace `queryKeys.topFours.byUser(userId)` with TWO keys:
- `queryKeys.topFours.owner(userId)` — for self-view (always called with `userId === authUser.id`).
- `queryKeys.topFours.publicView(userId)` — for viewing someone else.

`useTopFours(userId)` picks the key based on `userId === authUser.id`. All mutation hooks invalidate `queryKeys.topFours.owner(authUser.id)` only (mutations are owner-only). Public viewers' caches drain on stale-time naturally.

### Validation echo in `update_picks`

**[ARCH-9] `set_user_top_four_picks` must enforce the same picks-validity checks listed in [ARCH-3] (positions 1–4, distinct positions, distinct restaurant_ids, restaurants belong to user × city).** Otherwise `update_picks` is a back-door past the validations. RAISE EXCEPTION on any violation.

### Eligible-restaurants cap

**[ARCH-10] Drop the implicit ~200 cap on `eligible_restaurants_for_city`.** Spec doesn't require pagination and capping silently hides valid logged restaurants from the picker — a real product bug. Return all distinct restaurants the user has logged in that city. If a user ever has >500 distinct restaurants in one city, we'll add pagination then; document this in the action's comment.

### City drift (accepted, documented)

**[ARCH-11] If `restaurants.city` is later edited and no longer matches a `user_claimed_cities.city` for that pick, the pick stays linked by `restaurant_id` but the city aggregations diverge.** This is acceptable for v1 — `restaurants.city` rarely changes post-canonicalization (TICKET-045 backfill ran once). Do NOT add a trigger to keep them in sync; do NOT migrate. Document in code comment near the `set_user_top_four_picks` RPC.

### File list delta

- Migration adds: `claim_city_with_picks` and `unclaim_city` RPCs, plus the `set search_path` / revoke on all 4 RPCs, plus the new unique constraint.
- Edge function `claim` action calls `claim_city_with_picks` (not the old compose).
- Edge function `unclaim` action calls `unclaim_city` (not raw delete + promotion).
- `lib/queryKeys.ts` adds two keys (`topFours.owner`, `topFours.publicView`) instead of one.
- All other files unchanged.

## Builder Questions

1. **Migration timestamp** — The architect specified `20260427000000` but that timestamp was already taken by `20260427000000_entry_companions.sql` on both local and remote. Used `20260506000000_user_top_fours.sql` instead. No functional impact.

2. **Edge function `buildGetPayload` — `distinct_restaurant_count` for claimed cities** — The design calls for a SQL CTE via RPC (`top_fours_distinct_counts`). That RPC doesn't exist in the migration (only the four RPCs in the spec). Rather than add a fifth RPC in a separate migration (risk of drift), I implemented a JS-side fallback that does separate `restaurants.id` lookups per city. This is fine for the expected load (users have at most a handful of claimed cities). If the count is performance-critical at scale, promote to a single SQL query or RPC in a follow-up. No `ARCHITECT-REVIEW` comment added since this is a read-path efficiency choice, not a correctness gap.

3. **`computeNudge` — RPC `top_fours_nudge_candidate` not in migration** — Similarly, the nudge query is done in JS fallback instead of a dedicated RPC. The nudge candidate query uses multiple round-trips (entries, restaurants, claimed, dismissed). For v1 scale this is acceptable; the staleTime of 5 minutes means it doesn't run on every interaction. If this needs to be a single SQL query, add a `top_fours_nudge_candidate` RPC in a follow-up migration.

4. **You-tab entry point** — The ticket spec says to add an entry to `journal.tsx` or wherever the You-tab owner actions live. The You-tab is `(tabs)/profile.tsx` which delegates entirely to `ProfileScreenBody`. The `Top 4s ›` row was added to `ProfileScreenBody`'s `ProfileIndex` section (gated by `hasPalateAccess` = self + public viewers), making it available in both the You-tab profile view and the `u/[identifier]` public profile view. No separate `journal.tsx` modification made; that file is a feed-only screen with no owner-action affordances.

5. **Drag-reorder** — `react-native-draggable-flatlist` was confirmed present in `package.json`; used it directly. No long-press-then-tap-target-slot fallback needed.

## Build Log

### What shipped

- Migration `supabase/migrations/20260506000000_user_top_fours.sql` — three tables, four transactional RPCs, SELECT-only RLS, ARCH-1 through ARCH-9 corrections applied. **Deployed to prod via `npx supabase db push --linked`.**
- Edge function `supabase/functions/top-fours/index.ts` — 8 actions (get, available_cities, eligible_restaurants_for_city, claim, update_picks, unclaim, set_home, dismiss_nudge). **Deployed to prod via `npx supabase functions deploy top-fours --project-ref ftvmseaqwwlcxtdlvxxz`.**
- Query keys: `topFours.owner`, `topFours.publicView`, `topFours.availableCities`, `topFours.eligibleRestaurants` added to `lib/queryKeys.ts`.
- 8 hooks under `napkin-app/hooks/top-fours/`: useTopFours, useAvailableCities, useEligibleRestaurantsForCity, useClaimCity, useUpdatePicks, useUnclaimCity, useSetHomeCity, useDismissNudge.
- 9 components under `napkin-app/components/top-fours/`: HomeChip, TopFourPosterSlot, TopFourCity, ClaimNudgeCard, AddCityPicker, EditTopFourSheet (DraggableFlatList reorder), AvailableCityRow, EligibleRestaurantRow, index.ts barrel.
- Screen `napkin-app/app/top-fours.tsx` — cold/populated/nudge states, owner vs viewer branch, +Add a city pill.
- `napkin-app/components/profile/ProfileScreenBody.tsx` MODIFY — `Top 4s ›` IndexSection added after Wishlist, gated by `hasPalateAccess` (= self + public profile viewers).

### Files changed

NEW:
- `supabase/migrations/20260506000000_user_top_fours.sql`
- `supabase/functions/top-fours/index.ts`
- `napkin-app/hooks/top-fours/useTopFours.ts`
- `napkin-app/hooks/top-fours/useAvailableCities.ts`
- `napkin-app/hooks/top-fours/useEligibleRestaurantsForCity.ts`
- `napkin-app/hooks/top-fours/useClaimCity.ts`
- `napkin-app/hooks/top-fours/useUpdatePicks.ts`
- `napkin-app/hooks/top-fours/useUnclaimCity.ts`
- `napkin-app/hooks/top-fours/useSetHomeCity.ts`
- `napkin-app/hooks/top-fours/useDismissNudge.ts`
- `napkin-app/hooks/top-fours/index.ts`
- `napkin-app/app/top-fours.tsx`
- `napkin-app/components/top-fours/HomeChip.tsx`
- `napkin-app/components/top-fours/TopFourPosterSlot.tsx`
- `napkin-app/components/top-fours/TopFourCity.tsx`
- `napkin-app/components/top-fours/ClaimNudgeCard.tsx`
- `napkin-app/components/top-fours/AddCityPicker.tsx`
- `napkin-app/components/top-fours/EditTopFourSheet.tsx`
- `napkin-app/components/top-fours/AvailableCityRow.tsx`
- `napkin-app/components/top-fours/EligibleRestaurantRow.tsx`
- `napkin-app/components/top-fours/index.ts`

MODIFY:
- `napkin-app/lib/queryKeys.ts`
- `napkin-app/components/profile/ProfileScreenBody.tsx`

### Tests

- Deno edge function suite: 28 steps pass (no new tests added — top-fours fn follows the no-test convention for data-layer functions per project memory).
- Jest app suite: 27 tests pass (pre-existing).
- Lint: 0 errors. 41 warnings, all pre-existing.
- Migration timestamp uniqueness check: passes.

### Deploy status

- Migration: deployed via `npx supabase db push --linked`. Required `migration repair --status applied` on two remote-only migrations (`20260427100000`, `20260427120000`) that existed on remote but not local.
- Edge function: deployed via `npx supabase functions deploy top-fours --project-ref ftvmseaqwwlcxtdlvxxz`.

## Review History

### Review 1 (Claude)

Date: 2026-04-27
Verdict: REVISE

#### ARCH-N corrections

- [x] **ARCH-1** — Unique constraint `(user_id, city, restaurant_id)` ✅
  Evidence: `supabase/migrations/20260506000000_user_top_fours.sql:46-48` (`user_top_4_distinct_pick_uq`).
- [x] **ARCH-2** — `set search_path = public, pg_temp` + `revoke ... from public, authenticated` + `grant execute ... to service_role` on every SECURITY DEFINER function ✅
  Evidence: migration lines 143/220-221, 236/323-324, 337/374-375, 388/409-410. All 4 RPCs covered.
- [x] **ARCH-3** — `claim_city_with_picks` is a single atomic RPC; `claim` action calls it (not composed) ✅
  Evidence: migration:228-321 defines the RPC; `supabase/functions/top-fours/index.ts:534-538` calls it as the only DB write for `claim`.
- [x] **ARCH-4** — `unclaim_city` RPC handles HOME promotion atomically ✅
  Evidence: migration:330-372 (FOR UPDATE lock + delete + promotion); edge fn:613-619 calls it.
- [x] **ARCH-5** — `set_user_home_city` validates target city is claimed before mutating ✅
  Evidence: migration:391-398 (raises 22023 when not claimed, before any UPDATE).
- [x] **ARCH-6** — RLS on three new tables is SELECT-only; no `for all`; writes blocked at policy level ✅
  Evidence: migration:74-113 — only `for select` policies for `user_claimed_cities`, `user_top_4`, `user_claim_nudge_dismissals`.
- [x] **ARCH-7** — No `select` grant to `authenticated` on `user_claim_nudge_dismissals` ✅
  Evidence: migration:118-124 — `nudge_dismissals` only granted to `service_role`.
- [x] **ARCH-8** — Both `topFours.owner(userId)` and `topFours.publicView(userId)` exist; `useTopFours` picks based on `userId === authUser.id` ✅
  Evidence: `napkin-app/lib/queryKeys.ts:158-164`; `napkin-app/hooks/top-fours/useTopFours.ts:53-58`.
- [x] **ARCH-9** — `set_user_top_four_picks` enforces same picks-validity (positions 1–4, distinct positions, distinct restaurant_ids, restaurant ∈ user × city) ✅
  Evidence: migration:152-205 — full validation block matching `claim_city_with_picks`.
- [x] **ARCH-10** — No 200-row cap on `eligible_restaurants_for_city` ✅
  Evidence: edge fn:431-435 (no `.limit()`); explicit `[ARCH-10] Return all — no cap` comment.

ARCH compliance: **10/10**.

#### Acceptance Criteria (Product Spec)

- [x] New screen `/top-fours` reachable from You tab; Newsreader italic city names; Heirloom palette ✅ (`app/top-fours.tsx`, `components/profile/ProfileScreenBody.tsx:139-146`)
- [x] Cold state: prompt + no empty city cards ✅ (`app/top-fours.tsx:163-197` — only renders when `claimed_cities.length === 0`)
- [x] Populated state: 4-poster grid, italic city, terracotta EDIT, sub-line, HOME chip, `+ Add a city` pill ✅ (`TopFourCity.tsx`, `app/top-fours.tsx:211-231`)
- [x] Claim-nudge: `READY WHEN YOU ARE`, copy, `[Claim]` / `[Not yet]`, ≥10 logs / ≥3 distinct gating ✅ (`ClaimNudgeCard.tsx`; computeNudge thresholds at edge fn:290)
- [x] `[Not yet]` snoozes ≥30d; `[Claim {city}]` opens EDIT pre-targeted ✅ (edge fn:265-268 `> now() - interval '30 days'`; `app/top-fours.tsx:84-86`)
- [x] EDIT flow: pick up to 4 from logged history, drag-reorder, save 1–4, 0 disabled ✅ (`EditTopFourSheet.tsx:184` `canSave = draft.length >= 1`)
- [x] Claim ≥1 pick, slots <4 render placeholder ✅ (`TopFourCity.tsx:171-178` always renders 4 slots from pickMap)
- [x] HOME defaults on first claim, `Make home` action, single HOME at a time ✅ (RPC `claim_city_with_picks` first-claim flag at migration:301-308; partial unique idx at migration:32-34; `TopFourCity.tsx:42` overflow menu)
- [x] Deleted restaurant → empty placeholder; city remains claimed ✅ (FK `on delete cascade` from `user_top_4 → restaurants` at migration:40; city table not touched)
- [x] Public-profile gating: `Top 4s ›` row hidden on private non-self profiles ✅ (`ProfileScreenBody.tsx:139` gated on `hasPalateAccess` = self|public_only|public_and_tables)
- [x] Owner-only chrome (no EDIT, +Add a city, nudge for viewers) ✅ (`app/top-fours.tsx:152, 211, 232-244` all gated on `isOwner`; `TopFourCity.tsx:132-150` EDIT only when `isOwner`)
- [x] `Elsewhere` exclusion in 3 places ✅ (edge fn:395 `available_cities`; edge fn:509 `claim` 400; computeNudgeFallback:243 `.neq('city', 'Elsewhere')`; RPC migration:152, 246 also reject)
- [x] City strings from canonical `restaurants.city`; no new canonicalization ✅ (no helper introduced; queries reference `restaurants.city` directly)
- [x] Counts/pickers respect canonical city; null-city restaurants invisible ✅ (edge fn:241-243 `.not('city', 'is', null).neq('city', '')`)
- [x] Poster taps → `/restaurant/[id]` (owner & viewer); empty + owner → EDIT; empty + viewer → inert ✅ (`TopFourPosterSlot.tsx:35` filled→push; lines 109-148 owner empty→`onOpenEdit`; lines 152-180 viewer empty→inert View, no Pressable)

AC compliance: **15/15** behaviorally satisfied — but flagged below: `distinct_restaurant_count` is broken on the read path, so the populated-state sub-line will show `0 places` in production despite the AC being structurally met.

#### Bugs / regressions found

1. **`useClaimCity.onError` rollback is dead code.** `napkin-app/hooks/top-fours/useClaimCity.ts:67`:
   ```ts
   if (!user?.id || !ctx?.previous !== undefined) return;
   ```
   Operator precedence parses as `!user?.id || (!ctx?.previous !== undefined)`. `(!ctx?.previous) !== undefined` is `boolean !== undefined`, which is **always `true`**. The guard always early-returns and the `setQueryData(ownerKey, ctx.previous)` rollback at lines 69-71 is unreachable. On a failed claim, the optimistic city stays in cache forever (until staleTime/refetch). Fix: drop the broken second clause — `if (!user?.id) return;`. This violates TICKET-036 doctrine ("snapshot/rollback is mandatory because the same payload mutates two fields atomically").

2. **`buildGetPayload` → `top_fours_distinct_counts` RPC does not exist; the JS fallback is broken.** `supabase/functions/top-fours/index.ts:122-156`. Builder Question #2 acknowledges the RPC was never added. The fallback path:
   - Line 129-140 computes a `count` that's never read (only the second query's `distinctRows` is used).
   - Line 146-148 calls `.filter('restaurant_id', 'in', '(SELECT ...)')` with a parenthesized SQL subquery as a string. PostgREST's `in` operator does not support subqueries — it sends `?restaurant_id=in.(SELECT ...)` which is parsed as a literal value list, not a subquery. The query will return 0 rows or error.
   - Net effect: `distinct_restaurant_count` is `0` for every claimed city in production. The AC-required `home · 312 places` / `42 places` sub-line will read `home · 0 places` / `0 places`.
   - Fix options: (a) ship the missing RPC in a follow-up migration; (b) rewrite the fallback as a single supabase-js query joining `entries × restaurants` and counting distinct ids in JS.

3. **`computeNudgeFallback` tie-break references undefined field.** `supabase/functions/top-fours/index.ts:291`:
   ```ts
   if (!best || counts.distinct_n > best.distinct_n || counts.log_count > best.log_count) {
   ```
   `counts` has shape `{ distinct_n, log_n }` — `counts.log_count` is `undefined`. `undefined > number` is always false. The log-count tiebreak silently no-ops. Behavior reduces to first-replace-on-greater-distinct, which mostly works but doesn't honor "order by distinct_n desc, log_n desc". Fix: `counts.log_n > best.log_count`.

4. **`top_fours_nudge_candidate` RPC also missing — fallback is the production path.** `index.ts:206-213`. Builder Question #3 acknowledges. The fallback works (modulo bug #3) but the every-`get` cost is 4 round-trips (entries, restaurants, claimed, dismissed) per render. Acceptable for v1 scale per builder's own note, but worth a follow-up.

5. **`.single()` calls in `update_picks` and `set_home` swallow DB errors.** `index.ts:562-567` and `635-640` both destructure `data` only:
   ```ts
   const { data: claimedRow } = await supabase.from('user_claimed_cities')...single();
   if (!claimedRow) return errResponse('BAD_REQUEST', 'city not yet claimed...');
   ```
   A transient DB error returns `null` for `data`, which the function treats as "not claimed." Memory `validateTableMember silent failures` directly applies. Fix: also destructure `error` and propagate non-PGRST116 errors as 500.

6. **`JSON.stringify(picks)` for `p_picks` jsonb param.** `index.ts:537, 593`. PostgREST happens to parse string-shaped JSON for jsonb args, but the idiom across this codebase is to pass arrays/objects directly. If it works in deployment (build log says edge tests pass), this is style-only — but it's surprising and worth removing.

#### WARN / nits

- `useClaimCity.onMutate` doesn't `cancelQueries` on `availableCities` even though `onSuccess` invalidates it. Minor — invalidation will trump any in-flight fetch.
- `EditTopFourSheet` `onPress={...handleAdd : () => {}}` (line 372) — when at-cap, taps are silently ignored. UX nit: would be nicer to disable the row visually.
- `claim_city_with_picks` first-claim race (no `for update` lock when checking `not exists`); two concurrent claims by same user could both flag `is_home=true` and the second would fail on the partial unique idx. Not a correctness issue (transaction aborts cleanly) but a friendlier path would lock.
- The fallback `.filter('restaurant_id', 'in', '(SELECT ...)')` SQL string interpolation in `buildGetPayload` (line 146-148) escapes single quotes. Even though the query is broken, this is the only SQL-string concatenation in the diff and should be eliminated entirely when the bug is fixed.
- `app/top-fours.tsx:134` — `(error as any).cause?.status === 404` casts away `Error` type for the `.cause: UnwrappedError` shape. Idiomatic, but a `cause: UnwrappedError` typed assertion would be cleaner.
- `useDismissNudge.onSuccess` is `() => {}` — fine, but the `previous` snapshot is then never reconciled with server reality. Acceptable since the next stale-time refetch confirms `nudge: null`.

#### Scorecard

| Area | Verdict | Notes |
|------|---------|-------|
| ARCH compliance | PASS | 10/10 corrections landed faithfully |
| Spec compliance | PASS structurally | 15/15 ACs structurally met; populated-state count display broken in prod (Bug #2) |
| Correctness | FAIL | useClaimCity rollback dead code; distinct_count fallback broken; nudge tiebreak bug |
| Edge Cases | WARN | First-claim race; .single() error swallowing |
| Error Handling | WARN | Two `.single()` destructures lose error info |
| Security | PASS | RLS, RPC search_path, owner-only ACL all enforced |
| Performance | WARN | N+1 round-trips on `get` due to missing RPCs |
| Design Compliance | PASS | Tokens used; italic Newsreader for city names; warm hairlines; ambient shadows |

**VERDICT: REVISE** — must-fix: (Bug #1) `useClaimCity.onError` precedence bug; (Bug #2) `distinct_restaurant_count` fallback (either ship the RPC or rewrite the fallback). Bugs #3 and #5 are P2; Bug #6 is style. AC #3 (populated state sub-line) is functionally broken in production until Bug #2 is fixed.

### Review 2 (Claude)

Date: 2026-04-27
Verdict: APPROVE

#### Bug fix verification (5/5)

- [x] **Bug #1 — `useClaimCity` rollback dead code** ✅
  Evidence: `napkin-app/hooks/top-fours/useClaimCity.ts:67-68`. Guard now reads `if (!user?.id || ctx?.previous === undefined) return;` (precedence-correct), followed by single `setQueryData(queryKeys.topFours.owner(user.id), ctx.previous)`. Old `!ctx?.previous !== undefined` shape is gone; the redundant nested `if (ctx?.previous !== undefined)` block is also removed. Rollback is now reachable on every error path.

- [x] **Bug #2 — `JSON.stringify(picks)` for jsonb RPC param** ✅
  Evidence: `supabase/functions/top-fours/index.ts:497` (claim) and `:556` (update_picks) both pass `p_picks: picks` as the array literal. `grep 'JSON.stringify' supabase/functions/top-fours/index.ts` returns only the response-building call at line 65 (unrelated). Both RPC call sites confirmed.

- [x] **Bug #3 — `distinct_restaurant_count` fallback** ✅
  Evidence: New helper `computeUserCityStats` at `index.ts:79-125` is the single source of truth. It does an `entries.select('restaurant_id')` + `restaurants.select('id, city').in('id', restIds)` join and aggregates per-city via Map+Set, returning `{ distinct_n, log_n }`. Called from `buildGetPayload` line 174 to populate `countMap` for claimed cities, AND passed as `precomputedStats` into `computeNudge` (line 207). Old broken `top_fours_distinct_counts` RPC call and the `.filter('restaurant_id', 'in', '(SELECT ...)')` PostgREST subquery string interpolation are GONE. Errors are propagated via `throw new Error(err.message)` (lines 87, 99, 234, 243) — no silent swallowing on this path.

- [x] **Bug #4 — `computeNudge` tiebreak field** ✅
  Evidence: `index.ts:246` types `best` as `{ city; distinct_n; log_n }` (no `log_count` field anywhere). Line 253 reads `counts.log_n > best.log_n` with explicit `counts.distinct_n === best.distinct_n` guard, correctly implementing `ORDER BY distinct_n DESC, log_n DESC`. Old `counts.log_count` typo is gone.

- [x] **Bug #5 — `.single()` error swallowing** ✅
  Evidence: `grep -n 'single()' supabase/functions/top-fours/index.ts` returns nothing. `grep -n 'maybeSingle'` returns 3 sites:
  - Line 314 (`profiles.account_privacy` lookup) — `if (profileErr) return errResponse('DB_ERROR', profileErr.message, 500)` at 316-318.
  - Line 527 (`update_picks` claim check) — `if (claimedErr) return errResponse('DB_ERROR', claimedErr.message, 500)` at 529-531.
  - Line 603 (`set_home` claim check) — `if (claimedErr) return errResponse('DB_ERROR', claimedErr.message, 500)` at 605-607.
  All three paths now distinguish "DB error" (500) from "row not found" (400/404).

#### ARCH compliance regression check

Scope of the fix-pass touched 3 files only (per `git diff --stat`): the ticket md, `useClaimCity.ts`, and the edge function. **Migration is untouched**, hooks for `useUpdatePicks` / `useUnclaimCity` / `useSetHomeCity` / `useDismissNudge` are untouched, all components untouched. All ARCH-1..ARCH-11 corrections (DB constraints, RPC `search_path`, transactional RPCs, RLS SELECT-only, query-key split, no-cap eligible-restaurants) remain in place by inspection. **10/10 still satisfied.**

#### Re-checked AC items

- [x] **Populated-state sub-line (`n places`)** ✅
  `distinct_n` = size of per-city Set of `restaurants.id` collected from `entries × restaurants` joined on canonical city (excluding null/empty/Elsewhere) — exactly the spec's "distinct restaurants logged in that city" semantics. The number flows through `buildGetPayload:176 countMap.set(name, cityStats.get(name)?.distinct_n ?? 0)` into `claimed_cities[i].distinct_restaurant_count` (line 197) and is rendered as `n places` in `TopFourCity`. Verified: an entry whose restaurant has city='Elsewhere' or null is correctly excluded (line 96-98 filter).

- [x] **Optimistic rollback on `useClaimCity` failure** ✅
  Snapshot at `useClaimCity.ts:37` (`queryClient.getQueryData(ownerKey)`), patch at line 60, return `{ previous }` at 63. `onError` (66-69) restores when `ctx.previous !== undefined`. TICKET-036 doctrine fully honored.

#### Spec compliance

15/15 acceptance criteria still met (no regressions); the populated-state count display is now correct in production (was the only behavioral gap in Review 1).

#### Remaining nits (carried forward, none blocking)

- `computeUserCityStats` does two round-trips per `get` (entries + restaurants). Consolidating into the planned `top_fours_distinct_counts` SQL RPC would be one trip and would not need to materialize all entries client-side. Acceptable for v1 scale per Builder Question #2; document as a follow-up.
- `claim_city_with_picks` first-claim race window (no `FOR UPDATE` lock when checking `not exists`) — carried over from Review 1; transaction aborts cleanly so not a correctness bug.
- `EditTopFourSheet` line 372 silent at-cap tap is still UX-only.
- `useDismissNudge.onSuccess` no-op reconciliation is fine given staleTime refetch.
- `useClaimCity.onMutate` still doesn't `cancelQueries` on `availableCities` — minor, invalidation in `onSuccess` covers it.

#### Scorecard

| Area | Verdict | Notes |
|------|---------|-------|
| ARCH compliance | PASS | 10/10 corrections still in place; nothing in fix-pass touched migration or hooks beyond `useClaimCity` |
| Spec compliance | PASS | 15/15 ACs met; populated-state `n places` count now correct in prod |
| Correctness | PASS | All 5 bugs fixed; rollback reachable; jsonb param array-literal; distinct count single-source helper; nudge tiebreak typed correctly |
| Edge Cases | PASS | `.maybeSingle()` everywhere; null/empty/Elsewhere filter applied uniformly in `computeUserCityStats` |
| Error Handling | PASS | All three former-`.single()` sites now propagate `DB_ERROR` 500; helper `throws` on supabase errors so the outer try-block returns `INTERNAL_ERROR` 500 cleanly |
| Security | PASS | RLS SELECT-only, RPC `search_path`, owner-only ACL untouched and still enforced |
| Performance | WARN | Two-round-trip `computeUserCityStats` (entries + restaurants in JS) instead of single SQL RPC — acceptable for v1, follow-up to add `top_fours_distinct_counts` RPC if it bites at scale |
| Design Compliance | PASS | No UI files touched in fix-pass; prior review's PASS still stands |

**VERDICT: APPROVE** — all 5 bugs from Review 1 are fixed; ARCH-1..11 still hold; populated-state `n places` count is now functionally correct in production. Performance follow-up (consolidate the two-round-trip city-stats helper into a single SQL RPC) is logged but non-blocking.

### Review 3 (Claude)

Date: 2026-04-27
Verdict: APPROVE

#### Bug #6 fix verification

- [x] **Bug #6 — `entries.overall_rating` → `entries.rating`** ✅
  Evidence:
  - `supabase/functions/top-fours/index.ts:409` — select clause now reads `'restaurant_id, rating, created_at'` (was `'restaurant_id, overall_rating, created_at'`).
  - Lines 422 (typed cast), 427 (`best_rating: e.rating`), 433 (`if (e.rating != null)`), 434 (`existing.best_rating == null || e.rating > existing.best_rating`), 435 (`existing.best_rating = e.rating`) — all five `e.overall_rating` references migrated to `e.rating` in the aggregation block.
  - `grep -n 'overall_rating' /Users/jacky/Napkin/supabase/functions/top-fours/index.ts` returns nothing. Zero residual references in the edge function.
  - `grep -rn 'overall_rating' /Users/jacky/Napkin/supabase/migrations/` returns nothing. Confirms the column does not exist anywhere in the canonical schema; the canonical migration `20251215145100_create_entries_table.sql:42` defines `"rating" DOUBLE PRECISION` only.

- [x] **Error handling** ✅
  Both queries in `eligible_restaurants_for_city` now destructure `error`:
  - `index.ts:392-399` — `cityRestaurants` query: destructures `cityRestErr`, returns `errResponse('DB_ERROR', cityRestErr.message, 500)` on failure (lines 397-399). Empty-result fall-through (line 400) only fires when `error` is null.
  - `index.ts:407-415` — `entriesData` query: destructures `entriesErr`, returns `errResponse('DB_ERROR', entriesErr.message, 500)` on failure (lines 413-415). Same pattern.
  No more silent empty-list — a real DB error now surfaces a 500 to the client instead of an empty picker. Pattern matches the one applied to the three former-`.single()` sites in Review 2.

#### Bugs #1–5 still fixed (no new regressions)

- [x] **Bug #1 — `useClaimCity` rollback** ✅ untouched in this commit; precedence-correct guard `if (!user?.id || ctx?.previous === undefined) return;` still in place at `useClaimCity.ts:67` (commit 4c8b980 only modified the edge function).
- [x] **Bug #2 — `p_picks: picks` array literal** ✅ untouched; lines 503 (claim) and 562 (update_picks) still pass `picks` directly as the jsonb arg.
- [x] **Bug #3 — `computeUserCityStats` helper** ✅ untouched at `index.ts:79-125`; still the single source of truth for distinct-count.
- [x] **Bug #4 — nudge tiebreak typed correctly** ✅ untouched at `index.ts:246-256`; `best.log_n` reference still correct.
- [x] **Bug #5 — `.maybeSingle()` + explicit error** ✅ untouched at three sites (lines 314 / 528-540 / 604-616); all three still propagate `DB_ERROR` 500.

#### Column-name sweep across `top-fours/index.ts`

Cross-referenced every `.from('table').select(...)` against canonical migrations. All clean:

- `entries`: `restaurant_id`, `rating`, `created_at`, `user_id` — all exist (`20251215145100_create_entries_table.sql:32-50`).
- `restaurants`: `id`, `name`, `city`, `photo_url` — `id/name/city` from `20251201113055_remote_schema.sql:124-135`; `photo_url` added by `20260415100000_add_restaurant_photos.sql:1`.
- `profiles`: `user_id`, `account_privacy` — `user_id` from `20251201113055_remote_schema.sql:111-118`; `account_privacy` referenced by other production migrations (`20260430000000_dual_scope_post_interactions.sql:62`) confirms it exists upstream.
- `user_claimed_cities`: `city`, `is_home`, `claimed_at`, `user_id` — all defined in this ticket's migration `20260506000000_user_top_fours.sql`.
- `user_top_4`: `city`, `position`, `restaurant_id`, `user_id` — same migration.
- `user_claim_nudge_dismissals`: `city`, `dismissed_at`, `user_id` — same migration; upsert at line 643 also uses canonical `dismissed_at`.

No remaining column-name mismatches in `top-fours/index.ts`.

#### ARCH-1–11 regression check

Migration file (`supabase/migrations/20260506000000_user_top_fours.sql`) is untouched in commit 4c8b980 — `git show 4c8b980 --stat` would show only `top-fours/index.ts`. All ARCH-1..ARCH-11 corrections still hold by inspection. **10/10 maintained.**

#### Spec compliance

15/15 acceptance criteria still met. The previously-broken EDIT flow (empty picker due to `overall_rating` silent failure) now functions correctly: `eligible_restaurants_for_city` returns the user's logged restaurants in that city, sorted by `last_logged_at` desc, with `best_rating` populated from the canonical `rating` column. AC-7 ("EDIT flow: pick up to 4 from logged history") was structurally met but functionally broken before this fix; it is now also functionally correct.

#### Remaining nits (carried forward, none blocking)

- Same as Review 2: `computeUserCityStats` two-round-trip cost; `claim_city_with_picks` first-claim race window; `EditTopFourSheet` silent at-cap tap; `useDismissNudge.onSuccess` no-op reconciliation; `useClaimCity.onMutate` no `cancelQueries` on `availableCities`.
- Pattern note: this is the second time on this ticket where a read query swallowed errors via destructure-`data`-only (Bugs #5 and #6 share root cause). Worth a codebase-wide grep for similar `.from('...').select(...).eq(...)` without `error` destructuring on edge function read paths in future reviews.

#### Scorecard

| Area | Verdict | Notes |
|------|---------|-------|
| ARCH compliance | PASS | 10/10 still hold; migration untouched |
| Spec compliance | PASS | 15/15 ACs met; EDIT picker now functional in prod |
| Correctness | PASS | Bug #6 fixed at column-name level (5 sites in aggregation block); column-name sweep clean across all 6 tables touched by this fn |
| Edge Cases | PASS | Empty-result fall-through (lines 400, 416) gated behind explicit error checks |
| Error Handling | PASS | Both queries in `eligible_restaurants_for_city` destructure `error` and return `DB_ERROR` 500 — pattern matches the three `.maybeSingle()` sites |
| Security | PASS | Owner-only gate (line 386) untouched; service-role + manual `auth.getUser` flow intact |
| Performance | WARN | Same as Review 2 — two-round-trip `computeUserCityStats` not addressed in this fix-pass; non-blocking |
| Design Compliance | PASS | No UI files touched in this fix-pass |

**VERDICT: APPROVE**

---

## Completion

- **Completed:** 2026-04-27
- **Final verdict:** APPROVE (Claude + Codex both PASS on Review 3)
- **Cycles:** 3 review rounds. Round 1 FAIL on 5 bugs (rollback guard, JSON.stringify(picks), distinct-count fallback, nudge tiebreak, .single() swallow). Round 2 APPROVED by Claude but Codex caught a 6th bug (`entries.overall_rating` column doesn't exist — silent empty picker). Round 3 APPROVE from both.
- **Squash-merged** to `main` as a single commit.
- **Migration deployed** via `npx supabase db push --linked` during build.
- **Edge function deployed** via `npx supabase functions deploy top-fours --project-ref ftvmseaqwwlcxtdlvxxz` after each fix-pass.
- **Performance follow-up (deferred):** `computeUserCityStats` does two round-trips (entries, restaurants) and aggregates in JS. Acceptable for v1; if the populated-state sub-line becomes a hot path, replace with a single SQL RPC.
