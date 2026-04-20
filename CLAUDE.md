# CLAUDE.md — Napkin Implementation Guide

## What is Napkin?

Napkin is **"Letterboxd for restaurants, with a private supper club."** A mobile app where you catalogue meals — alone or with close friends — inside private groups ("Tables"), and where the Table's accumulated taste compounds into a trust graph that makes recommendations actually useful. Public surfaces (profiles, lists, reviews) exist as an opt-in expression of self, not as the hero.

**The Table is the hero and the moat.** Private feed, Rounds, who's-been on a restaurant, wishlist overlap. The Table is where trust compounds over time. Nobody else has this primitive; it's Napkin's defensible wedge.

**Solo logging is first-class** via a per-user "personal Table" (auto-created, `is_personal = true`). Everything in Napkin belongs to a Table — the personal Table is just a Table of one and acts as the user's private diary.

**Rounds** (formerly "Table Night") are a **side mode**, not the hero. A Round is a group rating event where Tablemates each drop their own rating on a shared meal — sync at dinner or async after. Flavor event, not centerpiece.

### Privacy and the public layer (doctrine locked 2026-04-17)

- **Default: private.** Account-level privacy is the master switch. New users are private by default; public is explicit opt-in.
- **Opt-in public surfaces:** once opted in, a user's profile, lists, and written reviews become world-browsable — Letterboxd-shaped. These surfaces fill gaps the Table can't (traveling, new cuisines, areas no one's been).
- **Tables are never public.** Whatever a user opts in to publicly does not include Table activity. The Table circle stays sacred regardless of account mode.
- **Logs vs. lists have different defaults:**
  - **Logs** (rating + note): private by default. Only surface publicly if the account is opted-in AND the log has real review content.
  - **Lists** (curatorial, themed): per-list public/private picker at creation; lists are made to share, so public per list is the expected default — but account-level privacy still gates world visibility.
- **Engagement on public content:** emoji reactions allowed; replies gated by a profile-level toggle. Public replies live in a **separate comment scope** from Table threads — they never bleed into the Table feed.
- **Two concentric trust rings:**
  - **Ring 1:** your Table(s). Small (3–8 ppl), bounded by real social reality. High trust per signal.
  - **Ring 2 (future ticket):** calibrated strangers — public users whose rating history overlaps yours, surfaced via a taste-calibration signal. Not friends; trust via alignment. This is the unlock for traveling / "no friends have been here" coverage.

**External context** (Google Places rating) is shown on restaurant pages as a sibling signal — never merged with Napkin numbers, never computed as a cross-Table aggregate.

**Rejected and superseded (do not re-open):**
- Product A "Beli with trust" (public-default, broad discovery as hero) — rejected 2026-04-17 in favor of Product B.
- Public-by-default for logs — rejected. Causes self-censorship; fills public pages with noise.
- Per-log privacy toggles — rejected. Account-level master toggle only, Letterboxd precedent.
- The older "Path A — no public layer ever" formulation is superseded. The door is now *opened but controlled*: public surfaces exist, opt-in, supporting-not-heroic.

If you feel a gravitational pull toward public-default or toward making discovery the hero, re-read this section. The doctrine has been re-litigated multiple times and the shape above is where it landed.

## Terminology

- **Round** is the product name for a group rating event. File paths, DB tables, the edge function, and some legacy components still use `table-night` / `table_night`. Treat them as aliases — new UI copy says "Round," existing code paths stay as-is unless a ticket renames them.
- **Personal Table** = the auto-created solo Table with `is_personal = true`. Every user has exactly one. Solo logs target this.
- **Ghost restaurant** = a Places-search result not yet persisted in `restaurants`. First heart/log tap triggers upsert-from-place silently.

## Current State (as of 2026-04-17)

Shipped foundations:

- **Auth + Tables CRUD** (TICKET-001, -002) — signup, Table create/join, membership model
- **Feed + filtering + views** (TICKET-003) — journal tab with reverse-chron, grid, calendar
- **Logger + entry composer** (TICKET-002, -004, -011 WIP) — overall rating + category breakdowns + notes
- **Photos** (TICKET-005, -005b, -006b) — restaurant photos, user entry photos, shared photo pool on Rounds
- **Rounds** (TICKET-006, -006c) — live round experience, realtime presence, reveal UI
- **Reactions & replies** (TICKET-007) — emoji reactions + threaded replies on all posts
- **Restaurant context** (TICKET-008) — per-restaurant history panel on Round/entry detail
- **Member profiles** (TICKET-012) — Table-scoped profile with rating distribution + top spots
- **Restaurant entity foundation** (TICKET-014) — first-class `restaurants` table, Google Places fields, solo-log flow into personal Table
- **Wishlist** (TICKET-015) — personal wishlist (primary); Table wishlist is emergent algorithmic merge
- **Restaurant page v2** (TICKET-016) — personal-first hero, tiered numbers (you / Table / Google), who's-been, log CTA sheet, ghost rendering
- **Restaurant search** (TICKET-017) — Places-backed, ghost-until-logged

Foundations **not yet built** (see `.kanban/backlog/`):
- **On-the-Table dishes module** (TICKET-009)
- **Feed card depth** (TICKET-010) — reaction previews, reply counts, unseen markers
- **Expanded logging metadata** (TICKET-011) — occasion, price, companions, craving
- **Participant drill-down from Round** (TICKET-013)

The UI was wiped and rebuilt in April 2026 around the **Heirloom Journal** aesthetic (warm paper palette, Newsreader + Manrope typography).

## Tech Stack

| Layer | Tech |
|-------|------|
| Mobile | React Native (Expo, Expo Router) |
| Styling | StyleSheet + theme tokens in `constants/theme.ts` |
| State | TanStack Query (React Query) |
| Animation | React Native Reanimated |
| Backend | Supabase (PostgreSQL + Auth + Edge Functions + Realtime) |
| Edge Functions | Deno / TypeScript |

## Project Structure

```
napkin-app/
├── app/
│   ├── (tabs)/
│   │   ├── journal.tsx            # Main feed
│   │   ├── tables.tsx             # Tables list + per-Table activity
│   │   ├── log.tsx                # + action
│   │   ├── search.tsx             # Places-backed restaurant search
│   │   ├── friends.tsx            # Member list / profiles
│   │   └── settings.tsx
│   ├── restaurant/[id].tsx        # Restaurant page v2 (TICKET-016)
│   ├── member/[id].tsx            # Member profile
│   ├── create-entry.tsx           # Entry composer (accepts prefill params)
│   ├── entry-detail.tsx           # Solo entry detail
│   ├── table-night.tsx            # Round live experience
│   ├── table-night-detail.tsx     # Round reveal / recap
│   ├── wishlist.tsx
│   └── auth.tsx
├── components/
│   ├── feed/                      # Feed cards, filters, views
│   ├── members/
│   ├── posts/                     # Reactions, replies, post rows
│   ├── restaurants/               # Hero, Numbers, WhoBeen, Distribution, LogVisitSheet
│   ├── search/
│   ├── table-night/               # Round UI (ParticipantList, RatingInput, Reveal, Recap)
│   └── wishlist/
├── hooks/
│   ├── members/
│   ├── posts/
│   ├── restaurants/               # useRestaurantPage, useUserRestaurantHistory, etc.
│   ├── search/
│   ├── tables/                    # useTables, useTableActivity, useTableNight*
│   └── wishlist/
├── lib/supabase.ts
├── lib/queryKeys.ts
├── constants/theme.ts
└── providers/AuthProvider.tsx

supabase/functions/
├── _shared/                       # cors.ts etc.
├── entry/                         # Create/update entries
├── member-profile/
├── places-search/                 # Google Places integration
├── post-interactions/             # Reactions, replies
├── restaurant-history/            # Personal/Table/aggregated restaurant pages
├── table-activity/                # Feed for a Table
├── table-management/              # Table CRUD
├── table-members/
├── table-night/                   # Round lifecycle
├── user-profile/
└── wishlist/
```

## Code Patterns — Follow These Exactly

### Edge Function Pattern
Canonical: `supabase/functions/table-management/index.ts`.
- Import `serve` from deno std, `createClient` from supabase-js, `corsHeaders` from shared
- Handle OPTIONS for CORS preflight
- Create Supabase client with **service role key** (bypasses RLS, validates auth manually)
- Validate user via `supabase.auth.getUser(token)`
- Route by HTTP method + `action` param or JSON body
- Return `{ data }` or `{ error }` shape with `corsHeaders`

### Hook Pattern (Query)
See `hooks/tables/useTables.ts` or `hooks/restaurants/useRestaurantPage.ts`:
- `useQuery` from `@tanstack/react-query`, `supabase` from `@/lib/supabase`, `queryKeys` from `@/lib/queryKeys`
- Fetch via `supabase.functions.invoke()`
- `enabled: !!userId`, `staleTime: 1000 * 60 * 5`

### Hook Pattern (Mutation)
See `hooks/tables/useCreateTable.ts`:
- `useMutation` + `useQueryClient`
- Session token via `supabase.auth.getSession()`, `Authorization: Bearer ${token}` header
- On success, invalidate relevant query keys

### Query Keys
All defined in `lib/queryKeys.ts`. When adding a new feature, add its keys there, not ad-hoc.

### Component Pattern
- `Colors` from `@/constants/theme`, `useColorScheme` from `@/hooks/use-color-scheme`
- `useAuth` from `@/providers/AuthProvider`
- Barrel-export from each component directory's `index.ts`

## Things NOT to Build

Explicitly out of scope until a ticket says otherwise:

- Any public-facing review, feed, or universal aggregate (Path A)
- Value Profiles (removed)
- Explore / strangers' feed / public leaderboards
- Share to Instagram Stories
- Table Wrapped annual stats
- Privacy settings matrix (friends/table/both visibility)
- Push notifications (deferred)
- Map pins / directions
- Menu / hours / phone UI on restaurant pages

## Key Files to Read Before Starting

1. `napkin-app/constants/theme.ts` — Heirloom Journal design tokens
2. `napkin-app/app/(tabs)/journal.tsx` + `tables.tsx` — reference feed/tab patterns
3. `napkin-app/app/restaurant/[id].tsx` — most recently written screen (TICKET-016), good pattern reference
4. `supabase/functions/restaurant-history/index.ts` — recent edge function pattern (aggregated endpoint)
5. `hooks/restaurants/useRestaurantPage.ts` — recent query hook pattern
6. `lib/queryKeys.ts` — central query key registry
7. `.kanban/done/TICKET-016-restaurant-page-v2.md` — last shipped ticket with full spec + tech design + review, useful as a template

## Working on Tickets

Workflow lives in `.kanban/`:
- `backlog/` → ideas, not fully specced
- `ready/` → specced, has acceptance criteria, ready to build
- `in-progress/` → being built
- `review/` → implementation done, awaiting review
- `done/` → shipped

Use the project slash commands: `/project:board`, `/project:spec TICKET-NNN`, `/project:start TICKET-NNN`, `/project:review`.
