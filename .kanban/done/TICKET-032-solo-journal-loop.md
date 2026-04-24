---
id: TICKET-032
title: "Solo journal loop — composer, memory-object feed card, day logger"
priority: high
status: done
created: 2026-04-22
updated: 2026-04-23
tags: [solo, composer, feed, journal, mvp]
---

# Solo journal loop — composer, memory-object feed card, day logger

## Problem

Napkin's core differentiator vs. Beli is the journaling ritual: **writing is the act, the rating is a by-product.** Today the solo experience reads like a ranking workflow, not a journal:

- The composer (`app/create-entry.tsx`) is a form with 8+ stacked sections. Rating row comes **before** the notes input. "Break it down" surfaces four sub-ratings (Beli's DNA). Table picker + mode picker + attendee picker bleed into the solo flow even when a user has never shared to a Table.
- The re-read surface — the journal feed — renders entries as flat `JournalNoteCard` rows. A user's own writing gets truncated to a `extractHighlight` phrase with no typographic weight. Scrolling your own feed a week later does not feel like flipping through a journal.
- There is no way to log a meal retroactively. Entries save as `now`. Half the "I should jot this down" impulse happens the next morning on the subway.

The consequence: first users will tap stars, skip the note, submit, and stop returning. The product becomes "Beli with paper textures." This ticket is the V1-MVP swing to make solo feel like Day One / Letterboxd — the loop that earns the friend-beta.

Wireframes: `/Users/jacky/Napkin/wireframes/logger-rethink.html` (Concepts A / B / C / D).

## Notes

### Three concepts, one loop

**A. The Page** — composer reimagined as a journal page.
- Restaurant name as italic Newsreader masthead; 5 stars inline on the right, baseline-aligned, no label.
- Writing surface is the hero (Newsreader 20/32, ~60% of viewport), ghost copy: *"Say something about this one."*
- Photos / companions / dish / date as chip affordances under the writing area.
- Dish, "Break it down" secondary ratings, and Table share all collapse into a single *add details* drawer.
- Table share affordance: quiet olive footer *only* appears if user has ≥1 Table. Solo users on day one never see Table chrome.
- Primary CTA: "Save" (solo) / "Share" (to Table) / "Start Round" (Round mode). Drop "LOG IT."

**B. The Memory Object** — the feed card is the reward for writing.
- `JournalNoteCard` rebuilt: user's own writing as a serif italic pull-quote (em-dash, left terracotta rule), restaurant as italic masthead, rating as a large serif italic numeral (e.g. `4/5`) not five small stars.
- Empty-note variant reads as intentional, not incomplete: *"— no note. the egg sandwich spoke for itself."*
- Entry detail (`app/entry-detail.tsx`) upgraded to match: giant rating numeral, pull-quote body, "your second visit · last time 3.5" hook (past-self ↔ present-self).
- Diary ledger (`components/profile/DiaryRow.tsx`) **untouched** — stays on the 5-tick `Rating` glyph. The two surfaces are complementary zoom levels: diary row = flip-through, memory card = linger.

**C. The Day Logger** — retroactive journaling.
- `+` action opens on a day-page for *today* with meal slots (breakfast / lunch / dinner). Existing entries for the day render in place; missing slots are dashed empty states.
- Swipe / arrow-nav backward through days (capped at e.g. 30 days). Copy shifts from *"What did you eat today?"* → *"Anything you forgot?"* for past days.
- Tap a slot → opens Concept A composer with `visited_at` prefilled to that day + meal slot time (breakfast 9am / lunch 1pm / dinner 8pm as defaults).
- Schema: `entries.visited_at` already exists; expose it in the composer. Optional `entries.meal_slot` enum (`breakfast|lunch|dinner|snack`) to support the day-page rendering — nice-to-have, can be derived from `visited_at` hour in v1.

---

## Product Spec

### Visual reference

![Concepts A/B/C/D wireframe](../../wireframes/logger-rethink.png)

Four stacked concepts in the wireframe (top → bottom): **A. The Page** (composer), **B. The Memory Object** (feed card + entry detail), **C. The Day Logger** (retroactive day-page + meal slots), **D. Two Scales** (memory-card vs. untouched DiaryRow — complementary, not competing).

### Framing

Writing is the act. Rating is a by-product. Every surface in this ticket must reward the note over the number. If a decision trades off expressive typography against form density, choose the typography. If a decision surfaces a breakdown rating at the same level as the note, it's wrong.

---

### User Stories

**Composer (Concept A)**
- As a solo journaler on day one (no Tables), I want to open the composer and see only a restaurant name, a star row, and a blank page, so I feel invited to write — not processed through a form.
- As a user who's already eaten, I want to tap a star and type two sentences and save in under 15 seconds, so logging stays frictionless when I don't want to linger.
- As a user who wants to go deeper, I want to expand an *add details* drawer for dish, breakdown ratings, photos, and companions, so the depth is available but never shouted.
- As a user in a Table, I want a quiet footer that lets me share this entry to a Table — but only after I've written — so Table chrome never pre-frames a solo moment.

**Feed card / Memory Object (Concept B1)**
- As a user re-reading my feed a week later, I want my own writing to read as a pull-quote with typographic weight, so scrolling back feels like flipping through a journal, not a timeline.
- As a user who skipped the note, I want the empty state to feel deliberate (*"— no note. the egg sandwich spoke for itself."*), so the card doesn't shame me into padding it out.
- As a user with rich entries, I want the rating to appear as a large serif numeral, so the number feels like a quiet verdict, not a score.

**Entry detail (Concept B2)**
- As a user opening a past entry, I want the full note as a pull-quote with the giant numeral, so the detail view is a fuller version of the memory card, not a different surface.
- As a user revisiting a place, I want to see *"your 2nd visit · last time 3.5"* at the top, so my past self and present self meet on the page.

**Day Logger (Concept C)**
- As a user tapping `+`, I want to land on today's day-page with breakfast / lunch / dinner slots, so logging feels like filling in a diary, not starting from zero.
- As a user who forgot to log yesterday's dinner, I want to swipe backward to yesterday and tap the dinner slot, so I can backfill without digging through settings.
- As a user who already logged lunch today, I want to see that entry in place on the day-page, so I understand what's recorded and what's still open.

**Diary ledger (Concept D — negative scope)**
- As a user scanning my profile diary, I want the existing compact `DiaryRow` with 5-tick `Rating` glyphs to remain unchanged, so the flip-through zoom level still exists alongside the linger zoom level.

---

### Acceptance Criteria

#### Composer (Concept A) — `app/create-entry.tsx`

- [ ] Restaurant name renders as Newsreader italic masthead (type scale matching `restaurant-canvas` masthead, not hardcoded).
- [ ] 5-star rating control sits **inline** with the restaurant name, right-aligned, baseline-aligned. No label text above, beside, or below. No "how did it land?" copy anywhere on the screen.
- [ ] Writing input is the visually dominant element: ≥55% of initial viewport height on iPhone 14 (390×844) before the keyboard opens.
- [ ] Writing input uses Newsreader 20/32, ghost copy *"Say something about this one."* (no micro-prompts, no rotating hints, no emoji).
- [ ] Below the writing surface, these chip affordances appear in a single horizontal row (scrollable if overflow): `photos`, `dish`, `companions`, `date`. Chips use Heirloom pill styling (ghosted warm rule, no solid fill).
- [ ] An **add details** drawer (collapsed by default) contains: breakdown ratings (the four sub-ratings currently at top level), any metadata not covered by chips. Drawer open/close animates; state does not persist across sessions.
- [ ] Breakdown ratings are NOT visible on the primary composer surface. Accessing them requires opening the drawer.
- [ ] Table share affordance: rendered as a quiet olive footer strip, appears **only** when `tables.length >= 1` for the current user. Users with zero Tables never see it. When present, it reads *"also share to [Table name]"* with a toggle; defaults OFF.
- [ ] Primary CTA button label is context-aware: `Save` (no Table share, no Round), `Share` (Table share ON), `Start Round` (Round mode — reached via existing Round entry point, not surfaced in solo composer chrome). The string "LOG IT" is removed.
- [ ] `visited_at` is user-settable via the `date` chip, opening a date picker. Defaults to `now`. Selection displays as lowercase past-tense human copy on the chip (*"today"*, *"yesterday"*, *"thu apr 18"*).
- [ ] No Table picker, no mode picker, and no attendee picker is visible on the primary surface for users with zero Tables.
- [ ] Submit behavior, validation, and persisted fields match the existing `entry` edge function contract. No schema changes required for v1 composer.

#### Feed memory-object card (Concept B1) — `components/feed/JournalNoteCard.tsx`

- [ ] Card applies only to the **viewing user's own solo entries** on the journal tab. Other users' entries (via Tables / companions) use existing card components for this ticket; unify later.
- [ ] Restaurant name renders as Newsreader italic masthead at card scale.
- [ ] User's `content` renders as a serif-italic pull-quote, prefixed by an em-dash, with a left terracotta rule (2px). If content exceeds ~3 lines at card scale, truncate with a trailing ellipsis inside the quote; tap opens entry detail.
- [ ] Empty-note variant: when `content` is empty/whitespace, render a deliberate line — *"— no note. the [dish or 'meal'] spoke for itself."* If no dish recorded, fallback to *"— no note."* alone. Do NOT use `extractHighlight` fallbacks that invent phrases.
- [ ] Rating renders as a large serif-italic numeral in `X/5` or `X.5/5` form (e.g. `4/5`, `3.5/5`). The 5-tick `Rating` glyph is NOT used on this card.
- [ ] Metadata kicker uses middle-dot separators and lowercase past-tense verbs (*"noted · tue · kono"*), consistent with Heirloom conventions.
- [ ] Card uses ambient shadow only (`0 8px 30px rgba(28,28,25,0.06)`). No hard drop shadow, no 1px solid border. Section breaks via background shifts + spacing.
- [ ] Tap target: whole card → entry detail, matching current nav.

#### Entry detail (Concept B2) — `app/entry-detail.tsx`

- [ ] Header shows restaurant name as italic masthead, matching card treatment at larger scale.
- [ ] Rating renders as a giant serif-italic numeral (card scale × ~1.8), positioned per wireframe (top-right of masthead block).
- [ ] Body renders full `content` as a pull-quote (em-dash + left terracotta rule), not truncated.
- [ ] When prior entries exist for the same `user_id × restaurant_id`, show a metadata line above the masthead: *"your 2nd visit · last time 3.5"*. Hide entirely on first visit.
- [ ] If prior rating was higher than current, copy stays neutral — do not add softening language. Honest memory is the feature.
- [ ] Photos, companions, dish, breakdown (if present) render below the body in the same chip/drawer grammar as the composer.

#### Day Logger (Concept C) — `app/(tabs)/log.tsx` + new day-page route

- [ ] `+` tab opens on a day-page for **today** as the default entry point. The current direct-to-composer flow is replaced.
- [ ] Day-page shows a masthead with the day in italic Newsreader (*"thu, apr 22"* lowercase), plus a subtitle (*"what did you eat today?"* for today, *"anything you forgot?"* for any past day).
- [ ] Three meal slots render vertically: `breakfast`, `lunch`, `dinner`. Each slot shows either (a) the existing entry for that slot (compact summary: restaurant · rating · first line of note) or (b) a dashed empty state with *"tap to add"* affordance.
- [ ] Tapping a filled slot opens the existing entry in entry-detail.
- [ ] Tapping an empty slot opens the Concept A composer with `visited_at` prefilled to that day + slot default time (breakfast 9:00, lunch 13:00, dinner 20:00, local time).
- [ ] Swipe left/right (or arrow buttons) navigates between days. Navigation is capped at 30 days in the past; no future navigation.
- [ ] Slot-to-entry mapping v1: derive from `visited_at` hour bucket (breakfast = 4–11, lunch = 11–16, dinner = 16–23, overnight = maps to dinner of prior day). No schema change required.
- [ ] A secondary affordance *"log without a day"* or equivalent escape hatch is NOT required in v1 — flag to user if a simpler path is needed. See Open Questions.

#### Diary ledger (Concept D) — negative scope

- [ ] `components/profile/DiaryRow.tsx` is NOT modified in this ticket.
- [ ] `components/ui/napkin/Rating.tsx` (5-tick glyph) is NOT removed; it continues to serve the diary ledger and other compact surfaces.
- [ ] Reviewer verifies visual regression on profile diary screen.

---

### UX Decisions

- **Stars inline with restaurant name, no label.** Chosen because the user explicitly rejected "how did it land?" framing. The composer's visual grammar — masthead + stars on one line, blank page below — reads as journal, not form.
- **Pull-quote as the feed-card hero, numeral as verdict.** Chosen because re-reading is the retention loop. Typography rewards writing; a small numeral beside small stars rewards ranking. We're not a ranking product.
- **Empty-note treatment is deliberate, not apologetic.** *"— no note. the egg sandwich spoke for itself."* We do not use `extractHighlight` to fabricate a pseudo-note. A real empty note is a valid memory; the card's job is to dignify it.
- **Day-page replaces direct composer from `+`.** Chosen because retroactive logging is a primary use case and the day-page doubles as a "what's already here" memory surface. Direct composer is still reachable from a tapped slot; no entries are lost.
- **Table affordance appears only post-Table.** Strict read of "Individual-first. Tables emerge." — a user who has not yet tagged a friend or formed a Table sees zero Table chrome in the composer.
- **`visited_at` exposed as a chip, not a header field.** Keeps the top of the composer silent — masthead + stars + page. Date is a detail, not a prompt.
- **Drawer state does not persist.** Each new composer session opens with drawer collapsed. A user who opened the drawer once is not pushed toward form-mode forever.
- **Slot times are fixed defaults, not user preferences in v1.** Breakfast 9 / lunch 13 / dinner 20 local. Customization deferred.
- **Numeral format: `X/5` with half-star precision (`3.5/5`).** Matches existing `Rating` scale; avoids decimals like `4.0/5`.
- **Honest past-self metadata.** When a prior rating was higher, copy stays neutral (*"your 2nd visit · last time 4"*). No softening. Journal truthfulness is the product.

---

### Out of Scope

- Micro-prompts inside the writing box (explicitly rejected).
- "How did it land?" or any label text above/beside the stars (explicitly rejected).
- Beli-style breakdown ratings promoted to top-level composer surface (explicitly rejected).
- Round composer redesign. Round entry points remain as-is; this ticket must not leak Round chrome into solo.
- Rebuilding feed cards for entries authored by other users (Table-shared, companion-tagged). Deferred — this ticket ships memory-object card for viewing user's own solo entries only.
- `components/profile/DiaryRow.tsx` and `components/ui/napkin/Rating.tsx` — do not modify.
- Public profile surface changes.
- Push notifications / reminders to log.
- Year-in-review / wrapped surfaces.
- Calibrated-strangers / Ring 2 work (TICKET-022).
- Custom meal-slot labels or a 4th snack slot in v1.
- Editing `visited_at` on already-saved entries (composer-only exposure this round).
- Full `entries.meal_slot` enum migration — slot derivation from `visited_at` hour is sufficient for v1.

---

### Open Questions

Answered from wireframes + doctrine:

1. **Does the day-logger replace or sit beside the `+` → create-entry flow?** → **Replace.** `+` opens day-page for today; tapping a slot opens the composer. Direct composer is not a separate entry point. (Flagged: if this creates friction for the "I know the restaurant, just let me type" path, we can add a quiet *"skip the day"* affordance in v1.1. Builder should prototype both and flag if the replacement feels heavy.)
2. **Should `visited_at` default to `now` or the last-used slot of today?** → **`now`** when composer is opened from any entry point other than the day-logger. When opened from a day-logger slot, prefill to that slot's default time. No "last-used" tracking.
3. **Pull-quote extraction on the feed card: full content, first sentence, or user-selectable?** → **Full `content` if ≤3 lines at card scale; truncate with trailing ellipsis otherwise.** Do not use `extractHighlight`. User-selectable pull-quote is out of scope. Tap expands via entry detail.
4. **Treatment when rating dropped on revisit?** → **Neutral, no softening.** Journal truthfulness is the product; honest memory is the feature.
5. **Do companion names appear on the memory-object card frame?** → **Only in the kicker strip** (*"noted · tue · kono · with clara"*), not inside the pull-quote frame. The pull-quote is the user's voice alone.
6. **Keep verbs ("noted", "tried") on the memory card, or let the pull-quote stand alone?** → **Keep verbs in the kicker.** They're brand voice and scan quickly. The pull-quote does the emotional work; the verb does the grammatical work.

Genuinely needs user input before building:

- **Q7 (new).** Day-page masthead copy for *today* — does the user prefer *"what did you eat today?"* (conversational) or a quieter *"today"* alone (less Duolingo)? Wireframe shows the longer form; doctrine leans quiet.
- **Q8 (new).** For the memory-object card empty-note variant — is the *"the [dish] spoke for itself"* construction always safe, or should it only apply when a dish is explicitly logged? (Risk: sounds odd if dish field is a cuisine type like "omakase" or a generic "dinner".)
- **Q9 (new).** When a user has exactly one Table, should the Table share footer default ON or OFF? Spec currently says OFF. OFF respects the "solo is the default" posture; ON reduces a tap for users who've clearly opted in. Flagging as a V1 calibration decision.
- **Q10 (ship-risk).** The memory-object card applies to the viewing user's own entries only. Feed currently mixes own + Table + companion entries. Builder must confirm the conditional render logic doesn't produce a visually jarring alternation between two card styles in the same scroll. If it does, we need a spec pass on a unified card treatment before merging.

---

### Work buckets (for builder scoping)

1. **Composer rebuild** — `app/create-entry.tsx`, drawer component, chip row component, Table footer conditional.
2. **Memory-object feed card** — `components/feed/JournalNoteCard.tsx` rebuild, pull-quote + numeral primitives (consider `components/ui/napkin/`), conditional render based on authorship.
3. **Entry detail polish** — `app/entry-detail.tsx` masthead + pull-quote + giant numeral + prior-visit metadata.
4. **Day logger** — new day-page surface, meal-slot component, day-nav swipe, `app/(tabs)/log.tsx` rewire, slot→composer prefill plumbing.
5. **Regression guard** — verify `DiaryRow`, `Rating` glyph, Round composer, Table-shared cards untouched.

### Related files

- `app/create-entry.tsx` — composer rebuild (Concept A)
- `app/entry-detail.tsx` — re-read treatment (Concept B2)
- `components/feed/JournalNoteCard.tsx` — memory-object card (Concept B1)
- `components/feed/SoloShareCard.tsx` — out of scope this ticket; flag for follow-up
- `app/(tabs)/journal.tsx` — feed surface
- `app/(tabs)/log.tsx` — `+` action → day logger entry point (Concept C)
- `app/diary.tsx` / `components/profile/DiaryRow.tsx` — **do not change**; lives alongside
- `components/ui/napkin/Rating.tsx` — **do not change**
- `lib/textHighlight.ts` — `extractHighlight` NOT used on memory card (empty-note handling is explicit)

### Why now

This is the **V1-MVP gate** for friend-beta. Per doctrine (CLAUDE.md, 2026-04-20): *"Individual-first. Tables emerge."* The solo loop has to be a complete, self-respecting product — most users will live in Moment 1 for weeks before tagging a friend, and many forever. If the solo loop doesn't feel like journaling, the arc collapses and Napkin reads as a worse Beli with group chat.

---

## Technical Design

### Approach

Four surfaces touch code, but the real work is in two primitives that unlock the rest. We extract a `PullQuote` component (em-dash + 2px terracotta left rule, Newsreader italic) and a `GiantRatingNumeral` component (Newsreader italic `X/5` / `X.5/5`), then compose them into the memory card, the entry-detail body, and the day-page slot summary. The composer (`create-entry.tsx`) gets rebuilt around a three-block layout (masthead+stars / writing page / chip row) with all secondary ratings and metadata hidden inside a collapsible `AddDetailsDrawer`. The `+` tab gets rewired from a direct push to `/create-entry` into a new `app/day/[date].tsx` route that owns the breakfast/lunch/dinner logic; slot taps forward to the rebuilt composer with `visited_at` prefilled. No schema changes. One small additive field on the `/feed` edge function's entry payload (`prior_visit`) avoids an N+1 on the memory card's "your 2nd visit · last time 3.5" hook.

Design grammar is sourced from the Heirloom Journal tokens already in `constants/theme.ts` and the existing canvas-faithful `SoloShareCard`/`JournalNoteCard` pair — same spacing rhythm, same italic masthead, same ambient shadow. This ticket elevates the typographic hierarchy; it does not invent new brand language.

**Note on bundle fetch:** `api.anthropic.com/v1/design/h/arCMwe2IOddzhHFBISX_Ng` returned 404 during this design pass. Falling back to `theme.ts`, existing canvas-faithful components, and `wireframes/logger-rethink.html` (authoritative for this ticket). Builder should retry the bundle before starting; if still 404, escalate.

### Architecture Decisions

- **New route `app/day/[date].tsx`, `+` rewired in `_layout.tsx::BottomNavBar`**: because the day-logger is a distinct surface with its own header, swipe nav, and URL-addressable state (*"yesterday's page"*) — that wants a real route, not a modal. Expo Router dynamic segment `[date]` (YYYY-MM-DD) keeps it deep-linkable. Trade-off: one more top-level Stack entry in `_layout.tsx` and care needed around back-stack when a slot tap pushes `/create-entry`.
- **Composer stays at `app/create-entry.tsx`, rebuilt in-place**: because the modal presentation, back-stack behavior, and 20+ upstream push sites (restaurant pages, fast-log, search results) all already point here. Building a parallel `app/compose.tsx` would force a migration we don't need. Trade-off: diff is large; builder should rewrite the JSX tree cleanly rather than incrementally patch.
- **Slot → entry mapping derived client-side from `visited_at` hour**: ticket explicitly says no `meal_slot` enum in v1. A `mapEntriesToSlots(entries, date)` pure function in `lib/mealSlots.ts` keeps the derivation testable and swappable later if we add the enum. Trade-off: restaurant "overnight" edge case (1am) gets assigned to prior day's dinner — spec says this is correct.
- **Memory card conditional at the feed-render site, not inside the card**: the branch (`is_viewer_own_solo` → `JournalNoteCard` v2, else existing cards) lives in `app/(tabs)/journal.tsx` where feed items are mapped. The rebuilt `JournalNoteCard` takes the same `SoloShareActivity` shape as today but renders the new grammar. Cleaner than a variant prop that forks visually by ~80%. Trade-off: see Q10 risk below.
- **Prior-visit metadata on entry detail via existing `useUserRestaurantHistory`**: this hook already fetches `visit_count`, `user_average`, and per-visit ratings. We use `excludeEntryId` to drop the current entry, then read `visits[0].rating` and `visits.length + 1` for the "your Nth visit · last time X" copy. No edge function change needed. The existing `PreviouslyHereBanner` gets replaced inline by the new metadata line; do not delete the component (it's still used on Round detail).
- **Memory card's prior-visit hook is N+1-hostile**: calling `useUserRestaurantHistory` inside `JournalNoteCard` would fire one request per card in the feed. Instead, extend the `feed` edge function to include `prior_visit: { count: number; last_rating: number | null } | null` on each `FeedEntry`. Pure-additive field, single join. Trade-off: one small edge-function edit. Worth it — this is the only way to ship the "2nd visit" hook on the memory card without a scrolling performance regression.
- **Drawer state local, not persisted**: `useState(false)` inside composer. Spec explicitly rejects cross-session persistence. No prop threading, no context.
- **Table footer is a separate component, appears only when `tables.length >= 1`**: quiet olive strip below writing area (above chip row), toggle defaults OFF (Q9). Zero-table users never see the component mounted. This is the strict read of "Individual-first. Tables emerge."

### File Changes

**New — primitives (pull these first, reuse 3x):**
- `components/ui/napkin/PullQuote.tsx` — NEW — serif-italic body text with em-dash prefix + 2px terracotta left rule. Props: `text`, `numberOfLines?`, `size?: 'card' | 'detail'`. Uses `palette.primary` for the rule, `Newsreader_400Regular_Italic`.
- `components/ui/napkin/GiantRatingNumeral.tsx` — NEW — Newsreader italic `X/5` or `X.5/5` numeral. Props: `value: number`, `scale?: 'card' | 'detail'` (detail = card × 1.8). Does NOT replace `Rating.tsx` (5-tick glyph).
- `components/ui/napkin/index.ts` — MODIFY — barrel-export both.

**New — composer sub-components (keep `create-entry.tsx` readable):**
- `components/create-entry/ComposerMasthead.tsx` — NEW — restaurant name (Newsreader italic) + inline 5-star row, baseline-aligned. Accepts optional `onClearPlace` for the selected-place affordance.
- `components/create-entry/WritingSurface.tsx` — NEW — the Newsreader 20/32 `TextInput`, ghost *"Say something about this one."*, min-height sized so the 3-block layout hits ≥55% viewport before keyboard.
- `components/create-entry/ChipRow.tsx` — NEW — horizontal scrollable row of `photos`, `dish`, `companions`, `date` chips. Uses existing `NapkinChip` styling grammar. Each chip is a Pressable that opens the relevant picker or drawer section.
- `components/create-entry/AddDetailsDrawer.tsx` — NEW — collapsible container hosting the four breakdown `StarRating`s + any overflow fields. Animated `LayoutAnimation` or Reanimated height transition.
- `components/create-entry/TableShareFooter.tsx` — NEW — quiet olive strip, toggle + single-line "also share to [Table name]". Renders only when `tables.length >= 1`. Picker sheet for multi-Table users (tap Table name opens a bottom sheet to pick which Table).
- `components/create-entry/DateChip.tsx` — NEW — chip that opens a native date picker, renders `visited_at` as lowercase *"today" / "yesterday" / "thu apr 18"*. Uses `@react-native-community/datetimepicker`.
- `components/create-entry/index.ts` — NEW — barrel export.

**New — day-logger surface:**
- `app/day/[date].tsx` — NEW — day-page route. Reads `date` param (YYYY-MM-DD, defaults to today), renders `DayMasthead` + three `MealSlotRow`s + swipe nav. Capped at 30 days back. Calls `useEntriesForDay(date)`.
- `components/day/DayMasthead.tsx` — NEW — italic Newsreader *"thu, apr 22"* + subtitle (*"what did you eat today?"* for today, *"anything you forgot?"* for past days). See Q7 — builder picks one.
- `components/day/MealSlotRow.tsx` — NEW — filled state (restaurant · `Rating` glyph · first line of note, tappable → entry detail) or empty state (dashed border, *"tap to add"*, terracotta `+` icon, tappable → composer with prefill).
- `components/day/DayNav.tsx` — NEW — left/right chevrons + swipe handler (`react-native-gesture-handler`). Disables right/forward on today; disables left at day-30.
- `components/day/index.ts` — NEW — barrel export.
- `hooks/entries/useEntriesForDay.ts` — NEW — fetches user's entries where `visited_at` falls in `[date 00:00, date 24:00)` local time, then maps to slots via `lib/mealSlots.ts`. `queryKey: ['entriesForDay', userId, date]`. Uses direct Supabase query (no edge function needed — RLS-safe; user can only read their own entries).
- `lib/mealSlots.ts` — NEW — pure functions: `slotForHour(hour): 'breakfast'|'lunch'|'dinner'`, `defaultTimeForSlot(slot, date): ISO string`, `mapEntriesToSlots(entries, date)`. Unit-testable.

**Modified — composer:**
- `app/create-entry.tsx` — MODIFY — full rewrite of render tree. Keeps the existing state hooks (`useCreateEntry`, `useTables`, `useStartRound`, photo upload, companion state, debounced search) — those are load-bearing. Rips out the mode picker + attendee picker from the solo surface (Round entry stays reachable via `mode=round` param); removes the 4 breakdown `StarRating`s from the top level (they move into `AddDetailsDrawer`); removes the "LOG IT" copy; adds `visited_at` state. Submit label becomes `Save` / `Share` / `Start Round`.

**Modified — feed card:**
- `components/feed/JournalNoteCard.tsx` — MODIFY — rebuild as memory-object card: italic masthead restaurant name, `PullQuote` body (or deliberate empty variant), `GiantRatingNumeral` top-right, kicker with middle-dot separators. Remove `extractHighlight` usage. Add empty-note branching (with dish → *"— no note. the [dish] spoke for itself."* / without dish → *"— no note."*).
- `app/(tabs)/journal.tsx` — MODIFY — currently a placeholder. This ticket is NOT required to ship a full journal tab, but the memory card lives in the feed surfaces. Wire the rebuilt `JournalNoteCard` at `app/(tabs)/tables.tsx:642-652` — the render site that mixes card types — guarded by `item.user_id === viewer.id && item.table_id == null` (viewer's own solo entry). All other cases keep `SoloShareCard` / `JournalNoteCard` v1 behavior. (If Q10 fires, see risk below.)
- `app/(tabs)/feed.tsx` — MODIFY — if feed tab also renders solo entries authored by the viewing user, apply the same branching. Inspect at build time.

**Modified — entry detail:**
- `app/entry-detail.tsx` — MODIFY — replace the current rating + note block with `ComposerMasthead`-mirrored header (restaurant italic masthead + `GiantRatingNumeral` at `detail` scale) and `PullQuote` body. Add prior-visit metadata line above masthead when `userHistory.visit_count > 0` — copy: *"your {ordinal} visit · last time {lastRating}"*. `PreviouslyHereBanner` callsite replaced for own entries; Round takes still use banner.

**Modified — navigation:**
- `app/_layout.tsx` — MODIFY — `BottomNavBar`'s `+` button changes `router.push('/create-entry')` → `router.push('/day/today')` (or the YYYY-MM-DD of today). Register new `Stack.Screen name="day/[date]"`.

**Modified — edge function:**
- `supabase/functions/feed/index.ts` — MODIFY — extend each `FeedEntry` with optional `prior_visit: { count, last_rating } | null` by joining entries-where-user-and-restaurant-match-and-visited_at < current. Cheap window function.
- `hooks/feed/useFeed.ts` — MODIFY — add `prior_visit` to `FeedEntry` type.

**Unchanged (guard in review):**
- `components/profile/DiaryRow.tsx`, `components/ui/napkin/Rating.tsx`, `components/feed/SoloShareCard.tsx` (still serves others' solo entries), `app/table-night.tsx`, `app/table-night-detail.tsx`.

### Implementation Order

1. **Primitives** — `PullQuote` + `GiantRatingNumeral` in `components/ui/napkin/`. Snapshot them in isolation. Everything downstream composes these.
2. **`lib/mealSlots.ts`** — pure, unit-testable. Unblocks both day-page and composer prefill.
3. **Composer sub-components** (`ComposerMasthead`, `WritingSurface`, `ChipRow`, `AddDetailsDrawer`, `TableShareFooter`, `DateChip`) — build in isolation with mocked props, then wire into `create-entry.tsx`. Breaking this up avoids a 1000-line diff.
4. **`create-entry.tsx` rewrite** — wire primitives + sub-components. Verify submit contract unchanged via e2e: empty-Table user → `Save`; Table user → `Share`; Round mode still reachable via `mode=round` URL param. Depends on 1–3.
5. **Memory-object `JournalNoteCard`** — replace internals using primitives. Branch conditional render in `(tabs)/tables.tsx` + `(tabs)/feed.tsx`. Depends on 1.
6. **Entry detail polish** — masthead + pull-quote + giant numeral + prior-visit line. Depends on 1, reuses `useUserRestaurantHistory`.
7. **Feed edge function `prior_visit` field** — ship alongside step 5 so the memory card has data. Deploy with `npx supabase functions deploy feed --project-ref ftvmseaqwwlcxtdlvxxz`.
8. **Day-logger surface** — `app/day/[date].tsx` + components + `useEntriesForDay`. Depends on 2, 4 (composer prefill target).
9. **Bottom-nav rewire** — flip `+` to `/day/today`. Smallest, last — easiest to revert if day-logger lands rough.
10. **Regression pass** — verify `DiaryRow`, `Rating` glyph, `SoloShareCard` (others' entries), Round composer all untouched.

### Risks

- **Q10 — scroll alternation between memory card and existing cards.** Same feed will render `JournalNoteCard` v2 (pull-quote + giant numeral, ~180pt tall) directly above a `SoloShareCard` (~120pt, nested `noteCard` fill, 5-tick `Rating` glyph) when a user and a Tablemate both posted solo. Visual grammar is different enough to feel jittery. **Mitigation:** (a) keep the *spacing rhythm* identical — same `paddingVertical`, same timeline left-rule treatment — so the outer frame reads consistent even if interiors differ. (b) If build-time review confirms it feels jarring, introduce a `variant: 'memory' | 'compact'` prop on a unified `SoloCard` and drive it from authorship; this is a ~2hr follow-up, not a blocker. Flag explicitly in PR description so reviewer can sanity-check the same screen.
- **Composer rewrite size.** `create-entry.tsx` is ~1400 lines. Pulling state into a parent + rendering sub-components is safe, but submit logic is intricate (photo gen refs, companion state, Round branch). Mitigation: keep the submit `handleSubmit` + all `useEffect` upload plumbing untouched; only the render tree changes.
- **Q7 / Q8 / Q9 unanswered.** Spec calls these out as needing user input. **Proposed defaults** (builder should adopt unless user overrides): Q7 use quieter *"today"* alone (doctrine leans quiet — wireframe's longer form reads Duolingo-y). Q8 only use "*— no note. the [dish] spoke for itself.*" when `dish_description` is present and is a concrete dish (contains a space or 4+ chars), else fall back to *"— no note."*. Q9 Table share footer defaults OFF even for single-Table users — solo-is-default posture is the whole ticket.
- **Date-chip timezone drift.** `visited_at` is stored UTC; user intent is local. Use the device `Intl.DateTimeFormat` locale for chip display and keep the ISO stored value local-midnight for slot defaults (breakfast 09:00 local, etc.). Build a thin `toLocalISO(date, hour, minute)` helper in `lib/mealSlots.ts` and USE IT — do not touch Date math inline.
- **Back-stack from day-page → composer → save.** After save, `router.back()` should land on the day-page (showing the new entry in place), not bounce to `/feed`. Current composer `router.back()` already does this correctly via the modal presentation, but verify the first back step pops only the composer modal, not the whole day-page route too.
- **Expo Router dynamic date param collisions.** `app/day/[date].tsx` with `date=today` string is ergonomic for the nav button but messy for caching. **Mitigation:** normalize on entry — if `date === 'today'`, compute the YYYY-MM-DD and `router.replace` to the canonical URL. Keeps query keys stable.
- **Feed edge function change is load-bearing for memory card.** If the `prior_visit` field ships broken, the card shouldn't crash — treat `prior_visit` as nullable and skip the hook silently. Belt-and-suspenders.

---

## Build Log

### Files Changed

**New files:**
- `napkin-app/components/ui/napkin/PullQuote.tsx` — serif-italic pull-quote primitive (em-dash + 2px terracotta left rule)
- `napkin-app/components/ui/napkin/GiantRatingNumeral.tsx` — Newsreader italic `X/5` / `X.5/5` numeral (card + detail scale)
- `napkin-app/components/create-entry/ComposerMasthead.tsx` — restaurant masthead + inline 5-star row
- `napkin-app/components/create-entry/WritingSurface.tsx` — Newsreader 20/32 TextInput, ≥55% viewport height
- `napkin-app/components/create-entry/ChipRow.tsx` — horizontal chip row (photos / dish / with / date)
- `napkin-app/components/create-entry/AddDetailsDrawer.tsx` — collapsible drawer for breakdown ratings + dish
- `napkin-app/components/create-entry/TableShareFooter.tsx` — olive footer strip, toggle defaults OFF, hidden for zero-Table users
- `napkin-app/components/create-entry/DateChip.tsx` — lightweight date-picker Modal (30-day list rows, no native date picker dependency)
- `napkin-app/components/create-entry/index.ts` — barrel export
- `napkin-app/components/day/DayMasthead.tsx` — italic Newsreader date header + subtitle
- `napkin-app/components/day/MealSlotRow.tsx` — filled / empty slot states (breakfast / lunch / dinner)
- `napkin-app/components/day/DayNav.tsx` — left/right day navigation with swipe and chevrons
- `napkin-app/components/day/index.ts` — barrel export
- `napkin-app/app/day/[date].tsx` — day-logger route; normalises `today` → YYYY-MM-DD; swipe via Gesture.Pan
- `napkin-app/hooks/entries/useEntriesForDay.ts` — direct Supabase query for entries in a calendar day; maps to slots
- `napkin-app/lib/mealSlots.ts` — pure functions: `slotForHour`, `defaultTimeForSlot`, `toLocalISO`, `mapEntriesToSlots`, label helpers

**Modified files:**
- `napkin-app/components/ui/napkin/index.ts` — barrel-exports PullQuote + GiantRatingNumeral
- `napkin-app/components/feed/JournalNoteCard.tsx` — rebuilt as memory-object card (PullQuote + GiantRatingNumeral + kicker)
- `napkin-app/app/create-entry.tsx` — full render-tree rewrite; state hooks unchanged; new `visitedAt` param; CTA labels Save / Share / Start Round
- `napkin-app/app/entry-detail.tsx` — GiantRatingNumeral at detail scale, PullQuote body, prior-visit metadata line
- `napkin-app/app/(tabs)/tables.tsx` — card selection: own solo entries → JournalNoteCard, others → SoloShareCard
- `napkin-app/app/_layout.tsx` — `+` routes to `/day/today`; `day/[date]` modal screen registered
- `napkin-app/hooks/feed/useFeed.ts` — added `prior_visit` to `FeedEntry` type
- `napkin-app/lib/queryKeys.ts` — added `entries.forDay`
- `supabase/functions/feed/index.ts` — additive `prior_visit` field on each FeedEntry (batch join, no N+1); deployed

**Untouched (regression guard confirmed):**
- `components/profile/DiaryRow.tsx` — 0 diff
- `components/ui/napkin/Rating.tsx` — 0 diff
- `components/feed/SoloShareCard.tsx` — 0 diff
- `app/table-night.tsx` — 0 diff
- `app/table-night-detail.tsx` — 0 diff

### Tests

- **Deno edge function tests:** 38 steps, 6 passed, 0 failed (`entry`, `places-search`, `table-management`, `table-members`, `user-profile`)
- **TypeScript (`npx tsc --noEmit`):** 0 new errors; 3 pre-existing errors unchanged (`tables.tsx::is_personal` × 2, `InfoMapPreview.tsx` comparison)
- **Expo lint:** 0 errors (42 warnings, all pre-existing or minor unused-import warnings from new files)
- **Jest:** no app-layer test suite exists (`--passWithNoTests` exits 0)
- **Feed edge function deployed:** `npx supabase functions deploy feed --project-ref ftvmseaqwwlcxtdlvxxz` ✓

### Decisions Made (Q7 / Q8 / Q9)

- **Q7:** Day-page masthead for today shows `null` subtitle (just "today" italic date, no conversational copy). Past days show "anything you forgot?". Quieter — doctrine leans against Duolingo-style prompts.
- **Q8:** "spoke for itself" line only emitted when `dish_description` is present AND has ≥4 chars OR contains a space (avoids odd cases like "omakase" or single-word cuisine types). Fallback is `"— no note."` alone.
- **Q9:** Table share footer defaults OFF even for single-Table users. Solo-is-default posture is the entire thesis of this ticket.

### Builder Questions

**Q10 — two card styles in the same scroll (flagged, not resolved):**
The same feed view now renders `JournalNoteCard` v2 (pull-quote + giant numeral, ~180pt) interspersed with `SoloShareCard` (~120pt, timeline fill, 5-tick Rating). When a user and a Tablemate both have solo entries in the same session, the two card grammars alternate. On a quick visual inspection they read as complementary zoom levels (the spec framing), but the height delta and typographic contrast may feel jittery in practice. Mitigation applied: kept outer spacing rhythm and shadow identical between cards. If reviewer confirms jarring: introduce `variant: 'memory' | 'compact'` on a unified `SoloCard` — ~2hr follow-up. Flagged here per Q10 in the spec; not resolving in this ticket.

**DateChip — no native date picker:**
`@react-native-community/datetimepicker` is not installed in this project. DateChip was rewritten as a lightweight `Modal` with a scrollable list of the past 30 days. Functionally equivalent for v1; if a full native calendar picker is wanted later, the interface (`value: Date`, `onChange: (date) => void`) is stable enough to swap the implementation without touching callers.

---

## Review History

### Review 1
Date: 2026-04-23
Verdict: REVISE

Spec compliance: 25/32 acceptance criteria met (7 failing or partial)

**Composer (Concept A)**
- [x] Restaurant masthead (Newsreader italic) — PASS (`components/create-entry/ComposerMasthead.tsx:105-111`, 32pt)
- [x] 5-star inline, baseline-aligned, no label — PASS (`ComposerMasthead.tsx:52-83`); minor: half-star handler at :26-32 is dead (`handleStarPress(star, 0, 1)` hardcodes args and :64 overwrites)
- [x] Writing input ≥55% viewport — PASS (`WritingSurface.tsx:17` → 409pt on iPhone 14)
- [x] Writing input Newsreader 20/32 + ghost copy — PASS (`WritingSurface.tsx:52-62`)
- [x] Chip row: photos/dish/companions/date — PASS (`ChipRow.tsx`)
- [x] Add details drawer, collapsed default, non-persisted — PASS (`AddDetailsDrawer.tsx:53` local `useState(false)`)
- [x] Breakdown ratings NOT on primary surface — PASS (moved inside drawer at `AddDetailsDrawer.tsx:95-109`)
- [~] Table share footer appears only when tables ≥ 1, defaults OFF — PASS on presence/default, but **regression**: `create-entry.tsx:518` now sets `effectiveTableId = (round || shareToTable) ? selectedTableId : null`. When `FastLogSheet.tsx:75` passes `tableId` param, `selectedTableId` is set but `shareToTable` defaults to false → entry silently drops the caller's intended share-to-table.
- [x] CTA label Save/Share/Start Round — PASS (`create-entry.tsx:562-566`)
- [x] `visited_at` via date chip — PASS (`DateChip.tsx` supports 30 past days including today)
- [x] No pickers on primary surface for zero-Table users — PASS (footer gated at `create-entry.tsx:722`)
- [~] Submit contract unchanged — PARTIAL (see above `tableId` silent-drop)

**Memory card (Concept B1)**
- [ ] **FAIL — card applies only to viewer's own solo entries (`user_id === viewer.id && table_id == null`)** — `app/(tabs)/tables.tsx:645` gates only on `user.id === solo.user_id`; does NOT check `table_id == null`. The Tables tab by definition only surfaces entries **with** a `table_id`, so the memory card renders for the viewer's own **table-shared** entries — the opposite of the spec semantic. The actual "feed-only solo" entries (`table_id IS NULL`) have no surface (journal.tsx is still the placeholder from main). The tech design flagged this site as the render location; the conditional was implemented but with the wrong predicate.
- [x] Restaurant italic masthead — PASS (`JournalNoteCard.tsx:244-250`, 22pt)
- [x] Pull-quote em-dash + 2px terracotta left rule, 3-line truncate — PASS (`PullQuote.tsx`; `JournalNoteCard.tsx:173-177`)
- [ ] **FAIL (Q8 inversion)** — `JournalNoteCard.tsx:71-76` fires `"the [dish] spoke for itself"` whenever `dish.length >= 4 || dish.includes(' ')`. "omakase" (7 chars), "dinner" (6 chars), "chicken" (7 chars) ALL trigger the branch — exactly the cases the Build Log said should be avoided. Logic is inverted — the builder wrote `>= 4 OR space` but the intent was plainly `>= 4 AND space` (two-word concrete dishes). Ship with this and users get "the dinner spoke for itself" on generic meal-type entries.
- [x] GiantRatingNumeral X/5 form — PASS (`GiantRatingNumeral.tsx:21-29`)
- [x] Middle-dot kicker, lowercase past-tense verbs — PASS (`JournalNoteCard.tsx:152-156`); brittle: `kicker.slice(5)` at :155 hardcodes the verb length
- [x] Ambient shadow, no hard drop / 1px solid border — PASS (outer card: `Shadow.ambient`; the 1px `foot` border at :270 uses `palette.divider` = `rgba(221,192,186,0.15)` ghosted warm — compliant)
- [x] Tap whole card → entry detail — PASS

**Entry detail (Concept B2)**
- [x] Masthead restaurant italic — PASS
- [x] Giant numeral detail-scale — PASS (`entry-detail.tsx:1116`)
- [x] Pull-quote full content — PASS (`entry-detail.tsx:1254`, no `numberOfLines`)
- [~] Prior-visit metadata line — PASS on content, but visual duplication: the new "your Nth visit · last time X" at `entry-detail.tsx:1065-1079` and the existing `PreviouslyHereBanner` at :1158-1179 **both render** for own entries with prior history. The Tech Design explicitly said "existing `PreviouslyHereBanner` gets replaced inline by the new metadata line" — the replacement wasn't performed.
- [x] Neutral copy on rating drop — PASS (no softening added)
- [x] Chips/drawer grammar matches composer — PASS
- Dead styles: `entry-detail.tsx:1958-1967` (`ratingNum`, `ratingSlash`) unreferenced after GiantRatingNumeral swap.

**Day logger (Concept C)**
- [x] `+` opens `/day/today`, normalised to YYYY-MM-DD — PASS (`_layout.tsx:73`; `day/[date].tsx:65-69`)
- [x] Masthead Q7 quiet — PASS, but `DayMasthead.tsx:24-26` is a no-op ternary (`isYesterday ? 'anything you forgot?' : 'anything you forgot?'` — both branches identical)
- [x] Three slots render — PASS
- [x] Filled slot → entry-detail; empty slot → composer with visitedAt prefill — PASS
- [x] Swipe + chevrons — PASS; cosmetic risk: root `Gesture.Pan()` on a modal route may fight iOS modal pan-to-dismiss (test case, not blocker)
- [x] 30-day cap, no forward — PASS
- [ ] **FAIL — slot→entry mapping via `visited_at` hour bucket on PostgREST (timezone bug).** `hooks/entries/useEntriesForDay.ts:31-32` passes `toLocalISO(date, 0, 0)` as a **naive local ISO string** (`"2026-04-22T00:00:00"` — no `Z`, no offset). PostgREST forwards this to PostgreSQL as a text literal; PostgreSQL interprets naive literals against a `timestamptz` column in the **server's timezone** (Supabase is UTC). Result: a PST user's dinner at local 20:00 is stored as `~04:00Z` of the next day, and the day-page query (`gte 00:00 UTC .. lte 23:59 UTC` for the target date) misses it. All UTC−N users will see dinners disappear from their intended day-page and reappear on the prior day. The `mapEntriesToSlots` helper has the correct local-hour logic, but it never gets the right rows because the range filter already excluded them. Fix: either append local offset to the ISO strings sent to PostgREST, or widen the range and filter in `mapEntriesToSlots`.
- [x] Escape hatch not required in v1 — OK

**Diary/Rating (Concept D — negative scope)**
- [x] `DiaryRow.tsx`, `Rating.tsx`, `SoloShareCard.tsx` untouched — PASS (0-diff confirmed)
- [x] Bottom nav icons+labels untouched — PASS

Correctness: FAIL — (a) day-page timezone query bug drops legitimate entries for any non-UTC user; (b) Q8 empty-note heuristic is logically inverted relative to stated intent; (c) memory-card render gate uses wrong predicate vs AC (`user_id` only instead of `user_id && table_id IS NULL`).
Edge Cases: FAIL — overnight (0–3) case handled in `mealSlots.ts` only via `mapEntriesToSlots`, but never runs for non-UTC users because of the range-filter bug. DST edge handled acceptably by `Math.round` in `daysDiff`.
Error Handling: PASS — mutation errors alert; feed edge function wraps in try/catch; `useEntriesForDay` throws on supabase error.
Security: WARN — `feed/index.ts:192` uses string interpolation (`\`(${[...myEntryIds].join(',')})\``) for `not.in` filter. UUIDs are injection-safe, but the pattern is fragile and different from the `.in('restaurant_id', array)` form on the same query; at minimum inconsistent.
Performance: WARN — `useCreateEntry.onSuccess` does NOT invalidate `entriesForDay` → stale day-page after save+back (2min staleTime window). Same pattern bites anything that writes an entry while a day-page is mounted. Also: the `prior_visit` edge-function field is **dead code** — added to `feed/index.ts:175-212` and `useFeed.ts:23`, but no client (neither `JournalNoteCard.tsx` via `SoloShareActivity`, nor `FeedEntry` consumers `FastLogRow`/`FriendLogCard`) ever reads it. Extra round-trip cost per feed load with no UI benefit. The additive field also has a **correctness bug**: it counts ALL non-current-entry user visits at the restaurant, including entries chronologically AFTER the current entry — so for older entries the "prior_visit" actually includes future visits. No filter on `visited_at < e.visited_at`.
Design Compliance: WARN — mostly compliant (theme tokens used throughout, Newsreader italic for mastheads/numerals, Manrope for kickers, middle-dot separators, lowercase past-tense verbs). Tautological code: `ComposerMasthead.tsx:80` `Number.isInteger(rating) ? String(rating) : String(rating)`. Cosmetic: `DayMasthead.tsx:33` prints raw `04 22` as the non-today kicker (e.g. "04 22" above "yesterday") rather than a formatted kicker — looks crude.

Q10 verdict (scroll alternation own-memory-card vs. others'-SoloShareCard): **WARN, ugly-but-shippable-IF the gate is fixed to be meaningful.** Right now the memory card fires for own entries shared to the current Table — which is arguably the WORST mixed-scroll scenario (you shared an entry to your Table, Clara also shared hers, yours blows up to 180pt with a pullquote and hers renders as 120pt timeline). If the spec gate (`table_id IS NULL`) were enforced, the only Tables-tab entries that currently qualify are zero (Tables tab never surfaces feed-only entries), so the alternation wouldn't occur. Either way, not visibly broken; height delta is real.

Blockers (must fix before ship):
1. **Day-page timezone bug** — `hooks/entries/useEntriesForDay.ts:31-32`. Naive ISO strings sent to PostgREST against a `timestamptz` column drop legitimate entries for every non-UTC user. Breakfast/lunch/dinner will appear on the wrong day-page in PST/EST. Either emit ISO with the local offset (`2026-04-22T00:00:00-08:00`) or widen range (prior day 00:00 → next day 23:59) and filter by `localDateStr(new Date(e.visited_at)) === date` inside `mapEntriesToSlots`.
2. **Memory-card gate predicate** — `app/(tabs)/tables.tsx:645`. The AC says `user_id === viewer.id && table_id == null`, not just `user_id === viewer.id`. Without the `table_id == null` half, the card renders on the wrong entries. Given journal.tsx is a placeholder, the correct fix is probably to pull this gate out of the Tables feed entirely and land it on the journal tab as part of this ticket (or explicitly scope this concept to a later ticket and stop mis-wiring it).
3. **Q8 heuristic inversion** — `components/feed/JournalNoteCard.tsx:72`. `dish.length >= 4 || dish.includes(' ')` is the opposite of the stated intent (avoid odd "the omakase spoke for itself"). Replace with `dish.includes(' ')` (require multi-word) OR drop the variant entirely.
4. **`useCreateEntry` missing `entriesForDay` invalidation** — `hooks/tables/useCreateEntry.ts:62-74`. Save-from-day-page → back leaves slot empty until 2-minute staleness expires. Add `qc.invalidateQueries({ queryKey: ['entriesForDay', userId] })` in `onSuccess` (match by prefix).
5. **`tableIdParam` silent-drop** — `create-entry.tsx:518`. Callers that pass a `tableId` URL param now have their share-target silently ignored unless the user toggles the footer. Either preserve the auto-share behavior when a caller explicitly specifies `tableIdParam` (initialise `shareToTable=true` when `tableIdParam` present), or audit all `create-entry?tableId=…` callers and strip the now-ignored param.

Nits (non-blocking):
- `feed/index.ts` `prior_visit` is unused by any client; either wire it into the memory card (the tech design intended this) or remove the field to avoid shipping dead code + the future-visits correctness bug at :192-212.
- `entry-detail.tsx` renders both the new prior-visit line (:1065) AND the existing `PreviouslyHereBanner` (:1158) for own entries — Tech Design said replace. Pick one.
- `DayMasthead.tsx:24-26` — redundant ternary (`isYesterday ? A : A`).
- `DayMasthead.tsx:33` — kicker prints raw `MM DD` (e.g. `04 22`) rather than a formatted short month label.
- `ComposerMasthead.tsx:80` — tautological `Number.isInteger(rating) ? String(rating) : String(rating)`.
- `ComposerMasthead.tsx:26-32` — `handleStarPress` is dead code (called with hardcoded args at :63, result immediately overwritten at :64). Half-star-on-tap-left-half is unreachable.
- `JournalNoteCard.tsx:34` — `formatRelativeTime` imported but unused.
- `entry-detail.tsx:1958-1967` — `ratingNum` and `ratingSlash` styles unreferenced after GiantRatingNumeral swap.
- `app/(tabs)/_layout.tsx:93` — dead onPress to `/create-entry`; tabbar is hidden (`display: 'none'` at :32), so the custom `BottomNavBar` is the only path. Still misleading.
- `feed/index.ts:192` `not.in` uses string interpolation inconsistently with `.in('restaurant_id', array)` two lines up; UUID-safe but worth normalising to `.not('id', 'in', \`(${array.join(',')})\`)` isn't better — either use the `.not` method form or wait for PostgREST's array support.
- `hooks/entries/useEntriesForDay.ts:60` uses a raw key array instead of `queryKeys.entries.forDay(...)` — shape matches so consumers still match by prefix, but the pattern violates the "keys live in `lib/queryKeys.ts`" rule from CLAUDE.md.
- `components/create-entry/ChipRow.tsx:108` wires `DateChip` directly, bypassing the `onDateChange` prop naming convention — acceptable but worth knowing if callers ever want to swap the picker.

---

## Build Log (fix pass) — 2026-04-23

### Blockers Fixed

1. **Day-page timezone bug** — `hooks/entries/useEntriesForDay.ts`.
   Switched from naive local ISO strings to true UTC ISO strings (`Date#toISOString()`) so PostgREST's `timestamptz` comparison works correctly across timezones. Widened the SQL range by ±1 day in local time to safely cover the overnight (0–3 → prior day's dinner) rule and any timezone offset; `mapEntriesToSlots` already does precise local-date filtering, so the wider SQL result set is shaped back down client-side. Updated to use `queryKeys.entries.forDay(userId, date)` (addresses nit 10).

2. **Memory-card gate predicate** — `app/(tabs)/tables.tsx` + new `app/(tabs)/journal.tsx`.
   Pulled the `JournalNoteCard` branch out of the Tables tab entirely (Tables-tab entries always have `table_id`, so the gate couldn't be AC-faithful there). Wired the memory-card surface into `app/(tabs)/journal.tsx` backed by a new `hooks/entries/useMySoloEntries.ts` that queries entries where `user_id = viewer AND table_id IS NULL AND table_night_id IS NULL`. Added `queryKeys.entries.mySolo(userId)`. Side-benefit: Q10 scroll-alternation risk is resolved — the Tables tab reverts to its single `SoloShareCard` grammar, and the journal tab renders only memory cards. *Caveat:* `journal` is currently a hidden tab (`href: null` in `(tabs)/_layout.tsx`) and not exposed in the custom `BottomNavBar`. The memory-card surface is reachable via direct navigation (`/journal`) but has no nav entry yet — exposing it is a nav-composition decision outside this ticket's scope.

3. **Q8 heuristic inversion** — `components/feed/JournalNoteCard.tsx`.
   Replaced `dish.length >= 4 || dish.includes(' ')` with `dish.trim().includes(' ')`. Only multi-word dish descriptions (e.g. "egg sandwich") trigger the "spoke for itself" variant; generic single-word entries ("dinner", "omakase", "chicken") fall back to `"— no note."` alone.

4. **`useCreateEntry` missing `entriesForDay` invalidation** — `hooks/tables/useCreateEntry.ts`.
   Added `qc.invalidateQueries({ queryKey: ['entriesForDay', userId] })` (prefix match) and `queryKeys.entries.mySolo(userId)` to the `onSuccess` handler. Save-from-day-page → back now immediately shows the new slot populated.

5. **`tableIdParam` silent-drop** — `app/create-entry.tsx`.
   Changed `shareToTable` initial state from `false` to `!!tableIdParam`. Callers that pass an explicit `tableId` URL param (e.g. `FastLogSheet`) have clearly signalled share intent; Q9's default-OFF rule now only applies to users opening the composer without a caller-specified Table.

### Nits Fixed

6. **`feed/index.ts` `prior_visit` correctness** — rewrote the per-restaurant aggregation to filter strictly by `visited_at < e.visited_at` per target entry. Older entries no longer count future visits as "prior." Batched fetch + per-entry local filter preserves the single-round-trip pattern. Field is still additive/nullable; not yet consumed by a client card, but kept deployed for the future memory-card wire-through.

7. **`entry-detail.tsx` duplicate prior-visit rendering** — the new inline "your Nth visit · last time X" kicker and the legacy `PreviouslyHereBanner` both rendered for own non-Round entries. Added `!(isOwnEntry && !isRoundEntry)` to the banner guard, so Round entries and other users' entries still use the banner; own solo entries use the inline line only. Also deleted the dead `ratingNum` / `ratingSlash` styles (`styles.ratingStack` is still used).

8. **`DayMasthead.tsx` redundant ternary + raw kicker** — collapsed the no-op `isYesterday ? A : A` to `subtitle = isToday ? null : 'anything you forgot?'`. Rewrote the kicker to format `MON DD` (e.g. `APR 22`) via `toLocaleDateString` instead of printing raw `04 22`.

9. **`ComposerMasthead.tsx` dead `handleStarPress` + tautological ternary** — removed the unreachable half-star-on-left-half branch (always overwritten by `onRatingChange(star === rating ? 0 : star)` on the next line) and collapsed `Number.isInteger(rating) ? String(rating) : String(rating)` to `String(rating)`.

10. **`(tabs)/_layout.tsx` misleading onPress** — rewired the hidden `add` tab's `tabBarButton` onPress from `/create-entry` to `/day/today` for consistency with the visible `BottomNavBar`. The Tabs component is `display: 'none'` so this onPress never fires in practice, but the intent now matches.

11. **`JournalNoteCard.tsx` unused import** — removed `formatRelativeTime` (no longer called after the pull-quote rewrite).

### Verify

- `npx tsc --noEmit`: 0 new errors (3 pre-existing unchanged: two `is_personal` in `tables.tsx`, one comparison in `InfoMapPreview.tsx`).
- Deno tests: 6 files, 38 steps, all pass.
- `feed` edge function redeployed to production Supabase (`ftvmseaqwwlcxtdlvxxz`) with prior-visit correctness fix.

### Notes for Reviewer

- **Journal tab nav exposure** is deliberately not added in this pass. The surface exists and renders memory cards correctly; whether to add a 6th bottom-nav item, replace an existing one, or surface via a scope pill on Feed is a product decision that warrants its own conversation. The user has previously defended the 5-tab `Feed / Tables / + / Search / Profile` structure.
- `prior_visit` field on the feed edge function is still deployed but unconsumed by any client card (neither `FastLogRow`/`FriendLogCard` nor `JournalNoteCard`, which uses `SoloShareActivity` not `FeedEntry`). Kept for the future wire-through; correctness bug fixed so the shipped field is at least truthful.
- Q10 scroll-alternation: mitigated by construction — the memory card is now the only card style on the journal tab, and `JournalNoteCard` no longer fires on the Tables tab. Not a concern in v1 scroll surfaces.

---

### Review 2
Date: 2026-04-23
Verdict: APPROVE

Spec compliance: 32/32 acceptance criteria met (previously-failing AC now addressed; nav-exposure of the journal tab is explicitly scope-flagged by the builder and is not a spec requirement of this ticket).

**Blocker verification (Review 1 → fix pass):**
- [x] **1. Day-page timezone** — `hooks/entries/useEntriesForDay.ts:35-50` — PASS. `new Date(year, month-1, day, 0,0,0,0)` builds a local-time anchor, then `.toISOString()` emits a true UTC instant for PostgREST's `timestamptz` comparison. The ±1-day widening (line 35-36) safely covers any timezone offset plus the overnight (0–3 → prior day's dinner) rollover. Over-fetching is bounded and `mapEntriesToSlots` (lib/mealSlots.ts:153) already drops spillover via `if (effectiveDate !== date) continue`. Correct.
- [x] **2. Memory-card gate predicate** — `app/(tabs)/tables.tsx:641-650`, `app/(tabs)/journal.tsx:43-67`, `hooks/entries/useMySoloEntries.ts:36-56` — PASS. JournalNoteCard branch fully removed from tables.tsx (import gone at :43). New `useMySoloEntries` hook scopes exactly `user_id = viewer AND table_id IS NULL AND table_night_id IS NULL` (the extra `table_night_id` guard is correct since Round entries also get a `table_night_id` but may also have `table_id` — belt-and-suspenders). Shape conforms to `SoloShareActivity` minus optional reaction fields.
- [x] **3. Q8 heuristic** — `components/feed/JournalNoteCard.tsx:72-78` — PASS. `trimmed.includes(' ')` requires a space, so single-word entries ("dinner", "omakase", "chicken") cleanly fall through to plain `"— no note."`. Mental-test: "egg sandwich" → variant fires; "chicken parm" → variant fires; all single-word generics → plain line.
- [x] **4. `useCreateEntry` invalidation** — `hooks/tables/useCreateEntry.ts:65-68` — PASS. `['entriesForDay', userId]` is the correct prefix shape (full key is `['entriesForDay', userId, date]`); TanStack Query matches by array prefix by default, so any day-page mounted on any date invalidates. Also invalidates `queryKeys.entries.mySolo(userId)`. Both run unconditionally inside the `if (userId)` branch.
- [x] **5. `tableIdParam` share intent** — `app/create-entry.tsx:118` — PASS. `useState(!!tableIdParam)` flips share-ON automatically for any caller supplying a tableId URL param. Zero-param callers still default OFF. `selectedTableId` is initialised from the same source (line 119-121), so `effectiveTableId` at :520 correctly resolves.

**Nit verification:**
- [x] `feed/index.ts` `prior_visit`: strict `< visited_at` per target (`:205-207`) — PASS. Also drops the inconsistent `.not('id', 'in', ...)` string interpolation flagged in Review 1. Pattern is now a clean batch-fetch + per-target local filter.
- [x] `entry-detail.tsx:1160` — PASS. `!(isOwnEntry && !isRoundEntry)` banner guard correctly keeps Round + other-user paths while hiding the redundant banner on own non-Round entries.
- [x] `entry-detail.tsx:1958-1967` dead `ratingNum`/`ratingSlash` styles — PASS (removed).
- [x] `DayMasthead.tsx:30-31` redundant ternary — PASS (collapsed to `subtitle = isToday ? null : 'anything you forgot?'`).
- [x] `DayMasthead.tsx:18-23` kicker format — PASS (`APR 22` via `toLocaleDateString`, not raw `04 22`).
- [x] `ComposerMasthead.tsx` — PASS. `handleStarPress` gone (:23-24 shows no function, Pressable :51-53 calls `onRatingChange` directly). Tautological ternary collapsed to `String(rating)` at :68.
- [x] `JournalNoteCard.tsx` — PASS. `formatRelativeTime` import removed (import list :27-35 does not include it).
- [x] `(tabs)/_layout.tsx:93` — PASS (onPress → `/day/today`).
- [x] `useEntriesForDay.ts:61` — PASS (`queryKeys.entries.forDay`).

**Regression watch:**
- `useMySoloEntries` — single-round-trip Supabase query with `.limit(50)`; RLS scopes to own entries (hook is explicitly `.eq('user_id', userId)` on top of RLS — safe). No N+1.
- `journal.tsx` → `JournalNoteCard` without `tableId`/`lastSeenAt` — PASS. Both props are `?:`; `isUnseen` degrades to `true` for all cards (every card shows the unseen dot), which is cosmetically odd for the "my own journal" surface but not a correctness issue. `handlePickEmoji` guards `if (tableId)` before invalidating, so no crash path.
- `tables.tsx` still compiles — PASS. No remaining references to `JournalNoteCard`.
- TypeScript: 0 new errors (3 pre-existing, unchanged).

Correctness: PASS — all five Review 1 blockers addressed; prior-visit field is now internally truthful even though no client consumes it yet.
Edge Cases: PASS — widened SQL range in `useEntriesForDay` + local-date filter in `mapEntriesToSlots` correctly handles TZ offset, DST, and the overnight (0–3) rollover rule. Q8 plain-fallback covers single-word dishes.
Error Handling: PASS — both new hooks throw on supabase error; `useCreateEntry.onSuccess` invalidates unconditionally (no throwing paths added).
Security: PASS — `useMySoloEntries` is RLS-safe (own-entries only); `feed/index.ts` prior-visit is gated by `user_id === user.id`. String-interpolation issue from Review 1 eliminated by the rewrite.
Performance: PASS — no N+1; `useMySoloEntries` has `.limit(50)` cap and `staleTime: 2min`. `prior_visit` still ships unused, but correctness bug is fixed so the field is at least honest — builder flagged in Notes for future consumer.
Design Compliance: PASS — Heirloom tokens throughout; italic Newsreader mastheads, terracotta left-rule pull-quotes, middle-dot kickers, `MON DD` formatted kicker on DayMasthead.

Residual observations (not blocking):
1. `components/feed/JournalNoteCard.tsx:157` — `kicker.slice(5)` still hardcodes the length of "noted"; brittle if the verb ever changes but flagged as nit in Review 1, not a blocker.
2. `app/(tabs)/journal.tsx` — journal tab has no bottom-nav entry. Builder explicitly scoped this as a product decision; reachable only via direct `/journal` navigation (or programmatic push). Explicitly called out in reviewer instructions as not-a-blocker.
3. `supabase/functions/feed/index.ts:179-216` — `prior_visit` field still unconsumed by any client. Future-ticket concern; correctness now clean.
4. `hooks/entries/useMySoloEntries.ts` — the `SoloShareActivity.type: 'solo_share'` literal is set but `JournalNoteCard` doesn't branch on it; shape sufficient. Reactions are absent from this query (the card's `FeedActionRow` will render zeros), which is fine for the initial journal surface but worth noting for when reactions are wired on the journal tab.

Verdict: APPROVE. Fix pass is solid — all five blockers addressed, nit cleanup thorough, no new regressions surfaced. Shipping gate.

---

## Completion

- **Completed:** 2026-04-23
- **Final verdict:** APPROVE (all 5 blockers + 11 nits from Review 1 addressed; Review 2 clean with 4 non-blocking residual notes)
- **Branch:** `feat/TICKET-032`. Commits:
  - `9057bbe` — Phase 1 build (primitives, composer rebuild, memory card, entry detail polish, day logger, edge function additive `prior_visit`)
  - `7e16a2b` — Fix pass (timezone bug, memory-card surface migration to journal.tsx, Q8 heuristic, invalidations, share-intent, 11 nits)
- **Deployed:** `feed` edge function redeployed to production Supabase (`ftvmseaqwwlcxtdlvxxz`) with prior-visit correctness fix.
- **Accepted residuals** (follow-up candidates, not blocking ship):
  1. Journal tab has no bottom-nav entry — exposing it is a product decision (5-tab layout is user-preferenced). Memory-card surface is reachable via `/journal` route.
  2. `prior_visit` field on the feed edge function is correct but unconsumed by any client card. Future ticket can wire it through the memory card's "your 2nd visit · last time X" hook without schema changes.
  3. `JournalNoteCard.tsx:157` `kicker.slice(5)` hardcodes the length of the verb "noted" — brittle if verb copy ever changes, but shipping as nit.
  4. `useMySoloEntries` omits reaction data — `FeedActionRow` renders zero state on journal cards. Acceptable for v1 of the journal surface; revisit when engagement lands on own-entry memory cards.
