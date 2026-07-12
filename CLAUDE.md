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
- Warm paper + Newsreader is the brand. Upright Newsreader is the default editorial voice for names and authored content. Italic serif is a scarce accent reserved for the wordmark, rating numerals, and direct quotes — never section headings, labels, prompts, instructions, or metadata.
- Functional type has a legibility floor: 16pt body, 13pt metadata, and 11pt uppercase labels. Smaller type is allowed only when it is non-essential text embedded inside artwork; it must never carry an action or primary meaning.
- Never pure black. Use `#1c1c19`.
- No 1px solid borders for sectioning. Structure = background shifts + spacing + ghosted warm rules.
- Ambient shadows only (`0 8px 30px rgba(28,28,25,0.06)`). No hard drop shadows.
- Verbs are lowercase past-tense: `noted` / `tried` / `pinned` / `voted` / `gathered` / `clipped`. Never "posted/shared."
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
- **Saves (wishlist pins) are public-by-default signals** (2026-07-10, TICKET-155). A save is low-intimacy ("tempted"), not a diary entry — like a Letterboxd watchlist add. When the account is public (the default), a user's saves AND their source clipping (the TikTok/IG it came from) are visible to anyone, strangers included. **Private account → saves stay self + Table-mates only** (unchanged). Gated ONLY by `account_privacy` — **no per-item/per-save toggle** (consistent with the rejected per-log-toggle doctrine). **Clipping visible ⟺ save visible.** The read predicate is the `SECURITY DEFINER` `fn_restaurant_saves_visible` RPC — the both-direction block check MUST live in a definer, never an RLS `USING` clause (`blocked_users`' own RLS hides the saver→viewer block row and would fail open). Non-owners get a sanitized source allowlist `{type,url,author_handle,author_name,thumbnail_url}`; the owner gets the raw source. The `wishlist_items` SELECT policy is unchanged (owner + Table-mate) — legacy defence-in-depth, NOT the doctrine surface.
- **Private accounts stay reachable, searchable, and followable** (2026-07-10, TICKET-155). A private profile is not a UX dead-end: it appears in search and stays followable, and tapping in shows a quiet **"their journal is private"** state — identity (name/avatar/username/bio) + follower/following counts + a working follow button, with ALL palate withheld. **NO follow-request/approve machinery** — follow always resolves immediately. Going private still means something (logs/palate stay hidden; saves drop to self + Table-mates); it just isn't a wall.
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
- Circle-gated saves (wishlist pins visible only to self + Table overlap) — superseded 2026-07-10 (TICKET-155). Saves are public-by-default signals gated by `account_privacy`; private savers still surface to Table-mates only, and the source clipping rides along (clipping visible ⟺ save visible).
- Private accounts as UX dead-ends (private profile → 404 / "make your profile public for friending to mean anything") — superseded 2026-07-10 (TICKET-155). Private accounts stay searchable + followable with a quiet "their journal is private" state; no follow-request/approve flow. (Tables-never-public and logs-private-default are UNCHANGED — this loosened saves + profile reachability only.)

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
- **On-screen copy economy — cut hard.** Claude Design canvases over-explain; their prose is a *maximum to cut from*, not a spec to reproduce. Prefer a succinct label ("Name", or none + a placeholder) over a full-sentence prompt — never ship "what should we call this table?". Never stack multiple explanatory sentences on one screen (reads as cluttered garbage). If a field is self-evident, don't narrate it — let the placeholder/structure carry it; one entry box per intent. Empty states get at most one short line. **The goal is instant comprehension** — the user should "get it" at a glance, which is as much about type hierarchy and contrast as word count: put functional text, section structure, and field labels in upright Manrope with real contrast; use upright Newsreader for editorial content and names; reserve Newsreader italic for rare accents such as ratings and direct quotes. A prompt in decorative italic reads as atmosphere, not instruction. This applies to all UI agents (builder, designer, reviewer).

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

## Edge function calls — use `callEdgeFn`

`napkin-app/lib/edgeInvoke.ts::callEdgeFn` is the one canonical way to call any Supabase edge function from a hook. Do **not** call `supabase.functions.invoke` directly and do **not** raw-`fetch` an edge function URL outside this helper.

Why: auth attachment, error unwrapping, GET-with-query-params, and the TICKET-037 structured error envelope are all centralized there. Hooks that bypass it will drift and silently 401 when contract changes (see TICKET-038 retro: Atlas + Cy hooks both shipped manual `Authorization` headers and broke).

```ts
// POST (mutation) — typical edge function shape
const item = await callEdgeFn<WishlistItem>('wishlist', {
    action: 'add',
    body: { restaurant_id },
});

// GET (read with query params) — when invoke is the wrong transport
const page = await callEdgeFn<DiaryPage>('user-profile', {
    method: 'GET',
    action: 'diary',
    params: { user_id, limit: 30 },
});
```

Errors are real `Error` instances with `.cause: UnwrappedError` (`{ code, message, details?, status? }`) for callers that want to branch on the structured shape.

## Mutation pattern (TanStack Query)

Every data-mutation hook follows this shape (TICKET-036 doctrine):

```ts
useMutation({
    mutationFn: async (input) => callEdgeFn(...),
    onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData(queryKey);
        queryClient.setQueryData(queryKey, (old) => patch(old, input));
        return { previous };
    },
    onError: (_err, _input, ctx) => {
        if (ctx?.previous !== undefined) queryClient.setQueryData(queryKey, ctx.previous);
    },
    onSuccess: (result) => {
        // Reconcile with server shape; do not blanket-invalidate.
    },
});
```

Rules:

1. **`onMutate` ALWAYS snapshots `previous` and returns it.** Non-negotiable. Without this, errors leave the cache stuck on the optimistic value (TICKET-036 P0-8 was exactly this on `useMarkSeen`).
2. **Never invalidate on a wider prefix than needed.** `['users', 'profile']` (all profiles) is wrong; `queryKeys.users.profile(targetId)` is right. Loop if multiple ids.
3. **Related caches get patched, not invalidated.** Flipping a follow shouldn't refetch every cached profile (TICKET-036 P1-8).
4. **`onSettled` invalidations are dangerous if `onMutate` already patched.** They race with the patch. Only invalidate at settle time when the server shape carries data the patch couldn't synthesize (e.g. server-assigned positions in a list).

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

**Canonical mutation pattern (TICKET-036/042):** Every mutation hook must follow the snapshot → patch → rollback → narrow refetch lifecycle. The full doc with annotated template, the `client_nonce` round-trip pattern, shared `InfiniteData` helpers, and an anti-patterns checklist lives in `napkin-app/lib/mutations.md`. Read it before writing any new `useMutation` hook — or before adding `invalidateQueries` to an existing one.

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
- Remote push notifications (APNs/FCM tokens, server-driven push) still deferred. Device-LOCAL notifications shipped for import completion only (TICKET-120) — `expo-notifications`, no tokens, no server involvement.
- Map pins / embedded maps on restaurant pages (a `directions` deep-link out to Google Maps is allowed — see TICKET-081)
- A real menu surface — Google Places exposes no menu data. The restaurant page surfaces `website` only (never a "menu" affordance that implies a real menu). Menu remains out until a real source is found.

> Restaurant metadata (phone · directions · website · hours from Google Places) was greenlit 2026-06-12 (TICKET-081), reversing the former "Menu / hours / phone UI on restaurant pages" prohibition. Menu stays out (no Places source).

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

## Deploy doctrine — auto-deploy with smoke + auto-revert (locked 2026-04-30)

After three "could not load X" prod fires in a week (TICKET-043 PGRST201, etc.), the repo runs a smoke-tested auto-deploy with auto-revert on failure. **There is no staging environment** — Supabase free-tier project cap and unwillingness to pay $25/mo for Pro means staging-first is not on the table yet. Revisit when (a) the project has paying users, or (b) we hit Pro for any other reason (branching, larger DB).

### How code reaches prod

1. **Land changes on a `release/<date>-<tickets>` branch** and open a PR to `main`. PR review = the human gate.
2. **Merge to main.** [`prod-deploy.yml`](.github/workflows/prod-deploy.yml) automatically:
   - Runs the duplicate-timestamp guard.
   - `supabase db push --linked` against prod.
   - Deploys every edge function changed in this commit range.
   - Runs `scripts/smoke/edge-functions.ts` against prod (HTTP 200 + shape sniff per critical endpoint).
3. **If smoke fails**, the workflow automatically opens an auto-revert PR (`auto-revert/<sha>`). Go merge it. ETA from breakage to revert depends on how fast you click — design for under 5 minutes.
4. **If smoke passes**, you're done.

### Hard rules

- **Never** run `supabase db push --linked` or `supabase functions deploy --project-ref ftvmseaqwwlcxtdlvxxz` from a laptop. The CI workflow is the only path to prod. Local laptop work goes against `supabase start` (local Docker stack) only.
- **The smoke test list is sacred.** When a postmortem traces a fire to an endpoint not in the list, add it to the list as part of the fix. The list lives in [`scripts/smoke/edge-functions.ts`](scripts/smoke/edge-functions.ts).
- **Hot-fix exception:** if prod is on fire and CI is also broken, you may direct-deploy to prod with a postmortem-required rule. Exactly one person (you) has that authority.
- **Trade-off acknowledged:** smoke runs *after* deploy. Users may briefly hit errors before the auto-revert PR merges. This is the explicit cost of skipping a paid staging environment. Acceptable while in friends-test phase; revisit on first real users.

### When to upgrade to staging-first

The minute any of these is true, pay $25/mo for Supabase Pro and switch on Branching (or stand up a dedicated staging project):

- Real users (anyone who'd churn over a 30-second outage)
- More than ~3 prod-deploys per day
- A second person committing to the repo

## Migration blast-radius checklist (planner output, mandatory)

PGRST201 — and every other "function passes, screen 500s" bug — comes from a migration changing the schema in a way that invalidates code nobody touched. The planner agent must produce this checklist for any ticket that includes a migration. Reviewers verify the checklist is complete; missing entries fail the review.

For each schema change in the migration, the plan must list:

1. **PostgREST embeds.** Grep every `supabase/functions/**` and `napkin-app/**` file for `.from('<table>').select('...joined_table(...)')`. List every site. Note for each: must be disambiguated with `!fk_name` syntax, or rewritten, or "no change needed because...".
2. **Direct SQL queries.** Same grep against any `.rpc()` calls and any raw SQL in migrations that reference the changed objects.
3. **RLS policies.** List every policy on the changed table OR any table that joins to it via SECURITY DEFINER helpers. Note which ones need a corresponding update.
4. **Edge function contracts.** List every edge function whose request/response shape changes. Each must be redeployed in the same release.
5. **TanStack Query keys + hooks.** List every queryKey and hook that consumes a changed shape. Each must update its type and any cache patches.
6. **Optimistic patches.** If the new schema changes what the server returns, list every `onMutate` patch that synthesizes that shape — the synthesized shape must match.

The checklist lives in the ticket's `## Notes / Blast Radius` section, written before the build phase. Builders treat it as a TODO list. Reviewers reject any PR where a listed file wasn't touched or wasn't explicitly justified.

### From-scratch replayability (locked 2026-07-04)

`supabase db push` only applies NEW versions against the complete prod schema — it never re-checks that the chain still replays from zero. Local `supabase start` / `db reset` (and any future staging/branching) DO replay from zero. Rules:

- **Never rename an already-applied migration version.** It desyncs `supabase_migrations.schema_migrations` on prod. Fix ordering bugs by editing file *content* — applied files never re-run on prod.
- **Backdated timestamps are the trap.** A branch cut before another migration merges will replay before it, even though prod applied them in merge order. If an earlier-versioned file must reference a later table inside a `language sql` body, `set check_function_bodies = off;` / `reset` around it (see `20260424100000_pagination_rpcs.sql`).
- **Nested `$$` never parses.** Use distinct dollar-quote tags for strings inside DO blocks (`$do$` / `$job$`).
- CI enforces this: `.github/workflows/migration-replay.yml` replays the full chain into a throwaway DB on every PR touching `supabase/migrations/**`. A red replay guard fails the PR.
- The 39 dashboard-era fossil objects prod used to carry (`entry_likes`, `entry_comments`, `table_wishlist`, `notify_on_*`, `fn_user_stats`, …) were **dropped 2026-07-04** by TICKET-100 (`20260705000000_drop_dashboard_era_fossils.sql`; all three fossil tables verified empty first). Prod and a fresh replay now agree. If a future audit finds prod-only objects again, drop them via a guarded `IF EXISTS` migration through CI — never add capture migrations, never laptop-push.

### PostgREST embed disambiguation rule

If a table T has more than one foreign-key relationship to the same target table U (which happens whenever you add a join table that bridges T and U), every PostgREST embed `from('T').select('... U(...)')` MUST name the FK explicitly: `from('T').select('... U!T_<col>_fkey(...)')`. Otherwise PostgREST throws `PGRST201` at request time (HTTP 500).

Example (TICKET-043 retrospective): adding `entry_tables` made every `entries → tables` embed ambiguous. Fix: `tables!entries_table_id_fkey(...)`.

When a migration adds a join table, the blast-radius checklist (item 1 above) MUST list every existing `from('<existing_table>').select('... <other_existing_table>(...)')` site touching either side of the new join.

### Dual-review protocol

For high-stakes work, every gated phase (spec, architecture, build) gets BOTH a Claude review and a Codex review. Two model architectures, independent failure modes — catches what a single reviewer misses. Single-reviewer is fine for routine adds.

**Triggers** (any one is enough — applies at spec, architecture, AND build phases):

- PR / change deletes >500 LOC or removes major modules
- Touches DB schema, migrations, or RLS policies
- Touches edge function contracts in `supabase/functions/_shared/` or `lib/edgeInvoke.ts`
- Refactors crossing module boundaries
- Auth, permissions, or data integrity (Supabase RLS, `table_members`, follow graph)
- External APIs with real cost or rate limits (Google Places, Maps)
- Builder uses `--no-verify` or any hook bypass
- Builder reports "pre-existing failures" to justify failing tests
- Builder deviates from the spec's file list (additions or omissions)
- Cherry-picks, rebases, or merge-conflict resolutions

**Where Codex plugs in:**

| Phase | Claude reviewer | Codex pass | What Codex looks for |
|-------|------------------|--------------|------------------------|
| Spec (`/project:spec`) | (n/a, product-designer writes spec) | Sanity-check spec | Missing acceptance criteria, ambiguous scope statements, security/data-integrity gaps |
| Architecture (`/project:start` Phase 1) | (n/a, architect writes design) | Adversarial design review | Hidden coupling, lazy-import landmines, scope creep, lock-in choices |
| Build (`/project:start` Phase 3) | code-reviewer subagent | `/codex:adversarial-review` | Runtime landmines, swallowed errors, broken callers, test bypass |

**Reconciliation:** if either reviewer returns FAIL, the phase fails. PASS from one + PASS-WITH-NITS from the other = pass with nits documented. Conflicting findings on the same code path → orchestrator does a third pass.

**Invocation:** Codex runs via `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task` (for spec/arch sanity) or `adversarial-review` (for build review). See `~/.claude/commands/spec.md`, `~/.claude/commands/start.md`, `~/.claude/commands/review.md` for the exact invocation per phase.
