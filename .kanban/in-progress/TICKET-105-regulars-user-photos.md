---
id: TICKET-105
title: "Regulars: user entry photos only — never restaurant/Google photos"
priority: high
status: in-progress
created: 2026-07-05
updated: 2026-07-05
tags: [profile, doctrine, edge-fn]
---

# Regulars: user entry photos only

## Problem
Profile "your regulars" (RegularsRail on profile + app/regulars.tsx via RegularRow) renders `restaurants.photo_url` — Google Places photos. Founder doctrine (2026-07-05): no restaurant photos anywhere right now; a regular's thumb may only be a photo the profile owner uploaded on one of their own entries at that restaurant, else no photo.

## Fix spec
1. `supabase/functions/user-profile/index.ts`: in the regulars payload assembly, stop sourcing `photo_url` from `restaurants`. Instead batch-fetch the profile owner's most recent entry photo per regular restaurant (entry_photos joined to their entries at those restaurant ids, newest first, first per restaurant — ONE batched query, no N+1). Respect existing visibility gates: for non-self viewers, only photos from entries that the fn's existing public gates already expose (reuse the same predicate/helpers in gates.ts that gate public reviews/diary); self view may use any own entry photo. Field stays `photo_url: string | null` — semantic swap only, no shape change.
2. Client fallback: `RegularsRail.tsx` + `RegularRow.tsx` currently render an empty grey box when photo_url is null — replace with a quiet monogram (restaurant initial, Newsreader italic, muted, on surfaceJournalLow) so photo-less regulars read as designed, not broken. All colors via theme tokens.
3. Do NOT touch other profile sections (cover photo, spots, dining map) even if they use restaurant photos — this ticket is regulars only.

## Build Log
### Files Changed
- `supabase/functions/user-profile/index.ts` — `fetchRegulars()`: dropped `photo_url` from the `restaurants` select (now `id, name, city` only). Added a single batched `entry_photos` query joined to the profile owner's OWN entries (`entries!inner`, `.eq('entries.user_id', userId)`, `.in('entries.restaurant_id', regularRestaurantIds)`), ordered `created_at DESC`, keeping the first (most recent) photo per restaurant. `photo_url` in the returned `RegularSummary` now comes from `photoByRestaurant`, else `null`. Serves both the `profile` action (8-item preview) and the `regulars` action (200-item full list), since both call `fetchRegulars`.
- `supabase/functions/user-profile/index.test.ts` — added a documenting (skipped) test step pinning the TICKET-105 photo-source semantics (owner's own entry photo, never `restaurants.photo_url`; non-self viewers gated to non-private entries). Matches the file's existing skipped-stub convention.
- `napkin-app/components/profile/RegularsRail.tsx` — when `photo_url` is null, the 72px card photo area now renders a quiet monogram (restaurant initial, `Newsreader_400Regular_Italic` @ 28px, `palette.textMuted`, on `palette.surfaceJournalLow`) instead of an empty deep-cream box. Visit pill unchanged (still top-right).
- `napkin-app/components/profile/RegularRow.tsx` — same monogram fallback for the 56px thumb (initial @ 22px). Added a `monogram` style (absolute-fill centered).

No app-side type change: both `RegularSummary` definitions (edge `index.ts` and `napkin-app/hooks/users/useUserProfile.ts`) already declare `photo_url: string | null` — this is a pure semantic swap, no wire-shape change, so no hook/type edits were needed (verified).

### How gating is respected for public viewers
- `fetchRegulars(supabase, userId, includePrivate, limit)` is called with `includePrivate = isSelf` at every call site (unchanged). The photo query mirrors the existing entries aggregation exactly: `if (!includePrivate) photoQuery = photoQuery.neq('entries.visibility', 'private')`. So a non-self (public) viewer never receives a photo sourced from a private entry — same `visibility != 'private'` predicate the fn already applies to the visit-count aggregation and that `fetchDiary`/reviews apply for public reads (TICKET-093(a) semantics).
- The `regulars` and `profile` actions already gate NON-self access up-front via `fetchBlockState` + `computeRelationship` + `strangerCanReadPalate` (unchanged in this ticket). A stranger with no public access never reaches `fetchRegulars` at all; if they do reach it, `includePrivate` is `false`.
- Photos are scoped to the profile OWNER's own entries only (`.eq('entries.user_id', userId)`) — a viewer never sees a tablemate's or stranger's photo surfacing as the owner's regular. No cross-user photo leak path.

### Tests
- `deno test --allow-env supabase/functions/user-profile/` — **14 passed / 0 failed** (13 gates.test.ts + 1 index.test.ts group with 11 steps, incl. the new TICKET-105 doc step). Deno also type-checks the imported `index.ts` on `Check` — green.
- `npx tsc --noEmit` (from `napkin-app/`, node_modules symlinked from main repo) — **5 errors, all pre-existing in untouched files** (`app/_layout.tsx` tuple error; 4 in `components/wishlist/__tests__/*`). Zero errors in the three touched app/edge files. Matches the documented baseline.
- No jest tests exist for `components/profile/*` (no `__tests__` dir), so nothing to run there.
- `git diff --name-only` = exactly the 4 expected files (+ this ticket).

### Builder Questions
- None. Design read: monogram = restaurant initial in Newsreader italic on `surfaceJournalLow`, muted — reads as an intentional typographic placeholder, consistent with the brand's italic-serif-for-names rule, not a broken image slot. No new tokens introduced; all colors via `palette.*`.
