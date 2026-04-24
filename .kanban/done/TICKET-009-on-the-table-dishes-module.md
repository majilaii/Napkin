---
id: TICKET-009
title: "On the Table — promote dish data into a menu-card module"
priority: medium
status: ready
created: 2026-04-16
updated: 2026-04-17
tags: [enrichment, round-detail, entry-detail, typography, dishes]
---

# "On the Table" Dishes Module

## Problem

`dish_description` is already captured in every entry, and TICKET-004 plumbed it through so participants' dishes appear on Round detail. But it's rendered as a thin amber chip inside each participant card — treated as metadata, not content.

For a meal where everyone ordered different things ("we shared"), the *collective menu* is the most memorable part of the night. "What did the table order?" is a question people ask about dinners *all the time*. The data exists, but the page doesn't answer it. Instead you have to scan four participant cards and piece it together from chips.

**The mental model is a restaurant's menu card, or a wine pairing sheet from a tasting dinner.** Newsreader italic for dish names. Small caps for the person who ordered it. The rating as a pull number. Read it top to bottom like a menu.

**Who has this problem:** anyone viewing a Round detail for a meal with mixed orders. Also, solo entries where the person logged a specific dish — the dish should feel like the *subject* of the entry, not a footnote.

**Why it matters:** food apps that don't foreground food feel wrong. Right now a Napkin Round reads "people + scores." It should read "dinner + dishes + scores." This is a cheap, high-leverage upgrade that uses data you already have.

## Notes

### What this ticket delivers

A new "On the Table" section on Round detail, rendered as a menu-card-style list. Dishes get editorial typographic treatment, each attributed to the person and their rating.

Also upgrades the dish display on Entry detail — the dish becomes a header line, not a buried chip.

### Concrete additions

| # | What | Where | Effort |
|---|---|---|---|
| 1 | "On the Table" list module — ranked dishes with attribution + rating | `app/table-night-detail.tsx` (new section, between Breakdown and Who Said What) | S-M |
| 2 | Typographic upgrade: dish name in `Newsreader_400Regular_Italic`, 20px | new component | S |
| 3 | "Highest rated dish" gets amber tint + subtle 👑 or star ornament | new component | S |
| 4 | Remove dish chip from `ParticipantRow` on Round detail (now redundant) | `app/table-night-detail.tsx` | S |
| 5 | Dish block on Entry detail — dish name as a subheader above notes, not a chip | `app/entry-detail.tsx` | S |
| 6 | Empty state: if no participants logged a dish, hide the section entirely | `app/table-night-detail.tsx` | S |
| 7 | Partial state: if only *some* participants logged dishes, section still renders with only those | `app/table-night-detail.tsx` | S |

### Visual sketch (prose description)

Section header in small caps: `ON THE TABLE`

Then a list of rows, each one rendered like:

```
Spaghetti alle vongole                         4.5
— ordered by Sarah                              ★
.........................................
Cacio e pepe                                    4.0
— ordered by Jacky
.........................................
Porchetta sandwich                              3.5
— ordered by Marco
```

- Dish name: Newsreader italic, 20px, `palette.text`
- "— ordered by X": Manrope, 11px label style, `palette.textMuted`, with actual em-dash
- Rating: Newsreader italic 22px, `palette.tertiary` (amber)
- Highest-rated row: faint `tertiaryFixed` background tint, amber star ornament
- Dividers between rows: no hard border — use `Spacing.md` vertical gap + a ghost divider (`palette.divider`, 1px)
- Rank by rating descending. Ties broken by entry `created_at` ascending (who submitted first).

### UX decisions to lock in during product spec

- **Rank by rating descending, not submission order.** Reading the menu top-to-bottom becomes an implicit "what was the best thing?" ranking. This is the *point*.
- **Highest-rated dish gets a marker.** If there's a tie at the top, all tied dishes get the marker.
- **If only one participant logged a dish, still render the module.** Single-item list is fine. The section header "On the Table" still reads naturally.
- **Remove the dish chip from ParticipantRow** on Round detail, because it's now redundant. Entry detail (which is one person's page) keeps dish inline — that's one person's meal, not the table's menu.
- **Tapping a dish row navigates to the entry detail** for the person who ordered it. Makes the menu a navigation surface.
- **Don't link dishes to external menus / menu items from Google Places.** Pure text.
- **Dish name character limit stays at whatever `dish_description` currently allows.** If that's >80 chars, truncate with ellipsis in this module (full text still on entry detail).

### Entry detail dish treatment

Currently on entry detail: small amber chip labeled with dish text.

Proposed: render dish name as a subtle subheader directly below the restaurant name, in Newsreader italic 18px, `palette.textSecondary`, prefixed with a small em-dash or ornament. Removes the chip, promotes the dish into a first-class part of the page hierarchy.

Example:
```
Lucali
Brooklyn, NY
— Spaghetti alle vongole
```

### Data layer

No new queries, no new tables. Uses `dish_description` from `TableNightParticipant` (already plumbed in TICKET-004) and the existing `dish_description` on solo entries.

### Out of scope

- ❌ Multiple dishes per person (would need a new `entry_dishes` table — explicitly v2 per CLAUDE.md)
- ❌ Dish-level ratings (v2 — per CLAUDE.md, `table_night_dishes` and `table_night_dish_ratings` tables exist but we ignore them)
- ❌ Photos attached to specific dishes
- ❌ "Dishes popular at this restaurant" cross-Round aggregation (restaurant screen territory, TICKET-008)
- ❌ Dish search / typeahead from menu data
- ❌ Editing a dish post-hoc

### Risks

- **Data quality** — dish_description is free-text. Someone types "pasta," someone types "the noodle dish," someone types "cacio e pepe e funghi al tartufo with extra pepper." The module must handle both 3-char and 80+ char strings gracefully. Long strings wrap; very long get truncated in this module only.
- **Removing the chip on ParticipantRow is a visible regression for people who liked it there.** Mitigation: the new module makes the dish *more* prominent, not less. But flag in product spec.
- **Highest-rated visual call-out can mislead** with small n. If only two people rated and one is 4.5, one is 4.0, the "highest" marker may feel overstated. Mitigation: only show the marker when ≥3 participants have dish data, OR when the highest is ≥0.5 above the next. Decide in spec.

### Files touched (anticipated)

- **New**: `components/round/OnTheTableList.tsx`, `components/round/DishRow.tsx`
- **Modified**: `app/table-night-detail.tsx` (new section, remove chip from ParticipantRow), `app/entry-detail.tsx` (dish promotion)

### Dependencies

- Depends on TICKET-004 (dish data plumbed through `status` edge function) — already done ✅

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec

### User Stories

- As a **user viewing a revealed Round**, I want to see the collective menu — what each person ordered — laid out like a menu card, so that I can remember the night as "dinner + dishes + scores" instead of just "people + scores."
- As a **user scanning a Round**, I want dishes ranked by rating top-to-bottom, so that "what was the best thing at the table?" reads itself without me mentally re-sorting.
- As a **user who wants to jump to a specific dish's context**, I want tapping a dish row to open the entry detail for the person who ordered it, so that the menu becomes a navigation surface into individual takes.
- As a **user viewing a Round with mixed data quality** (some people logged a dish, some didn't), I want the section to still render with only the dishes that were logged, so that partial data still produces a useful artifact.
- As a **user viewing a Round where nobody logged a dish**, I want the section to disappear entirely, so that I'm not staring at an empty "On the Table" header.
- As a **user viewing a solo entry with a dish**, I want the dish to read as the subject of the entry (a subheader, not a buried chip), so that the page hierarchy says "this was *about* the spaghetti."
- As a **user viewing a solo entry without a dish**, I want the dish line absent entirely, so that the header block stays clean.
- As a **participant in a live Round (pre-reveal)**, I want the On the Table module hidden, so that highest-rated hints don't leak before reveal.

### Acceptance Criteria

**Section placement & render conditions (Round detail)**
- [ ] New "On the Table" section renders between the "Breakdown" section and the "Who Said What" section in `/Users/jacky/Napkin/napkin-app/app/table-night-detail.tsx`.
- [ ] Section only renders when `nightStatus.status === 'revealed' || 'closed'`. During `rating` or earlier phases it is absent, because surfacing highest-rated leaks info.
- [ ] Section only renders when at least one participant has a non-null `dish_description`. Zero dishes = section absent, no header, no placeholder text.
- [ ] If a participant has no `dish_description`, they do not appear in the module (but still appear in Who Said What as today).

**Section header**
- [ ] Header text `ON THE TABLE` styled with the existing `Type.label` token (Manrope 700, 11px, `letterSpacing: 1.5`, uppercase) in `palette.textSecondary`, matching `SectionLabel` used elsewhere on the screen.

**Dish row structure**
- [ ] Each row renders three elements: dish name (left, wraps), rating (right, fixed-width numeric), attribution line `— ordered by <display_name>` beneath the dish name.
- [ ] Dish name: `Newsreader_400Regular_Italic`, 20px, `palette.text`. Closest existing token: `Type.headlineMedium` has the right family/weight but is 20px non-italic — the builder should apply `fontFamily: 'Newsreader_400Regular_Italic'` explicitly on top of the preset (same pattern used on `table-night-detail.tsx:342-350` for the restaurant name).
- [ ] Attribution: `Type.labelSmall` (Manrope 600, 9px, uppercase) OR 11px Manrope regular in `palette.textMuted`. Builder choice — `Type.labelSmall` is closest existing token but is 9px uppercase; if the editorial "— ordered by Sarah" needs mixed-case 11px, apply an ad-hoc style matching `Type.caption` (12px Manrope 500) in `palette.textMuted`. The em-dash character `—` (not a hyphen) must prefix the name.
- [ ] Rating: `Newsreader_400Regular_Italic`, 22px, `palette.tertiary` (amber). Closest existing token: `Type.rating` (24px) or the `Type.rating` used at 22px in the Breakdown section (`table-night-detail.tsx:422`) — the builder should follow that precedent and render as `[Type.rating, { color: palette.tertiary, fontSize: 22 }]`.
- [ ] Rating displays the participant's overall `rating` (the same `participant.rating` shown in Who Said What), formatted `X.X` with one decimal.

**Rank & tiebreaker**
- [ ] Rows are ranked by `participant.rating` descending.
- [ ] Ties broken by the participant's entry `created_at` ascending (earliest submitter first).

**Highest-rated marker**
- [ ] A marker (subtle amber star ornament + faint `palette.tertiaryFixed` background tint on the row) is rendered only when all three conditions are met:
  1. At least 3 participants logged a `dish_description`, AND
  2. The top rating is strictly greater than the second-highest rating (no equal values at the top), AND
  3. The top rating is ≥ 0.5 above the second-highest.
- [ ] If multiple participants are tied at the top (equal to the current highest), no marker is rendered — a tie is not a winner.
- [ ] When fewer than 3 participants logged dishes, the module still renders with the available rows but no marker.

**Tap behavior**
- [ ] Each dish row is fully tappable. Tap navigates to `/entry-detail` with params `{ nightId, userId: participant.user_id }` — identical to the existing ParticipantRow tap behavior in `table-night-detail.tsx:912-918`.
- [ ] No nested tap targets inside the row — "— ordered by X" is display-only, not a link to the member profile. Member profile access remains via the avatar on the Who Said What participant row.

**Truncation**
- [ ] Dish names longer than 80 characters are truncated with a trailing ellipsis inside this module. Full text continues to render in full on entry detail.
- [ ] Dish names under 80 characters wrap to a second line as needed; no truncation applied.

**Row dividers**
- [ ] Rows separated by `Spacing.md` vertical gap and a 1px ghost divider in `palette.divider`. No hard borders on the section itself (consistent with surrounding Heirloom Journal rules).

**ParticipantRow chip removal (Round detail)**
- [ ] The amber `dishChip` currently rendered inside `ParticipantRow` (`table-night-detail.tsx:941-952`) is removed. The supporting `dishChip` style may be retained only if still referenced by entry detail below; otherwise deleted.
- [ ] Notes (`participant.notes`) continue to render in ParticipantRow exactly as today.

**Entry detail: dish subheader upgrade**
- [ ] In `/Users/jacky/Napkin/napkin-app/app/entry-detail.tsx`, when `entry.dish_description` is present and the viewer is not editing, the dish renders as a subheader line directly below the restaurant name block, in `Newsreader_400Regular_Italic` at 18px (matches existing `Type.headlineItalic` token exactly) in `palette.textSecondary`, prefixed by an em-dash: `— <dish_description>`.
- [ ] The existing amber `dishChip` in the "Dish" section (`entry-detail.tsx:1101-1116`) is removed; the "Dish" section's label + chip affordance is replaced by the inline subheader presentation in the header block. The edit-mode inline text input (own-entry flow) still reaches via a tap on the subheader (own entries show a pencil glyph on hover/press).
- [ ] When `entry.dish_description` is null and viewer is not the entry owner, the subheader is absent.
- [ ] When `entry.dish_description` is null and viewer IS the entry owner, the existing "Add a dish" muted-row affordance still appears where the Dish section used to live — own-entry flesh-out flow is preserved.

### UX Decisions

- **Rank by rating descending, not submission order**: reading the menu top-to-bottom implicitly answers "what was the best thing?" without requiring the viewer to re-sort. This is the point of the module.
- **Highest-rated marker gated at ≥3 participants AND top ≥ 0.5 above next AND no tie at top**: with fewer participants a "winner" overstates a signal from thin data, and ties at the top deserve no winner. The 0.5 gap corresponds to half a star, the minimum meaningful rating increment on this scale.
- **Render only post-reveal**: a "highest rated" marker during the live rating phase would leak how other participants rated before reveal. Gating on `revealed | closed` keeps the reveal ceremony intact.
- **Single-dish module still renders**: if only one person logged a dish, the section is a one-row menu card. "On the Table: Sarah's cacio e pepe, 4.5" is honest to the data and reads naturally as a section.
- **Remove the chip from ParticipantRow, keep dish inline on entry detail**: Round detail is the Table's collective view, so the menu card absorbs dish context. Entry detail is one person's page, where the dish is an attribute of *their* experience, so it stays inline (upgraded to subheader).
- **Row tap → entry detail, no nested profile tap**: one tap surface per row keeps the interaction model consistent with ParticipantRow. Profile access stays on the avatar in Who Said What, which already exists.
- **Truncation at 80 chars inside the module only**: dish_description is free text; 80 chars is long enough for "Cacio e pepe e funghi al tartufo with extra pepper" but prevents a single verbose dish from dominating the vertical rhythm of the menu card. Full text remains on entry detail.
- **Solo entries with no dish: subheader absent entirely**: no "No dish recorded" placeholder. An absent subheader is calmer than a negative-space label.
- **Typography follows existing overrides pattern, no new tokens**: the closest existing tokens are `Type.headlineMedium` (dish name size/family), `Type.caption`/`Type.labelSmall` (attribution), `Type.rating` (rating number). Where an exact size/style differs, apply an ad-hoc override on top of a token, following the precedent at `table-night-detail.tsx:342-350`.

### Out of Scope

- Multiple dishes per person (requires new `entry_dishes` table — v2).
- Dish-level ratings (the existing `table_night_dishes` / `table_night_dish_ratings` tables are ignored in v1).
- Photos attached to specific dishes.
- Cross-Round "popular dishes at this restaurant" aggregation (restaurant-screen territory; would live under TICKET-008 / restaurant page extensions).
- Dish search / typeahead / autocomplete from menu data (e.g., Places menus).
- Editing a dish post-hoc from inside the module (own-entry dish edit remains on entry detail, via the existing flow).
- "Ordered by X" as a tap target to the member profile (explicit: row tap goes to entry detail, not member profile).
- Module on screens other than Round detail and entry detail (no module on feed, restaurant page, wishlist).
- Renaming/expanding `dish_description` schema (still a single free-text field).

### Open Questions

- None blocking. Architect to decide folder placement: Notes anticipate `components/round/` but the existing folder is `components/table-night/` (file-path alias per CLAUDE.md — UI copy says "Round" but code paths still use `table-night`). Recommend following the existing convention and placing `OnTheTableList.tsx` + `DishRow.tsx` in `components/table-night/`.

---

## Technical Design

### Approach

Pure presentation ticket — no data, no edge function, no new queries. All inputs already live on `nightStatus.participants` (via `useTableNightStatus`) and on the entry detail's `EntryDetail.dish_description`. The work is three self-contained pieces: (1) a new pair of components `OnTheTableList` + `DishRow` rendered as a new section in `app/table-night-detail.tsx` between "Breakdown" and "Who Said What"; (2) deletion of the `dishChip` block inside the existing `ParticipantRow` in the same file; (3) in-place rewrite of the "Dish" block on `app/entry-detail.tsx` so that when the entry is being *viewed* (not edited) the dish renders as an italic subheader inside the header section instead of an amber chip lower down — while preserving the own-entry edit flow wired up in TICKET-019.

The module's sort, marker, reveal-gating, and truncation are all derivable client-side from the participant array; no server changes. Rows reuse the exact `router.push('/entry-detail', { nightId, userId })` call pattern currently used by `ParticipantRow` (table-night-detail.tsx:912–918), so there is zero new navigation surface area.

### Architecture Decisions

- **Folder placement: `components/table-night/`, not `components/round/`**: the spec flagged this as an open question. The codebase already uses `table-night` for file paths, hooks (`useTableNight`), tables (`table_nights`, `table_night_participants`), and the edge function. CLAUDE.md explicitly codifies this: *"File paths, DB tables, the edge function, and some legacy components still use `table-night`… Treat them as aliases — new UI copy says 'Round,' existing code paths stay as-is unless a ticket renames them."* Creating `components/round/` now would fork the convention for one feature with no rename ticket in flight. Trade-off: UI copy says "Round" but the file lives under `table-night/` — mild cognitive tax, but consistent with every other round-related file in the repo.

- **Two components, not one**: `OnTheTableList.tsx` owns the section header, the sorting, the highest-rated detection, and the empty-state early return. `DishRow.tsx` owns rendering one row (dish name / attribution / rating / optional winner chrome) and the tap handler. Splitting keeps `DishRow` a pure presentational component that could later be reused if a similar row appears elsewhere (e.g., future restaurant-page dish aggregation in TICKET-008 extensions). Trade-off: two files instead of one inline section. Worth it for readability and matches the restaurant module split (`Hero` / `Numbers` / `WhoBeen` / `Distribution` in `components/restaurants/`).

- **Sort + winner detection computed inline, not memoized**: participant arrays are tiny (3–8 members bounded by the Table primitive). A `.filter().sort()` on every render is cheap. Skip `useMemo`. Trade-off: sort runs on every parent re-render. Bench cost is nil at n≤8.

- **Reveal gating lives at the parent (`table-night-detail.tsx`)**: `OnTheTableList` renders unconditionally when mounted. The parent guards with `{isRevealedOrClosed && <OnTheTableList … />}`, matching the existing gate on `usePostInteractions` and `useNightPhotoPool` (table-night-detail.tsx:205–218). Keeps the component reveal-agnostic and reusable. Trade-off: caller must remember the gate, but the pattern is already established on this screen.

- **Typography: ad-hoc overrides on existing tokens, no new tokens added**: follows the precedent set by the restaurant-name line at table-night-detail.tsx:342–350, which composes `Type.displayLarge` with `{ fontFamily: 'Newsreader_400Regular_Italic', fontSize: 38, lineHeight: 42 }`. Dish name = `[Type.headlineMedium, { fontFamily: 'Newsreader_400Regular_Italic' }]` (italicizes the 20px/Newsreader base). Rating = `[Type.rating, { color: palette.tertiary, fontSize: 22 }]` — identical to the breakdown-cell rating at table-night-detail.tsx:422. Attribution = `[Type.caption, { color: palette.textMuted }]` (12px Manrope 500 Medium, mixed case, reads as editorial) rather than `Type.labelSmall` (9px uppercase would look like a chip label, not a menu caption). Trade-off: no single-line token says "dish name" — future reuse needs to repeat the override. Acceptable until a second consumer exists.

- **Entry-detail dish becomes a header subheader, not a separate section**: the existing "Dish" section at entry-detail.tsx:1156–1214 is deleted in view mode and re-rendered as a subheader line below the restaurant name + address block (entry-detail.tsx:912–947). The own-entry edit affordances (chip with pencil, muted "Add a dish" row, inline TextInput with save/cancel) move with it — they now hang off the subheader line instead of a standalone section, keeping TICKET-019's flesh-out contract intact. Trade-off: the header block grows a fourth row; mitigated by using `Type.headlineItalic` (18px, quiet) and a small `marginTop`.

- **Winner-marker gating logic lives in `OnTheTableList`, not `DishRow`**: `OnTheTableList` computes `isWinner` per row and passes it as a prop. `DishRow` just decides how to render when `isWinner === true`. Keeps the rule (≥3 participants AND top > second AND gap ≥ 0.5 AND no tie) in one place. Trade-off: `DishRow` becomes dumber, `OnTheTableList` owns all rules. Good separation.

- **Truncation at 80 chars done with a simple `slice(0, 80) + '…'` inside `DishRow`, not `numberOfLines`**: `numberOfLines` + `ellipsizeMode` is visual-only and would defeat word-boundary awareness at ~40 CJK chars. Explicit string truncation keeps the rule visible in code and identical across platforms. Trade-off: we truncate mid-word at 80 — spec explicitly accepts this.

### File Changes

- `napkin-app/components/table-night/OnTheTableList.tsx` — NEW — Section component. Signature: `({ participants, nightId, palette })`. Filters participants with non-null `dish_description`, sorts by `rating desc`, tiebreak by `created_at asc` (needs `participant.created_at` — confirm it's on `TableNightParticipant` type; if not, sort by `submitted_at` or a stable alternative already present). Early-returns `null` if filtered array is empty. Computes `isWinner` per row using the three-gate rule. Renders a `SectionLabel`-style header `ON THE TABLE` (copy from the inline `SectionLabel` helper in table-night-detail.tsx:773–779 or import if we promote it; inline duplicate is fine for v1) and a `View` of `DishRow`s with `Spacing.md` gap. Between rows insert a 1px ghost divider `View` with `backgroundColor: palette.divider`. Exports default.

- `napkin-app/components/table-night/DishRow.tsx` — NEW — Row presenter. Signature: `({ participant, isWinner, nightId, palette, onPress })`. Renders a `Pressable` with `onPress`. Inside: flex-row layout with a left column (dish name + attribution line) and a right column (rating number + optional amber star glyph when `isWinner`). When `isWinner`, row gets `backgroundColor: palette.tertiaryFixed` with `padding: Spacing.sm` + `borderRadius: Radius.sm` and an `Ionicons name="star"` (or a Unicode `★`) glyph in `palette.tertiary` next to the rating. Dish name: `[Type.headlineMedium, { fontFamily: 'Newsreader_400Regular_Italic', color: palette.text }]`, truncated at 80 chars via `text.length > 80 ? text.slice(0, 79).trimEnd() + '…' : text`. Attribution: single `Text` styled `[Type.caption, { color: palette.textMuted }]` rendering `— ordered by ${participant.profiles.display_name}` with a real em-dash (U+2014). Rating: `[Type.rating, { color: palette.tertiary, fontSize: 22 }]` rendering `participant.rating.toFixed(1)`. Rating column uses fixed width (~44) + `textAlign: 'right'` so rows align vertically. No nested Pressables — attribution is plain `Text`.

- `napkin-app/components/table-night/index.ts` — MODIFY — Append `export { default as OnTheTableList } from './OnTheTableList';` and `export { default as DishRow } from './DishRow';`.

- `napkin-app/app/table-night-detail.tsx` — MODIFY —
  - Line ~28: add `OnTheTableList` to the `@/components/table-night` import (currently not imported from there; that folder isn't referenced by this file today, so add a fresh import line).
  - Lines 437–454: insert the new section *between* the Breakdown section (ends at 436) and the Who Said What section header (starts at 440). Wrap in `{isRevealedOrClosed && <View style={styles.section}><OnTheTableList participants={nightStatus.participants} nightId={nightId!} palette={palette} /></View>}`. `OnTheTableList` itself returns `null` when no participant has a dish, so the outer `View` collapses naturally.
  - Lines 940–952: delete the `{participant.dish_description ? (…dish chip…) : null}` block inside `ParticipantRow`.
  - Lines 1072–1077: delete the `dishChip` StyleSheet entry — no longer referenced in this file (the style in `entry-detail.tsx` is a separate local definition).

- `napkin-app/app/entry-detail.tsx` — MODIFY —
  - Lines 911–947 (the restaurant-name header block inside `headerSection`): directly below the restaurant address line (line 945), add a new conditional block that renders the dish as a subheader when `entry.dish_description` is present, styled `[Type.headlineItalic, { color: palette.textSecondary, marginTop: Spacing.xs }]`, prefixed with `— ` (em-dash + space). For own entries, wrap the subheader in a `Pressable` that sets `isEditingDish = true` (reuse `handleDishEditStart`, already defined at line 540); append an `Ionicons name="pencil-outline"` size 12 inline after the text (matches the affordance pattern used today at line 1202). For non-owners, plain `Text`.
  - Lines 1156–1214 (the entire "Dish" section `<View style={styles.section}>…</View>`): delete. The inline edit path (TextInput + save/cancel at lines 1161–1189, "Add a dish" muted row at lines 1206–1213) moves into the header block. Concretely:
    - Keep: `isEditingDish`, `localDish`, `dishError`, `handleDishEditStart`, `handleDishSave`, `handleDishCancel` — all state handlers stay as-is (entry-detail.tsx:347–349, 539–563).
    - New placement: directly below the restaurant address, render one of four states: (a) `isEditingDish` → the `TextInput` block (lines 1161–1189 content) inside the header section; (b) `entry.dish_description != null && !isEditingDish` → italic subheader `— {dish}` with optional pencil for own entries, wrapped in a Pressable that calls `handleDishEditStart`; (c) own entry + no dish → the muted "Add a dish" row (lines 1206–1213 content); (d) non-owner + no dish → render nothing.
  - The local `dishChip` style at line 1402–1409 becomes unused after this change. Delete it.

- The `dishChip` style **is** still referenced elsewhere: verify with a grep before deleting. If `ParticipantRow`'s chip removal on table-night-detail and the entry-detail Dish section removal are the only two consumers, both styles can be deleted. If any other component imports a named `dishChip` (unlikely — they're file-local `StyleSheet.create` entries), leave the foreign copy untouched.

### Implementation Order

1. **Build `DishRow.tsx`** — pure presenter, zero dependencies on screen state. Easiest to review and Storybook-style eyeball in isolation. Defines the typography contract that drives everything else.
2. **Build `OnTheTableList.tsx`** — wraps `DishRow`, owns the sort + winner-rule logic. Depends on step 1. Unit-testable with a handful of fixture participants (zero-dish, one-dish, three-dish-no-winner, three-dish-winner, three-dish-tie-at-top, three-dish-gap-under-0.5).
3. **Wire into `table-night-detail.tsx`** — add the gated section between Breakdown and Who Said What. Depends on step 2. Also delete the `dishChip` render + style in the same commit to avoid a stale intermediate state where the dish appears twice on the page.
4. **Update `entry-detail.tsx`** — move dish into the header block, delete the Dish section + `dishChip` style. Independent of steps 1–3 in terms of code dependency, but best done after them so visual-QA is done on a stable round-detail first (round detail is the primary surface for this ticket).
5. **Update `components/table-night/index.ts` barrel** — add the two exports. Trivial, but easy to forget; keep it as its own line item in the PR checklist.

The builder should commit steps 1+2 together (pure new code), steps 3 as a single commit (Round screen delta + `dishChip` cleanup), step 4 as a single commit (entry detail delta), and step 5 included with step 1+2.

### Risks

- **`TableNightParticipant.created_at` may not exist on the type** — the tiebreaker spec says "entry `created_at` ascending." Check `hooks/tables/useTableNight.ts` for the `TableNightParticipant` shape. If the field isn't there, either (a) widen the type + select in the edge function (scope creep), or (b) fall back to a field that IS there (`submitted_at`, `user_id` lexicographic) and note the deviation in the build log. Likely (b) — tiebreaker behavior on equal ratings is a cosmetic detail.
- **Participant shape and `display_name` joining** — `DishRow` needs `participant.profiles.display_name`. Confirmed present in `ParticipantRow` at table-night-detail.tsx:857. Not a risk, just a precondition for the builder.
- **Owners of `entry-detail.tsx` edit flow (TICKET-019)** — the Dish section just shipped as part of progressive logging (commit 467b80c). Moving it breaks any muscle-memory of its position on the page. Mitigation: the subheader placement is the spec's explicit ask and the edit affordance still works (tap the italic line to edit). Call out in the PR description so reviewers who shipped TICKET-019 can eyeball it.
- **Removing the dish chip on ParticipantRow is a visible regression** — users who learned to look at the amber chip inside each person's card will briefly not find it. Mitigation per spec: the new "On the Table" module puts the same information in a more prominent place, so the migration is net positive. No feature flag needed — this is a presentation-only change.
- **Long dish strings at exactly the 80-char boundary** — `slice(0, 79) + '…'` produces 80 chars. If someone enters exactly 81 chars, the displayed string is effectively 80 with the final char replaced by an ellipsis. Acceptable; spec doesn't require word-boundary awareness.
- **Winner-marker sensitivity to rating scale** — the spec assumes ratings are on the half-star scale (0.5 increments) so a "0.5 above" gap is exactly one half-star. If any round has participants on a different scale (there shouldn't be — overall rating is always the 0–5 half-star scale), the rule still behaves sensibly but the gap no longer corresponds to a visible unit. Not a real risk with current data model; flag only if rating scale changes in a future ticket.
- **Winner tint clashing with the 1px ghost divider** — the divider between rows is `palette.divider` (very faint). On top of a `palette.tertiaryFixed`-tinted winner row, the divider will sit on the boundary between the tinted and untinted rows. Visually fine but worth confirming the divider doesn't cut through the tinted area; render the divider *between* rows as a sibling `View`, not as a row border.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed
- `napkin-app/components/table-night/DishRow.tsx` — NEW. Pure presenter for one dish row (Newsreader italic name, em-dash attribution, amber rating, winner chrome). Typed with `TableNightParticipant & { rating: number }` intersection to satisfy rating non-null at render time.
- `napkin-app/components/table-night/OnTheTableList.tsx` — NEW. Section component: filters participants with dish + rating, sorts rating desc (user_id lexicographic tiebreak — see Builder Questions), computes winner marker eligibility, renders `DishRow`s with ghost dividers. Returns null when no dish data.
- `napkin-app/components/table-night/index.ts` — MODIFIED. Added `export { default as OnTheTableList }` and `export { default as DishRow }`.
- `napkin-app/app/table-night-detail.tsx` — MODIFIED. Added `OnTheTableList` import; inserted `{isRevealedOrClosed && <View style={styles.section}><OnTheTableList … /></View>}` between Breakdown and Who Said What; removed `{participant.dish_description ? (…dish chip…) : null}` block from `ParticipantRow`; deleted `dishChip` StyleSheet entry.
- `napkin-app/app/entry-detail.tsx` — MODIFIED. Added dish subheader block (4 render states: editing/view-with-dish/own-no-dish/other-no-dish) directly below the restaurant address `<Pressable>` in the header section. Removed the standalone Dish `<View style={styles.section}>` block (lines 1156–1214 per original) and deleted the `dishChip` StyleSheet entry.

### Tests
- TypeScript type-check (`npx tsc --noEmit`): 0 errors.
- ESLint (`npx expo lint`): 0 errors, 5 pre-existing warnings (none from this ticket's files).
- Deno edge-function tests: 6 passed / 0 failed (unchanged by this ticket — no server changes).
- Jest (`jest --passWithNoTests`): no app-level tests exist; passed with code 0.

### Builder Questions
1. **Tiebreaker deviation**: `TableNightParticipant` does not expose `created_at` (confirmed in `hooks/tables/useTableNight.ts`). The spec calls for tiebreak by entry `created_at` ascending. I used `user_id` lexicographic as a stable, deterministic fallback — marked with an `ARCHITECT-REVIEW:` comment in `OnTheTableList.tsx`. To implement the spec exactly the edge function's `table-night?action=status` response would need to include `created_at` per participant (scope creep, one select field). The deviation is cosmetic and only matters when two participants have an identical overall rating. Confirm whether the exact tiebreaker matters enough to warrant the edge-function change.
2. **ESLint cache stale-on-new-file**: the pre-commit hook failed twice because the ESLint `import/no-unresolved` resolver cached a negative result for the two new `.tsx` files. Resolved by manually clearing `.eslintcache` before the final commit. The hook should ideally run with `--no-cache`; flagging in case this bites future tickets that add new files to existing barrels.

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
Date: 2026-04-17
Verdict: APPROVE (with one WARN on tiebreaker deviation)

Spec compliance: 21/22 acceptance criteria met (1 WARN)

**Section placement & render conditions (Round detail)**
- [x] Section renders between Breakdown and Who Said What — PASS (`table-night-detail.tsx:439-447`, inserted between Breakdown close at ~436 and Who Said What header at 452)
- [x] Only renders when `revealed || closed` — PASS (gated by `isRevealedOrClosed` at `table-night-detail.tsx:440`; same derivation as existing gates at 202-203)
- [x] Only renders when at least one participant has dish — PASS (`OnTheTableList.tsx:41` early-returns null; also filters null/empty/whitespace-only with `trim()`, which is stricter than spec and correct)
- [x] Participants with no dish excluded from module — PASS (`OnTheTableList.tsx:36-39`); ParticipantRow rendering in Who Said What unaffected.

**Section header**
- [x] Header styled with `Type.label` in `textSecondary` — PASS (`OnTheTableList.tsx:64`). Text passed as `"On the Table"` but `Type.label` applies `textTransform: 'uppercase'` (`theme.ts:218`), producing `ON THE TABLE` at render. Matches `SectionLabel` helper inline.

**Dish row structure**
- [x] Three elements, rating right-aligned fixed-width — PASS (`DishRow.tsx:52-80`; `rightCol` width 44, `textAlign: 'right'`)
- [x] Dish name uses `Newsreader_400Regular_Italic` 20px — PASS (`DishRow.tsx:55-57`, composes `Type.headlineMedium` + fontFamily override, matches precedent)
- [x] Attribution uses `Type.caption` 12px muted with em-dash U+2014 — PASS (`DishRow.tsx:62-64`)
- [x] Rating uses `Type.rating` amber 22px — PASS (`DishRow.tsx:77`)
- [x] Rating = `participant.rating.toFixed(1)` — PASS (`DishRow.tsx:78`)

**Rank & tiebreaker**
- [x] Rank by rating desc — PASS (`OnTheTableList.tsx:46`)
- [⚠] Tiebreak by entry `created_at` ascending — WARN: uses `user_id` lexicographic instead (`OnTheTableList.tsx:48`). Builder flagged in ARCHITECT-REVIEW comment at line 96-101 and in Build Log Q1. Judgment: **acceptable deviation**. Tiebreaker only affects cosmetic row order among exactly-equal ratings; it is deterministic and stable; the alternative (threading `created_at` through the edge function + type) is out-of-proportion scope creep for a visual ordering detail. Not blocking — recommend a follow-up ticket or note in backlog if product ever wants "earliest submitter wins the tie" ordering semantically.

**Highest-rated marker**
- [x] Marker gated by ≥3 participants AND top > second AND gap ≥ 0.5 — PASS (`OnTheTableList.tsx:55-59`, all three conditions AND'd correctly; strict `>` prevents tie-at-top winner)
- [x] Tie at top = no marker — PASS (implied by `topRating > secondRating` being strict)
- [x] Fewer than 3 participants → renders without marker — PASS (module still renders; `showWinner` just false)
- Row tint + star: PASS (`DishRow.tsx:44-48, 69-76`). Background `tertiaryFixed`, `Ionicons name="star"` 12px in `palette.tertiary`.

**Tap behavior**
- [x] Row tappable, navigates to `/entry-detail` with `{nightId, userId}` — PASS (`OnTheTableList.tsx:78-83`)
- [x] No nested tap targets in the row — PASS (attribution is plain `Text` at `DishRow.tsx:62`)

**Truncation**
- [x] >80 chars truncated with ellipsis — PASS (`DishRow.tsx:28-33`, `slice(0, 79) + '…'`)
- [x] <80 chars wraps, no truncation — PASS (no numberOfLines)

**Row dividers**
- [x] `Spacing.md` gap + 1px ghost divider in `palette.divider`, between rows not after last — PASS (`OnTheTableList.tsx:86-88`, `styles.divider` has `height: 1, marginVertical: Spacing.md`; `!isLast` guard ensures no trailing divider)

**ParticipantRow chip removal**
- [x] Dish chip removed from ParticipantRow — PASS (diff confirms deletion of lines 940-952 in old file)
- [x] `dishChip` StyleSheet entry deleted — PASS (grep shows no remaining `dishChip` in `table-night-detail.tsx`)
- [x] `participant.notes` still renders — PASS (untouched in diff)

**Entry detail: dish subheader**
- [x] Subheader below restaurant name block, `Type.headlineItalic` in `textSecondary`, em-dash prefix — PASS (`entry-detail.tsx:984-986`)
- [x] Old "Dish" section removed + local `dishChip` style deleted — PASS (diff removes section 1156-1214 and styles block; no remaining `dishChip` refs in entry-detail)
- [x] Four render states preserved (editing / view-with-dish / own-no-dish / other-no-dish) — PASS (`entry-detail.tsx:949-1003`):
  1. `isEditingDish` → TextInput with save/cancel/error/spinner (lines 949-977)
  2. `entry.dish_description` + not editing → italic subheader with pencil glyph for owner (978-995)
  3. No dish + own entry → muted "Add a dish" row (996-1002)
  4. No dish + non-owner → null fallthrough (1003)
- [x] TICKET-019 inline-edit flow preserved — PASS. `handleDishEditStart`, `handleDishSave`, `handleDishCancel`, `localDish`, `isEditingDish`, `dishError` state handlers unchanged at `entry-detail.tsx:540-563`. `updateEntry.mutateAsync({ dish_description })` call path identical. Tap-to-edit reaches the handler via the view-state Pressable at 979-980.

Correctness: PASS — winner rule implemented exactly per spec; strict `>` inequality correctly excludes ties-at-top.
Edge Cases: PASS — empty-array null return, whitespace-only dish filtered out via `trim()`, `secondRating === null` guarded when only 1 participant has dish, truncation at 80 chars handled.
Error Handling: PASS — presentation-only; edit flow error handling untouched from TICKET-019.
Security: PASS — no new data paths.
Performance: PASS — n≤8 bound, inline sort per spec note, no wasted re-renders.
Design Compliance: PASS — Heirloom Journal typography respected (Newsreader italic dish, Manrope caption attribution, amber `tertiary` for rating).

Key issues:
1. **Tiebreaker deviation** (`OnTheTableList.tsx:48`) — uses `user_id` lex instead of `created_at` asc. Acceptable as-is; deterministic, stable, cosmetic. If spec fidelity matters for future "earliest submitter first" product semantics, add `created_at` to the table-night status edge function's participant select and thread through `TableNightParticipant` type — ~3 line change, deferred. No code fix required in this ticket.

Minor notes (non-blocking):
- `OnTheTableList.tsx:64-66` inlines `SectionLabel`'s styling rather than importing the helper (helper is file-local to `table-night-detail.tsx`). Acceptable for v1 — builder explicitly noted in the tech design that inline duplicate is fine until `SectionLabel` is promoted.
- `DishRow.tsx:44-48` applies `padding: Spacing.sm` only when `isWinner`, which causes winner rows to be visually taller/offset compared to neighbors. Mild visual asymmetry but matches spec ("faint tint on the row"). Not worth changing.

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: YYYY-MM-DD
- Final verdict:
- Notes:
