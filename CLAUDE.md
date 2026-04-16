# CLAUDE.md — Napkin Implementation Guide

## What is Napkin?

Napkin is a mobile app for private friend groups ("Tables") to share restaurant experiences and rate restaurants together. Think of it as a trusted supper club — your close friends post where they ate, you trust their recs, and when you dine out together you play **Table Night**: a real-time group rating reveal game.

**The Table is the product.** Not a public feed, not a review platform. A small trusted group that shares food experiences and occasionally turns dinner into a game.

**Solo logging is allowed** via a per-user "personal Table" (an auto-created Table where `is_personal = true`) that acts as the user's private diary. Everything in Napkin still belongs to a Table — the personal Table is just a Table of one.

**External context is allowed as a reference signal**, not as a social layer:
- Google's rating from the Places API may be shown on a restaurant page as a secondary number.
- An anonymized aggregate ("N Napkin Tables averaged this X.X") is a *future possibility* — do not build it until its absence is felt after real use.
- No public feed, no cross-Table review visibility, no Napkin-wide consensus layer in v1. Ratings are scoped to the Tables you belong to.

**Future escape hatch (deferred, do not design now):** if users demand broader visibility, a Table may opt-in to become public. The door exists; it stays closed for now.

This decision has been re-litigated multiple times. If you find yourself pulled toward a public/universal layer, re-read this section — the answer has been the same every time.

## Current State

The foundation is built: Expo app, Supabase backend, auth, table CRUD, activity feed. The UI was wiped and rebuilt in April 2026 around the Heirloom Journal aesthetic (warm paper palette, Newsreader + Manrope typography). The hero feature — **Table Night** — still has no UI implementation. Its schema, edge function, and data hooks exist.

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
├── app/(tabs)/tables.tsx          # Tables tab (existing, working)
├── app/table-night/[id].tsx       # Table Night screen (TO BUILD)
├── components/tables/             # Table components (existing)
├── components/table-night/        # Table Night components (TO BUILD)
├── hooks/tables/                  # Table hooks (existing)
├── hooks/tables/useTableNight.ts  # Table Night hook (TO BUILD)
├── hooks/tables/useTableNightRealtime.ts  # Realtime hook (TO BUILD)
├── lib/supabase.ts                # Supabase client
├── lib/queryKeys.ts               # Centralized query keys
├── constants/theme.ts             # Colors/theme
└── providers/AuthProvider.tsx      # Auth context

supabase/
├── functions/_shared/cors.ts      # CORS headers (reuse this)
├── functions/table-management/    # Table CRUD (existing pattern to follow)
├── functions/table-night/         # Table Night edge function (TO BUILD)
└── migrations/                    # Schema (table_nights etc already exist)
```

## Code Patterns — Follow These Exactly

### Edge Function Pattern
See `supabase/functions/table-management/index.ts` for the canonical pattern:
- Import `serve` from deno std, `createClient` from supabase-js, `corsHeaders` from shared
- Handle OPTIONS for CORS preflight
- Extract auth token from Authorization header
- Create Supabase client with **service role key** (bypasses RLS, validates auth manually)
- Validate user via `supabase.auth.getUser(token)`
- Route by HTTP method and URL path
- Return JSON with `{ data }` or `{ error }` shape
- Always include `corsHeaders` in response headers

### Hook Pattern (Query)
See `hooks/tables/useTables.ts`:
- Import `useQuery` from `@tanstack/react-query`
- Import `supabase` from `@/lib/supabase`
- Import `queryKeys` from `@/lib/queryKeys`
- Define async fetch function that calls `supabase.functions.invoke()`
- Export hook that returns `useQuery` with `enabled: !!userId`
- Use 5-minute staleTime: `staleTime: 1000 * 60 * 5`

### Hook Pattern (Mutation)
See `hooks/tables/useCreateTable.ts`:
- Import `useMutation`, `useQueryClient` from `@tanstack/react-query`
- Get session token via `supabase.auth.getSession()`
- Pass `Authorization: Bearer ${token}` in headers
- On success, invalidate relevant query keys

### Query Keys
Defined in `lib/queryKeys.ts`. Add new keys for Table Night:
```typescript
tableNight: {
    status: (nightId: string) => ['tableNight', nightId] as const,
    active: (tableId: string) => ['tableNight', 'active', tableId] as const,
    participants: (nightId: string) => ['tableNight', nightId, 'participants'] as const,
},
```

### Component Pattern
- Use `Colors` from `@/constants/theme` for theming
- Use `useColorScheme` from `@/hooks/use-color-scheme`
- Use `useAuth` from `@/providers/AuthProvider` for current user
- Barrel export from `components/table-night/index.ts`

## What to Build — In Order

### Step 1: Edge Function (`supabase/functions/table-night/index.ts`)

Single edge function with action routing via request body `{ action: "start" | "join" | "rate" | "ready" | "reveal" }` for POST, and query params for GET.

**Actions:**

**POST `{ action: "start", table_id, restaurant_id }`**
- Validate user is member of table
- Insert into `table_nights` (status: `rating`, host_user_id: user.id)
- Insert host into `table_night_participants`
- Return the created table night

**POST `{ action: "join", table_night_id }`**
- Validate user is member of the table
- Validate night status is `rating`
- Insert into `table_night_participants`
- Return participant record

**POST `{ action: "rate", table_night_id, rating }`**
- Validate rating is 0.5 to 5.0 in 0.5 increments
- Validate user is participant and not already ready
- Update `table_night_participants.rating`
- Return updated participant

**POST `{ action: "ready", table_night_id }`**
- Validate user has submitted a rating
- Set `table_night_participants.ready = true`
- Return updated participant

**POST `{ action: "reveal", table_night_id }`**
- Validate requester is host
- Validate all participants are ready
- Validate minimum 2 participants
- Update `table_nights.status = 'revealed'`, set `revealed_at = NOW()`
- Return full night data with all ratings

**GET `?action=status&table_night_id=X`**
- Return night details + all participants
- If status is NOT `revealed`: include ready states but HIDE ratings (return null)
- If status IS `revealed`: include all ratings

**GET `?action=active&table_id=X`**
- Return any table night with status `rating` for this table, or null

**Test with curl before moving to frontend.**

### Step 2: Hooks (`hooks/tables/useTableNight.ts` + `useTableNightRealtime.ts`)

**useTableNight.ts:**
- `useActiveTableNight(tableId)` — query for active night (polls or uses realtime)
- `useTableNightStatus(nightId)` — query for full night state
- `useStartTableNight()` — mutation: start
- `useJoinTableNight()` — mutation: join
- `useRateTableNight()` — mutation: rate
- `useReadyTableNight()` — mutation: ready
- `useRevealTableNight()` — mutation: reveal

All mutations should invalidate `queryKeys.tableNight.status(nightId)` on success.

**useTableNightRealtime.ts:**
- Subscribe to Supabase Realtime channel `table-night:{nightId}`
- Listen for changes on `table_night_participants` (filtered by table_night_id)
- Listen for changes on `table_nights` (filtered by id)
- On any change: invalidate TanStack Query cache for that night's status
- When `table_nights.status` changes to `revealed`: trigger a callback (for animations)
- Return cleanup function to unsubscribe

Pattern:
```typescript
const channel = supabase
  .channel(`table-night:${nightId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'table_night_participants',
    filter: `table_night_id=eq.${nightId}`,
  }, () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.tableNight.status(nightId)
    });
  })
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'table_nights',
    filter: `id=eq.${nightId}`,
  }, (payload) => {
    if (payload.new.status === 'revealed') {
      onReveal?.();
    }
    queryClient.invalidateQueries({
      queryKey: queryKeys.tableNight.status(nightId)
    });
  })
  .subscribe();
```

### Step 3: TableNightBanner (`components/table-night/TableNightBanner.tsx`)

Shown in the Tables tab when a Table Night is active. Uses `useActiveTableNight(tableId)`.
- If active night exists: show banner "Table Night at [restaurant] — Tap to join"
- Tapping navigates to `/table-night/[id]`
- Add this banner to `app/(tabs)/tables.tsx` above the activity feed

### Step 4: TableNightScreen (`app/table-night/[id].tsx`)

Full-screen route. Manages phase state machine:

```
waiting → rating → revealing → recap
```

- `waiting`: Show restaurant name, participant avatars (joined vs not), "Start Rating" when 2+ joined
- `rating`: Show RatingInput + "Lock It In" button + ParticipantList with ready checkmarks + "X/Y ready" count. Host sees "Reveal" button when all ready.
- `revealing`: CountdownReveal animation (3-2-1) → card flip showing all ratings
- `recap`: RecapStats display + "Add Note" + "Done" button that closes the night

### Step 5: Components (`components/table-night/`)

**ParticipantList.tsx**
- Row of avatar circles with name labels
- Ready state: checkmark overlay on avatar
- Count label: "3/5 ready"

**RatingInput.tsx**
- Half-star picker: 0.5 to 5.0
- Visual: row of 5 stars, tappable at half-star granularity
- Shows current selection prominently
- "Lock It In" confirmation button

**RevealAnimation.tsx**
- Triggered when status changes to `revealed`
- Phase 1: Countdown text "3... 2... 1..." (1 second each)
- Phase 2: Card flip animation for each participant
  - Cards start face-down (showing avatar)
  - All flip simultaneously using Reanimated `withTiming` + `rotateY` transform
  - Face-up side shows avatar + rating number
- Use `react-native-reanimated` SharedValue for flip progress

**RecapStats.tsx**
- Computed client-side from participant data after reveal
- Average score (mean of all ratings)
- Highest rater: name + score + 👑
- Lowest rater: name + score + 💀
- Closest to average: name
- Controversy score: standard deviation (< 0.5 = consensus, 0.5-1.0 = split, > 1.0 = divisive)

**TableNightBanner.tsx** (described in Step 3)

Barrel export all from `components/table-night/index.ts`.

### Step 6: Wire Up Realtime

- Connect `useTableNightRealtime` in `TableNightScreen`
- Verify on two test devices/browsers: when one user marks ready, the other sees it update
- When reveal is triggered, all clients transition to revealing phase

### Step 7: Activity Feed Integration

After reveal + "Done", the Table Night should appear in the Table's activity feed:
- The rebuilt `app/(tabs)/tables.tsx` renders the feed; `useTableActivity` returns both solo shares and table nights
- Table Night rows already get a distinct bordered-card treatment in the feed
- The `table-activity` edge function may need updating to include table night data when status is revealed

### Step 8: Test at Dinner

Use it with real friends. Two physical devices via Expo Go pointed at the same dev server.

## Database Schema Reference

These tables already exist in the database (created in migrations):

```sql
-- Core table night session
table_nights (id, table_id, restaurant_id, host_user_id, status, predictions_enabled, is_async, created_at, revealed_at)
-- status enum: 'rating', 'pre_reveal', 'revealed', 'closed'

-- Participants and their ratings
table_night_participants (table_night_id, user_id, rating, ready, notes)
-- rating: NUMERIC(2,1), nullable until rated
-- ready: BOOLEAN default false

-- Realtime is already configured:
-- ALTER PUBLICATION supabase_realtime ADD TABLE table_night_participants;
-- ALTER PUBLICATION supabase_realtime ADD TABLE table_nights;
```

Tables that exist but are NOT needed for v1 (ignore them):
- `table_night_predictions` — prediction game (v2)
- `table_night_dishes` / `table_night_dish_ratings` — dish-level ratings (v2)
- `table_night_photos` / `table_night_photo_likes` — photo management (v2)

## Things NOT to Build

Do not build any of the following. They are explicitly out of scope:

- Value Profiles (removed from product)
- Explore/Friends Feed (not the product)
- Prediction game phase
- Dish-level ratings
- Async/Quick Post mode
- Photo management UI (hero photo, sort, filter)
- Push notifications
- Share to Instagram Stories
- Table Wrapped annual stats
- Privacy settings matrix (friends/table/both visibility)
- Any public-facing review or feed feature

## Key Files to Read Before Starting

1. `napkin-app/constants/theme.ts` — Heirloom Journal design tokens (palette, typography, spacing, shadows)
2. `napkin-app/app/(tabs)/tables.tsx` — Reference implementation of the feed aesthetic and component patterns
3. `supabase/functions/table-management/index.ts` — Edge function pattern to follow
4. `hooks/tables/useTables.ts` — Query hook pattern
5. `hooks/tables/useCreateTable.ts` — Mutation hook pattern
6. `lib/queryKeys.ts` — Add table night keys here
7. `lib/supabase.ts` — Supabase client setup
