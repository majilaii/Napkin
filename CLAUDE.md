# CLAUDE.md — Napkin Implementation Guide

## Design source of truth — READ BEFORE ANY UI WORK

All Napkin UI must match the **Heirloom Journal** design system. The canonical bundle is:

**`https://api.anthropic.com/v1/design/h/arCMwe2IOddzhHFBISX_Ng`**

Fetch + extract:
```
curl -sL -o /tmp/design.tar.gz "https://api.anthropic.com/v1/design/h/arCMwe2IOddzhHFBISX_Ng"
mkdir -p /tmp/design && tar -xzf /tmp/design.tar.gz -C /tmp/design
```

Before implementing ANY screen, component, or visual change:
1. Read `napkin-design-system/project/README.md` (design bible — voice, palette, type, iconography, components, card archetypes).
2. Read the relevant canvas in `napkin-design-system/project/ui_kits/napkin-app/` (e.g., `profile-canvas.jsx`, `feed-canvas.jsx`, `restaurant-canvas.jsx`, `logger-canvas.jsx`, `tables-canvas.jsx`, `crossroad.jsx`).
3. Match visuals in React Native. Translate prototype HTML/JSX idioms — but spacing, color, type, radii, shadows must match.
4. Tokens live in `napkin-app/constants/theme.ts` and must stay aligned with `napkin-design-system/project/colors_and_type.css`. Never hardcode colors/spacing/type in components.
5. Copy assets (avatars, icons, photos) from `napkin-design-system/project/assets/` — never redraw.
6. If the bundle is ambiguous, ask the user before implementing.

**Non-negotiable brand rules** (see `project/README.md` for full detail):
- Warm paper + italic Newsreader is the brand. Italic serif = brand voice (wordmark, Table names, restaurant names, rating numerals).
- Never pure black. Use `#1c1c19`.
- No 1px solid borders for sectioning. Structure = background shifts + spacing + ghosted warm rules.
- Ambient shadows only (`0 8px 30px rgba(28,28,25,0.06)`). No hard drop shadows.
- Verbs are lowercase past-tense: `noted` / `tried` / `pinned` / `voted` / `gathered`. Never "posted/shared."
- Middle dot `·` separates metadata. Em dash `—` prefixes pull-quotes.
- No emoji in chrome. Only as user-generated reactions.
- Ionicons outline @ 24px. Fills avoided.
- Max two accent colors per screen (terracotta / olive / amber — pick two).

This rule applies to all agents (builder, code-reviewer, product-designer). Subagents MUST consult the bundle, not just `theme.ts`.

## What is Napkin?

Napkin is **"Letterboxd for restaurants, with a private supper club."** A mobile app where you catalogue meals — alone or with close friends — inside private groups ("Tables"), and where the Table's accumulated taste compounds into a trust graph that makes recommendations actually useful. Public surfaces (profiles, lists, reviews) exist as an opt-in expression of self, not as the hero.

**The Table is the hero and the moat.** Private feed, Rounds, who's-been on a restaurant, wishlist overlap. The Table is where trust compounds over time. Nobody else has this primitive; it's Napkin's defensible wedge.

**Solo logging is first-class** via the user's feed. Entries can optionally be shared to a Table, or posted feed-only (no `table_id`). The feed IS the user's personal journal — there is no separate "personal Table" concept. Tables are always social/group constructs.

**Rounds** (formerly "Table Night") are a **side mode**, not the hero. A Round is a group rating event where Tablemates each drop their own rating on a shared meal — sync at dinner or async after. Flavor event, not centerpiece.

### Privacy and the public layer (doctrine locked 2026-04-17)

- **Profiles are PUBLIC BY DEFAULT** (updated 2026-04-20). When a user has a profile, it's world-browsable — Letterboxd-shaped. Opt-out via settings toggle. Do NOT gate behind opt-in.
- **Logs default private.** Surface on public profile only when log has real review content AND profile is public (the default).
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
- Product A "Beli with trust" as the whole app (public-default, broad discovery as hero) — rejected. Tables remain the hero.
- Public-by-default for logs — rejected. Causes self-censorship.
- Per-log privacy toggles — rejected. Account-level toggle only.
- Private-by-default profiles (old 2026-04-17 stance) — superseded 2026-04-20. Profiles now public-default with opt-out.
- "Path A — no public layer ever" — superseded. Public surfaces exist; Tables still never public.

## Core thesis: Individual-first. Tables emerge. (2026-04-20)

Napkin is **individual + friends by default**; a Table **emerges naturally** when a crew keeps eating together. Not three IA forks — one timeline, four moments:

1. **Day one — a lone ledger.** Solo, private-by-default journal. No tables, no groups, no share sheet. Retention = craft of journaling. This is the product for days/weeks/months.
2. **First spark — tag a friend.** Log sheet gains one optional field: *who were you with?* Tagging Clara lets her see the entry in her feed. No room, no invite. Friends graph fills in; each friend carries a "meals together" count.
3. **Emergence — the app names it.** Trigger: 3+ shared meals with the same set within ~3 months. A quiet **suggestion card in the feed** reads: *"You, Clara, Thomas & Julian keep eating together. Start a table?"* Refusable. Never nags twice.
4. **Centerpiece — the table becomes a place.** Editorial masthead with name + members + stitched past-meal history. Rounds voting now has a home. Most users will have 1–2 tables.

Rules:
- **Do NOT frame solo as a deficient table.** Solo must be a complete, self-respecting product. Most users never form a table — fine.
- **Do NOT gamify the arc.** No XP, no levels, no Duolingo HUD. Progression reads as life happening.
- **Emergence card is rare and dismissible.** One trigger, soft copy, single primary CTA + "Maybe later." Never show twice for the same set in a short window.
- **Design continuity across the arc.** Same components, same grammar. Table feed = solo feed + shared authorship + masthead.
- **The hero is the arc itself**, not any single surface. Round is a niche side mode, NOT the hero. If this file still hints otherwise, treat as stale.

Related code surfaces: `app/looking-back.tsx`, `app/seed-from-solo.tsx`, `components/tables/FoundedHero.tsx`, `components/tables/TableHeader.tsx`. Companion-tagging field not yet built; schema does not yet carry `companion_ids`.

## Wishlist model

Emergent overlap, not declared nomination.

- **Personal wishlist:** Pinterest-style one-tap saves, private to user, cross-Table. Low-stakes hoarding.
- **Table wishlist:** NOT directly editable. An algorithmic merge/ranking of members' personal wishlists. More members saving a restaurant → higher rank (e.g., "3 of you want to try Kono").
- **No "Nominate" / unilateral add-to-Table action.** Omitted v1 to avoid spam and test whether emergent model is sufficient.
- **Leaving a Table:** personal wishlist untouched; contributions to Table overlap simply drop out.
- **UI:** Table wishlist emphasizes overlap count ("3 of you saved this") as primary ranking signal. Do NOT build an add-to-Table action.

## User preferences — honor these

- **Bottom nav stays Ionicons + labels.** Do NOT swap for the canvas text-only uppercase variant from `feed-canvas` / `profile-canvas`. 52×52 floating terracotta `+` with negative margin. User rejected text-only nav; icons are non-negotiable. When doing canvas-faithful passes, skip the bottom nav — leave `app/_layout.tsx::BottomNavBar` and `navStyles` alone. If asked to redesign nav later, confirm before replacing icons.
- **Terse responses.** Don't narrate. Short updates, direct answers.

## Terminology

- **Round** is the product name for a group rating event. File paths, DB tables, the edge function, and some legacy components still use `table-night` / `table_night`. Treat them as aliases — new UI copy says "Round," existing code paths stay as-is unless a ticket renames them.
- **Feed-only entry** = an entry with `table_id = NULL`. Lives on the user's personal feed/journal. Not shared to any Table.
- **Ghost restaurant** = a Places-search result not yet persisted in `restaurants`. First heart/log tap triggers upsert-from-place silently.

## Schema conventions — read before writing migrations or RLS

### `member_id` vs `user_id` (intentional exception)

Every table that references a user uses `user_id` — **except `table_members.member_id`**. This is legacy from TICKET-001 and the rename cost is not worth the value (every RLS policy and join would need touching). Doctrine for new code:

- When writing RLS or joins against `table_members`, the column is `member_id`, full stop. Type `tm.user_id` and you have a bug.
- When writing queries that "feel like" they want a `user_id` from `table_members`, alias it: `select member_id as user_id from table_members ...`.
- This trap caused TICKET-034 P0-2 (`entry_photos` RLS used `tm.user_id`, silently allowed nothing).

### `table_night` vs `round` — when each name applies

| Layer | Name |
|---|---|
| DB tables / columns | `table_nights`, `table_night_participants`, `table_night_id` |
| Edge function path | `table-night/` (actions: `start`, `rate`, `status`, ...) |
| Client hooks | Prefer `Round` in new hook names (`useStartRound`, `useRateRound`). Existing `useTableNight*` hooks are fine until renamed. |
| UI copy | Always "Round" — never expose "table night" to users. |

Rename DB tables and edge function paths only if a ticket explicitly scopes that work. Hook renames are mechanical and can land opportunistically.

### Dead-hook hit list (do not resurrect)

- `useStartTableNight` was deleted in TICKET-039 — its signature didn't match the edge function. Use `useStartRound` from `hooks/tables/useStartRound.ts`.
- `useSubmitTake` was deleted in TICKET-039 — duplicate of `useRateTableNight`.
- `supabase/functions/table-members/` was deleted in TICKET-039 — never invoked from any hook. Use `table-management?action=add_member`.

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

### Pagination
All paginated endpoints use the canonical `Page<T>` envelope and opaque cursor string.

**Wire envelope** (snake_case on the wire):
```ts
type Page<T> = { rows: T[]; next_cursor: string | null; has_more: boolean };
```

**Cursor format**: `base64(${iso8601}|${uuid})`. The server is authoritative; clients never parse cursors.

**Client helper** — `napkin-app/lib/pagination.ts`:
- `useCursorPagedQuery<T>(opts)` — wraps `useInfiniteQuery` with canonical `getNextPageParam`. **Mandate: every paginated hook must use this — never open-code `useInfiniteQuery` or numeric offsets.**
- `flattenPages<T>(data)` — replaces `data?.pages?.flat()` everywhere.

**Server helper** — `supabase/functions/_shared/pagination.ts`:
- `encodeCursor` / `decodeCursor` — encode/decode the `(sort_date, id)` tuple.
- `buildPage(rows, pageSize, getCursor)` — build the envelope from a `limit+1` query result.
- `applyKeysetFilter(query, cursor)` — apply the decomposed tuple keyset filter to a supabase-js query.

**Keyset SQL**: `ORDER BY sort_date DESC, id DESC`, filter = `(sort_date, id) < (d, i)`.

**`table-activity` uses POST** (cursor in body). All other endpoints use POST action bodies. Do not use GET for paginated calls — cursor strings can be long.

See `hooks/users/useUserDiary.ts` or `hooks/tables/useTableActivity.ts` for canonical hook examples.

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
