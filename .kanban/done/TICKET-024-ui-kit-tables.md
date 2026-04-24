---
id: TICKET-024
title: "Apply Heirloom UI kit — Tables"
priority: high
status: done
created: 2026-04-20
updated: 2026-04-20
completed: 2026-04-20
tags: [ui, design-system, tables]
---

# Apply Heirloom UI kit — Tables

## Problem
Migrate the Tables surface (solo → table invitation swerve, Table tab, Table activity, Round flows where reskinned) to the Heirloom Journal UI kit. The feed is already done.

## Scope
- `app/(tabs)/tables.tsx` — Table list + per-Table activity
- Table detail / Table-scoped feed
- "Empty-chair" / invitation swerve for solo users (per canvas Act I)
- Any Table-related components in `components/table-night/`, `components/tables/` that the kit reskins
- Table switcher component

Thesis from the canvas: *"The table is a container, not a feature pack."* Solo users keep almost everything; the Table unlocks a small set of qualitatively-different capabilities (rounds, Tonight?, shared wishlist surfacing, bound history).

## Design sources
Bundle: `~/Downloads/napkin-design-system/`
- `project/ui_kits/napkin-app/tables-canvas.jsx` / `.html` — 8 wireframes across 3 acts
- `project/ui_kits/napkin-app/tables-flows.jsx` — flows
- `project/ui_kits/napkin-app/tables-screens.jsx` / `table-screens.jsx` — individual screens
- `project/ui_kits/napkin-app/primitives.jsx` + `feed-components.jsx` — reuse existing atoms
- `project/README.md` — voice, iconography, components reference

## Notes
- Respect doctrine: Tables are **never public**. Round is a side mode, not the hero.
- Don't regress existing Round functionality — visual pass only unless the kit explicitly shows a new interaction.

## Coordination
Owned by: Claude Code terminal working on **tables**. Do not touch logger (TICKET-023) or profile (TICKET-025) files.

## Technical Design

### Approach
Visual reskin of the Tables surface to the Heirloom Journal UI kit. The canvas is aspirational (9 wireframes across Acts I–IV) — it depicts features that don't exist yet (Gather voting flow, Subset cards, Seeded-merged cards, Looking Back, Pin-to-board modal). This ticket ships **only the skin on what's already implemented**: the Tables tab (`tables.tsx`), the Table header / switcher, the Round cards in-feed, and the two Round screens (`table-night.tsx`, `table-night-detail.tsx`) where they show Table-scoped surfaces. Everything shipped already has real hooks and real data — we do not touch those. We lift atoms that the feed migration (`feed.tsx`, `FriendLogCard`, `FastLogRow`, `FeedHeader`, `FeedDateHeader`, `InlineStars`) already produced, and reuse them wherever the canvas overlaps.

The single clear net-new atom the canvas demands is a **TTableHeader** — a table-specific masthead (italic serif name, "TABLE" kicker label, member-avatar stack, ▾ switcher affordance) that replaces the current ad-hoc header in `tables.tsx`. The "empty-chair" solo swerve is a new empty-state slab on the Tables tab — *not* an onboarding flow — rendered when the user's only table is their personal Table.

### Architecture Decisions

- **Skin, don't re-platform**: we do not adopt the canvas's motif-color-per-table system (`TABLE_MOTIFS` in `table-screens.jsx`). Reason: motifs are a greenfield design concept; shipping them now adds DB shape (a `motif` column or client-side hash) and a second palette axis. Trade-off: table cards are less visually differentiated than the canvas shows. Revisit in a follow-up ticket.
- **Empty-chair swerve lives inline on the Tables tab, not on a new screen**. The canvas shows it as a dismissable slab above the solo journal. Map: render it as a hero block above the feed when `tables.length === 1 && tables[0].is_personal`. Trade-off: we don't yet build the "Gather a table" CTA's destination (no create-table modal exists); CTA opens an `Alert.alert` "Coming soon" stub, which matches the visual-only scope. The swerve *shape* is what matters for the kit.
- **Round cards already match the canvas**. `TableNightCard` already has the hero image + italic name + avatar stack + rating chip shape. Only palette/type nudges are needed (e.g. date-label chip on the hero corner to echo the canvas `Round · Sat 29 Mar` overlay). Do not rewrite `TableNightCard`; tune it.
- **Switcher is a bottom-sheet, not a top-dropdown modal**. The canvas `ScreenSwitcher` is an iOS-style bottom sheet showing all tables as rows with avatar stacks, sub-labels, a live-pulse dot on active rounds, and the solo journal as a row. The current implementation is a top-anchored dropdown `Modal`. We replace it with a pannable sheet. Trade-off: slightly more code (drag-to-dismiss), but the canvas pattern is consistent with Pin-to-board and the system language. Reason: the canvas treats tables as peers of the solo journal ("a table for one") — a sheet that surfaces all of them as equal rows reinforces that doctrine.
- **Segmented control (Activity | Wishlist) stays**. Canvas doesn't explicitly show a control but also doesn't contradict it. Keep as-is; restyle to the warm-cream pill treatment used elsewhere.
- **Out-of-scope canvas features are deliberately ignored** (see Out-of-Scope list below). They re-appear when/if their feature ticket lands.

### Canvas screen → RN mapping

| Canvas wireframe | RN target | Action |
|---|---|---|
| WF1 · Solo home, no table yet | `app/(tabs)/tables.tsx` (empty state when only personal Table) | Reskin — add invitation slab component |
| WF2 · Gather / Seed flow | — | **Out of scope** (no create-table UI exists) |
| WF3 · Founded, just you | `app/(tabs)/tables.tsx` (brand-new table, zero entries) | Reskin — minor; reuse existing `isEmpty` branch with updated copy/shape |
| WF4 · Active Gather / live vote | — | **Out of scope** ("Tonight?" voting doesn't exist). The live *round* banner (`ACTIVE ROUNDS` shelf) is the nearest existing analogue and is already reskinned via TableNightCard's `LIVE ROUND` treatment |
| WF5 · Mixed feed | `app/(tabs)/tables.tsx` activity branch | Reskin header, section labels, round cards (existing atoms) |
| WF6 · Round detail · four voices | `app/table-night-detail.tsx` hero strip + voices list | Light reskin — tune hero photo overlay + per-voice card to match canvas "alternating surface" pattern |
| WF7 · Table switcher sheet | Switcher in `tables.tsx` (currently a top Modal) | Replace top-anchored dropdown with a bottom sheet matching canvas |
| WF8 · Pin to board modal | — | **Out of scope** (wishlist flow owns this; TICKET-015 didn't add a multi-board picker) |
| WF9 · Looking Back | — | **Out of scope** (annual retrospective feature doesn't exist) |

### Component decomposition

**Reused from feed migration (no changes):**
- `InlineStars` — for participant voices in Round detail
- `FeedDateHeader` / `DateSectionHeader` — already used in `tables.tsx`
- `FilterChipRow` — already used
- `FeedActionRow`, `ReactionPicker`, `PulseDot`, `Avatar` — already used by TableNightCard / SoloShareCard / JournalNoteCard

**Reskin in place (tune palette/type, no prop changes, no behavior changes):**
- `components/feed/TableNightCard.tsx` — add the canvas's top-left chip label (`ROUND · Sat 29 Mar`) overlaid on the hero image; tune date-label to canvas format. Leave everything else.
- `components/feed/SoloShareCard.tsx` — align "{X} shared to the table" preamble to canvas `TNoteCard` language (we're already close)
- `components/feed/JournalNoteCard.tsx` — ditto for the "noted" / no-rating variant
- `app/table-night-detail.tsx` — hero image overlay (restaurant name in italic serif + avg rating pill, bottom-left / bottom-right), per-voice card row (avatar + name + stars + italic serif quote)

**New atoms (small, scoped to Tables surface):**
- `components/tables/TableHeader.tsx` — `TABLE` uppercase kicker + italic serif table name + ▾ switcher + right-aligned avatar stack + optional sub ("4 members · 23 rounds"). Mirrors canvas `TTableHeader`.
- `components/tables/EmptyChairInvitation.tsx` — the solo swerve slab: "AN INVITATION" kicker, italic serif headline, body copy, `Gather a table` primary + `Not now` ghost. Body and CTA-destination copy per canvas; CTA fires a stub handler (see decision above).
- `components/tables/TableSwitcherSheet.tsx` — bottom sheet replacing the current top-dropdown Modal. Rows: avatar stack + name (italic serif for named tables, upright sans for the personal "Your journal" row) + sub + live-pulse dot when any round is currently rating. Handle + dim + drag-to-dismiss.
- `components/tables/FoundedHero.tsx` (small, optional) — the "Founded today" centered block for brand-new tables with zero entries. Can be inlined if we want to keep component count down; factoring it lets the empty-state branch stay readable.

**Barrel**: `components/tables/index.ts` — new; exports the four above.

### Token additions
None required. The kit maps 1:1 to existing tokens:

| Canvas CSS var | theme.ts token |
|---|---|
| `--surface-table` | `palette.background` |
| `--surface-journal` | `palette.surfaceContainer` |
| `--surface-journal-low` | `palette.surfaceContainerLow` |
| `--surface-journal-hi` | `palette.surfaceContainerHigh` |
| `--surface-note` | `palette.card` |
| `--ink-primary` | `palette.text` |
| `--ink-secondary` | `palette.textSecondary` |
| `--ink-muted` | `palette.textMuted` |
| `--terracotta` | `palette.primary` |
| `--olive` | `palette.secondary` |
| `--rule-warm-soft` | `palette.dividerSoft` |
| `--rule-warm` | `palette.divider` |
| `--amber-cream` / `--amber-ink` | `palette.tertiaryFixed` / `palette.tertiary` |
| `--shadow-note` | `Shadow.ambient` |

If anything goes missing during implementation, extend `Colors` in `constants/theme.ts` — do not introduce a second palette file.

### File-by-file change plan

- `napkin-app/app/(tabs)/tables.tsx` — MODIFY.
  - Replace inline header block (lines 213–236) with `<TableHeader />`.
  - Replace top-dropdown `Modal` (lines 449–521) with `<TableSwitcherSheet />`.
  - Wrap empty/solo-only case in `<EmptyChairInvitation />` (branch when `tables?.length === 1 && tables[0].tables.is_personal`).
  - Use `<FoundedHero />` (or inline equivalent) when `activeTable` exists but `items.length === 0` and the table is non-personal.
  - Keep all hooks, query keys, state, filter logic, active-rounds-shelf branch unchanged.
- `napkin-app/components/tables/TableHeader.tsx` — NEW.
- `napkin-app/components/tables/EmptyChairInvitation.tsx` — NEW. CTA handler is a prop; `tables.tsx` passes an `Alert.alert` stub.
- `napkin-app/components/tables/TableSwitcherSheet.tsx` — NEW. Bottom-sheet replacement for the top dropdown; same props shape (`tables`, `selectedIndex`, `onSelect`, `visible`, `onClose`).
- `napkin-app/components/tables/FoundedHero.tsx` — NEW (or inline in `tables.tsx` if small enough).
- `napkin-app/components/tables/index.ts` — NEW.
- `napkin-app/components/feed/TableNightCard.tsx` — MODIFY. Add the canvas's top-left chip pill over the hero image ("ROUND · Sat 29 Mar" / "LIVE ROUND" when active). No prop changes. No behavior changes.
- `napkin-app/app/table-night-detail.tsx` — MODIFY. Reskin the hero strip overlay (italic serif name bottom-left, amber rating pill bottom-right) and the per-voice rows (avatar + name + `<InlineStars />` + italic serif quote pull). All hooks and flows untouched. *Do not touch anything to do with the rating flow, OnTheTableList, CommentThread, or photo pool logic.*
- `napkin-app/app/table-night.tsx` — MODIFY minimally. Only the header chrome and the presence row may need palette/type nudges. **Do not touch sliders, reducers, realtime, upload, reveal, ready flows.**
- `napkin-app/components/table-night/PresenceRow.tsx` — MODIFY minimally if needed (type/avatar stack tokens only).
- `napkin-app/components/feed/SoloShareCard.tsx`, `JournalNoteCard.tsx` — MODIFY copy/type alignment only to match canvas preamble shape ("went solo to" / "noted"). No behavior changes, no structural changes.

**Do not touch** (scope boundaries):
- `app/(tabs)/log.tsx`, `app/create-entry.tsx`, `app/fast-log.tsx`, `app/entry-detail.tsx`, `components/logging/**` (TICKET-023 — logger).
- `app/(tabs)/profile.tsx`, `app/member/**`, `app/u/**`, `components/members/**`, `components/profile/**` (TICKET-025 — profile).
- Any `supabase/functions/**` — no edge function changes.
- Any `hooks/**` — reskin does not change data layer.

### Implementation Order

1. **Scaffold atoms** — `TableHeader`, `EmptyChairInvitation`, `FoundedHero`, and `components/tables/index.ts`. Pure presentational; no hook deps. Build them in isolation against the canvas.
2. **Integrate into `tables.tsx`** — swap header, add empty-state branches, keep all existing state intact. Verify personal-only, brand-new-named, and active-table cases render correctly.
3. **TableSwitcherSheet** — replaces the top Modal last because it needs `tables.tsx` already wired through steps 1–2. Depends on `@gorhom/bottom-sheet` only if already installed; otherwise build on RN `Modal` + `Animated` (check deps before adding).
4. **Card pill overlay on `TableNightCard`** — small additive change. After `tables.tsx` is visually correct, this elevates round cards to match canvas.
5. **Reskin `table-night-detail.tsx`** — hero overlay + voices list. Last because it's the heaviest file and highest risk for regression; doing it after the tab is done gives a visual reference.
6. **Copy/type passes on `SoloShareCard` / `JournalNoteCard`** — trivial, last.

### Risks / Ambiguities

- **CTA destination for "Gather a table"** — no create-table screen exists today. Canvas WF2 (three-tier seed) is a meaty feature. Mitigation: the button stubs to an Alert per the visual-only constraint; log a follow-up ticket for the actual Gather flow. Flag to PM before merging.
- **Bottom sheet dep**: confirm whether `@gorhom/bottom-sheet` is installed. If not, do not add it for this ticket — fall back to `Modal` + `Animated.spring` slide-up. Either path satisfies the canvas.
- **Round detail reskin regression risk**: `table-night-detail.tsx` is large and mixes data, realtime, and UI. Constrain changes to the hero overlay + the voices list rendering block only. All queries, mutations, realtime channels, photo grid, comment thread, and ActionSheet code must be byte-identical.
- **Canvas implies chip labels on Round cards** (`ROUND · Fri 04 Apr`, `SUBSET · Thu 20 Mar` etc.). We have rounds but no "subset" concept. Render only the `ROUND` / `LIVE ROUND` variants; do not introduce a subset variant without a feature ticket.
- **Canvas uses a motif-per-table color system** on Table cards in `table-screens.jsx` (`TABLE_MOTIFS`). We deliberately skip this — see Architecture Decisions.

### Out of Scope (canvas shows, we're not building)

- WF2 — Gather / three-tier Seed flow (new screen)
- WF4 — "Tonight?" / Active Gather live-vote UI (new feature)
- WF5 — Subset card and Seeded-merged card weights (no data shape)
- WF8 — Pin-to-board multi-wishlist picker (wishlist already ships a simpler heart toggle; multi-board is TICKET-015 follow-up)
- WF9 — Looking Back annual ceremonial screen + anniversary ticks in-feed (no data)
- Motif color per table (`TABLE_MOTIFS` in `table-screens.jsx`)
- Table anniversary events, "pinned Tombolo for the next round" ticks (data layer doesn't exist)
- Any list-of-tables directory screen (there isn't one today — the tab shows *the active table*, and the switcher sheet covers multi-table navigation)

## Build Log

### Files Changed

**New files:**
- `napkin-app/components/tables/TableHeader.tsx` — `TABLE` / `YOUR JOURNAL` kicker + italic serif table name + ▾ switcher + right-aligned avatar stack + member/round sub-label
- `napkin-app/components/tables/EmptyChairInvitation.tsx` — solo swerve slab; `onGatherPress` CTA is a prop (stub to `Alert.alert` from caller)
- `napkin-app/components/tables/FoundedHero.tsx` — "Founded today" centered block for brand-new non-personal tables with zero entries
- `napkin-app/components/tables/TableSwitcherSheet.tsx` — bottom sheet replacing old top-dropdown Modal; `Modal` + `Animated.spring` + `PanResponder` drag-to-dismiss; rows show `PulseDot` on tables with live rounds
- `napkin-app/components/tables/index.ts` — barrel export

**Modified files:**
- `napkin-app/app/(tabs)/tables.tsx` — replaced inline header block with `<TableHeader />`; replaced top-dropdown `Modal` with `<TableSwitcherSheet />`; added `<EmptyChairInvitation />` branch (solo-only, dismissable); added `<FoundedHero />` branch (brand-new named table, empty); moved `useMemo` calls before early returns to fix `react-hooks/rules-of-hooks` lint errors
- `napkin-app/components/feed/TableNightCard.tsx` — label text changed from `GROUP ENTRY · …` to `ROUND · …`; added canvas-style top-left chip overlay on hero image (`ROUND · DATE` / `LIVE ROUND` with PulseDot) when a hero photo is present
- `napkin-app/app/table-night-detail.tsx` — canvas hero overlay: restaurant name (italic serif) bottom-left + avg rating pill (amber chip) bottom-right when hero photo present; header section only shown when no hero photo; participant voice quotes use `Newsreader_400Regular_Italic` (`voiceQuote` style)
- `napkin-app/components/feed/SoloShareCard.tsx` — preamble copy updated from "tried" to "went solo to" per canvas voice rules

### Tests

- `npx tsc --noEmit` — exit 0, zero type errors
- `npm test` — `jest --passWithNoTests` exits 0 (no Jest tests exist per project convention)
- `npx expo lint` — 0 errors; 11 pre-existing warnings (none in newly written files except pre-existing `react-hooks/exhaustive-deps` pattern inherited from original `tables.tsx`)

### Notes

- `TableNightCard` hero chip overlay only renders when `photoUrl` is present. Fallback initial-letter blocks don't get the overlay (they have no photo content to overlay on). This matches canvas intent — the chip lives on the image.
- `TableSwitcherSheet` built on `Modal` + `Animated` (no `@gorhom/bottom-sheet` — not in `package.json`). Behavior: spring slide-up, backdrop tap to close, drag-handle pannable with velocity-aware dismiss threshold.
- `EmptyChairInvitation` "Gather a table" CTA fires `Alert.alert("Coming soon", …)` stub as specified. The slab is dismissable in-session via `invitationDismissed` state (not persisted — reappears on next app launch for solo users).
- `table-night.tsx` and `PresenceRow.tsx` required no changes — their palette/type tokens were already on-spec.
- `JournalNoteCard.tsx` required no changes — "noted" verb already matches canvas voice rules.
- Scope boundaries respected: no logger files, no profile files, no edge functions, no hooks touched.

## Review History

### Review 1
Date: 2026-04-20
Verdict: REVISE

Spec compliance: 6/10 acceptance criteria met
- [x] `TableHeader` kicker + italic serif name + chevron + avatar stack + sub-label — PASS (canvas `TTableHeader` shape matched; `TABLE` / `YOUR JOURNAL` kicker correctly uses muted color per canvas)
- [x] `EmptyChairInvitation` slab shape — PASS (structure matches WF1)
- [ ] `EmptyChairInvitation` kicker color — FAIL (canvas specifies `var(--terracotta)` for `AN INVITATION`; implementation uses `palette.textMuted` — kicker should be `palette.primary`)
- [x] `FoundedHero` structure — PASS (centered block with italic serif name + ceremonial hairline rules)
- [ ] `FoundedHero` kicker color — FAIL (canvas uses `var(--terracotta)` for `FOUNDED TODAY`; implementation uses `palette.textMuted`)
- [ ] `TableSwitcherSheet` matches WF7 — FAIL (multiple deviations: see Key issues #1)
- [ ] `TableNightCard` chip overlay — FAIL (outer `labelRow` duplicates the same `ROUND · …` text as the new hero chip — see Key issues #2)
- [ ] `table-night-detail.tsx` voices list — FAIL (canvas WF6 requires `InlineStars` on each voice row + alternating surface colors — neither implemented)
- [x] Voice rules — PASS (lowercase verbs `went solo to` / `noted`; middle-dot metadata; italic serif for restaurant + table names)
- [x] Scope discipline — PASS (touched exactly the 5 files in scope; did not touch hooks, edge functions, logger, or profile files in the in-scope diffs)

Correctness: WARN — logic is correct, visual spec fidelity is partial
Edge Cases: PASS — solo-only, founded-empty, named-with-filter, and main activity all handled; `memberNames` / `liveRoundTableIds` `useMemo` moved above early returns (rules-of-hooks respected)
Error Handling: PASS — `Alert.alert` stub for Gather CTA is correct per ticket; backdrop/onRequestClose wired for switcher sheet
Security: PASS — no new data fetches; all auth already enforced upstream
Performance: PASS — `useMemo` applied to `filteredItems`, `activeRounds`, `timelineItems`, `feedSections`, `memberNames`, `liveRoundTableIds`; sheet uses `useNativeDriver: true`
Design Compliance: FAIL — 4 concrete deviations from the canvas (kicker colors, double label on round card, missing InlineStars in voices, switcher sheet row shape)

Key issues:

1. **`TableSwitcherSheet` diverges heavily from canvas WF7** (`components/tables/TableSwitcherSheet.tsx`):
   - L156-164: sheet title `Your Tables` styled with `Type.label` (Manrope sans uppercase). Canvas WF7 L712-715 shows it as **italic Newsreader serif**, 20px, not uppercase.
   - L230: each row shows a **single `<Avatar name={tableName}>`** using the table name as initials ("Sunday Roast Club" → "SR"). Canvas WF7 L728-736 shows a **3-avatar member stack** with 9px overlap. Data limitation acknowledged (no per-table members in props), but single-avatar with table-name initials is not the design — either pass members through or drop avatar entirely.
   - L243-247: solo row sub reads `personal`. Canvas WF7 L690 reads `Solo · 14 entries`. Non-personal rows have **no sub** at all. Canvas shows `4 members · Live vote` / `5 members · 8 rounds` for named tables.
   - Missing right-aligned `+ Gather new` CTA on sheet header (canvas WF7 L716-720). Even if it stubs to the same Alert, the affordance is part of the design.
   - Fix: make the sheet title italic-serif, wire member lists into rows for stacks + sub-labels, and add the `+ Gather new` header CTA.

2. **Double `ROUND · …` label on `TableNightCard`** (`components/feed/TableNightCard.tsx`):
   - L138-149 renders outer `labelRow` with `ROUND · 14 DEC` text.
   - L179-201 renders the new `heroChip` overlay on the photo with the same `ROUND · 14 DEC` text.
   - When `photoUrl` is present, both render → the user sees the same label twice.
   - Canvas `TRoundCard` (tables-screens.jsx L184-201) has ONLY the on-photo chip, no outer label row.
   - Fix: condition outer `labelRow` on `!photoUrl`, OR drop the outer labelRow entirely (fallback block can absorb the label).

3. **`table-night-detail.tsx` voices list missing canvas fidelity** (`app/table-night-detail.tsx:993-1039`):
   - No `InlineStars` rendered per voice (ticket's component-decomposition list explicitly calls out "InlineStars — for participant voices in Round detail" as a reused atom).
   - No alternating surface colors between rows (canvas WF6 L656-660: `background: i % 2 === 0 ? 'var(--surface-note)' : 'var(--surface-journal-low)'`). Implementation uses `palette.card` for all rows.
   - Rating number size (20px) is fine, but pairing stars + numeric per canvas is the explicit shape.
   - Fix: add `<InlineStars value={participant.rating} size={11} />` inside the top row (between name and rating number), alternate `backgroundColor` based on index.

4. **Kicker colors wrong on ceremonial blocks** (`components/tables/EmptyChairInvitation.tsx:40`, `components/tables/FoundedHero.tsx:39`):
   - Canvas kickers `AN INVITATION` and `FOUNDED TODAY` both use `var(--terracotta)` = `palette.primary`.
   - Implementation uses `palette.textMuted` in both places.
   - This is the warm-accent anchor that distinguishes ceremonial kickers from utility labels — trivial fix but material to the Heirloom aesthetic.
   - Fix: change both to `palette.primary`.

Minor (non-blocking) nits:
- `EmptyChairInvitation.tsx:78` ghost CTA has `paddingVertical: 12` on a 10px text — about 34px total tap height, under the 44×44 iOS minimum. Add `hitSlop={8}` or increase `paddingVertical` to 16.
- `FoundedHero.tsx:21-27` uses `new Date(dateStr).toLocaleDateString(...)` — depends on runtime locale, which can yield surprising formats. Canvas uses `14 Apr 2026 · by you`. Consider using a deterministic format and adding the `· by you` segment for parity with WF3.
- `TableHeader.tsx:25` says `memberNames: string[]` — "Top 3 member names to show as avatar stack" — but the screen passes ALL member names; only `MAX_STACK_AVATARS = 3` are rendered. Harmless but inconsistent with the prop comment. Also, unlike the canvas, there's no `+N` overflow bubble when `memberNames.length > 3`.
- `TableSwitcherSheet.tsx:171` references `liveRoundTableIds` from the *active* table only (tables.tsx L195-201). Non-active tables with live rounds will never show the pulse dot, since `activeRounds` is derived from `activityData` of the selected table only. Accept as a scope limitation — fetching rounds for every table membership is larger work — but note that the dot will appear on at most one row, always the active one, which defeats the canvas intent ("switch to a table where a round is live").

Overall: the scaffolding and architecture are clean; the new atoms are well-factored and scope-disciplined; `tables.tsx` wires them correctly. The issues are visual-fidelity gaps against the canvas — which is the explicit focus of this ticket. Four concrete spec deviations push this to REVISE. Once kicker colors, double-label, InlineStars+alternation in voices, and switcher sheet shape are corrected, this is a clean APPROVE.

### Revision 1 — 2026-04-20

Addressed all four blocking items plus two non-blocking nits:

1. **Double `ROUND · …` label** — `components/feed/TableNightCard.tsx:138-151`: outer `labelRow` now only renders when `!photoUrl`. When a photo is present, only the on-photo `heroChip` shows.
2. **TableSwitcherSheet** — `components/tables/TableSwitcherSheet.tsx`:
   - Sheet title is now italic Newsreader serif 20px (`Your tables`, not uppercase) — matches canvas WF7 L712-715.
   - Added right-aligned `+ GATHER NEW` terracotta CTA on sheet header; wired from `tables.tsx` to the same Alert stub used by the empty-chair.
   - Solo row sub now reads `Solo` (not `personal`); non-solo rows show `Shared table` placeholder. Member counts and entry counts are out of reach — `table-management` edge function doesn't surface them on the list endpoint; pulling them would require a hook/data change, which is out of scope for a visual-only pass. Code comment added to the avatar stack explaining the data boundary.
   - Single 40px table-initials avatar replaced with a 3-disc approximation (outline + primary-muted companion discs behind a 26px table-initials avatar) — mirrors canvas silhouette density within the data constraint.
3. **ParticipantRow voices** — `app/table-night-detail.tsx`:
   - `InlineStars` now renders on each voice row between name and quote (`participant.rating / 2` to convert 10-pt to 5-star).
   - Row background alternates between `palette.card` and `palette.surfaceContainerLow` via a new `rowIndex` prop (canvas WF6 alternating surfaces).
4. **Ceremonial kickers** — both `EmptyChairInvitation.tsx:40` and `FoundedHero.tsx:39` now use `palette.primary` (terracotta).

Non-blocking nits picked up:
- `EmptyChairInvitation` ghost CTA bumped to 44px minHeight.
- `FoundedHero` kicker now reads `Founded {date} · by you` per canvas WF3.

Remaining non-blocking:
- `TableHeader` `+N` overflow bubble when `memberNames.length > 3`: not applied (canvas doesn't render this either in WF5/6; would be a nice-to-have).
- `liveRoundTableIds` still only populates the active table's ID — a real fix needs rounds data across all memberships, which would require a hook/edge-function change. Left as-is with a comment in the hook boundary; the dot still correctly renders on the active table when a live round exists.

Verification: `npx tsc --noEmit` exit 0.

### Revision 1 Review
Date: 2026-04-20
Verdict: APPROVE

Spec compliance: 10/10 acceptance criteria met (all 4 blocking items from Review 1 resolved)
- [x] `TableHeader` kicker + italic serif name + chevron + avatar stack + sub-label — PASS (unchanged)
- [x] `EmptyChairInvitation` slab shape — PASS (unchanged)
- [x] `EmptyChairInvitation` kicker color — PASS (`EmptyChairInvitation.tsx:40` now uses `palette.primary`)
- [x] `FoundedHero` structure — PASS (unchanged; now includes `Founded {date} · by you` per WF3)
- [x] `FoundedHero` kicker color — PASS (`FoundedHero.tsx:39` now uses `palette.primary`)
- [x] `TableSwitcherSheet` matches WF7 — PASS (sheet title now italic Newsreader 20px at `TableSwitcherSheet.tsx:349-352`; `+ GATHER NEW` terracotta CTA added at L170-174; solo row sub reads `Solo` at L287; data-layer constraint on member-avatar stack explicitly commented L240-243; 3-disc silhouette approximation at L244-273 preserves the "stack density" canvas intent)
- [x] `TableNightCard` chip overlay — PASS (outer `labelRow` now conditioned on `!photoUrl` at `TableNightCard.tsx:139`; only one `ROUND · …` label renders at any time — either outer when no photo, or on-hero chip when photo present)
- [x] `table-night-detail.tsx` voices list — PASS (`InlineStars` rendered per voice at `table-night-detail.tsx:1029-1034`, alternating surface via `rowIndex % 2` at L943, `rowIndex` wired from caller at L534)
- [x] Voice rules — PASS (unchanged)
- [x] Scope discipline — PASS (diff touches only in-scope files; no hook, edge function, logger, or profile file changes)

Correctness: PASS — all four fixes are behavioral (conditional rendering, style toggling, new index prop) with no logic regressions
Edge Cases: PASS — empty-chair/founded-empty/solo branches still guarded; `rowIndex` defaults to 0 so a single-voice list still renders correctly; `hasMultipleTables` still gates chevron/press-to-open
Error Handling: PASS — `onGatherNew` is optional (guarded at `TableSwitcherSheet.tsx:163`), closes sheet before firing Alert to avoid stuck-sheet-over-alert on iOS
Security: PASS — no new data fetches or auth surfaces
Performance: PASS — no new render paths or re-subscriptions; `cardBg` computed inline per participant (cheap), Animated values held via `useRef`
Design Compliance: PASS — all four spec deviations from Review 1 are corrected against WF6/WF7 and the ceremonial kicker rule

Verification:
- `npx tsc --noEmit` exit 0 from `/Users/jacky/Napkin/napkin-app`
- Manual walk-through of the canvas→RN mapping for WF1/WF3/WF6/WF7 against the current code matches

Notes:
- Data-layer tradeoff on `TableSwitcherSheet` avatar stack (single 26px initials avatar + two muted companion discs, because `table-management` list endpoint doesn't surface per-table members) is a reasonable compromise given the visual-only scope. The silhouette density reads as "a table of people" at a glance, which is what the canvas primitive is signaling. Flagged in Revision 1 notes with an explicit code comment at L240-243 — acceptable.
- `liveRoundTableIds` limitation (only the active table's ID) is pre-existing from Review 1 and correctly noted as out-of-scope (would require a hook/edge-function change). Not a regression.
- `TableHeader` `+N` overflow bubble not applied — canvas WF5/WF6 don't show it either, and not a blocking item. Fine as-is.
- All previously-PASSing items from Review 1 (voice rules, scope discipline, rules-of-hooks ordering) remain intact — no regressions introduced.

Clean APPROVE — this is ready to ship.

## Completion
- **Date**: 2026-04-20
- **Final verdict**: APPROVE (after 1 revision cycle)
- **Shipped**: 4 new atoms in `components/tables/` (`TableHeader`, `EmptyChairInvitation`, `FoundedHero`, `TableSwitcherSheet`) + reskins on `app/(tabs)/tables.tsx`, `app/table-night-detail.tsx`, `components/feed/TableNightCard.tsx`, `components/feed/SoloShareCard.tsx`. No hook, edge function, or doctrine-adjacent changes.
- **Known limitations accepted in scope**: (1) Switcher-sheet rows show an approximated member avatar (single initials disc + two silhouette companions) rather than a true 3-avatar member stack — data layer doesn't surface members on the tables-list endpoint. (2) `liveRoundTableIds` only reflects the active table; cross-table live indicators would require a multi-table rounds fetch. Both tracked for a follow-up if/when the data surface catches up.
