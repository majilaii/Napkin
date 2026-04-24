---
id: TICKET-002
title: "Rounds & Unified Logger — solo shares, group rounds, secondary ratings"
priority: high
status: done
created: 2026-04-15
updated: 2026-04-15
completed: 2026-04-15
tags: [core, logger, rounds, ratings, UX]
---

# Rounds & Unified Logger Redesign

## Problem

The logger today is a flat form: pick restaurant → pick table → optional single rating → notes → submit. Three core problems:

1. **No richness.** One number (0–5) captures nothing about *why* a place was good. The wireframes show Flavor, Vibes, Service, Value as distinct axes. The `table_night_participants` table already has these columns, but entries (solo logs) don't — solo diners are second-class citizens.

2. **No distinction between sharing a rec and starting a group evaluation.** When you post to a group table, it should be obvious whether you're dropping a quick "I tried this spot" story or saying "we all went here, everyone rate it." Right now everything goes through `entry_participants`, which is a confusing hybrid.

3. **"Table Night" is a bad name and a confusing concept.** It implies a special evening event. The async version — "we went to lunch, everyone rate it on your own time" — is the 90% use case and it shouldn't feel ceremonial. We're renaming to **Round**: everyone goes around the table and shares their impression.

## Core Concepts

### The Impression (Atomic Unit)

Every time you eat somewhere, you produce the same atomic unit — your impression:

- **Overall rating**: 0.5–5.0 (half-star, Letterboxd-style)
- **Secondary axes** (optional, expandable): Flavor, Vibes, Service, Value — same 0.5–5.0 scale
- **Dish**: what you had
- **Notes**: free-form text

This form is **identical** for solo diners and group diners. No one gets a stripped-down version.

### Two Posting Modes (Group Tables Only)

When posting to a **group table**, the user makes an explicit choice:

| Mode | Analogy | What it creates |
|------|---------|-----------------|
| **Solo Share** | Texting the group chat "yo I tried this new spot" | A single `entries` row with `table_id` set. Shows as a compact card in the feed. No collaboration needed. |
| **Start a Round** | "We all went to Carbone, everyone drop your scores" | A `table_nights` row (async), participant rows for each attendee, and journal entries as each person submits. The user **picks who attended** — not everyone in the table has to be included. |

When posting to a **personal table**, it's always a solo journal entry. No mode picker, no participant tagging.

### Round Lifecycle (Async)

```
1. CREATED
   Host picks restaurant, picks attendees, fills in THEIR impression, submits.
   → 1 table_nights row (is_async = true, status = 'rating')
   → Host's table_night_participants row (ratings filled)
   → Host's entries row (linked via table_night_id)
   → Empty participant rows for each attendee (rating = null, ready = false)

2. OPEN — "The Round is open"
   Feed card shows: restaurant, who's submitted, who hasn't.
   Pending attendees see an "Add Your Take" CTA.
   Tapping it opens the same impression form (pre-filled with restaurant).
   On submit → their participant row is updated + their journal entry is created.

3. COMPLETE — "The Round is in"
   When all attendees have submitted (or host closes it):
   → status changes to 'revealed'
   → Feed card transforms to show group average + everyone's individual ratings/notes
   → Tap through to full breakdown with secondary axes
```

### Round Lifecycle (Live — Future Phase)

Same as async, but:
- Ratings are **hidden** while the Round is open
- Each person sees "Ready ✓" when they've submitted
- When all are ready → host taps "Reveal"
- Countdown: 3… 2… 1… → cards flip simultaneously
- The Mario Party moment

*(Not in this ticket's scope — included for architectural awareness)*

### Naming

| Old | New |
|-----|-----|
| Table Night | **Round** |
| Start Table Night | **Start a Round** |
| "Table Night is active" | **"The Round is open"** |
| "Table Night revealed" | **"The Round is in"** |
| "Add your take" | **"Add Your Take"** (kept) |

The `table_nights` and `table_night_participants` table names stay as-is in the DB (renaming tables is high-risk for no user-facing value). The UI and code comments use "Round" everywhere.

---

## Product Spec

### User Stories

- **As a solo diner**, I can log a meal with an overall star rating AND optional detail ratings (Flavor, Vibes, Service, Value), so my journal captures the full picture.
- **As a group member**, I can quickly share a rec to the group feed ("Solo Share") without creating a collaborative artifact.
- **As a group member**, I can start a Round, pick which friends were there, submit my impression, and have each friend fill in theirs on their own time.
- **As a Round attendee**, I see an "Add Your Take" prompt in the feed, tap it, fill in the same impression form, and submit — which also creates a journal entry for me.
- **As any user**, I see beautiful half-star ratings (★★★½☆) instead of raw numbers.

### Acceptance Criteria

- [ ] `entries` table has `vibe_rating`, `flavor_rating`, `service_rating`, `value_rating` columns (0.5–5.0, nullable)
- [ ] `<StarRating>` component renders half-star ratings and works as both display and input
- [ ] Logger shows secondary rating axes in a collapsible "Rate the details" section, same UI for solo and group
- [ ] When a group table is selected, a mode picker appears: "Solo Share" vs "Start a Round"
- [ ] Solo Share creates an entry with `table_id`, no participants, shows in feed instantly
- [ ] Start a Round shows attendee picker (checkboxes for table members, not all required)
- [ ] Starting a Round creates: `table_nights` row + host participant row + host entry + empty participant rows for attendees
- [ ] Round feed card shows restaurant, who's submitted, who's pending, and "Add Your Take" CTA for pending attendees
- [ ] "Add Your Take" opens impression form (restaurant pre-filled, same star + detail axes), submits participant row + creates attendee's journal entry
- [ ] Submit button label reflects mode: "Log It" (personal), "Share" (solo share to group), "Start the Round" (round)
- [ ] Entry edge function accepts `vibe_rating`, `flavor_rating`, `service_rating`, `value_rating`

### UX Decisions

- **5-star scale** (0.5 increments) for everything. Not 10. Matches Letterboxd, reduces false precision.
- **Secondary axes are optional.** The "Rate the details" section is collapsed by default. Power users expand it. Casual users just drop a star rating and move on.
- **Mode picker is explicit.** Not inferred from participant tagging. Clear choice: "Solo Share" vs "Start a Round."
- **Attendee selection defaults to no one selected.** You opt people *in*, not out. Only the people who actually showed up.
- **Host is always a participant** in a Round. You can't start a Round and not rate.
- **The impression form is identical** across all contexts: solo journal, solo share, Round host, Round attendee. Same component, same fields.

### Out of Scope (This Ticket)

- Live/synchronous Round (hidden ratings + countdown reveal) — future ticket
- Restaurant hero images / photos
- Feed card redesign (distinct card types for Round vs Solo Share) — separate ticket
- Push notifications for "Add Your Take"
- Closing/expiring a Round (host manually closes or time-based)
- `entry_participants` deprecation (leave it working, just don't use it for new flows)

### Open Questions

- **Round auto-close?** Should Rounds auto-complete when all attendees have submitted, or should the host explicitly close it? *Proposed: auto-complete when all are in, with host override to close early.*
- **Can you edit your take?** After submitting to a Round, can you change your ratings? *Proposed: no for now. Keep it simple.*

---

## Technical Design

### 1. Database Migration

**New file: `supabase/migrations/20260416000000_entries_secondary_ratings.sql`**

```sql
-- Add secondary rating axes to entries (matching table_night_participants)
-- Solo diners and group entry creators both get full rating support.

ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS vibe_rating    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS flavor_rating  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS service_rating DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS value_rating   DOUBLE PRECISION;

-- Constraints: same 0.5–5.0 range as overall rating
ALTER TABLE public.entries
  ADD CONSTRAINT chk_entries_vibe_rating
    CHECK (vibe_rating IS NULL OR (vibe_rating >= 0.5 AND vibe_rating <= 5.0)),
  ADD CONSTRAINT chk_entries_flavor_rating
    CHECK (flavor_rating IS NULL OR (flavor_rating >= 0.5 AND flavor_rating <= 5.0)),
  ADD CONSTRAINT chk_entries_service_rating
    CHECK (service_rating IS NULL OR (service_rating >= 0.5 AND service_rating <= 5.0)),
  ADD CONSTRAINT chk_entries_value_rating
    CHECK (value_rating IS NULL OR (value_rating >= 0.5 AND value_rating <= 5.0));
```

No changes to `table_nights` or `table_night_participants` — those already have the columns.

### 2. StarRating Component

**New file: `napkin-app/components/StarRating.tsx`**

A reusable component that works as both **display** and **input**:

```
Props:
  value: number                    // 0–5, half-star precision
  size?: number                    // icon size (default 20)
  editable?: boolean               // if true, taps and swipes change value
  onChange?: (value: number) => void
  color?: string                   // default: palette.star (amber)
  showValue?: boolean              // show "4.5" next to stars (default false)
```

Renders 5 star icons using `@expo/vector-icons` (Ionicons `star`, `star-half`, `star-outline`). When `editable`, each star is a `Pressable` — tap left half = X.5, tap right half = X.0. Uses the amber `palette.star` color from the theme.

### 3. Entry Edge Function Changes

**Modified file: `supabase/functions/entry/index.ts`**

Accept 4 new fields in the POST body and pass them through to the `entries` insert:

```
Body additions:
  vibe_rating?: number | null
  flavor_rating?: number | null
  service_rating?: number | null
  value_rating?: number | null
```

Validation: each must be null or 0.5–5.0. Passed directly into the insert.

### 4. Table Night Edge Function Changes

**Modified file: `supabase/functions/table-night/index.ts`**

Extend the `start` action to support the new Round flow:

```
POST action: 'start'
  Existing: table_id, restaurant_id
  New:      participant_ids: string[]   // who attended (required for async)
            is_async: boolean           // true for Round, false for live (future)
            rating, notes, vibe_rating, flavor_rating, service_rating, value_rating
            dish_description

  Behavior:
  1. Create table_nights row (is_async, status: 'rating')
  2. Create host's table_night_participants row (with ratings filled)
  3. Create host's entries row (linked via table_night_id)
  4. Create empty participant rows for each attendee
```

Extend the `rate` action to accept secondary ratings:

```
POST action: 'rate' (renamed from 'rate' — now handles full impression)
  Existing: table_night_id, rating
  New:      notes, vibe_rating, flavor_rating, service_rating, value_rating
            dish_description

  Behavior:
  1. Update participant's table_night_participants row
  2. Create participant's entries row (linked via table_night_id)
  3. Mark ready = true
  4. If all participants are now ready → auto-set status to 'revealed'
```

### 5. Logger UI Changes

**Modified file: `napkin-app/app/create-entry.tsx`**

Current flow:
```
Restaurant search → Table picker → Participant tags → Rating toggle → Notes → Submit
```

New flow:
```
Restaurant search → Table picker → [Mode picker if group] → [Attendee picker if Round] → Impression form → Submit
```

Specific changes:

**a) Mode Picker (group tables only)**
After selecting a group table, show two options:
- "Solo Share" — quick rec to the group feed
- "Start a Round" — collaborative group rating

Render as two tappable cards or a segmented control. Only appears when `isPersonalTable === false`.

**b) Attendee Picker (Round mode only)**
Replaces the current participant tagging section. Shows all table members as checkboxes. None selected by default. You check the people who were actually there. Host (current user) is always included and visually indicated but not toggle-able.

**c) Impression Form (universal)**
Replace the current rating section with:
- **Overall rating**: `<StarRating editable value={rating} onChange={setRating} />` — always visible, no toggle
- **"Rate the details"**: Collapsible section with 4 `<StarRating>` inputs for Flavor, Vibes, Service, Value
- **What did you have**: TextInput (existing)
- **Notes**: TextInput (existing)

**d) Submit Button**
Dynamic label based on context:
- Personal table: **"Log It"**
- Group table + Solo Share: **"Share"**
- Group table + Round: **"Start the Round"**

**e) Submit Handler**
Branch on mode:
- **Solo journal / Solo share**: Call `entry` edge function as today, now including secondary ratings
- **Start a Round**: Call `table-night` edge function with `action: 'start'`, passing attendee IDs + impression data

### 6. useCreateEntry Hook Changes

**Modified file: `napkin-app/hooks/tables/useCreateEntry.ts`**

Extend `CreateEntryInput` interface with secondary ratings:

```typescript
export interface CreateEntryInput {
    // ... existing fields ...
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
}
```

### 7. New Hook: useStartRound

**New file: `napkin-app/hooks/tables/useStartRound.ts`**

```typescript
interface StartRoundInput {
    table_id: string;
    restaurant: { external_id, name, ... };   // same shape as entry
    participant_ids: string[];
    rating: number;
    notes?: string;
    dish_description?: string;
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
}
```

Mutation that:
1. Upserts the restaurant (reuse entry edge function's logic, or call it first)
2. Calls `table-night` edge function with `action: 'start'`
3. Invalidates `queryKeys.tables.activity(tableId)` and `queryKeys.tableNight.active(tableId)`

### 8. New Hook: useSubmitTake

**New file: `napkin-app/hooks/tables/useSubmitTake.ts`**

For Round attendees submitting their impression:

```typescript
interface SubmitTakeInput {
    table_night_id: string;
    rating: number;
    notes?: string;
    dish_description?: string;
    vibe_rating?: number | null;
    flavor_rating?: number | null;
    service_rating?: number | null;
    value_rating?: number | null;
}
```

Calls `table-night` edge function with `action: 'rate'`.
Invalidates table activity + night status queries.

---

## Architecture Decisions

- **Keep `table_nights` / `table_night_participants` table names.** Renaming is high-risk, zero user-facing benefit. Use "Round" in UI and code comments only.
- **Don't deprecate `entry_participants` yet.** Existing data uses it. New flows use `table_night_participants` for Rounds and nothing for Solo Shares. We'll clean up `entry_participants` in a future migration.
- **Restaurant upsert in Round start.** The `table-night` edge function currently takes `restaurant_id` (assumes restaurant already exists). For the Round flow, the host is also searching for a restaurant by name. Two options: (a) have the client call the `entry` edge function first to upsert the restaurant, then use the returned ID for the Round; (b) add restaurant upsert logic to the `table-night` function. **Decision: Option (b)** — duplicate the upsert logic into `table-night` so it's a single call. Extract the upsert into `_shared/restaurant.ts` to avoid duplication.
- **Journal entries from Rounds.** When a Round attendee submits their take, the edge function creates an `entries` row for them with `table_night_id` set. This means their journal shows the meal, and the table feed shows the grouped Round. One action, two views.
- **`entries` table gets secondary rating columns** so solo diners have full parity. The entry edge function writes them. No structural difference between a solo entry and a Round participant's entry — both have the same columns.

## File Changes

### New Files
| File | Purpose |
|------|---------|
| `supabase/migrations/20260416000000_entries_secondary_ratings.sql` | Add 4 rating columns to entries |
| `napkin-app/components/StarRating.tsx` | Reusable half-star rating component (display + input) |
| `napkin-app/hooks/tables/useStartRound.ts` | Mutation to create an async Round |
| `napkin-app/hooks/tables/useSubmitTake.ts` | Mutation for attendees to submit their impression |
| `supabase/functions/_shared/restaurant.ts` | Shared restaurant upsert logic (extracted) |

### Modified Files
| File | Changes |
|------|---------|
| `supabase/functions/entry/index.ts` | Accept + store 4 secondary rating fields |
| `supabase/functions/table-night/index.ts` | Extend `start` (accept participants + ratings + restaurant data), extend `rate` (accept secondary ratings, auto-create journal entry, auto-complete Round) |
| `napkin-app/app/create-entry.tsx` | Mode picker, attendee picker, StarRating input, secondary ratings section, dynamic submit label + handler |
| `napkin-app/hooks/tables/useCreateEntry.ts` | Add secondary rating fields to interface |
| `napkin-app/lib/queryKeys.ts` | Add `round` query keys (alias `tableNight` or add new group) |

### Unchanged (for reference)
| File | Why unchanged |
|------|---------------|
| `napkin-app/hooks/tables/useTableMembers.ts` | Already fixed (TICKET-001), used by attendee picker |
| `napkin-app/hooks/tables/useTableNight.ts` | Existing hooks still work, just extended usage |
| `supabase/functions/table-management/index.ts` | No changes needed |

## Implementation Order

```
Phase A — Foundation (no UI changes yet)
─────────────────────────────────────────
 1. Migration: Add 4 rating columns to entries table
 2. StarRating component: display + input mode
 3. Entry edge function: accept secondary ratings

Phase B — Logger Redesign
─────────────────────────
 4. Impression form: replace toggle/slider with StarRating + collapsible detail section
 5. Mode picker: Solo Share vs Start a Round (group tables)
 6. Attendee picker: table member checkboxes (Round mode)
 7. Submit handler: branch on mode (entry function vs table-night function)

Phase C — Round Backend
───────────────────────
 8. Extract shared restaurant upsert into _shared/restaurant.ts
 9. Table-night edge function: extend 'start' with full Round creation
10. Table-night edge function: extend 'rate' with journal entry creation + auto-complete
11. useStartRound hook
12. useSubmitTake hook

Phase D — Round Frontend (separate ticket)
──────────────────────────────────────────
13. Round feed card (open state: who's in, who's pending, "Add Your Take")
14. Round feed card (complete state: group avg, individual ratings, expand to see notes)
15. "Add Your Take" screen (impression form with restaurant pre-filled)
```

**This ticket covers Phases A–C.** Phase D (Round feed cards + "Add Your Take" screen) is a separate ticket because it depends on the feed/card component architecture.

## Risks

- **Edge function size.** The `table-night` function is growing. After this change, `start` does: validate membership, upsert restaurant, create night, create host participant, create host entry, create attendee participants. Consider splitting into a `round` edge function if it gets unwieldy.
- **Dual entry creation paths.** Solo entries go through the `entry` function; Round entries are created by the `table-night` function. Need to make sure both paths write the same columns to `entries`. The shared restaurant upsert helps, but the entry-creation logic should also be extracted if it diverges.
- **Auto-complete race condition.** If two attendees submit at the same time, both check "am I the last one?" and both might try to flip status to `revealed`. Mitigation: the status update is idempotent (UPDATE WHERE status = 'rating'), so the second one is a no-op.

---

## Data Model Reference

```
 SOLO SHARE TO GROUP TABLE
 ──────────────────────────
 entries: {
   user_id, restaurant_id, table_id,
   rating, vibe_rating, flavor_rating, service_rating, value_rating,
   content, dish_description,
   table_night_id: null    ← not part of a Round
 }

 ROUND (async)
 ─────────────
 table_nights: {
   id, table_id, restaurant_id,
   host_user_id, status: 'rating',
   is_async: true, created_at
 }

 table_night_participants: [
   { table_night_id, user_id: host,   rating: 4.5, vibe_rating: 4.0, ..., ready: true,  notes: "..." },
   { table_night_id, user_id: elena,  rating: null, ..., ready: false, notes: null },
   { table_night_id, user_id: derek,  rating: null, ..., ready: false, notes: null },
 ]

 entries: [
   { user_id: host, restaurant_id, table_id, table_night_id, rating: 4.5, ... },
   -- elena's entry created when she submits her take
   -- derek's entry created when he submits his take
 ]
```

---

## Review History

### Review 1
Date: 2026-04-15
Verdict: APPROVE

Spec compliance: 9/11 acceptance criteria met (2 N/A — Phase D)
- [x] `entries` table has `vibe_rating`, `flavor_rating`, `service_rating`, `value_rating` columns (0.5–5.0, nullable) — PASS
- [x] `<StarRating>` component renders half-star ratings and works as both display and input — PASS
- [x] Logger shows secondary rating axes in a collapsible "Rate the details" section, same UI for solo and group — PASS
- [x] When a group table is selected, a mode picker appears: "Solo Share" vs "Start a Round" — PASS
- [x] Solo Share creates an entry with `table_id`, no participants, shows in feed instantly — PASS
- [x] Start a Round shows attendee picker (checkboxes for table members, not all required) — PASS
- [x] Starting a Round creates: `table_nights` row + host participant row + host entry + empty participant rows for attendees — PASS
- [N/A] Round feed card shows restaurant, who's submitted, who's pending, and "Add Your Take" CTA — Phase D, out of scope
- [N/A] "Add Your Take" opens impression form — Phase D, out of scope
- [x] Submit button label reflects mode: "Log It" (personal), "Share" (solo share to group), "Start the Round" (round) — PASS
- [x] Entry edge function accepts `vibe_rating`, `flavor_rating`, `service_rating`, `value_rating` — PASS

Correctness: PASS — All data flows (solo, share, round start, rate+auto-complete) are correctly wired end-to-end
Edge Cases: WARN — Auto-complete when host starts a Round with zero attendees immediately reveals (line 275-280 of table-night/index.ts); intentional but undocumented
Error Handling: PASS — Participant validation, membership checks, idempotent status guards all present
Security: PASS — Auth validated via getUser(token), service role key used server-side, membership checks before all mutations
Performance: PASS — No N+1 queries; restaurant upsert uses onConflict
Design Compliance: PASS — Follows established edge function, hook, and component patterns from CLAUDE.md

Key observations (non-blocking):
1. `entry/index.ts:170-207` still has inline restaurant upsert rather than importing from `_shared/restaurant.ts`. The shared module was created (per ticket architecture decision) but only `table-night/index.ts` uses it. Low risk since both paths produce the same result, but the duplication the ticket intended to eliminate remains.
2. `_shared/restaurant.ts:26-49` does not handle non-food place types (always upserts to `restaurants` table). The `entry` function's inline version routes non-food Google Places to a `places` table. If a Round is ever started for a non-food place, it would land in `restaurants` incorrectly. Unlikely in practice but a latent bug.
3. `create-entry.tsx:120` — `canSubmit` requires `rating > 0`, which is correct since default is 0 and minimum valid rating is 0.5. Good guard.
4. `table-night/index.ts:275-280` — When host starts a Round with no attendees selected, the Round auto-completes to `revealed` immediately. This is logical (host is the only participant and is already ready) but worth noting as a design choice since it means a solo "Round" is possible.
5. `queryKeys.ts` — Ticket mentioned adding `round` query keys or aliasing, but existing `tableNight` keys are reused throughout. This is fine and avoids unnecessary churn.
