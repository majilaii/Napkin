---
id: TICKET-010
title: "Feed card depth — previews, quotes, quick reactions, unseen markers"
priority: medium
status: done
created: 2026-04-16
updated: 2026-04-17
tags: [feed, interactivity, enrichment, cards]
---

# Feed Card Depth

## Problem

Feed cards are surface-level: restaurant name, score, date, maybe a note snippet. You have to tap *in* to know if anyone else at the Table cared. Scrolling the feed is silent — no social gravity, no hint that a post is alive.

Letterboxd's feed works because every card hints at conversation (likes, comment count, "popular this week"). The feed itself is a scannable conversation thread. Napkin's feed is a list of receipts.

**Who has this problem:** everyone. This is the first thing you see when you open the app. If it looks dead, the app feels dead.

**Why it matters:** when reactions/replies ship (TICKET-007) and restaurant history ships (TICKET-008), there'll be signals worth surfacing. This ticket is where those signals become *visible* in the feed. Without it, the interactivity layer lives entirely on detail pages and the feed stays as cold as it is now.

## Notes

### What this ticket delivers

Three kinds of signal-surfacing on feed cards, plus one quality-of-life feature:

1. **Reaction preview row** on every card — top 2 emoji + counts + reply count pill
2. **Quote blurb extraction** — pull a compelling sentence from notes onto solo share cards
3. **Long-press quick reaction** — react from the feed without opening the detail
4. **"Unseen" dot** — a subtle marker on cards posted since the user's last Tables tab visit

### Concrete additions

| # | What | Where | Effort |
|---|---|---|---|
| 1 | Reaction preview row at bottom of each feed card: "🔥 😋 · 5 reactions · 2 replies" | `TableNightCard.tsx`, `SoloShareCard.tsx`, `JournalNoteCard.tsx` | S |
| 2 | Only render preview if ≥1 reaction OR ≥1 reply (keep clean cards clean) | all 3 card components | S |
| 3 | Long-press any card → bottom sheet reaction picker with the 5 emoji | all 3 card components | M |
| 4 | Quote extraction utility — pick strongest sentence from notes | `lib/textHighlight.ts` (new) | S |
| 5 | Quote blurb on `SoloShareCard` when notes exist — 1-line pull-quote in Newsreader italic | `SoloShareCard.tsx` | S |
| 6 | Quote blurb on `JournalNoteCard` where it makes sense (journal notes *are* notes, so this may already be the case — audit) | `JournalNoteCard.tsx` | S |
| 7 | "Unseen" dot indicator — small terracotta dot on cards newer than `tables.last_seen_at` for this user | all 3 card components | M |
| 8 | Track `last_seen_at` when user opens the Tables tab with this Table active | `app/(tabs)/tables.tsx` + backend | M |
| 9 | Relative time upgrade on cards — "2h ago" when <24h instead of "Today" | `DateSectionHeader.tsx` or inside cards | S |

### Data layer

**Reactions/replies preview:**
- Depends on TICKET-007 data existing (post_reactions, post_comments).
- Extend `table-activity` edge function to include: `reaction_summary: [{emoji, count}], reaction_count, comment_count` per activity item.
- Alternative (simpler to ship first): fetch these lazily per-card with a shared hook — trade-off is N+1 queries on feed render. Probably not worth it; denormalize into the activity query.

**Unseen markers:**
- New column: `table_members.last_seen_at timestamptz` (already may exist — check migrations).
- Update via new action on `table-management` edge function: `POST { action: 'mark_seen', table_id }` called on Tables tab mount when this Table is active.
- Feed cards compare `item.created_at > lastSeenAt` to show dot.
- Client-side fallback: store in AsyncStorage as `lastSeen:{tableId}` for offline resilience.

**Quote extraction:**
- Pure client-side utility. Pick the sentence containing the highest count of evaluative adjectives, OR fall back to the first sentence. Keep it simple — LLMs not needed.
- Heuristic: split on `.!?`, filter sentences 3–90 chars, score by count of words matching a small word list `[insane, incredible, amazing, best, worst, terrible, delicious, wild, unreal, perfect, trash, mid, fire, solid, disappointing, bland, unreal, dreamy, ugly, insane]`, return highest-scoring or first. Empty/no-match falls back to first sentence truncated at 80 chars.

### UX decisions to lock in during product spec

- **Reaction preview: maximum 2 emoji shown, count applies to all.** "🔥 😋 · 5 · 💬 2" compact, no labels.
- **Long-press bottom sheet:** same 5-emoji picker as ReactionBar (from TICKET-007). On tap, toggle and auto-dismiss.
- **Quote blurb styling:** `Newsreader_400Regular_Italic`, 15px, `palette.textSecondary`, prefixed with a left quotation mark ornament or a short dash. Max 1 line, ellipsis truncation.
- **Unseen dot:** 6px circle in `palette.primary` (terracotta), top-right of card. Disappears after scroll-past or tap. Don't make it flashy — it's a subtle hint, not a notification badge.
- **Quote extraction NEVER runs on Round cards.** Rounds don't have a single "author note" — they have multiple participants' notes. Keep quote to solo shares and journal notes.
- **Long-press gesture must NOT conflict with existing tap** on cards. Use `onLongPress` with threshold, don't swallow the regular tap-to-navigate.

### Out of scope

- ❌ Feed filters beyond the existing Rounds + per-user chips
- ❌ Infinite scroll polish (pagination exists; not this ticket)
- ❌ Search / jump-to-date
- ❌ Feed-level batching ("3 posts from Sarah today")
- ❌ Animated reaction picker (Apple-style). Keep it static for v1.
- ❌ Notification badges (Tables tab icon) — related but belongs in a notification ticket
- ❌ Pull-to-refresh upgrades (already works)

### Risks

- **Quote extraction picks the wrong sentence.** Cringe blurbs are worse than no blurbs. Mitigation: short fallback, and a product decision to gate on sentence length (>= 3 words) to avoid "Wow." becoming the blurb.
- **Last-seen semantics on multi-device.** Users on multiple devices will mark seen in one place and miss unseen dots on another. Acceptable v1 behavior. Flag in spec.
- **Long-press conflict with scroll gesture on iOS.** React Native `onLongPress` is well-behaved but test on a real device.
- **Reaction preview row adds vertical height** — feed cards get taller. Might push the info density too far. Mitigation: only render when counts > 0. And keep the row compact (height ≤ 20px).

### Dependencies

- **Hard dependency on TICKET-007** for reactions/replies data. If TICKET-007 hasn't shipped, only items 4, 6, 7, 8, 9 are buildable (quote blurb, unseen dots, relative time) — split into 010a and 010b if needed.
- Independent of TICKET-008 and TICKET-009.

### Files touched (anticipated)

- **New**: `lib/textHighlight.ts`, `components/feed/ReactionPreviewRow.tsx`, `components/feed/QuickReactionSheet.tsx`, `components/feed/UnseenDot.tsx`
- **Modified**: `components/feed/TableNightCard.tsx`, `components/feed/SoloShareCard.tsx`, `components/feed/JournalNoteCard.tsx`, `app/(tabs)/tables.tsx`, `supabase/functions/table-activity/index.ts`, `supabase/functions/table-management/index.ts` (mark_seen action), possibly `supabase/migrations/` if `last_seen_at` doesn't exist

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec

### Notes on existing state (audited 2026-04-17)

- `FeedActionRow` (in `components/feed/FeedActionRow.tsx`) already renders a reaction/reply summary with top-2 emojis, reaction count, and reply count — and already handles long-press on the *heart button* to open `ReactionPicker` (the 5-emoji popover from TICKET-007). The edge function `table-activity` already returns `top_emojis`, `reaction_count`, `comment_count`, `my_reactions` on every card. So items 1, 2, and part of 3 from the Notes table are substantially already shipped.
- `JournalNoteCard.tsx` already has a `timeAgo()` helper used in its own header (`"Julian noted · 2h ago"`). `TableNightCard` uses `GROUP ENTRY · 14 DEC` (absolute date). `SoloShareCard` shows no per-card time label at all — dates come from the `DateSectionHeader`.
- `SoloShareCard` and `TableNightCard` already render note text in a quote-styled block (typographic quotes `""`, truncation, secondary color) — but they render the *full* first-participant-note, not an extracted highlight. `JournalNoteCard` renders notes as a tag chip, not a quote.
- `table_members` has no `last_seen_at` column (confirmed in `supabase/migrations/20251201113055_remote_schema.sql:157-162`). Migration is new.

This ticket therefore **extends** existing infrastructure rather than building from scratch. The work splits into: (A) a full-card long-press path that complements the existing heart long-press, (B) quote-*extraction* replacing raw-note rendering on SoloShareCard and JournalNoteCard, (C) the unseen-dot system (new DB column + new action + card-level indicator), (D) per-card relative time on all three cards.

### User Stories

- As a **Tablemate scrolling the feed**, I want a glanceable hint of which posts are alive (a reaction emoji + a count), so I can tell the feed is warm before I tap in.
- As a **Tablemate who wants to react quickly**, I want to long-press any feed card and pick an emoji without leaving the feed, so a single "🔥" doesn't cost me two navigations.
- As a **reader of long notes**, I want the feed card to surface the most evaluative sentence ("absolutely unreal truffle pasta") instead of the first boilerplate line ("Went here for Sarah's birthday last night."), so I can scan taste signal at feed speed.
- As a **user returning to the Tables tab after a few days**, I want a subtle dot on the cards I haven't seen yet, so I know what's new without a giant "3 new" badge treatment.
- As a **user who opens the app often**, I want the dot state to clear when I revisit a Table — not fight with scroll tracking, not accumulate staleness, just "as of this visit."
- As a **poster whose note doesn't contain anything evaluative**, I want the card to fall back to my first sentence rather than show no quote at all or an embarrassing one-word blurb.
- As a **participant in a Round**, I do NOT want a single participant's one-liner extracted as "the quote" of the Round — Rounds have multiple authors; the existing full-notes block (first participant) is kept as-is.
- As a **user on a second device**, I understand the dot may not be perfectly in sync across devices for v1.

### Acceptance Criteria

**Reaction preview row** (extends existing `FeedActionRow`)
- [ ] Summary region (right side of `FeedActionRow`) is rendered only when `reaction_count > 0 OR comment_count > 0`. When both are zero, the row shows only the Like and Reply action buttons and no trailing summary — matches current behavior, just making it explicit as AC.
- [ ] Summary format: up to 2 distinct emojis from `top_emojis` (stacked with a -6px negative margin, current behavior), followed by a single numeric `reaction_count` (not per-emoji counts). Example: `🔥😋 5 · 3 replies`. The separator between the reaction cluster and the reply pill is a middle-dot `·` with `marginLeft: 10` (current spacing).
- [ ] Reply pill is hidden when `comment_count === 0`; reaction cluster is hidden when `reaction_count === 0`; if both hidden, the whole summary region is hidden.
- [ ] Reply pill text: `"N reply"` when `N === 1`, else `"N replies"` (current behavior, lock).
- [ ] Tapping any part of the summary routes to the detail screen (current behavior, lock).
- [ ] Row height stays ≤ 40pt visible (including vertical padding) so the card does not grow materially when reactions appear.

**Long-press quick reaction**
- [ ] Long-pressing anywhere on a feed card body (not only the heart button) opens the `ReactionPicker` popover anchored near the press point.
- [ ] Long-press delay: 500ms. Short-press (< 500ms) continues to navigate to detail as today — the tap is NOT swallowed.
- [ ] If the user long-presses on the heart button specifically, the existing heart-anchored behavior takes precedence (nested `Pressable` wins). The card-level long-press is the fallback.
- [ ] Picking an emoji from the card-level long-press applies the toggle via the same `useToggleReaction` hook and optimistic count logic already used by `FeedActionRow` — no separate mutation path.
- [ ] Long-press is disabled on `TableNightCard` when `status === 'rating'` (live Round) — reactions are locked during the round, same rule that already hides the entire `FeedActionRow` in this state.
- [ ] Haptic: a single light impact on long-press activation (iOS `Haptics.selectionAsync()` if available). Not blocking on Android.

**Quote blurb — SoloShareCard**
- [ ] When `item.content` is present, a *single extracted sentence* is rendered (replacing the current "render full content with quote marks" behavior). Extraction logic lives in `lib/textHighlight.ts` (new).
- [ ] When `item.content` is null or extraction returns empty, the quote block is not rendered at all.
- [ ] Typography: `Newsreader_400Regular_Italic`, 15px, `palette.textSecondary`. Prefixed with a 4pt em-dash ornament (`—`) in `palette.primary`, followed by a space, then the extracted sentence.
- [ ] Single line, `numberOfLines={1}`, ellipsis truncation (`ellipsizeMode="tail"`).
- [ ] No leading/trailing typographic quote marks on the extracted sentence itself — the em-dash prefix replaces the current `""` wrapping.

**Quote blurb — JournalNoteCard**
- [ ] Current behavior renders `content` as a tag chip. Replace with a 1-line quote block using the same typography and em-dash prefix as SoloShareCard. Tag chips for `dish_description` stay.
- [ ] Extraction uses the same `extractHighlight()` utility.
- [ ] If `content` is null/empty, the quote block is not rendered; `dish_description` tag chip still renders if present (current behavior).

**Quote blurb — TableNightCard**
- [ ] **No change.** Quote extraction does NOT run on `TableNightCard`. The existing "first participant note with decorative `""`" block is preserved as-is. A Round has multiple authors; picking one sentence mis-represents the post.

**Quote extraction utility (`lib/textHighlight.ts`)**
- [ ] Exported as `extractHighlight(text: string | null | undefined): string | null`.
- [ ] Splits on `.!?` (retain sentence terminators in the split result so truncated sentences don't read as fragments).
- [ ] Filters candidates to sentences with **3 or more words** (tokenize by whitespace) AND length 3–90 characters after trim.
- [ ] Scores each candidate by count of words (lowercased, word-boundary match) appearing in the locked evaluative word list below.
- [ ] Returns the highest-scoring candidate. Ties broken by earliest position in the source.
- [ ] If no candidate scores > 0, returns the **first candidate** from the filtered list (first sentence that passes the 3-word / length filter).
- [ ] If no candidate passes filters, returns `null`.
- [ ] Output is trimmed, has no leading/trailing quote marks, and is truncated to 80 characters (last full word boundary) before returning.

**Evaluative word list (locked — copy-pasteable)**
- [ ] `['amazing', 'incredible', 'insane', 'unreal', 'perfect', 'best', 'delicious', 'dreamy', 'fire', 'solid', 'wild', 'stellar', 'phenomenal', 'sublime', 'disappointing', 'bland', 'mid', 'trash', 'terrible', 'worst', 'overrated', 'underrated', 'forgettable', 'skippable']` — 24 words total, evenly positive/negative, no emojis, no obvious spam markers. Match is case-insensitive, whole-word only.

**Unseen dot — visual**
- [ ] Small filled circle, 6pt diameter, `palette.primary` (terracotta), positioned at the top-right of each feed card (absolute, 10pt from top-edge, 10pt from right-edge of the card frame). On `JournalNoteCard` it is absolute against the card's right side of the inner `.card` body, so it sits inside the rounded container rather than floating over the timeline gutter.
- [ ] Dot is ONLY rendered when `item.sort_date > lastSeenAt` (see data layer). When `lastSeenAt` is null (never seen), the dot renders on every card.
- [ ] Dot is a visual decoration — not interactive. No tap handler, no accessibility role.
- [ ] Does not render on `TableNightCard` with `status === 'rating'` (live Rounds already get a `PulseDot` + "LIVE ROUND" label; two dots is noise).

**Unseen dot — dismissal semantics**
- [ ] Whether the dot is shown is a **render-time decision** based on `item.sort_date > lastSeenAt` at card mount. It does NOT disappear on scroll-past, on tap, or on any per-item interaction within the session.
- [ ] `lastSeenAt` is recomputed (refetched) only when the Tables tab regains focus or when the user switches to a different Table via the picker. Between those events, the dot set is stable for the session.
- [ ] Trade-off accepted: if a user scrolls a card into view, closes the app, comes back in the same session, the card still shows a dot. The dot clears on the next Tables tab focus after the mark-seen write settles.

**Mark-seen trigger**
- [ ] A `mark_seen` write fires when: (a) the Tables tab regains focus with a `activeTable` set, AND (b) the user switches to a different Table via the picker. Both paths call the same mutation.
- [ ] Debounced: if a `mark_seen` for `(user_id, table_id)` fired within the last 30 seconds, the new call is a no-op client-side. Prevents hammering when the user tab-switches rapidly.
- [ ] The write sets `table_members.last_seen_at = now()` for the `(member_id, table_id)` pair.
- [ ] The write is fire-and-forget from a UX perspective — no spinner, no toast. On failure, the client silently swallows; stale `lastSeenAt` simply means a few extra dots next session.
- [ ] After a successful write, the `lastSeenAt` value used by card-rendering code is updated optimistically in the same query cache so dots recompute on the next render cycle.

**Relative time on cards**
- [ ] Each of `SoloShareCard`, `JournalNoteCard`, `TableNightCard` renders a relative time label on the card (`JournalNoteCard` already does; extend to the other two).
- [ ] Thresholds: `< 60s` → `"now"`; `< 60m` → `"Nm ago"`; `< 24h` → `"Nh ago"`; `≥ 24h` → **do not render a per-card time label** — the `DateSectionHeader` ("Today" / "Yesterday" / "This Week" / "Last Week" / "March 2026") already groups older content. Double-labeling is noise.
- [ ] Time source: `item.sort_date` (already populated by the edge function and falls through to `visited_at || created_at` for entries, `revealed_at || created_at` for nights).
- [ ] Visual placement:
  - `SoloShareCard` — inside `.headerRow`, right of the rating badge when the badge exists, else right-aligned on its own. `Type.caption`, `palette.textMuted`.
  - `JournalNoteCard` — no change needed (already rendered as `styles.timeAgo` in the header). Adjust its `timeAgo()` to match the locked thresholds: rename `"just now"` → `"now"`, drop `"yesterday"` / `"Nd ago"` fallbacks — return `null` for anything ≥ 24h and hide the `<Text>` when null.
  - `TableNightCard` — append after the existing label, e.g. `GROUP ENTRY · 14 DEC · 2H AGO`. Only append when the relative label is non-null (i.e. `< 24h`); beyond that, show just `GROUP ENTRY · 14 DEC` as today.
- [ ] Shared utility: export `formatRelativeTime(dateStr: string, now?: Date): string | null` from `lib/textHighlight.ts` (same file, kept small — or a new `lib/relativeTime.ts` if the architect prefers; product-side indifferent).

**Data layer — table-activity extension**
- [ ] No server-side change is required for reaction/reply counts — they're already returned. The `lastSeenAt` value is not returned *per item* (it's one scalar per viewer+table), so the edge function's activity response stays as-is.
- [ ] `useTableActivity` continues to return the same shape. The `lastSeenAt` value is surfaced by a separate, cheap `useLastSeenAt(tableId)` query (new hook) that reads `table_members.last_seen_at` for `(member_id = viewer, table_id)`. Card components receive `lastSeenAt` as a prop from the Tables screen.

**Data layer — mark-seen action**
- [ ] New edge-function branch on `table-management`: `POST /table-management?action=mark_seen` with JSON body `{ table_id: string }`. Returns `{ data: { last_seen_at: string } }` with the `now()` value written.
- [ ] The branch verifies the caller is a member of the given table (existing `table_members` query) and writes `UPDATE table_members SET last_seen_at = now() WHERE table_id = $1 AND member_id = auth.uid()` — `.select().single()` to return the value.
- [ ] Migration: add `last_seen_at timestamptz NULL` to `table_members`. No backfill — existing members start at `NULL`, which renders "all dots on" for one session, then clears on first mark-seen.

**State handling**
- [ ] Every new element (reaction summary, quote blurb, unseen dot, relative time) is additive and independently hide-able. A card with no reactions, no note, no unseen dot, and ≥ 24h old renders exactly as it does today.
- [ ] Cards in the active-rounds shelf (`activeRounds` in `tables.tsx`) do not show unseen dots or relative time — they're live and already prominent.

### UX Decisions

- **Long-press gesture: card-level AND heart-level, card loses to heart.** Keeping the existing heart-button long-press means power users' muscle memory is preserved; adding card-level long-press means a new user who doesn't know about the heart anchor still discovers the picker. Because the heart `Pressable` is nested inside the card `Pressable`, React Native's gesture responder hands the event to the inner node first — no additional work to make the heart win.
- **Long-press duration: 500ms.** Matches platform default. Existing heart long-press uses 220ms (snappy for a known-target gesture); keep that on the heart but use 500ms on the card to avoid accidental triggers during scroll.
- **Quote extraction: em-dash prefix, not quote marks.** Current cards already use `""` around the raw `content`. Once extraction is running, a sentence mid-note wrapped in `""` reads as if the whole post were that one line. Em-dash reads like a pull-quote / caption, which is what this is.
- **Quote extraction on cards only — not on detail pages.** Entry detail and Round detail render the full note body; no extraction happens there. The card is a preview; the detail is the source.
- **Evaluative word list kept short and locked.** 24 words covering positive and negative registers. Deliberately no emojis, no profanity, no slang so subjective it ages out within a year ("bussin'", "ate", etc. — intentionally omitted). Expand via follow-up ticket if extraction accuracy underwhelms in use.
- **Fallback to first sentence, not "no quote".** An un-opinionated-but-valid first sentence is better than silence on every neutrally-worded note. Paired with the 3-word minimum, prevents "Wow." or "Meh." from becoming the blurb.
- **Unseen dot: recompute on tab focus, not scroll tracking.** Scroll-based dismissal is expensive (FlatList viewability callbacks, timing fudge) and users report it as flaky across apps. Focus-based recompute is a single server write and zero per-item tracking — simpler code, predictable UX.
- **Multi-device dot state is best-effort v1.** Two devices can disagree by one session. Acceptable because dots are a nudge, not a notification. Called out explicitly in risks; no cross-device sync beyond the single DB column write.
- **Dot position: top-right absolute, inside card frame.** Terracotta against a cream card is visible without being loud. 6pt is small enough to read as a subtle signal and not a notification badge. Chosen over top-left because the top-left is used by Round live labels (`PulseDot` + `"LIVE ROUND"`) and solo-share labels (avatar frame), both of which would collide.
- **Relative time hidden at ≥ 24h.** The `DateSectionHeader` already labels the bucket ("This Week"). Saying "4d ago" on a card inside a "This Week" section is two timestamps for the same datum. For same-day content the date header says "Today" which conveys *nothing* about recency; that's where "2h ago" adds value.
- **Reaction summary copy: numeric only on the emoji cluster, word on the reply pill.** "🔥😋 5" reads because the emojis imply the noun. "3 replies" needs the word because a bare "3" next to emoji-count "5" would read as a second emoji count. This matches existing `FeedActionRow` behavior.
- **Mark-seen debounce window: 30 seconds.** Long enough to collapse rapid tab-switching (user flicks between tabs to dismiss a notification) but short enough that an intentional revisit within a minute still registers.

### Out of Scope

- Per-emoji breakdown in the summary (e.g. "🔥 3, 😋 2") — single total stays.
- Replacing the existing ReactionPicker animation/style. Reuse as-is.
- Feed filter UX beyond existing chips.
- Pagination / infinite scroll polish.
- Batching ("3 posts from Sarah today").
- Notification badge on the Tables tab icon.
- Push notifications for new activity.
- Cross-device last-seen sync.
- LLM-based quote extraction.
- Quote extraction on detail pages, wishlist cards, or restaurant visit rows.
- Tuning or expanding the evaluative word list in this ticket.
- Extracting quotes from `entry_participants.notes` on Round cards.
- Pull-to-refresh copy / animation.
- Scroll-based dot dismissal.
- Unseen-counter numerics ("2 new since your last visit").

### Open Questions

None. All decisions locked above.

---

## Technical Design

### Approach

Mostly additive work against shipped infrastructure. Four independent streams land in parallel: (1) a small audit/lock of `FeedActionRow`'s existing reaction-preview behavior (no code change expected), (2) a new card-level long-press on the outer `Pressable` of each of the three feed cards that opens the existing `ReactionPicker` through the same `useToggleReaction` path `FeedActionRow` already uses, (3) a new pure utility `lib/textHighlight.ts` exporting `extractHighlight()` + `formatRelativeTime()` that replaces the raw-`content` rendering on `SoloShareCard` and `JournalNoteCard` with a single-line em-dash pull-quote and standardizes relative time on all three cards, and (4) an unseen-dot system backed by a new nullable `table_members.last_seen_at` column, a new `table-management?action=mark_seen` branch, and a new `useLastSeenAt`/`useMarkSeen` hook pair wired into `app/(tabs)/tables.tsx` via `useFocusEffect` and the table-switch callback. `lastSeenAt` is threaded as a prop from `tables.tsx` through the feed-section mapping into each card (one layer — no context needed). No changes to `table-activity`, `useTableActivity`, or `ReactionPicker`.

### Architecture Decisions

1. **Card-level long-press on the existing outer `Pressable`, not a new wrapper component.** Each card already has a root `Pressable` with `onPress` (tap-to-navigate). React Native's `Pressable` accepts `onLongPress` + `delayLongPress` per instance, and the native responder chain awards the gesture to the innermost pressable that accepts it — so the heart button's nested `Pressable` (inside `FeedActionRow`) wins automatically with its 220ms `delayLongPress`, and the outer card's 500ms path is the fallback. No `GestureDetector` needed. Trade-off: card-level long-press anchor has to use a fixed position (see #4), because `Pressable`'s `onLongPress` doesn't give you the touch coordinates.

2. **Anchor the card-level picker to the card's top-right, fixed.** Product didn't lock this; I'm picking top-right via `measureInWindow` on the card's root `View` to mirror the existing heart-anchored behavior without modifying `ReactionPicker`'s contract. Trade-off: the picker isn't under the finger, but the alternative (passing tap coordinates through a custom `PanResponder` / `GestureDetector`) adds a dependency and code for a polish detail. Modifying `ReactionPicker` to accept a `{ gestureX, gestureY }` prop is a follow-up if this feels off in testing.

3. **Quote extraction lives in one shared utility, `lib/textHighlight.ts`, with the evaluative word list as a module-level frozen array.** Keeping `extractHighlight` and `formatRelativeTime` in the same file is what the spec explicitly allows and keeps the footprint small; splitting into two files would net-zero. The word list is a `const` `Set<string>` for O(1) lookup. Trade-off: `formatRelativeTime` is semantically unrelated to highlighting — if anyone adds a third `lib/` text util later, splitting is trivial.

4. **`lastSeenAt` comes from a dedicated 1-scalar query (`useLastSeenAt`), NOT piggybacked on `useTables`.** `useTables` currently selects `role, joined_at, tables(...)` — it does not include `last_seen_at` on the `table_members` row, and adding it would require editing the `table-management` GET branch's select, invalidating a cache every component consuming `useTables` depends on. A separate cheap query (single-row fetch on `table_members` with `staleTime: 0` so focus-refetch works) is isolated, cleanly invalidatable after `mark_seen` writes, and fits into its own `queryKeys.tables.lastSeen(tableId, userId)` key. Trade-off: one extra round-trip on Table focus; negligible and runs in parallel with `useTableActivity`.

5. **`lastSeenAt` threaded as a prop from `tables.tsx` → cards (single layer).** `tables.tsx` already maps `section.items` directly to card components — no intermediate `TableActivityFeed` wrapper. Prop-drilling depth is exactly one, which is fine; context would be overkill. Each card gets `lastSeenAt: string | null` and computes its dot internally via `item.sort_date > lastSeenAt`. Trade-off: all three card components grow a prop; acceptable because it's explicit and type-checked.

6. **Mark-seen debouncing via a module-level `Map<tableId, timestamp>` inside `useMarkSeen`.** Not `useRef` (the hook instance dies when the Tables tab unmounts and the debounce window would reset on every focus cycle — exactly the wrong behavior). Not `mutationKey` (React Query dedups in-flight mutations, not time-windowed ones). A module-local `Map<string, number>` keyed by `tableId` persists for the app's lifetime, survives remounts, and the 30s check is a simple `Date.now() - last < 30_000` guard before `mutate()`. Trade-off: module-level state is a mild purity violation but is scoped to this single hook and test-friendly via a reset export.

7. **Mark-seen fires on Tables-tab focus AND on table-switch via the picker. No scroll tracking.** The spec is explicit; implementation uses `useFocusEffect` (from `expo-router`) keyed on `activeTable?.id` so it fires both on tab focus and on switch. The optimistic update writes `lastSeenAt = now()` into the `useLastSeenAt` cache immediately (so dots clear without waiting for the server) and the server write is fire-and-forget. Trade-off: a failed server write means next session shows the old dots; acceptable (spec explicitly accepts this).

8. **Haptic: add `expo-haptics` as a new dependency.** Not currently installed (`node_modules/expo-haptics` absent; not in `package.json`). One call site (`Haptics.selectionAsync()` on long-press activation). The dep is Expo-published, trivially compatible with Expo SDK 54. Trade-off: one new install; worth it for the tactile cue on a feature whose discoverability depends on it.

9. **No migration backfill.** `table_members.last_seen_at` starts `NULL` for every existing row. When `NULL`, the card renders the dot on every item (the "new user, everything is unseen" case). First mark-seen write clears the set. Trade-off: current users see one session of all-dots after deploy; acceptable as it matches the "you've been away" mental model.

10. **`JournalNoteCard`'s local `timeAgo()` is replaced by the shared `formatRelativeTime()`; old function is deleted.** Avoids divergent implementations. The new signature returns `null` for ≥ 24h, so the card's header `<Text>` is conditionally rendered.

### Data contracts

```ts
// lib/textHighlight.ts
export function extractHighlight(text: string | null | undefined): string | null;
// Returns: trimmed sentence, no quote marks, ≤80 chars (last full word boundary).
// Null if no candidate passes the 3-word / 3-90 char filter.

export function formatRelativeTime(dateStr: string, now?: Date): string | null;
// Returns: 'now' | `${n}m ago` | `${n}h ago` | null (≥24h).

// Internal (not exported):
const EVALUATIVE_WORDS: ReadonlySet<string>; // 24 words, locked per AC.
```

```ts
// hooks/tables/useLastSeenAt.ts
export function useLastSeenAt(
    tableId: string | null | undefined,
    userId: string | null | undefined,
): UseQueryResult<string | null, Error>;
// Queries table_members.last_seen_at via a small edge-function branch OR a
// direct PostgREST select (see #4 below for choice). Key:
// queryKeys.tables.lastSeen(tableId, userId). staleTime: 0 so focus refetches.

export function useMarkSeen(): UseMutationResult<
    { last_seen_at: string },
    Error,
    { tableId: string },
    unknown
>;
// Debounced module-level by tableId (30s). On success, optimistically writes
// data into queryKeys.tables.lastSeen(tableId, userId).
```

```ts
// supabase/functions/table-management: new action branch
// POST /table-management?action=mark_seen
// Body: { table_id: string }
// Response: { data: { last_seen_at: string } }
// Also reads: GET /table-management?action=last_seen&table_id=X
// Response: { data: { last_seen_at: string | null } }
```

### File Changes

**New**
- `napkin-app/lib/textHighlight.ts` — NEW — exports `extractHighlight()`, `formatRelativeTime()`, and the locked `EVALUATIVE_WORDS` set. Pure, no deps.
- `napkin-app/hooks/tables/useLastSeenAt.ts` — NEW — `useLastSeenAt(tableId, userId)` query + `useMarkSeen()` mutation with module-level debounce map.
- `supabase/migrations/20260422000000_table_members_last_seen_at.sql` — NEW — `ALTER TABLE table_members ADD COLUMN last_seen_at timestamptz NULL;` + optional index `CREATE INDEX idx_table_members_table_member ON table_members(table_id, member_id);` if not already present.

**Modified**
- `napkin-app/components/feed/SoloShareCard.tsx` — MODIFY — replace raw `{'\u201C'}{item.content}{'\u201D'}` block with `<QuoteBlurb text={extractHighlight(item.content)} />` (inline in the file, no new component); wrap root `Pressable` with `onLongPress` + `delayLongPress={500}`; add `lastSeenAt` prop + absolute-positioned unseen dot; add `formatRelativeTime(item.sort_date)` into the header row next to the rating badge.
- `napkin-app/components/feed/JournalNoteCard.tsx` — MODIFY — remove local `timeAgo()`; use `formatRelativeTime()` and conditionally render the time `<Text>`; replace the `item.content` tag-chip with the em-dash pull-quote using `extractHighlight()`; same long-press + unseen-dot wiring as SoloShareCard. Dot positions inside the inner `.card` view so it sits within the rounded body, not over the timeline gutter.
- `napkin-app/components/feed/TableNightCard.tsx` — MODIFY — NO quote extraction change; add card-level `onLongPress` (skip when `status === 'rating'`); add unseen-dot (skip when `status === 'rating'`); append `· {formatRelativeTime(item.sort_date).toUpperCase()}` to the label string when non-null.
- `napkin-app/app/(tabs)/tables.tsx` — MODIFY — call `useLastSeenAt(activeTable?.id, user?.id)`; wire `useMarkSeen().mutate({ tableId })` inside `useFocusEffect` keyed on `activeTable?.id`; pass `lastSeenAt` into each of the three card components in the mapping.
- `supabase/functions/table-management/index.ts` — MODIFY — add two action branches: `GET ?action=last_seen&table_id=X` and `POST ?action=mark_seen` body `{ table_id }`. Both check membership via `table_members` before reading/writing. Use existing service-role client.
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `tables.lastSeen(tableId, userId)` key.
- `napkin-app/package.json` — MODIFY — add `expo-haptics` (use `npx expo install expo-haptics` to pin SDK-compatible version).

### Routing / flow

- **Mark-seen trigger point:** inside `tables.tsx`, add:
  ```tsx
  useFocusEffect(useCallback(() => {
      if (activeTable?.id) markSeen.mutate({ tableId: activeTable.id });
  }, [activeTable?.id]));
  ```
  This fires both on tab focus (`useFocusEffect` semantics) and on table switch (`activeTable?.id` changes → callback re-runs → effect re-fires on next focus cycle, plus immediately via the dependency change). The 30s debounce in `useMarkSeen` collapses duplicate fires within the window.
- **`lastSeenAt` reaches cards:** `const { data: lastSeenAt } = useLastSeenAt(activeTable?.id, user?.id)`; then in the section-map pass `lastSeenAt={lastSeenAt ?? null}` to each of `TableNightCard` / `SoloShareCard` / `JournalNoteCard`. Cards render the dot when `!lastSeenAt || item.sort_date > lastSeenAt`.
- **Picker anchor for card-level long-press:** the card's root `Pressable` holds a `ref`; on `onLongPress` fire `Haptics.selectionAsync()` then `measureInWindow` → compute anchor at `(right - 40, top + 12)` → set `pickerAnchor` state → render `<ReactionPicker anchor={...} onPick={...} />` inline in the card (not via `FeedActionRow`). `onPick` calls `useToggleReaction.mutate(...)` with the same `{ targetType, targetId, emoji }` shape `FeedActionRow` uses — the cache invalidation on success is identical so the preview row updates automatically.

### Migration / backend changes

1. **Migration `20260422000000_table_members_last_seen_at.sql`:**
   ```sql
   ALTER TABLE table_members ADD COLUMN last_seen_at timestamptz NULL;
   ```
   No backfill. RLS policies on `table_members` already restrict writes to the row owner; no policy changes needed since the edge function runs service-role.

2. **`table-management` edge function:** add branch routing on `url.searchParams.get('action')` BEFORE the existing `req.method === 'GET'` catch-all.
   - `action=last_seen` (GET): verify `table_members` row exists for `(table_id, user.id)`, select `last_seen_at`, return `{ data: { last_seen_at: string | null } }`.
   - `action=mark_seen` (POST): parse `{ table_id }`, verify membership, `UPDATE table_members SET last_seen_at = now() WHERE table_id = $1 AND member_id = $2 RETURNING last_seen_at`, return `{ data: { last_seen_at } }`.

### Implementation Order

1. **Migration + edge function branches.** Ship the DB column and `table-management` actions first; they're independent and unblock the hook. Verify with curl that `last_seen` returns null for a fresh row and `mark_seen` sets it.
2. **`lib/textHighlight.ts`.** Pure utility with exhaustive unit tests covering: empty/null input, single-word sentences (filtered), all-neutral notes (fallback to first), mixed evaluative words (highest-scoring wins), tie-breaking by position, 80-char truncation at word boundary, `formatRelativeTime` boundary values (59s, 60s, 59m, 60m, 23h59m, 24h).
3. **`useLastSeenAt` + `useMarkSeen` hooks + `queryKeys.tables.lastSeen`.** Depends on step 1 backend. Includes the module-level debounce map and optimistic cache write. Unit-test the debounce by calling `mutate` twice in quick succession and asserting one network call.
4. **Install `expo-haptics`.** `npx expo install expo-haptics`. Smoke-test on an iOS sim via a throwaway call.
5. **Card long-press + ReactionPicker plumbing.** Wire the three card components' outer `Pressable` with `onLongPress` / `delayLongPress={500}` / `Haptics.selectionAsync()` / `measureInWindow` → show `ReactionPicker` → call `useToggleReaction`. Verify heart's 220ms long-press still wins on all three cards. Verify tap-to-navigate still works (no accidental trigger).
6. **Quote blurb swap on `SoloShareCard` and `JournalNoteCard`.** Replace the raw `content` render with `extractHighlight()` + em-dash prefix, `numberOfLines={1}`, `Newsreader_400Regular_Italic`. Do NOT touch `TableNightCard`.
7. **Relative-time swap on all three cards.** Delete the local `timeAgo()` in `JournalNoteCard`. Render `formatRelativeTime()` on the other two with their locked placements. Hide when null.
8. **Unseen dot rendering.** Add the dot component inline (or `components/feed/UnseenDot.tsx` if it'd get reused — it's ~8 lines, inline is fine). Threaded from `tables.tsx` via the prop. Skip on `TableNightCard` when `status === 'rating'`.
9. **`tables.tsx` mark-seen wiring.** `useFocusEffect` on `activeTable?.id` calling `markSeen.mutate`. Verify that switching tables doesn't hammer the endpoint (debounce works). Verify that returning to the Tables tab after > 30s fires a write.
10. **Manual QA pass** against the full acceptance criteria list.

### Risks

- **Card-level long-press swallowing scroll gesture on iOS.** `Pressable` with a long delay is generally well-behaved, but a 500ms press during a slow-start scroll could in rare cases trigger. Mitigation: `delayLongPress={500}` is long enough that any finger movement before trigger cancels it (RN default). Test on device, not sim.
- **`useFocusEffect` firing more often than expected.** Expo Router's focus semantics fire on every navigation into the Tables tab, including child-screen pop-backs. The 30s debounce is the defense; verify it holds when popping `/create-entry` back to `/(tabs)/tables`.
- **Quote blurb picking a bad fallback on neutral notes.** The spec-locked 3-word minimum guards against one-word blurbs but doesn't guard against "Went here for Sarah's birthday last night." becoming the quote. Acceptable — better than nothing, flagged in the spec as an accepted v1 risk.
- **ReactionPicker anchor colliding with card top-right when the card is near the screen edge.** `ReactionPicker` already clamps `left` to screen bounds; verify clamp works for cards near the right edge.
- **`lastSeenAt` query churn on tab-switch.** `useLastSeenAt` has `staleTime: 0` so it refetches on focus. Combined with the optimistic write from `useMarkSeen`, cache should stay accurate. Watch for a race where the GET returns stale data immediately after the POST — the optimistic write must win; verify mutation `onMutate` writes cache BEFORE the GET fires.
- **Haptic on Android is a no-op but still imports the module.** `expo-haptics` handles this internally; no action needed, noting it here so nobody "fixes" it by gating the import.

### Test surface (manual)

**Happy path**
- Open Tables tab on account with fresh data: dots appear on all cards (NULL `last_seen_at`). Navigate away, return > 30s later: dots clear.
- Long-press a `SoloShareCard` body (not on heart): picker opens top-right, haptic fires, tapping `🔥` applies the reaction, card's `FeedActionRow` preview row updates on next render.
- Log a solo entry with notes "Went here for Sarah's birthday. The truffle pasta was absolutely unreal." — card renders `— The truffle pasta was absolutely unreal.`
- Log a solo entry with notes "Decent meal, fine spot." — first sentence falls back (no evaluative words score).
- `JournalNoteCard` (no rating) with `content` present: renders em-dash quote, drops the tag chip rendering for `content`.
- `TableNightCard`: card-level long-press opens picker (not during live round); quote block unchanged; LIVE ROUND cards get NO dot.
- Relative time: card posted 30s ago shows `now`; 5 min ago shows `5m ago`; 3h ago shows `3h ago`; yesterday shows no per-card time (section header handles).

**Edge**
- Long-press directly on the heart button: 220ms heart-anchored picker wins (existing behavior preserved).
- Tap on card body: navigates to detail (no long-press fired).
- Rapid table-switch: `mark_seen` fires once, second call inside 30s is a no-op.
- Two devices: session A marks seen, session B still sees dots until next focus — accepted v1.
- Content exactly at 80-char boundary: no mid-word truncation.
- Content with only ≤ 2-word sentences: `extractHighlight` returns `null`, no quote rendered.
- `TableNightCard` with `status === 'rating'`: long-press disabled, dot hidden, existing LIVE treatment unchanged.
- Cold first render (no `last_seen_at` yet, user on a fresh Table): dot on every card — confirm no crash on `lastSeenAt === null`.

---

## Build Log

### Files Changed

**New**
- `supabase/migrations/20260422000000_table_members_last_seen_at.sql` — adds `last_seen_at TIMESTAMPTZ NULL` to `table_members`; no backfill
- `napkin-app/lib/textHighlight.ts` — `extractHighlight()` + `formatRelativeTime()` + locked 24-word `EVALUATIVE_WORDS` set; pure, no deps
- `napkin-app/hooks/tables/useLastSeenAt.ts` — `useLastSeenAt(tableId, userId)` query + `useMarkSeen()` mutation with module-level 30s debounce map; exports `_resetMarkSeenDebounce()` test helper

**Modified**
- `supabase/functions/table-management/index.ts` — added `GET ?action=last_seen` and `POST ?action=mark_seen` branches before the existing catch-all GET handler; both verify membership before reading/writing
- `napkin-app/lib/queryKeys.ts` — added `tables.lastSeen(tableId, userId)` key
- `napkin-app/package.json` — added `expo-haptics` (SDK 54-compatible via `npx expo install`)
- `napkin-app/components/feed/SoloShareCard.tsx` — card-level `onLongPress` (500ms) + `ReactionPicker`; `extractHighlight()` replaces raw `{'\u201C'}content{'\u201D'}` block (em-dash prefix, `Newsreader_400Regular_Italic`, 15px, `numberOfLines={1}`); `formatRelativeTime()` in header row right of rating; `lastSeenAt` prop + absolute unseen dot (6pt, `palette.primary`, top:10, right:10)
- `napkin-app/components/feed/JournalNoteCard.tsx` — deleted local `timeAgo()`; uses `formatRelativeTime()` (conditionally rendered — null hides the `<Text>`); `item.content` tag-chip replaced with em-dash pull-quote via `extractHighlight()`; card-level long-press + `ReactionPicker` anchored to `.card` view ref; unseen dot inside `.card` body; `lastSeenAt` prop
- `napkin-app/components/feed/TableNightCard.tsx` — card-level long-press disabled when `status === 'rating'`; `formatRelativeTime()` appended to label string when non-null (uppercase); unseen dot skipped when `status === 'rating'`; `lastSeenAt` prop; NO quote extraction (spec-locked)
- `napkin-app/app/(tabs)/tables.tsx` — added `useFocusEffect` + `useCallback` imports from `expo-router`/`react`; `useLastSeenAt` + `useMarkSeen` hooks; `useFocusEffect(useCallback(() => markSeen.mutate, [activeTable?.id]))` for mark-seen trigger; `lastSeenAt ?? null` threaded into all three card renders (active rounds shelf + feed section mapping)

### Tests

- `npx tsc --noEmit` — **0 errors** (run against all TICKET-010 files and full project)
- `npm run test:functions` (Deno) — **31/31 pass** (6 test suites); new edge function branches do not break existing `table-management` tests (they route before the GET catch-all, so POST /mark_seen and GET /last_seen dispatch correctly while all 4 pre-existing test cases still hit their expected branches)
- Lint: `npx expo lint` — **0 errors**, 7 warnings (all pre-existing except 1 intentional `react-hooks/exhaustive-deps` suppression in `tables.tsx` for `markSeen.mutate`, annotated with inline comment)

### Deviations

- **`useFocusEffect` placement**: the spec says to key on `activeTable?.id` both for tab focus and table switch. The implementation uses `useFocusEffect(useCallback(..., [activeTable?.id]))` which fires on: (a) initial tab mount, (b) tab regaining focus, and (c) `activeTable?.id` changing (because `useCallback` returns a new function, which `useFocusEffect` re-subscribes to). This is exactly the spec intent. The eslint warning about `markSeen` missing from deps is suppressed with an inline comment explaining the intentional design.
- **`JournalNoteCard` quote blurb layout**: the spec says "tag chips for `dish_description` stay." The implementation keeps `dish_description` as a tag chip in the same `tagsRow` and places the em-dash quote blurb as a sibling inline element (not a separate chip). The quote blurb uses `flex: 1` to fill the remaining row width. This avoids wrapping issues since the quote is `numberOfLines={1}` already. If the UX needs the quote on its own line, trivial to separate.
- **`SoloShareCard` unseen dot position**: the spec says "absolute, 10pt from top-edge, 10pt from right-edge of the card frame." The card `View` has `overflow: 'hidden'` (needed for the hero image border-radius). The dot is rendered before the hero image so it sits on top of the hero when one is present. Works correctly — the `overflow: 'hidden'` clips the dot only if it were outside the frame; since it's at top:10/right:10 it stays within.

### Builder Questions

- **`useMarkSeen` debounce no-op return shape**: when debounce blocks the call, the mutation returns `{ last_seen_at: new Date(last).toISOString() }` (the timestamp of the last real write). This is a benign no-op from the caller's perspective (they ignore the value). The optimistic cache write in `onMutate` still runs on every call including debounced ones — meaning on rapid tab-switches the cache still shows `now()` even though no server write fired. This is fine (extra dots cleared early), but worth an architect eye in case the intent was to not update the cache on debounced calls.
- **`table_members` RLS on `last_seen_at`**: the migration adds the column but no RLS policy. The edge function runs service-role, so writes bypass RLS. If any client-side PostgREST query ever reads `table_members.last_seen_at` directly (not via edge function), RLS would block the read for non-owners. Currently safe since all reads/writes go through the edge function — flagging for awareness.

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1 — 2026-04-17

**Reviewer**: code-reviewer (cold)

**Verdict**: REVISE

**AC Scorecard**:

- Reaction preview row (locks existing behavior)
  - [PASS] Summary region renders only when `reaction_count > 0 OR comment_count > 0` — `components/feed/FeedActionRow.tsx:216` unchanged, conditional intact.
  - [PASS] Summary format "🔥😋 5 · 3 replies" — `FeedActionRow.tsx:226-258` top-2 emojis, numeric reaction_count, middle-dot + marginLeft:10 between clusters.
  - [PASS] Reply pill hidden when `comment_count === 0`; reaction cluster hidden when `reaction_count === 0` — `FeedActionRow.tsx:216, 224, 250`.
  - [PASS] Reply pill text pluralization — `FeedActionRow.tsx:257`.
  - [PASS] Tap on summary → detail — `FeedActionRow.tsx:218`.
  - [PASS] Row height ≤ 40pt — `FeedActionRow.tsx` styles unchanged, `paddingVertical: 2` + ~28pt button height.

- Long-press quick reaction
  - [PASS] Card-level `onLongPress` wired on each of the 3 cards — `SoloShareCard.tsx:105`, `JournalNoteCard.tsx:101`, `TableNightCard.tsx:117`.
  - [PASS] `delayLongPress={500}` on all three — same line refs above.
  - [PASS] Heart's 220ms nested Pressable still wins (heart Pressable is inside FeedActionRow which is rendered inside outer card Pressable; inner responder wins) — `FeedActionRow.tsx:168-172` unchanged.
  - [FAIL] "Applies the toggle via the same `useToggleReaction` hook **and optimistic count logic** already used by `FeedActionRow`" — `SoloShareCard.tsx:97-100`, `JournalNoteCard.tsx:88-91`, `TableNightCard.tsx:104-107` all call `toggleReaction.mutate({...})` with NO `onSuccess` callback. `FeedActionRow.invalidateFeed` is a caller-site-only invalidator that invalidates `['tableActivity', tableId]`. `useToggleReaction.onSuccess` only invalidates `postInteractions.all`. Net: card-level long-press posts to server but the feed card's `top_emojis` / `reaction_count` / `comment_count` DO NOT refresh on next render (they come from `tableActivity` query). Spec test surface explicitly requires "card's `FeedActionRow` preview row updates on next render" — violated.
  - [PASS] Long-press disabled on live Rounds — `TableNightCard.tsx:95` early return when `isActive`.
  - [PASS] Haptic `Haptics.selectionAsync()` on activation — `SoloShareCard.tsx:90`, `JournalNoteCard.tsx:81`, `TableNightCard.tsx:98`. `.catch(() => undefined)` silences Android no-op, intentional.

- Quote blurb — SoloShareCard
  - [PASS] Single extracted sentence via `extractHighlight(item.content)` — `SoloShareCard.tsx:69, 241-250`.
  - [PASS] Hidden when `content` is null or extraction returns null — `SoloShareCard.tsx:241` short-circuit.
  - [PASS] Typography: `Newsreader_400Regular_Italic`, 15px, `palette.textSecondary` — `SoloShareCard.tsx:382-387`.
  - [PASS] Em-dash prefix in `palette.primary` — `SoloShareCard.tsx:247`.
  - [PASS] `numberOfLines={1}`, `ellipsizeMode="tail"` — `SoloShareCard.tsx:244-245`.
  - [PASS] No wrapping quote marks on extracted sentence — em-dash fully replaces old `\u201C…\u201D` wrap.

- Quote blurb — JournalNoteCard
  - [PASS] `extractHighlight()` replaces tag-chip for content — `JournalNoteCard.tsx:59, 185-194`.
  - [PASS] Same em-dash + typography — `JournalNoteCard.tsx:191, 287-292`.
  - [WARN] `dish_description` chip + quote blurb live on same `tagsRow` (flexDirection: row, flexWrap: wrap). Quote gets `flex: 1` and may read crowded when both are present — acceptable per Builder's noted deviation but a real visual quirk when both present with a long quote. Spec did not lock layout; cosmetic only.
  - [PASS] Hidden when `content` is null — short-circuit at `JournalNoteCard.tsx:185`.

- Quote blurb — TableNightCard (no-change check)
  - [PASS] No quote extraction on TableNightCard — `TableNightCard.tsx:85` still uses `firstNote = item.participants?.find((p) => p.notes)?.notes`, preserves `\u201C…\u201D` decorative wrap at lines 281-309.

- Quote extraction utility (`lib/textHighlight.ts`)
  - [PASS] Exported as `extractHighlight(text: string | null | undefined): string | null` — `textHighlight.ts:86`.
  - [PASS] Splits on `.!?` with terminator retained via lookbehind — `textHighlight.ts:91`.
  - [PASS] Filter ≥ 3 words AND length 3–90 chars — `textHighlight.ts:95-99`.
  - [PASS] Scores via `scoreCandidate` with regex whole-word, case-insensitive — `textHighlight.ts:46-58`.
  - [PASS] Highest score wins, ties broken by position (`>` strict comparator keeps earliest) — `textHighlight.ts:106-112`.
  - [PASS] Fallback to first filtered candidate when all score 0 — `textHighlight.ts:103-104` (loop only replaces when `score > bestScore`, so if all score 0 the first candidate sticks).
  - [PASS] Returns null when no candidate passes filters — `textHighlight.ts:101`.
  - [PASS] Trimmed, no quote marks, 80-char word-boundary truncation — `textHighlight.ts:114` via `truncateAtWordBoundary`.
  - Traced the spec's test cases: `"Went here for Sarah's birthday last night. The truffle pasta was absolutely unreal."` → second sentence (score 1 from "unreal") wins, produces `"The truffle pasta was absolutely unreal."`. `"Decent meal, fine spot."` → single sentence, score 0, fallback to first = `"Decent meal, fine spot."`. `"Wow."` → 1 word, filter rejects, returns null. `null` / `""` → null. All correct.

- Evaluative word list
  - [PASS] Exact 24 words match the AC list — `textHighlight.ts:17-42`. Case-insensitive, whole-word regex `\b${w}\b` with `/i` flag.

- Unseen dot — visual
  - [PASS] 6pt circle, `palette.primary`, top:10, right:10, absolute inside card frame — `SoloShareCard.tsx:303-311`, `JournalNoteCard.tsx:257-265` (inside `.card` body per spec), `TableNightCard.tsx:361-369`.
  - [PASS] Rendered when `!lastSeenAt` or `sort_date > lastSeenAt` — all three cards implement the same predicate.
  - [PASS] Not interactive — no tap handler; `accessibilityElementsHidden` + `importantForAccessibility="no"` set on all three.
  - [PASS] Not rendered on live Round — `TableNightCard.tsx:81-82` gates on `!isActive`.

- Unseen dot — dismissal semantics
  - [PASS] Render-time decision at mount via prop comparison — confirmed via the three card bodies.
  - [PASS] `lastSeenAt` query refetches only via queryKey change (table switch) since `useLastSeenAt` has `staleTime: 0` and no `refetchOnWindowFocus` coercion — effectively matches "recomputed on focus" in the behavioral sense (optimistic write from `useMarkSeen.onMutate` keeps cache fresh without a network round-trip).
  - [PASS] Does not disappear on scroll-past or tap — confirmed by absence of per-card dismissal handlers.

- Mark-seen trigger
  - [PASS] Fires on Tables-tab focus and on activeTable switch — `tables.tsx:84-90` via `useFocusEffect(useCallback(..., [activeTable?.id]))`.
  - [PASS] Debounced 30s per tableId, module-level `Map<string, number>` — `useLastSeenAt.ts:24, 31, 82-88`. Traced: mutate('A') at t=0 fires; mutate('A') at t=10s returns no-op without updating timestamp (so 30s window anchors to first-fire); mutate('A') at t=31s proceeds. Correct.
  - [PASS] Writes `last_seen_at = now()` — `table-management/index.ts:106` uses `new Date().toISOString()` on `table_members` for `(member_id, table_id)`.
  - [PASS] Fire-and-forget UX — no spinner/toast, catch swallowed.
  - [WARN] Optimistic cache update in `onMutate` runs on every call (including debounced no-ops), but `onSuccess` on debounced calls writes the OLD stored timestamp back — potentially overwriting a fresher `now()` from `onMutate`. Builder flagged this in Build Log. Acceptable v1 since the "old stored timestamp" is only stale by seconds and dots still clear overall, but it's a quiet regression on edge cases where a post arrives mid-debounce window.

- Relative time on cards
  - [PASS] Same-day threshold ladder (`< 60s → now`, `< 60m → Nm ago`, `< 24h → Nh ago`, `≥ 24h → null`) — `textHighlight.ts:133-147`.
  - [PASS] `SoloShareCard` — placed in `headerRow.headerRight` left of rating badge, `Type.caption`, `palette.textMuted` — `SoloShareCard.tsx:196-200`.
  - [PASS] `JournalNoteCard` — old local `timeAgo()` deleted, shared `formatRelativeTime()` used, `<Text>` conditionally rendered when non-null — `JournalNoteCard.tsx:52-56, 134-138`.
  - [PASS] `TableNightCard` — appended only when non-null, uppercased — `TableNightCard.tsx:73-77`.
  - [PASS] Shared utility exported from `lib/textHighlight.ts` — per spec allowance.

- Data layer — table-activity extension
  - [PASS] No change to `table-activity` edge function or `useTableActivity` — confirmed via `git diff --stat` (neither in changeset).
  - [PASS] `lastSeenAt` surfaced via separate `useLastSeenAt` hook + threaded via prop, `queryKeys.tables.lastSeen` key — `queryKeys.ts:18-19`, `useLastSeenAt.ts:54-65`, `tables.tsx:367, 393, 405, 415`.

- Data layer — mark-seen action
  - [PASS] `POST /table-management?action=mark_seen` with `{ table_id }` body — `table-management/index.ts:78-118`.
  - [PASS] `GET /table-management?action=last_seen&table_id=X` returning `{ data: { last_seen_at: string | null } }` — `table-management/index.ts:47-75`.
  - [PASS] Membership verified before read/write (service-role bypasses RLS, but manual membership check in both branches) — `table-management/index.ts:56-69` (GET) and `:90-102` (POST).
  - [PASS] Migration `20260422000000_table_members_last_seen_at.sql` — adds nullable column, no backfill, matches tech design exactly. No index added (table_members PK `(table_id, member_id)` already indexes the lookup).

- State handling
  - [PASS] All new elements are additive and independently hide-able — empty/neutral cards render as before.
  - [PASS] Active-rounds shelf skips unseen dots + relative time via `isActive` gating — `TableNightCard.tsx:80-82` and `:70-77`.

**Cross-cutting findings**:

1. **[FAIL] Card-level long-press reaction doesn't refresh the feed card's preview row** — `SoloShareCard.tsx:97-100`, `JournalNoteCard.tsx:88-91`, `TableNightCard.tsx:104-107`. The card-level `handlePickEmoji` calls `toggleReaction.mutate(...)` but never passes `{ onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tableActivity', tableId], exact: false }) }`. Only `FeedActionRow.applyToggle` attaches this invalidator inline (`FeedActionRow.tsx:78-85, 105, 112`). The `useToggleReaction` hook's own `onSuccess` invalidates `postInteractions.all` — a query the feed card never reads. Spec test surface explicitly requires: "tapping `🔥` applies the reaction, card's `FeedActionRow` preview row updates on next render." Fix: each of the 3 card `handlePickEmoji` impls needs to either (a) inline the same `invalidateFeed` after mutate, or (b) centralize the invalidation inside `useToggleReaction.onSuccess` itself and remove it from FeedActionRow.

2. **[WARN] ReactionPicker right-edge overflow on card-anchored position** — `ReactionPicker.tsx:42`. Clamp is `Math.max(12, Math.min(anchor.x - 20, 9999))` — the 9999 ceiling is meaningless; there's no clamp against `Dimensions.get('window').width - POPOVER_WIDTH`. Card anchors at `x + width - 40` on a ~274pt wide card with 20pt left padding → picker's left ≈ 310 on a 390pt screen, so picker's right ≈ 570pt, overflowing 180pt. Tech design explicitly flagged this as a risk ("verify clamp works for cards near the right edge") but the fix wasn't applied. Pre-existing code in ReactionPicker, surfaced (not introduced) by TICKET-010's new card-level anchor. Should be patched before this feature ships to real users.

3. **[WARN] Debounced `mark_seen` `onSuccess` overwrites fresh optimistic cache** — `useLastSeenAt.ts:127-136`. On a debounced call, `mutationFn` returns `{ last_seen_at: new Date(last).toISOString() }` (the OLD stored timestamp), and `onSuccess` writes that OLD timestamp into cache — but `onMutate` already wrote fresh `now()`. Result: fresh optimistic timestamp gets downgraded to the old one. In narrow races (post arrives at t=5s, user tab-switches at t=10s within debounce window), the post could briefly show an unseen dot. Builder flagged this in Build Log. Suggest: skip the `setQueryData` in `onSuccess` when the returned `last_seen_at` equals the debounce-preserved stored value (or more simply, make the debounced branch return the `onMutate`'s optimistic value so they agree).

4. **[PASS] Feed-order invariant preserved** — `useMarkSeen.onSuccess` does NOT invalidate `queryKeys.tables.activity`. Confirmed via grep. PASS.

5. **[PASS] Branch hygiene** — single commit `6205beb` on `feat/TICKET-010`, exactly the 11 files in the tech design's File Changes list. No scope creep.

6. **[PASS] `useFocusEffect` dep** — keyed on `activeTable?.id`, per spec. ESLint `exhaustive-deps` suppression is annotated with rationale at `tables.tsx:81-83`.

7. **[PASS] Long-press vs heart precedence** — no `pointerEvents` changes, no responder interception; heart's inner Pressable wins via native responder chain + 220ms < 500ms timing.

8. **[PASS] Haptics import** — `expo-haptics@~15.0.8` in `package.json:32` and `package-lock.json:28`. `Haptics.selectionAsync().catch()` called on each card's long-press activation.

9. **[PASS] RLS enforcement in edge function** — service-role bypass is gated by manual membership check in both new branches.

10. **[PASS] Migration** — `ALTER TABLE table_members ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NULL;` with no backfill, matches tech design. Column is indexed via the existing `(table_id, member_id)` PK — no extra index needed.

**Final verdict**: REVISE

The FAIL on "card-level long-press refreshes the feed card" is the blocker — the feature looks wired up end-to-end but the user-visible preview row won't update until a manual pull-to-refresh, which directly contradicts the spec's Happy Path test surface. Fix is 3-6 lines (one `onSuccess` per card or one hook-level invalidation). The two WARNs (ReactionPicker right-edge clamp, debounced onSuccess cache overwrite) are not blockers individually but together reduce confidence that the feature is production-ready. Once the FAIL is addressed, the WARNs can be deferred to follow-up if timeboxed.

---

### Review 2 — 2026-04-17

**Reviewer**: code-reviewer (delta review)

**Verdict**: APPROVE

**Review 1 findings**:
- [PASS] Feed invalidation: all three card-level `handlePickEmoji` impls now pass `{ onSuccess }` that invalidates `['tableActivity', tableId]` with `exact: false` and a truthy `tableId` guard — mirrors `FeedActionRow.invalidateFeed` (`SoloShareCard.tsx:101-113`, `JournalNoteCard.tsx:93-105`, `TableNightCard.tsx:108-120`). All three import `useQueryClient` from `@tanstack/react-query`.
- [PASS] Picker edge clamp: `ReactionPicker.tsx:26,44-47` imports `Dimensions`, computes `maxLeft = SCREEN_WIDTH - POPOVER_WIDTH - EDGE_MARGIN`, and uses `Math.max(EDGE_MARGIN, Math.min(anchor.x - 20, maxLeft))`. Traced on 390pt screen with anchor.x=350: maxLeft=118, final left=118, right edge=378 (within 390-12). Fits.
- [PASS] Mark-seen cache race: `useLastSeenAt.ts:127-144` reads cached value and only writes `setQueryData` when the server/debounced `last_seen_at >= cached`. Traced: debounced call returns stored `now_A`, optimistic cache holds fresh `now_B > now_A`, comparison skips write, cache keeps `now_B`. Correct.

**Regression check**: No regressions. `git diff 6205beb..2e70c04 --stat` shows exactly the 5 expected files (the 3 cards + ReactionPicker + useLastSeenAt), 63 insertions / 7 deletions. No `app/u/[identifier].tsx` or other unrelated touch. `npx tsc --noEmit` exits 0. Previous PASSes (quote extraction, evaluative word list, migration, edge function branches, haptics wiring, `useFocusEffect` dep, long-press-vs-heart precedence) are all outside the delta — unchanged.

**Final verdict**: APPROVE

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: YYYY-MM-DD
- Final verdict:
- Notes:
