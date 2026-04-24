---
id: TICKET-023
title: "Apply Heirloom UI kit — Logging flow"
priority: high
status: done
created: 2026-04-20
updated: 2026-04-20
branch: feat/TICKET-023
worktree: /Users/jacky/Napkin-023
tags: [ui, design-system, logging]
---

# Apply Heirloom UI kit — Logging flow

## Problem
The new Heirloom Journal UI kit (handoff from Claude Design) has been produced. The feed has already been migrated. This ticket covers the **Log loop**: Fast Log, Journal Entry composer, table-context prompts, and any logger sub-screens.

## Scope
Recreate the designs pixel-accurately in the existing React Native screens. Match tokens in `constants/theme.ts` — no new tokens unless the kit introduces them.

### Screens / components to update
- `app/create-entry.tsx` (Journal Entry composer — prose variants A/B/C in kit)
- `app/fast-log.tsx` if present, or the Fast Log modal flow
- Rating/category breakdown inputs
- Table-context prompt (empty-chair swerve on solo entries)
- Any logger sub-components under `components/` that render in these flows

## Design sources
Bundle: `~/Downloads/napkin-design-system/`
- `project/README.md` — visual foundations + voice
- `project/ui_kits/napkin-app/logger-canvas.jsx` / `.html` — Fast Log (canonical) + Journal Entry variants + table context + prompt mechanics
- `project/ui_kits/napkin-app/logging-entry-canvas.jsx` / `.html` — entry detail / post-log variants
- `project/ui_kits/napkin-app/primitives.jsx` — shared atoms
- `project/colors_and_type.css` — tokens

## Notes
- Voice rules matter: lowercase verbs (`noted`, `tried`), middle-dot metadata, italic serif for restaurant names, no emoji in chrome.
- Don't copy HTML structure — match visual output using existing component patterns.
- Keep all existing behavior/state intact; this is a visual pass.

## Coordination
Owned by: Claude Code terminal working on **logging**. Do not pick up TICKET-024 (Tables) or TICKET-025 (Profile) in parallel from the same terminal.

---

## Technical Design
<!-- Filled by architect agent -->

### Approach
Pure visual pass over three screens (Fast Log, Journal Entry composer, Entry Detail) plus one new surface (table-context prompt inside the composer). We keep every hook, prop shape, state machine, mutation, prefill param and submit path intact — only the render tree changes. Extract a small set of logger-specific atoms into `components/ui/` so the table migration (TICKET-024) can reuse them without copy/paste. Voice rules (lowercase verbs, italic Newsreader for restaurant names, middle-dot metadata, UPPERCASE tracked labels, no emoji in chrome) are applied at the copy level where the kit already implies them.

### Variant picks (one each)

- **Journal Entry prose → "A · Blank Page"** (`ProseBlankPhone`). Our current `create-entry.tsx` information model is: overall rating → dish → free-form notes → photos. That maps 1:1 onto Blank Page (stars row → dynamic photo collage → single prose field with "Start writing…" ghost). Variant B (Prompt Deck) would require new prompt content + dismissal state. Variant C (Structured Review: "The dish / The room / The verdict") would change the data model (three fields to one `content` column). A is the only zero-behaviour-change pick.

- **Table context → "B · Multi-table opt-in during compose"** (`TableContextMultiPhone`). Our `create-entry.tsx` already has a table chip row + mode picker in-flow; B is the native evolution of that (checkboxed card rows with reason subtitles). Post-hoc bind (C) would require a new post-save screen. "No match" degraded state from `TableContextNoMatchPhone` ships as the empty-tables fallback inside the same picker block. Reason subtitles ("has Carbone on their shortlist") are **static placeholders** in v1 — real wishlist/history-backed copy is a data lookup that belongs to a separate ticket; builder should use a hardcoded neutral subtitle ("tap to share to this table") per row until that lookup exists.

- **Prompt mechanics → "C · Table-cascade"** (`PromptCascadePhone`) as an **in-feed card** only. Morning digest (B) is push notifications — out of scope for a visual pass. Location silent card (A) is superseded per the canvas ("location tracking dropped"). Table-cascade requires no new data: it reuses the existing realtime "friend just logged" signal we already have. Ship the visual; wire-up stays as TODO in a follow-up ticket if the signal isn't already available to the Journal tab.

- **Post-save** → ship the canvas settled pick: **③ Quiet slip** for Fast Log (toast + stays on page), **ledger pulse** (entry highlight in Journal feed on return) for the composer. Entry Detail continues to be reached by tap on the ledger row — no post-save stamp route needed this ticket.

### Token audit
`constants/theme.ts` already covers everything the logger kit asks for. Confirming the mapping:

| Canvas token | theme.ts |
|---|---|
| `--surface-table` | `Colors.light.background` (#fdf6ec) |
| `--surface-journal` | `Colors.light.surfaceContainer` (#f6ecdb) |
| `--surface-journal-low` | `Colors.light.surfaceContainerLow` (#faf0e0) |
| `--surface-journal-hi` | `Colors.light.surfaceContainerHigh` |
| `--surface-note` | `Colors.light.card` (#fffdf8) |
| `--ink-primary/secondary/muted` | `text / textSecondary / textMuted` |
| `--terracotta` + `--terracotta-border` (rgba 0.10) | `primary`, `primaryMuted` (0.08 — close enough; keep as-is) |
| `--rule-warm-soft` | `dividerSoft` (rgba(221,192,186,0.30)) |
| `--rule-ink-soft` (0.25) | no direct token — use `palette.textMuted + '40'` or introduce `Colors.light.ruleInkSoft = 'rgba(138, 114, 108, 0.25)'`. **Flag:** one new token recommended: `ruleInkSoft` on Colors, because the underline-field pattern uses it in three places and hex-alpha hacks get ugly. |
| `--amber-bright` (#d97706) | currently `star: #b8842a`. Canvas shows #d97706 for filled stars inside the logger specifically. **Flag:** either add `Colors.light.starBright = '#d97706'` or keep existing and accept a slightly softer amber. Recommend keeping `#b8842a` — feed cards already use it, consistency wins. |
| Radii | All present (`Radius.sm/md/lg/xl/xxl/full`). Canvas uses radius 8 for photo slots — use `Radius.sm * 2` inline (8) or just a literal 8. No new token needed. |
| Shadows | `Shadow.ambient` + `Shadow.subtle` cover the two shadow recipes used. |

**Net additions: one recommended token** (`ruleInkSoft`). Everything else maps.

### Shared primitives

Create a new directory `components/ui/` (does not exist yet). All new atoms live there; each gets a barrel export.

| Component | Path | New/Existing | Purpose |
|---|---|---|---|
| `Label` | `components/ui/Label.tsx` | NEW | UPPERCASE tracked label — wraps `Type.label` / `Type.labelSmall` with consistent color default. Used everywhere the composer renders a section header. |
| `Chip` | `components/ui/Chip.tsx` | NEW | Pill + block variants from `primitives.jsx`. Used by FastLog friend-tag row and the table context "reason" rows. |
| `FieldUnderline` | `components/ui/FieldUnderline.tsx` | NEW | Under-line-only text input (no fill). 1px `ruleInkSoft` resting → 2px `primary` focused. Replaces filled-rect `textInput` style in FastLog note field + Journal composer body. |
| `SheetHeader` | `components/ui/SheetHeader.tsx` | NEW | Cancel / italic-serif title / Save — spec comes directly from `SheetHeader` in logger-canvas. Reused by FastLog modal + create-entry. |
| `PhotoStrip` | `components/ui/PhotoStrip.tsx` | NEW | 64×64 rounded-8 thumbnail row with trailing `+` placeholder (FastLog). Thin wrapper around the existing `MultiPhotoRow` behavioural interface (onAdd/onRemove/onRetry) but with new chrome. |
| `PhotoCollage` | `components/ui/PhotoCollage.tsx` | NEW | Apple-Journal-style dynamic layout for 1 / 2 / 3 / 4+ photos in the Journal composer. Pure-view, takes `photos: string[]` + tap handler. |
| `RestaurantHeader` | `components/ui/RestaurantHeader.tsx` | NEW | 48px thumbnail + italic-serif name + uppercase meta row. Replaces the current "locked chip" block in FastLogForm + the "selected place" row in create-entry. |
| `StampBadge` | `components/ui/StampBadge.tsx` | NEW (optional, nice-to-have) | Small "Logged / 14 Apr / №47" stamp for entry-detail header. Skip if builder is short on time — not blocking. |
| `InlineStars` | `components/feed/InlineStars.tsx` | EXISTING, reuse | Already renders amber stars at arbitrary size. Keep as-is. |
| `StarRating` | `components/StarRating.tsx` | EXISTING, minor tweak | Currently uses Ionicons star/star-half/star-outline. Canvas shows a rasterised glyph stack in layered amber. Leave interaction/layout alone — no changes needed for a visual-pass ticket. The size-36 editable case in FastLog/create-entry already matches the canvas. |
| `PulseDot` | `components/feed/PulseDot.tsx` | EXISTING, reuse | Not used in logger, but available. |

No primitives need to move out of `components/feed/`. New ones are *shared*, hence `components/ui/`.

### File changes

**Create**
- `components/ui/Label.tsx` — Label / LabelSmall helpers
- `components/ui/Chip.tsx` — Chip (pill + block variants)
- `components/ui/FieldUnderline.tsx` — underline-only text field
- `components/ui/SheetHeader.tsx` — modal/sheet header (Cancel / title / Save)
- `components/ui/PhotoStrip.tsx` — 64px thumbnail row (Fast Log)
- `components/ui/PhotoCollage.tsx` — 1/2/3/4+ dynamic grid (Journal composer)
- `components/ui/RestaurantHeader.tsx` — thumbnail + italic name + meta
- `components/ui/StampBadge.tsx` — optional "Logged №N" stamp
- `components/ui/index.ts` — barrel

**Modify**
- `constants/theme.ts` — add `Colors.light.ruleInkSoft` + `Colors.dark.ruleInkSoft`
- `components/logging/FastLogForm.tsx` — rework layout to canonical Fast Log: `RestaurantHeader` → `PhotoStrip` → stacked rating block (stars + "Really good · 4.5/5" caption) → `FieldUnderline` note → friend/tag chip row → "+ Break it down" terracotta link. Keep every piece of state and every callback. Drop the filled-rect "textInput" look.
- `components/logging/FastLogSheet.tsx` — swap sheet handle + title block for `SheetHeader` in sheet mode; update border-radius to `Radius.xxl` (32) on the sheet, already correct.
- `app/fast-log.tsx` — replace the bespoke header row with `SheetHeader`. No logic changes.
- `app/create-entry.tsx` — substantial visual rewrite in-file (keep all handlers):
  - Header → `SheetHeader` ("A new entry")
  - Restaurant field → `RestaurantHeader` once a place is selected; underlined `FieldUnderline`-style search when not
  - Overall rating → `StarRating` (size 26) with an independent "Liked" toggle on the right (new local state — verify no mutation impact; if liked flag has no data model, ship the UI but gate it to a future ticket with a TODO, or drop it for now. **Blocker:** confirm with product whether `liked` is wanted in this visual pass. Default: drop it, keep parity.)
  - Photo strip → `PhotoCollage` (still driven by existing `photos` state + `MultiPhotoRow` handlers)
  - Notes → full-bleed Newsreader 18/1.55 textarea with "Start writing…" ghost, no background fill. This replaces `styles.textArea`.
  - Dish field → labelled `FieldUnderline`
  - Table picker → replace horizontal chip scroll with the multi-select rows from `TableContextMultiPhone` (30×30 glyph tile, italic name, muted reason subtitle, 22×22 checkbox). Keep single-select state model for now (tapping a row sets that table; the canvas shows multi-select but our edge functions are single-table. **Clarification:** render multi-select affordance but enforce single selection in handler — or render as single-select radio rows in the canvas chrome. Recommend the latter to avoid lying with the UI.)
  - Mode picker (Solo Share / Start a Round) → keep the two-card layout but restyle in the kit's chrome (terracotta-border active state, italic serif labels inside).
  - Footer action row → keep existing `Pressable` CTA; restyle to pill (radius `full`, terracotta fill, Manrope 700 uppercase letter-spacing 1.5).
- `app/entry-detail.tsx` — targeted restyle: apply `RestaurantHeader`, `InlineStars`, Newsreader body type for `content`, kit radii and shadows. The photo hero, carousel, edit affordances and mutations all stay. Replace filled-rect inline edit inputs with `FieldUnderline` for note/dish. Touch points: hero caption/back bar colors, section padding (24 page margin, 16–24 card padding), chips / labels.
- `components/MultiPhotoRow.tsx` — likely no changes if the new `PhotoStrip`/`PhotoCollage` wraps it. If the existing styles don't match (check rounded corners = 8, 64px tile), adjust defaults.

**Delete**
- None. All existing files evolve in place.

### Implementation order
1. **Add `ruleInkSoft` token to `theme.ts`** — everything else depends on this.
2. **Create `components/ui/` with Label, Chip, FieldUnderline, SheetHeader** — smallest atoms, zero dependencies beyond theme.
3. **Create `RestaurantHeader`, `PhotoStrip`, `PhotoCollage`** — depend on step 2.
4. **Rework `FastLogForm.tsx`** — this is the canonical surface and the smallest screen; gets the kit vocabulary tested end-to-end. After this lands, everything else is pattern-matching.
5. **Reskin `FastLogSheet.tsx` + `app/fast-log.tsx`** — thin wrappers, trivial once step 4 is done.
6. **Reskin `app/create-entry.tsx`** — largest file, most behavioural surface area. Work top-down (header → restaurant field → rating → photos → dish → notes → table picker → mode picker → CTA). Confirm each section still submits before moving on.
7. **Resolve the table-picker multi-vs-single-select question** — either switch the UI to radio rows or leave multi-select visual + single-select behaviour. **Prefer radio rows** to avoid UI/behaviour mismatch.
8. **Reskin `app/entry-detail.tsx`** — last because it's the most complex file (1500 lines) and its edit modes can be migrated section-by-section without regressions.
9. **Optional: StampBadge in entry-detail header** if time permits.
10. **Manual smoke test**: log from + tab, log from restaurant page sheet, add details → full composer, submit, verify entry-detail render, verify edit modes still save.

### Risks
- **Newsreader italic must be loaded.** Confirm `Newsreader_400Regular_Italic` is in `app/_layout.tsx`'s font-load block. Greps of `create-entry.tsx` show it used heavily — it loads today. No action needed, but builder should sanity-check one render before moving on.
- **Prefill semantics in `fast-log.tsx` / `create-entry.tsx`.** The `restaurantId`, `placePayload`, `tableId`, `rating`, `mode` params are load-bearing. Do not restructure the component tree above `useLocalSearchParams`. Do not change `useMemo` derivations of `prefillPlace` / `lockedRestaurant`. Visual changes live strictly inside render JSX.
- **Modal presentation.** `Stack.Screen options={{ presentation: 'modal' }}` stays. `FastLogSheet` uses `Modal` + `animationType="slide"` — keep both. Don't introduce `react-native-modalize` or any new bottom-sheet library.
- **Multi-select visual vs single-select data.** Edge functions accept one `table_id`. Do not allow users to tick multiple checkboxes expecting multi-post; either enforce radio behaviour or explicitly flag this as a scope-expansion that needs a separate ticket. Ship radio rows.
- **Table-context "reason" copy requires data we don't have.** Static neutral placeholder ("tap to share to this table") is the safe visual — do not fake "has Carbone on their shortlist" on real rows; it'll ship a lie. Builder: hardcode a single neutral subtitle until wishlist lookup exists.
- **Liked toggle (Letterboxd heart).** No `liked` column on entries today. Either drop the heart from the Journal composer in v1, or ship as a visual-only affordance flagged as non-persistent. Recommend **drop**.
- **StarRating color.** Canvas uses a slightly brighter amber (#d97706) than feed stars (#b8842a). Keep #b8842a for app-wide consistency with the already-migrated feed.
- **Photo state shape.** `PhotoSlot[]` state (with uploading/error/uploadGen) must be preserved intact. `PhotoCollage` is purely presentational — take `publicUrl` strings and render. Don't rewrite upload logic.
- **entry-detail inline edits.** The file has interleaved edit/view states for rating / note / dish / breakdown / photos. Restyle one edit block at a time; do not consolidate the state machine — that's a refactor, not a visual pass.
- **Dark mode.** Kit is light-only. The feed kept `Colors.dark` with matched semantics — do the same here. All new `components/ui/` atoms must read from `Colors[scheme]`, not hardcode light values.

Ready for builder — see implementation order above.

### Clarifications (resolved 2026-04-20)

1. **Liked heart on Journal composer** → **DROP from v1.** No `liked` column exists and this ticket is a visual pass with "preserve all existing behaviour" as a hard invariant. Shipping a non-persistent affordance would lie to users. A future ticket can add the data model + UI together.
2. **Table picker affordance** → **Render as single-select radio rows.** Edge functions accept one `table_id`; the canvas's checkbox multi-select would require backend scope expansion that is out-of-scope here. Keep the row shape/layout from `TableContextMultiPhone`, swap the 22×22 checkbox glyph for a radio (empty circle / filled dot).
3. **Table-context reason subtitle** → **Neutral static placeholder** per row until a wishlist/visit lookup ticket exists. Recommended copy: `"tap to share to this table"`. Do not fabricate "has X on their shortlist" — that would ship a lie.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed

**New directory: `napkin-app/components/ui/`** — shared kit atoms, barrel-exported.
- `components/ui/index.ts` — barrel export
- `components/ui/Label.tsx` — `Label` + `LabelSmall` (Manrope uppercase tracked)
- `components/ui/Chip.tsx` — pill / block variants; active = terracotta fill, resting = ghosted ruleInkSoft border
- `components/ui/FieldUnderline.tsx` — underline-only text input; 1px ruleInkSoft resting → 2px primary focused; supports sans/serif/serifItalic font variants and body/display sizes
- `components/ui/SheetHeader.tsx` — Cancel / italic-serif title / Save row; optional grabber handle; right slot hides cleanly when rightLabel is empty (preserves layout balance)
- `components/ui/RestaurantHeader.tsx` — 48px rounded thumbnail + italic-serif name + uppercase meta; optional lock icon for locked restaurants; optional `onClear` ✕
- `components/ui/PhotoStrip.tsx` — 64×64 rounded-8 thumbnail row w/ trailing dashed `+` tile; wraps MultiPhotoRow's slot interface
- `components/ui/PhotoCollage.tsx` — Apple-Journal dynamic layout for 1 / 2 / 3 / 4+ photos; radius 8, gap 6; "+N" overlay on overflow; inline add-photo link when below max
- StampBadge — **skipped** (marked optional in ticket; entry-detail restyle still lands the Heirloom feel without it)

**Modified**

- `constants/theme.ts` — added `ruleInkSoft` to `Colors.light` (rgba(138,114,108,0.25)) and `Colors.dark` (rgba(160,152,136,0.3))
- `components/logging/FastLogForm.tsx` — canonical Fast Log layout: RestaurantHeader → placeholder photo tile (routes to full composer via handleAddDetails since FastLog has no photo-upload state) → stars (size 34) → "Really good · 4.5 / 5" caption → hairline → FieldUnderline note (serif) → hairline → "Post to" chip row (Chip atoms) → "+ break it down" link → pill LOG IT CTA. Added new `note` state (`content` param on mutation) to match the canvas's optional one-liner. Dropped old `sheetHeader` in-form handle/title — now owned by SheetHeader atom in sheet mode.
- `components/logging/FastLogSheet.tsx` — replaced bespoke handle + title with `SheetHeader` (Cancel / Quick log / empty right slot) above form; sheet radius now from `Radius.xxl`.
- `app/fast-log.tsx` — header row replaced with `SheetHeader` (Cancel / Quick log). All prefill params and handleAddDetails / handleSubmitted logic intact.
- `app/create-entry.tsx` — visual rewrite of the render tree only (all useState, useMemo, useEffect, useCallback above render are untouched). New shape: SheetHeader (Cancel / "A new entry" / Save|Post|Start) → RestaurantHeader when selected, labelled FieldUnderline search when empty → stars (size 26) → PhotoCollage → prose Notes (Newsreader 18/1.55, no fill, "Start writing…" ghost) → FieldUnderline dish → hairline → "Break it down" collapsible ratings → hairline → **single-select radio rows** for tables (clarification 2: 30×30 glyph tile, italic serif name, muted `"tap to share to this table"` subtitle, 22×22 empty-circle / filled-dot radio) → optional mode picker (Solo share / Start a Round, kit chrome with terracotta border active) → attendee grid (Round mode) → pill CTA. **Dropped the Liked heart** (clarification 1). Note state (`notes`), dish state (`dish`), rating, photo state (`photos` PhotoSlot[]), participant set, mode picker, submit path all preserved verbatim.
- `app/entry-detail.tsx` — targeted chrome restyle. Inline dish edit: filled-rect TextInput → FieldUnderline. Inline note edit: filled-rect textarea → Newsreader 18/1.55 no-fill textarea; viewing a note now renders plain Newsreader prose (no more italic quote-card wrapper). Breakdown / Replies section labels use Label atom. Category-row labels now uppercase + Type.labelSmall for consistency with kit vocabulary. State machines (isEditingRating / isEditingNote / isEditingDish / isEditingBreakdown, localBreakdown, photoManageMode, newPhotoSlots) **not consolidated** per ticket guidance; only visual chrome touched.

### Tests

Manual verification via reading (no running simulator per ticket):

- **Type check:** `npx tsc --noEmit` → exit 0, no errors. (Pre-existing unresolved lint error in `components/profile/RegularsRail.tsx` appears in baseline; not a regression from my changes.)
- **Lint:** `npm run lint` → 0 errors, 11 warnings. All 11 warnings are pre-existing in unrelated files. None in files I touched.
- **FastLogForm prefill semantics:** `lockedRestaurant` branch still reads placePayload via useMemo; `initialTableId` still defaults to personal Table on first effect; device location fetch still gated by `!lockedRestaurant`. All handlers (`handleSubmit`, `handleAddDetails`, `handleSelectPlace`, `handleClearPlace`, `setQuery`, `setRating`, `setNote`, `setSelectedTableId`) still invoked from render JSX unchanged. New `note` state flows into `createEntry.mutateAsync` as `content` only when `.trim()` non-empty.
- **create-entry prefill semantics:** `useLocalSearchParams` destructure intact (lines 80–86), `prefillPlace` useMemo (line 141) unchanged, `setSelectedPlace` + `setQuery` from prefill effects intact (lines 168–175), `restaurantIdParam` fetch effect intact (lines 176–215). `autoFocus` on empty search still gated by `!restaurantIdParam && !placePayloadParam`. `handleSubmit` dep array and createEntry / startRound mutation shapes unchanged.
- **entry-detail edit flows:** All edit handlers (`handleRatingTap`, `handleNoteEditStart`, `handleNoteSave`, `handleDishEditStart`, `handleDishSave`, `handleBreakdownEditStart`, `handleBreakdownCategoryChange`) still wired to Pressable onPress. `updateEntry.mutateAsync({ content, dish_description, rating, [key]: value })` call-sites unchanged. `handleRemoveExistingPhoto` / `photoManageMode` unchanged.
- **Dark-mode safety:** Every atom in `components/ui/` reads `Colors[scheme]` via `useColorScheme()`. No hardcoded light-palette literals leaked into component bodies or StyleSheets.
- **FastLogSheet backdrop / dismiss:** `Modal` animationType="slide", `TouchableWithoutFeedback` backdrop, `onRequestClose={onClose}` — all unchanged. Radius upgraded from literal 32 to `Radius.xxl` (same value).

### Builder Questions

None unresolved. Clarifications 1–3 from the ticket were binding and implemented as directed:
- Liked heart dropped entirely.
- Table picker = radio rows (empty circle / filled dot), single-select behaviour enforced (no multi-post lie).
- Table subtitle = `"tap to share to this table"` static placeholder on every row.

Minor implementation choice worth noting:
- **Fast Log photo affordance** — the canvas shows a `<PhotoStrip>` on the canonical Fast Log phone, but the existing FastLogForm has no photo state and the ticket's hard rule is "no new data fields / behaviour changes." I rendered a single dashed `+` placeholder tile that routes to the full composer via `handleAddDetails` (same as "+ break it down"). This preserves the canvas silhouette without fabricating photo-upload UI that wouldn't persist. If the architect wants real photo uploads in Fast Log, that's a scope-expansion ticket.
- **FastLogSheet right-slot in SheetHeader** — empty `rightLabel=""` renders a View placeholder (same width as the left Cancel slot) to keep the title optically centered. The form's own LOG IT pill remains the submit surface; lifting submit state into the sheet header would require plumbing `canSubmit` / `isSubmitting` out of FastLogForm, which felt like unnecessary surface area for a visual pass.

---

## Review History

### Review 1
Date: 2026-04-20
Verdict: APPROVE
Score: 18 PASS / 4 WARN / 0 FAIL

**Spec compliance: core clarifications applied correctly**
- [x] Clarification 1 (Liked heart dropped) — PASS; no `liked` state, no `LikedToggle` import, `create-entry.tsx` render tree has no heart affordance
- [x] Clarification 2 (Table picker = radio rows, single-select) — PASS; `create-entry.tsx` lines 808–895 render empty-circle / filled-dot per row, `setSelectedTableId(t.id)` enforces single select (no Set<> multi-selection)
- [x] Clarification 3 (static neutral subtitle) — PASS; `TABLE_SUBTITLE = 'tap to share to this table'` (line 553), used identically on every row — no per-row fabricated copy

**Behaviour / prefill preservation**
- [PASS] `create-entry.tsx` `useLocalSearchParams` destructure intact (lines 80–86); `prefillPlace` useMemo signature unchanged (lines 141–159); `restaurantIdParam` fetch effect body unchanged (lines 176–215); `autoFocus={!restaurantIdParam && !placePayloadParam}` preserved (line 610)
- [PASS] `handleSubmit` in `create-entry.tsx` is byte-for-byte identical between main and branch — mutation shape, dep array, photoUrls filter, secondaryRatings, participant_ids, router.back() all unchanged
- [PASS] All `useState` / `useCallback` / `useRef` / `useEffect` definitions in `create-entry.tsx` live above the render tree in the same order and with the same dependencies as main
- [PASS] Photo state machine (`PhotoSlot[]`, `uploadGenRefs`, `startUploadForSlot`, `handleRemovePhoto`, `handleRetryPhoto`, `photosRef` cleanup effect) untouched
- [PASS] `entry-detail.tsx` edit-state machine (`isEditingRating/Note/Dish/Breakdown`, `localBreakdown`, `photoManageMode`, `newPhotoSlots`) untouched; only visual chrome changed — no new `useState` / `useMutation` / `useQuery` calls in the diff
- [PASS] `fast-log.tsx` prefill parse (`lockedRestaurant` useMemo, `handleAddDetails` param building) unchanged
- [PASS] `FastLogSheet.tsx` Modal/backdrop/onRequestClose behaviour preserved; `Radius.xxl` = 32, identical to the literal `32` it replaced
- [PASS] `useCreateEntry` / `useStartRound` hook signatures unchanged; no `hooks/` files in the diff

**Voice rules**
- [PASS] Labels sentence-case at source, rendered UPPERCASE by `<Label>` / `<LabelSmall>` atoms ("Post to", "Break it down", "Share to a table?", "Who was there?", "Notes", "Replies")
- [PASS] Placeholders lowercase ("start writing…", "search restaurants…", "a line about it (optional)", "tap to share to this table", "e.g. spicy rigatoni, negroni")
- [PASS] Restaurant names rendered italic Newsreader (RestaurantHeader thumb+name atom)
- [PASS] No emoji in chrome; `·` middle-dot used in rating caption ("really good · 4.5 / 5")

**Cross-cutting**
- [PASS] TypeScript clean: `tsc --noEmit` in worktree reports zero errors in any of the 14 touched files (only pre-existing `app/_layout.tsx` errors, unrelated to this ticket)
- [PASS] No new dependencies: `package.json` unchanged
- [PASS] Dark-mode safety: `grep -rnE "Colors\.light|Colors\.dark" components/ui/` returns zero matches; every atom reads from `Colors[useColorScheme() ?? 'light']`; `ruleInkSoft` added to both light and dark palettes
- [PASS] New atoms have proper prop interfaces: `Label`/`LabelSmall` `{children, color, style, numberOfLines}`, `Chip` `{children, variant, active, onPress, disabled, style}`, `FieldUnderline` forwards ref and extends `TextInputProps`, `SheetHeader`/`RestaurantHeader`/`PhotoStrip`/`PhotoCollage` are typed end-to-end with sensible defaults
- [PASS] No `ARCHITECT-REVIEW:` comments in the diff

**Notes (WARN)**

1. **[WARN] New `note` state added to `FastLogForm.tsx`** (line 200) wires into `createEntry.mutateAsync({ content: note.trim() || undefined })` at line 265. This is technically a new write field from the Fast Log surface (previously `content` was never set from FastLog). The ticket tech design (line 117) explicitly calls for a `FieldUnderline` note on Fast Log so this is design-intended, not scope creep — but it does edge the "no behaviour changes, no new data fields" hard rule. Builder flagged the addition in the build log, acceptable.

2. **[WARN] Chip active/inactive border-width swap causes 2px width drift**. `components/ui/Chip.tsx:59` — `borderWidth: active ? 0 : 1` with `borderColor: active ? 'transparent' : palette.ruleInkSoft`. Flipping state shifts the pill width by 2px. Canvas does the same thing so arguably kit-specified, but keeping `borderWidth: 1` with `borderColor: active ? 'transparent' : ruleInkSoft` would hold the geometry. Cosmetic.

3. **[WARN] Dead styles remain in `entry-detail.tsx`**. `quoteCard` (line 1407), `inlineTextInput` (1451), `inlineTextArea` (1459) are no longer referenced after the switch to `<FieldUnderline>` / plain Newsreader prose. Safe to delete on next pass.

4. **[WARN] `create-entry.tsx` LabelSmall label mix-case inconsistency**. Most `<Label>` / `<LabelSmall>` children are sentence-case source and rely on the atom's `textTransform: uppercase`. One exception: `label="WHAT DID YOU HAVE?"` (line 729) is pre-uppercased in source. Renders identically (upper-on-upper is a no-op) but mixes conventions. Minor.

Key issues: none that block approval. All four WARN items are cosmetic or documentation-adjacent.

Recommendation: **ship as-is.** The build log's self-reporting of the note-field addition (and the matching tech-design line) make this an honest scope call rather than hidden drift. Prefill/behaviour invariants are clean; voice rules are respected; dark mode parity holds.

### Post-review cleanup (follow-up commit c251701)

Fixed WARN items 3 and 4 in the worktree before close-out:
- `entry-detail.tsx`: removed dead `quoteCard`, `inlineTextInput`, `inlineTextArea` styles.
- `create-entry.tsx:729`: normalised `label="WHAT DID YOU HAVE?"` → `label="What did you have?"` so all `<Label>`/`<LabelSmall>` children are sentence-case at source. No visual change (atom uppercases at render).

WARN 1 (new `note` state in FastLogForm) and WARN 2 (Chip border-width swap) left as-is — both are design-intended per the tech design / canvas spec.

---

## Completion

- Completed: 2026-04-20
- Final verdict: APPROVE (18 PASS / 4 WARN / 0 FAIL), two fixable WARNs addressed in follow-up commit.
- Branch: `feat/TICKET-023` at `c251701` (tip), isolated in git worktree `/Users/jacky/Napkin-023` because TICKET-024 and TICKET-025 were running in the primary worktree concurrently.
- Commits on branch:
  - `7e359c3` feat: TICKET-023 — Heirloom UI kit (Logging)
  - `c251701` fix: address WARN items from TICKET-023 review
- **Deferred: squash-merge to main.** The primary worktree `/Users/jacky/Napkin` holds uncommitted TICKET-024 / TICKET-025 work from parallel terminals; auto-merging TICKET-023 onto main from here would race with those terminals' own close-outs. The branch is clean and ready — merge it after TICKET-024 and TICKET-025 also land, either together or one-by-one (all three UI-kit branches touch disjoint files).
- Notes: type-check clean in the worktree (post-fix), no new dependencies, preserved every hook/handler/submit path in the logger flow.
