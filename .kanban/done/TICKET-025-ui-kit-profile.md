---
id: TICKET-025
title: "Apply Heirloom UI kit — Profile (You tab)"
priority: high
status: done
completed: 2026-04-20
created: 2026-04-20
updated: 2026-04-20
tags: [ui, design-system, profile]
---

# Apply Heirloom UI kit — Profile (You tab)

## Problem
Migrate the Profile / "You" tab and related navigation to the Heirloom Journal UI kit. The feed is already done.

## Scope
- `app/(tabs)/friends.tsx` (or whichever tab now hosts the self/You view) — canonical self-view, populated
- Cold-start self-view (new user, no Top 4 yet)
- Stranger/public profile (`app/u/[id].tsx` or equivalent) — viewing someone else
- Diary full-screen (Letterboxd-style scroll-back, all entries chronological)
- Regulars full-screen (≥3 visits, restaurant-specific)
- Privacy controls screen
- Profile navigation entry points (header, settings glyph)

Philosophy from the canvas:
- **Top 4** = aspirational / curated (full posters, Letterboxd-faithful)
- **Regulars** = who you actually are (≥3 visits)
- Public by default once account is opted in; opt-out per section
- Diary is chronological scroll-back

## Design sources
Bundle: `~/Downloads/napkin-design-system/`
- `project/ui_kits/napkin-app/profile-canvas.jsx` / `.html` — 6 artboards
- `project/ui_kits/napkin-app/profile-navigation-canvas.jsx` / `.html` — navigation flows
- Root-level `project/profile-canvas.jsx` if it differs
- `project/ui_kits/napkin-app/primitives.jsx`
- `project/README.md` — voice, casing, iconography

## Notes
- Account-level privacy is master switch. Don't introduce per-log toggles.
- Tables are **never** surfaced publicly on a profile — even in opted-in mode, Table activity must stay in the Table ring.
- Reuse existing hooks (`useUserProfile.ts` etc.); this is a visual pass.

## Coordination
Owned by: Claude Code terminal working on **profile**. Do not touch logger (TICKET-023) or tables (TICKET-024) files.

---

## Technical Design

### Approach
Rebuild the profile surface as a Heirloom Journal editorial layout. The canvas landed on **Option C (Index navigation)**: Hero → Top 4 → Regulars → `— INDEX` (Diary / Reviews / Lists / Wishlist / Likes). The merged self-and-stranger screen (`app/(tabs)/profile.tsx` + `app/u/[identifier].tsx`) already shares `components/profile/*` — we keep that shared-component pattern and redo those components visually. Diary and Regulars full-screens are new routes. Privacy controls become a "Who sees what" per-section grid screen replacing the current `/settings/privacy.tsx` form layout, but per doctrine (CLAUDE.md) the per-section pickers drive a **single underlying toggle** — account-level privacy — presented as per-section visual affordances with an explanatory footer (no new DB columns).

### Architecture Decisions

- **Share one screen body between `(tabs)/profile.tsx` and `u/[identifier].tsx`** because they already compose the same components. Extract a single `<ProfileScreenBody />` that both mount. Trade-off: one more component file, but kills the current drift between self-tab and public routes (the tab currently hardcodes `is_self`).

- **Ship Top 4 + Regulars as presentational components that read from `useUserProfile`**, not as separately-queried hooks, in Phase 1. The edge function already has entry/restaurant data; extend `user-profile` `profile` action to compute `top_four` (auto-derived) and `regulars_preview` (derived ≥3 visits). Trade-off: one fatter payload vs. N+1 round-trips on profile open. Matches existing `useUserProfile` shape.

- **Top 4 is auto-derived, no new schema.** Computed server-side as the user's top-rated restaurants: filter entries to the user's personal-Table logs (or all their own logs if opted-in), group by `restaurant_id`, take the **max rating per restaurant** (or avg if multiple logs — use max for aspirational framing), require rating ≥ 4.0, then order by rating desc, `visit_count desc` as tiebreaker, then `last_visited_at desc` as secondary tiebreaker, limit 4. If fewer than 4 qualify, the UI renders the remainder as empty frames. Regulars is derived separately from `entries` where `count(*) >= 3` grouped by restaurant_id. Trade-off: loses the "curator" framing — the user can't pin a personal-significance pick that happens to be a 3.9. Curated persistence is a follow-up ticket.

- **Diary full-screen uses its own query (`useUserDiary`)**, not the profile payload. Reason: diary is paginated chronological history (potentially hundreds of rows), wrong to bundle with profile. Regulars full-screen can reuse the `regulars` field from `useUserProfile` plus one extended fetch for rows beyond the rail slice (`useUserRegulars`). Trade-off: 2 more edge-function actions, but each is justified by pagination / list size.

- **Privacy controls screen is visual-only expansion of existing model.** The canvas shows per-section Public/Friends/Private pickers, but CLAUDE.md doctrine locks us to an account-level master switch + per-list `privacy`. We render the per-section grid as **read-only affordances grouped under the master toggle**: Top 4 / Regulars / Reviews / Stats follow the account switch; Lists shows "per-list, managed in Lists" with a deep link; Diary/Likes show "follows account privacy." Trade-off: the UI lies slightly about granularity vs. what the doctrine allows — we compensate with a clear footer line ("Everything follows your account switch. Lists are per-list."). No new backend work; ships the intent without re-opening the privacy model.

- **Heirloom tokens already exist**; this is a visual refinement pass, not a token extension. No new entries in `constants/theme.ts`.

### File Changes

**Screens**
- `napkin-app/app/(tabs)/profile.tsx` — MODIFY — thin wrapper that mounts `<ProfileScreenBody identifier={user.id} inTab />`.
- `napkin-app/app/u/[identifier].tsx` — MODIFY — mounts `<ProfileScreenBody identifier={identifier} />` with back-nav chrome.
- `napkin-app/app/diary.tsx` — NEW — Diary full-screen (Artboard 4). Month-grouped SectionList, year summary band, day-number left rail.
- `napkin-app/app/regulars.tsx` — NEW — Regulars full-screen (Artboard 5). Ranked list, ×N visits in terracotta, subtitle "Places you've logged three or more times."
- `napkin-app/app/settings/privacy.tsx` — MODIFY — rebuild as "Who sees what" per-section grid over the existing master-toggle data. Keep username flow intact.

**Components — all under `napkin-app/components/profile/`**
- `ProfileScreenBody.tsx` — NEW — composes header + sections, reads `useUserProfile`, handles relationship gating.
- `ProfileHeader.tsx` — MODIFY — repaint to canvas: avatar left + identity block right, serif italic display name, identity numbers row (followers / following / places). Keep gear icon for self. **No follow CTA and no "X others follow" social proof** — follow graph isn't shipped yet; strangers see identity + counts only. The follow affordance lands when follow ships.
- `TopFour.tsx` — NEW — 4-up grid of posters with rating badge + italic caption. Auto-derived from `top_four` in profile payload — **no EDIT label, no edit sheet, no editability in this ticket**. Empty-state 4-slot dashed frame for cold-start (Artboard 2); partially-filled state renders real posters for qualifying picks and dashed frames for the remainder.
- `RegularsRail.tsx` — NEW — horizontal rail of 138px cards with visit count pill. Empty-state locked panel for cold-start ("Regulars unlock after your third visit.").
- `ProfileIndex.tsx` — NEW — editorial INDEX block: rows with title · count · italic hint · chevron. Rows: **Diary** (tappable → `/diary`), **Reviews** (disabled placeholder — muted text + italic hint `— coming soon`, no chevron, no `onPress`), **Lists** (tappable → existing lists screen), **Wishlist** (tappable → existing wishlist), **Likes** (disabled placeholder — same treatment as Reviews). Disabled rows stay in the INDEX for visual completeness per canvas, but are visually de-emphasized (muted text color, reduced opacity on the row container).
- `SectionHeader.tsx` — NEW — shared italic serif section header with optional right-label (Type.headlineItalic size 17).
- `DiaryRow.tsx` — NEW — used inside `app/diary.tsx`; day/weekday left rail + optional thumb + restaurant + rating.
- `RegularRow.tsx` — NEW — used inside `app/regulars.tsx`; 56px thumb + name + neighborhood + last visit + avg rating + ×N.
- `PrivacyPicker.tsx` — NEW — visual 3-way segmented (Public / Friends / Private) used inside privacy screen. Read-only or delegates to the master toggle.
- `PalateSection.tsx` — REMOVE (replaced by TopFour + RegularsRail + ProfileIndex composition).
- `PalateStatsStrip.tsx` — REMOVE (numbers moved into hero row per canvas — no double-counting).
- `PublicListsSection.tsx` — REMOVE (lives behind the INDEX → Lists row now).
- `RecentlyLoggedGrid.tsx` — REMOVE (replaced by Diary section hint + the full Diary screen).
- `TablesInCommonSection.tsx` — KEEP but render **below** the ProfileIndex and only for self or `tables_in_common` / `public_and_tables` relationships. Tables never surface on a public profile (doctrine).
- `NotFoundState.tsx` — KEEP.

**Hooks**
- `napkin-app/hooks/users/useUserProfile.ts` — MODIFY — extend `UserProfileData` with `top_four: TopPick[]` (0–4 entries, auto-derived) and `regulars_preview: RegularSummary[]` (up to 8). Type additions only; query key unchanged.
- `napkin-app/hooks/users/useUserDiary.ts` — NEW — paginated (cursor on `visited_at`) diary rows grouped by month for the target user. Gated by relationship (self + public).
- `napkin-app/hooks/users/useUserRegulars.ts` — NEW — full regulars list (≥3 visits) sorted by visit_count desc.

**Edge function**
- `supabase/functions/user-profile/index.ts` — MODIFY — add `regulars_preview` + `top_four` (auto-derived) to the `profile` action response. Add new actions: `diary` (paginated), `regulars` (full list).

**Database**
- No schema changes in this ticket. Regulars derivation benefits from an index on `entries(user_id, restaurant_id)` — verify it exists; if not, add a standalone migration.

**Query keys**
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `users.diary(userId, cursor)` and `users.regulars(userId)`.

### Component Mapping (artboard → RN)

| Artboard | Screen/Component | Sub-components |
|---|---|---|
| 1 · Canonical self | `ProfileScreenBody` in `(tabs)/profile.tsx` | `ProfileHeader` (self, gear icon), `TopFour` (auto-derived), `RegularsRail`, `ProfileIndex` (Diary/Lists/Wishlist active; Reviews/Likes disabled), `TablesInCommonSection` |
| 2 · Cold-start | Same body, empty-state branches inside `TopFour` and `RegularsRail` + a new `FirstReviewNudge` inline in `ProfileScreenBody` | `ProfileHeader` with zero-counts, `TopFour picks=empty`, `RegularsRail` locked panel |
| 3 · Stranger | `ProfileScreenBody` in `u/[identifier].tsx` | `ProfileHeader` (identity + counts only — no follow CTA), `TopFour` (auto-derived, non-editable), `RegularsRail`, `ProfileIndex` (Reviews/Likes disabled; no Tables) |
| 4 · Diary full | `app/diary.tsx` | `SectionList` with month headers, `DiaryRow`, `YearSummaryBand` (inline) |
| 5 · Regulars full | `app/regulars.tsx` | `FlatList` of `RegularRow`, subtitle band |
| 6 · Privacy | `app/settings/privacy.tsx` (rebuilt) | `PrivacyPicker` per row, master-toggle footer, existing reply-permission + profile-editor sections preserved below |

### Routing / Navigation

- New routes: `/diary` and `/regulars` — top-level stack routes (not tabs), pushed from `ProfileIndex` rows and the `RegularsRail` "SEE ALL" label.
- `/settings/privacy` stays as-is; internals change.
- Stranger profile stays at `/u/[identifier]`.
- Tab hosts self-view: `(tabs)/profile.tsx` — unchanged routing.
- Both Diary and Regulars take an optional `?userId=<uuid>` (omit = self). Self is the only case for Phase 1; public support lands when the relationship gate permits (stranger Diary is in the canvas but gated server-side).

### Data Sources

- Profile aggregate → `useUserProfile` (existing) + new `top_four` (auto-derived) / `regulars_preview` fields from extended edge function.
- Diary full → new `useUserDiary` hook / `user-profile` action `diary` (paginated on `visited_at desc, created_at desc`).
- Regulars full → new `useUserRegulars` hook / action `regulars` (single fetch, ≤200 rows expected even for heavy users).
- No Top 4 mutation. No new Places-API or other external calls.

### Tokens / Voice

- Tokens already present: `Colors.primary` (terracotta), `Colors.textMuted`, `Colors.surfaceContainerLow`, `Radius.sm/md/full`, `Shadow.subtle/note`, `Type.headlineItalic`, `Type.labelSmall`. No new tokens needed.
- Font: italic Newsreader for restaurant names, section headers, hints flagged `emphasis: true`; Manrope for counts, labels, metadata.
- Voice per README: lowercase verbs (`tried`, `noted`, `pinned`), middle-dot metadata separator, em-dash pull quotes, uppercase section labels (`— INDEX`, `SEE ALL`), Title Case screen titles (`Diary`, `Your regulars`, `Who sees what`). No emoji in chrome.
- Ratings render as `4.2` italic serif + muted ` / 5` (existing `StarRating` does not match — use a new inline `<Rating>` helper in `components/profile/` that mirrors the canvas).
- Visit count pill color: existing tokens don't have `sanguine`; use `Colors.primary` (terracotta) for the ×N pill — matches the canvas note ("×N visit count in terracotta").

### Implementation Order

1. **Edge function extensions** — extend `user-profile` `profile` action with auto-derived `top_four` + `regulars_preview`; add new actions `diary` (paginated) and `regulars` (full list). No schema migration. Unblocks everything UI-side.
2. **Shared atoms** — `SectionHeader`, inline `Rating`. Cheap and used everywhere below.
3. **`ProfileScreenBody` + `ProfileHeader` repaint** — lift current tab/public screens onto the shared body. Purely visual at this stage.
4. **`TopFour` (auto-derived) + `RegularsRail`** — both read from profile payload. Build together since they share the poster/card visual language.
5. **`ProfileIndex`** — wire active rows (Diary, Lists, Wishlist) to counts + navigation; render Reviews and Likes as disabled muted rows with `— coming soon` hint.
6. **Diary full-screen** — `useUserDiary` + `app/diary.tsx` + `DiaryRow`.
7. **Regulars full-screen + cold-start branches + privacy rebuild** — `useUserRegulars` + `app/regulars.tsx` + `RegularRow`; empty states in `TopFour` / `RegularsRail` / first-review nudge; rebuild `/settings/privacy` layout on top of existing mutations.

### Non-goals (explicit)

- **No Table activity on public profile.** `TablesInCommonSection` renders only for self / `tables_in_common` / `public_and_tables` (already gated). Public view never shows any Table data.
- **No per-log privacy toggle.** The privacy screen's per-section pickers are visual affordances over the account-level master toggle (doctrine).
- **No account-privacy model rewiring.** TICKET-020 shipped this; we only repaint.
- **No Top 4 Dishes.** Parked in canvas note — revisit when dish tagging lands.
- **No geographic map.** Parked with feed-map.
- **No stranger-Diary or stranger-Regulars in Phase 1.** Route exists and server path is gated, but the UI entry points are only wired for self. Public access lands as a fast-follow once copy/empty-states are reviewed.

### Risks

- **Edge-function payload growth**: adding `top_four` (up to 4 restaurants) + `regulars_preview` (up to 8 restaurants) roughly doubles the profile payload. Mitigation: both are thin (id/name/photo/rating/visits); cap `regulars_preview` server-side at 8.
- **Privacy UI lying about granularity**: users may expect the per-section Friends/Private pickers to actually work. Mitigation: footer copy ("Everything follows your account switch. Lists are per-list.") + only the Lists row is interactive (deep-links to per-list settings).
- **Auto-derived Top 4 feels impersonal**: a user's top-4-by-rating may not match what they'd curate (e.g., 4 new hype spots beat out a sentimental local). Mitigation: explicit follow-up ticket for curated picks; cutoff of ≥ 4.0 prevents filler; partial fill (empty frames) communicates "this is derived, not final."
- **Regulars derivation cost**: ≥3 visits grouped by restaurant is cheap at our data sizes but will need an index on `entries(user_id, restaurant_id)` if it doesn't already exist. Mitigation: verify and add index in a standalone migration if missing.

## Scope Decisions

These three decisions were made between the initial design and build. Recorded here so future work (and reviewers) understand why the shipped surface is narrower than the canvas implies.

1. **Reviews and Likes rows are disabled placeholders, not carved screens.** Those routes don't exist in the app tree and aren't in this ticket's scope. Render them in `ProfileIndex` as muted, non-tappable rows with an `— coming soon` italic hint so the INDEX still matches the canvas visually. Don't build `/reviews` or `/likes` screens in this ticket.

2. **Top 4 is auto-derived, not curator-edited.** The canvas implies curator-pinned picks, but that requires a new table (`profile_top_picks`), an edit sheet, a mutation hook, and a new edge-function action — out of scope for a "visual pass, reuse existing hooks" ticket. Instead: compute Top 4 server-side in the `profile` action as `rating desc, visit_count desc, last_visited_at desc`, cutoff `rating >= 4.0`, limit 4. Under-filled state renders empty frames for the remaining slots. No `EDIT` affordance anywhere in this ticket. Curator-driven picks are a follow-up ticket.

3. **No Follow CTA on stranger profiles yet.** There is no follow graph shipped. Rendering a placeholder button or "X others follow" social-proof line would be misleading. `ProfileHeader` for `relationship === 'public_only'` shows avatar + identity + account-level numbers only. The follow affordance lands when follow ships — not before.

---

## Build Log

### Files Created

- `napkin-app/app/diary.tsx` — Diary full-screen (Artboard 4): SectionList with month headers + year summary band + paginated fetch via useUserDiary; takes optional `?userId` param
- `napkin-app/app/regulars.tsx` — Regulars full-screen (Artboard 5): FlatList of RegularRow, subtitle band; takes optional `?userId` param
- `napkin-app/components/profile/ProfileScreenBody.tsx` — Shared body between (tabs)/profile and /u/[identifier]; composes all sections; handles cold-start branches
- `napkin-app/components/profile/TopFour.tsx` — 4-up poster grid; auto-derived picks; empty dashed frames for unfilled slots
- `napkin-app/components/profile/RegularsRail.tsx` — Horizontal scrolling rail; ×N visit count pill in terracotta; locked panel cold-start state; SEE ALL taps to /regulars
- `napkin-app/components/profile/ProfileIndex.tsx` — Editorial INDEX block; Diary/Lists/Wishlist active rows; Reviews/Likes as disabled muted placeholders with `— coming soon` italic hint
- `napkin-app/components/profile/SectionHeader.tsx` — Shared italic serif section header; optional right-label with optional onPress
- `napkin-app/components/profile/Rating.tsx` — Inline serif italic N.N + muted /5 helper
- `napkin-app/components/profile/DiaryRow.tsx` — Day/weekday left rail + photo thumb + restaurant + rating row
- `napkin-app/components/profile/RegularRow.tsx` — 56px thumb + name + neighborhood + last visit + avg rating + ×N
- `napkin-app/components/profile/PrivacyPicker.tsx` — Visual 3-way segmented control (Public/Friends/Private); read-only by default
- `napkin-app/hooks/users/useUserDiary.ts` — Paginated diary via useInfiniteQuery + groupDiaryByMonth helper
- `napkin-app/hooks/users/useUserRegulars.ts` — Full regulars list hook
- `supabase/migrations/20260426000000_entries_user_restaurant_idx.sql` — Composite index on entries(user_id, restaurant_id) for regulars/top-four derivation

### Files Modified

- `supabase/functions/user-profile/index.ts` — Added types (TopPick, RegularSummary, DiaryRow), added fetchTopFour/fetchRegulars/fetchDiary helpers, extended profile action response with top_four + regulars_preview, added diary and regulars actions
- `supabase/functions/user-profile/index.test.ts` — Extended skeleton with stubs for new diary/regulars/profile actions
- `napkin-app/hooks/users/useUserProfile.ts` — Added TopPick, RegularSummary, DiaryEntryRow types; extended UserProfileData with top_four and regulars_preview
- `napkin-app/hooks/users/index.ts` — Barrel exports for new types and hooks
- `napkin-app/lib/queryKeys.ts` — Added users.diary and users.regulars keys
- `napkin-app/components/profile/ProfileHeader.tsx` — Repainted to canvas layout: avatar left + identity block right; stats row (logs · places · avg); no follow CTA
- `napkin-app/components/profile/index.ts` — Added exports for all new components; kept removed components for backwards compat
- `napkin-app/app/(tabs)/profile.tsx` — Now a thin wrapper mounting ProfileScreenBody; tab label changed to "You"
- `napkin-app/app/u/[identifier].tsx` — Now a thin wrapper mounting ProfileScreenBody
- `napkin-app/app/settings/privacy.tsx` — Rebuilt as "Who sees what" per-section grid; PrivacyPicker visual affordances over master toggle; all existing mutations preserved
- `napkin-app/app/_layout.tsx` — Registered /diary and /regulars stack routes

### Spec Deviations

1. **ProfileHeader stat row uses stats from UserProfileData, not a separate followers/following count.** The canvas shows followers/following but the follow graph isn't built. Instead, the header row shows `total_logs · total_restaurants · avg rating` from the existing stats object — these are real numbers that are accurate and useful. Follow counts can replace or join this row when the graph ships.

2. **TopFour poster photo is a colored placeholder, not real imagery.** `photo_url` is present on TopPick but rendering images requires `expo-image` or `Image` component — the existing codebase uses fallback initials in ProfileHeader (ARCHITECT-REVIEW comment was already there). The poster shows the rating badge over a `surfaceContainerHigh` background. Real photos land as a fast-follow when image rendering is standardized across the app.

3. **RegularCard photo is also a placeholder.** Same reasoning as TopFour.

4. **DiaryRow shows photo thumb as placeholder background color only.** The `photo_url` field is passed in DiaryEntryRow, but rendering requires the image component decision.

### Deferred Items

- Image rendering in TopFour/RegularsRail/DiaryRow/RegularRow (blocked on image component standardization)
- Stranger Diary and Regulars entry points from the public profile (route exists, server-side gate works, but ProfileScreenBody doesn't add the INDEX Diary link for non-self today — easy to add when copy/empty-states are reviewed)
- Curated Top 4 edit sheet (Scope Decision 2 — follow-up ticket)
- Follow CTA on stranger profiles (Scope Decision 3)

### Type-check Status

**PASS — exit 0.** Zero errors in all files owned by this ticket.

### What Wasn't Testable (UI)

All 6 artboards require a running Expo app + real Supabase data to verify visual output. The canvas matching (fonts, spacing, color tokens, layout rhythm) was implemented by reading the JSX artboard source directly and mapping to existing RN StyleSheet patterns — no automated visual regression exists. The test file adds Deno skeleton stubs for the new edge-function actions (`diary`, `regulars`, updated `profile`) — full integration tests require a test DB fixture.

---

## Review History

### Review 1 — 2026-04-20
**Verdict:** REVISE

**Spec compliance: 7/7 acceptance criteria met** — all surfaces exist; only correctness defects below.

**FAIL** (must fix to pass):

1. `restaurants.neighborhood` column does not exist in schema — `supabase/functions/user-profile/index.ts:567` selects `.select('id, name, city, neighborhood, photo_url')`. Grepping all migrations (`20251201113055_remote_schema.sql` defines the table; later migrations only add `photo_url`, `google_rating`, `price_level`, `cuisine`, `places_synced_at`, `lat`, `lng`) confirms no `neighborhood` column ever lands. `fetchRegulars` will throw a Postgres "column does not exist" error — the `regulars` action and the `profile` action (which calls `fetchRegulars` for `regulars_preview`) will 500 for every user. This kills the profile screen for everyone, not just regulars full-screen. Fix: either drop `neighborhood` from the `select`+type and derive the line from `city` only, or add a migration that introduces the column (and a real populate path from Places). The migration approach is out of the ticket's "reuse existing hooks, no schema changes" scope, so the pragmatic fix is to drop the column from the select and use `city` in the subtitle.

2. Visibility-gate regression on new endpoints — `fetchStats`, `fetchRecentlyLogged`, and `fetchTablePreviews` (siblings in the same file, lines 239, 308, 380) all apply `.neq('visibility', 'private')` to prevent per-entry private logs from leaking. The three new helpers do NOT: `fetchTopFour` (`index.ts:437-507`), `fetchRegulars` (`index.ts:513-588`), and `fetchDiary` (`index.ts:595-647`) query entries with no visibility filter. For relationships `public_only` and `public_and_tables`, this exposes entries the target explicitly marked `visibility='private'` via Top 4 cards, the regulars rail, the full Regulars list, and the Diary full-screen. The year-summary aggregate in the `diary` action (`index.ts:798-819`) has the same gap. Doctrine is "per-log privacy toggles rejected" at the UI level, but `visibility='private'` is still the persisted opt-out; the three new endpoints must honor it for non-self readers. Fix: add `.neq('visibility', 'private')` to all three helper queries and to the diary year-summary select (or branch on `isSelf` so self still sees private entries in their own diary).

**WARN** (flag, don't block):

1. `components/profile/index.ts:23-26` — `PalateSection`, `PalateStatsStrip`, `PublicListsSection`, `RecentlyLoggedGrid` are re-exported from the barrel with a "will be cleaned up" comment. Ticket Technical Design says "REMOVE"; nothing outside the `profile/` folder imports them (verified via grep — only `PalateSection` itself imports the three sub-files). They are dead code. Either delete the four `.tsx` files in a follow-up commit or in this PR; keeping them re-exported is the worst of both worlds (build cost, invites accidental reuse).

2. `components/profile/ProfileScreenBody.tsx:77-95` — stranger Diary entry point IS added for `public_only` / `public_and_tables` via the INDEX, but `Build Log → Deferred Items` says "Stranger Diary and Regulars entry points from the public profile" is deferred. Either the Build Log is stale or the gate is too loose. Given the visibility leak above, closing the stranger path until that's fixed is safer — consider gating `Diary` INDEX row on `isSelf` for Phase 1.

3. `components/profile/RegularsRail.tsx:34-35` — the `SEE ALL → /regulars?userId=...` navigation is wired for every user with regulars, including strangers. Same flavor as #2.

4. `app/settings/privacy.tsx:44-92` — `SectionRow.isMaster` field is declared but never set to `true` on any row; `deriveSections` never uses it and every picker renders with `disabled={!s.isMaster}` (i.e. always disabled). The real master toggle is the separate big button above the grid, which works. Not a bug, but dead branching — either wire a row to be the master or drop the field.

5. `app/settings/privacy.tsx:114-120` — `useEffect([profile?.user_id])` syncs editor state only when `user_id` changes. Preserved from the pre-ticket file per design, but if `display_name` / `bio` / `avatar_url` changes externally (e.g. via another device) while the screen is open, local state won't refresh. Low-risk; flag for future.

6. `components/profile/ProfileHeader.tsx:46-55` + `TopFour.tsx:40-58` + `DiaryRow.tsx:51-53` + `RegularRow.tsx:40` + `RegularsRail.tsx:76` — all restaurant/avatar imagery is a colored placeholder (deviation #2–#4 in Build Log). Noted and justified; fast-follow.

7. `supabase/functions/user-profile/index.ts:268-297` — `fetchPublicLists` does an N+1 (one `count` + one `maybeSingle` per list). Pre-existing from TICKET-020; not introduced here, but the ticket's new path (`profile` action) now also carries the two new helpers, so the full `Promise.all` is fatter. Fine at current list counts; flag if lists grow.

8. `app/(tabs)/profile.tsx:32-37` — the "You" top bar renders `Type.headlineMedium` as the tab title, and a separate gear icon in the top bar, but `ProfileHeader` ALSO renders its own gear icon (line 89-97). Two gears stacked (one in top bar, one in header block next to avatar). Minor visual-noise concern; confirm against the canvas.

**PASS**:

- All 7 acceptance criteria scaffolded: canonical self (`app/(tabs)/profile.tsx`), cold-start (empty-state branches in `ProfileScreenBody`, `TopFour`, `RegularsRail`), stranger (`app/u/[identifier].tsx`), diary (`app/diary.tsx`), regulars (`app/regulars.tsx`), privacy rebuild (`app/settings/privacy.tsx`), nav entry points (`app/_layout.tsx` registers `/diary` and `/regulars`).
- Doctrine — Tables never shown on public-only stranger profile. `ProfileScreenBody.tsx:215-217` gates `TablesInCommonSection` to `self | tables_in_common | public_and_tables` only; `public_only` is excluded.
- Doctrine — per-log privacy screen delegates to account-level master toggle. `app/settings/privacy.tsx:133-164` — only the master toggle fires `updatePrivacy.mutate`; per-section PrivacyPickers are `disabled` visual affordances; footer copy explains.
- Scope Decision 1 (Reviews/Likes disabled placeholders) — `ProfileIndex.tsx:94-96,100-102` render disabled rows without chevron or `onPress`, opacity 0.45, muted text, italic `— coming soon` hint.
- Scope Decision 2 (Top 4 auto-derived, no edit) — `TopFour.tsx` has no EDIT affordance; derived server-side with rating ≥ 4.0 cutoff + max-rating / visit-count / last-visited tie-break (`user-profile/index.ts:470-480`).
- Scope Decision 3 (no follow CTA) — `ProfileHeader.tsx` shows avatar + identity + numbers only; no follow button or social-proof line.
- Hook pattern — `useUserDiary` and `useUserRegulars` match `useUserProfile` template (supabase.functions.invoke, session token in Authorization header, `queryKeys.users.*`, `enabled: !!identifier`, `staleTime: 5min`, FunctionsHttpError.context unwrap).
- Edge function pattern — service role client, manual `auth.getUser(token)`, CORS preflight, `json()/fail()/notFound()` helpers returning `{ data }` or `{ error }` — matches `table-management/index.ts` canon.
- Query keys centralized — `lib/queryKeys.ts:77-85` adds `users.diary(userId, cursor?)` and `users.regulars(userId)` under existing `users` namespace.
- Scope adherence — exactly 25 files changed; all inside `app/(tabs)/profile.tsx`, `app/diary.tsx`, `app/regulars.tsx`, `app/u/[identifier].tsx`, `app/settings/privacy.tsx`, `app/_layout.tsx`, `components/profile/*`, `hooks/users/*`, `lib/queryKeys.ts`, `supabase/functions/user-profile/*`, `supabase/migrations/`. No logger or tables files touched.
- `npx tsc --noEmit` exits 0.
- Composite index `idx_entries_user_restaurant` on `(user_id, restaurant_id)` — correctly justified for `fetchTopFour`/`fetchRegulars`/`fetchDiary` which all `eq('user_id', …)` then group by `restaurant_id`.
- Cold-start — `ProfileScreenBody.tsx:144-148` branches on `totalLogs === 0`; `TopFour` renders 4 dashed frames; `RegularsRail` renders locked panel; first-review nudge rendered under the rail for self.
- Voice — section labels (`— INDEX`, `SEE ALL`) uppercase via `Type.labelSmall`; restaurant names / section headers use `Newsreader_400Regular_Italic`; middle-dot separator used in counts row and diary metadata; no emoji in chrome.

### Review 2 — 2026-04-20
**Verdict:** APPROVE

**Spec compliance: 7/7 acceptance criteria met** — all Review 1 FAILs resolved; all addressed WARNs closed.

**FAIL**: none.

**WARN**:

1. `.kanban/review/TICKET-025-ui-kit-profile.md:207` — Build Log "Files Modified" entry for `components/profile/index.ts` still reads "kept removed components for backwards compat." That branch is now untrue — the four re-exports (`PalateSection`, `PalateStatsStrip`, `PublicListsSection`, `RecentlyLoggedGrid`) were deleted in commit `2b95e6f` and the source files are gone. Deferred-Items wording in Build Log should also note that stranger Diary / Regulars entry point was explicitly closed in the fix pass (Phase 1 = self only), not merely "deferred." Doc drift, not a code defect.

2. `app/settings/privacy.tsx:263-290` — each row is now a `Pressable` whose `onPress` is `undefined` for non-deep-link rows. Functionally fine (tapping a no-link row is a no-op), but `Pressable` with `onPress={undefined}` still consumes touch events and renders a pressed visual state on long-tap. Low-impact, but a plain `View` wrapper for non-deep-link rows would be cleaner. Flag, don't block.

**PASS**:

- FAIL 1 fully resolved. `supabase/functions/user-profile/index.ts:488` and `:570` select `id, name, city, photo_url` (no `neighborhood`); `:103-111` `RegularSummary` type has no `neighborhood` field; `napkin-app/hooks/users/useUserProfile.ts:81-89` mirrors. `components/profile/RegularRow.tsx:30-35` constructs `subtitle` from `regular.city` only; `components/profile/RegularsRail.tsx:99-103` reads `regular.city` only. Repo-wide grep for `neighborhood` returns zero matches in `napkin-app/` and `supabase/`.
- FAIL 2 fully resolved. `fetchTopFour` (`index.ts:436`), `fetchRegulars` (`index.ts:514`), and `fetchDiary` (`index.ts:597-603`) all take `includePrivate: boolean` and apply `.neq('visibility', 'private')` when false (lines 443, 520, 613). Diary year-summary at `:802-808` also gated on `isSelf`. Call sites verified:
  - self branch of `profile` action → `true` (`:703-704`),
  - `public_only` / `public_and_tables` branch → `false` (`:754-755`),
  - `diary` action → `isSelf` (`:798`, `:808`),
  - `regulars` action → `isSelf` (`:858`).
  No stray 2-arg call site exists; repo-wide grep confirms every invocation passes three arguments. The `tables_in_common`-only branch at `:732` short-circuits and never calls the three helpers, so no leakage there either.
- WARN 1 resolved. `PalateSection.tsx`, `PalateStatsStrip.tsx`, `PublicListsSection.tsx`, `RecentlyLoggedGrid.tsx` are all deleted on disk (confirmed via glob of `components/profile/*.tsx` — none returned). Barrel `components/profile/index.ts` no longer re-exports them. Repo grep for the four names returns zero matches outside the ticket doc.
- WARN 2/3 resolved. `ProfileScreenBody.tsx:82-97` gates Diary INDEX row on `isSelf` only; `:169-193` gates Top 4 / Regulars rail on `hasPalateAccess` (broader palate) but `:191` passes `showSeeAll={isSelf}` so strangers never see the `/regulars` deep-link. `RegularsRail.tsx:25-38` respects the new `showSeeAll` prop with `canSeeAll = showSeeAll && !isEmpty`; rightLabel + onRightLabelPress both resolve to `undefined` when false, and `SectionHeader` will not render the label.
- WARN 4 resolved. `app/settings/privacy.tsx:44-50` — `SectionRow` type no longer has `isMaster` field; `:285-288` `PrivacyPicker` is unconditionally `disabled`. The master toggle at `:222-248` (big standalone button) remains the sole actionable control. Lists row deep-link still works: `:265` `onPress={s.deepLink ? () => router.push(s.deepLink as any) : undefined}` preserved.
- WARN 8 resolved. `(tabs)/profile.tsx:25-33` renders only the "You" text label in the top bar; no `Ionicons` import remains at all (confirmed by reading the file). The ProfileHeader gear at `components/profile/ProfileHeader.tsx:88-97` is the sole gear on screen now, matching the canvas.
- No regressions introduced. `npx tsc --noEmit` in `napkin-app/` exits 0. No new theme tokens, no voice drift, no new imports anywhere outside the lines touched. Voice copy on RegularsRail locked panel / cold-start nudges preserved.
- Untouched WARN items from Review 1 (5, 6, 7) intentionally deferred and confirmed unchanged in this delta.

## Completion

**Date:** 2026-04-20
**Verdict:** Approved on Review 2 (0 FAIL, 2 low-priority WARN deferred).

**Summary:** All six profile artboards ship against the Heirloom Journal kit — canonical self, cold-start, stranger, Diary full-screen, Regulars full-screen, and rebuilt privacy controls. Two shared `ProfileScreenBody`s (tab + `/u/[identifier]`) eliminate drift. Top 4 is auto-derived server-side (rating ≥ 4.0). Regulars derived at ≥3 visits. Review 1 exposed two correctness bugs — a dead `restaurants.neighborhood` column selection and a visibility-gate regression — both fixed in the revise pass. Dead legacy components (`PalateSection`, `PalateStatsStrip`, `PublicListsSection`, `RecentlyLoggedGrid`) deleted.

**Deferred (fast-follow):**
- Curator-driven Top 4 picks (new schema + edit sheet).
- Stranger Diary / Regulars UI entry points (server path + gate exist; UI wiring deferred for copy review).
- Image rendering for posters / thumbs (blocked on app-wide image component).
- Follow CTA on stranger profile (blocked on follow graph).
