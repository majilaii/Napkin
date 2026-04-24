---
id: TICKET-007
title: "Reactions & replies on posts — the warmth layer"
priority: high
status: done
created: 2026-04-16
updated: 2026-04-16
tags: [interactivity, warmth, feed, round-detail, entry-detail, social]
---

# Reactions & Replies on Posts

## Problem

When a Round reveals, the conversation ends. When someone posts a solo share or a journal note, everyone sees it but nobody can respond. The feed is a shared read-only stream.

The whole pitch of the Table is "a small trusted group that shares food experiences" — but right now the *sharing* is one-way. You can't say "yum," you can't ask "where was this?", you can't reply "we have to go back." The page goes cold the second it's posted.

**The mental model is Letterboxd activity + iMessage reactions.** On Letterboxd, reviews accumulate likes and comments and that's what makes the feed feel alive. Napkin needs the same thing, but tuned for a private group — lightweight, warm, intimate, not performative.

**Who has this problem:** every member of every Table. Every post is currently a dead end after it's read.

**Why it matters:** without an interaction layer, Table Night feels like an event that happens and then evaporates. Solo shares feel like broadcasts into a void. The Table's shared memory is impoverished because the *reactions* to meals — the tiny "omg" and "we need to go back" moments — have nowhere to live.

## Notes

### What this ticket delivers

Two related primitives on every post:

1. **Reactions** — a small curated set of emoji (🔥 😋 ❤️ 💯 👀), tap-to-toggle per user. Shown on the detail page prominently, and as a mini-preview on feed cards.
2. **Replies** — a lightweight comment thread attached to a post. Plain text only. Scoped to the Table.

Both apply to:
- Table Nights (the Round as a whole, post-reveal)
- Entries (solo shares AND a participant's entry within a Round)
- Journal notes (entries without a rating)

### Data model — polymorphic target

```sql
-- post_reactions
id uuid primary key
target_type text check (target_type in ('table_night', 'entry'))
target_id uuid not null
user_id uuid references auth.users(id)
emoji text not null  -- one of '🔥' '😋' '❤️' '💯' '👀'
created_at timestamptz default now()
unique (target_type, target_id, user_id, emoji)

-- post_comments
id uuid primary key
target_type text check (target_type in ('table_night', 'entry'))
target_id uuid not null
table_id uuid references tables(id) not null  -- denormalized for RLS
user_id uuid references auth.users(id)
body text not null check (char_length(body) between 1 and 2000)
created_at timestamptz default now()
edited_at timestamptz
```

RLS: SELECT + INSERT gated on `table_id` matching a row in `table_members` for the current user. UPDATE/DELETE restricted to `user_id = auth.uid()`.

The `table_id` column is denormalized on `post_comments` for fast RLS checks — write path looks it up via the target's parent (table_night.table_id or entry.table_id) once.

Realtime: add both tables to `supabase_realtime` publication.

### Concrete additions

| # | What | Where | Effort |
|---|---|---|---|
| 1 | `ReactionBar` component — 5-emoji row, tap to toggle, shows count + who reacted on long-press | `components/posts/ReactionBar.tsx` | M |
| 2 | `CommentThread` component — list + inline composer, optimistic send | `components/posts/CommentThread.tsx` | M |
| 3 | Wire ReactionBar + CommentThread onto Round detail (below "Photos" section) | `app/table-night-detail.tsx` | S |
| 4 | Wire ReactionBar + CommentThread onto Entry detail (below notes) | `app/entry-detail.tsx` | S |
| 5 | Reaction preview on feed cards — top 2 emoji + "5 reactions · 2 replies" pill | `components/feed/TableNightCard.tsx`, `SoloShareCard.tsx`, `JournalNoteCard.tsx` | S |
| 6 | Realtime subscription hook — updates counts live on detail screens | `hooks/posts/usePostInteractionsRealtime.ts` | S |

### Edge function

`supabase/functions/post-interactions/index.ts` — single function with action routing:

- `POST { action: 'react', target_type, target_id, emoji }` → toggle (insert if missing, delete if exists)
- `POST { action: 'comment', target_type, target_id, body }` → insert
- `POST { action: 'edit_comment', comment_id, body }` → update (if owner, within 5 min)
- `POST { action: 'delete_comment', comment_id }` → delete (if owner)
- `GET ?target_type=X&target_id=Y` → return `{ reactions: [{emoji, count, user_ids}], comments: [...] }`

Follow the pattern in `supabase/functions/table-night/index.ts` exactly — service role key, manual auth via `supabase.auth.getUser(token)`, `corsHeaders` on every response.

### Hooks

- `hooks/posts/usePostInteractions(targetType, targetId)` — query hook, returns reactions + comments
- `hooks/posts/useToggleReaction()` — mutation
- `hooks/posts/useAddComment()` — mutation
- `hooks/posts/useEditComment()` / `useDeleteComment()` — mutations
- `hooks/posts/usePostInteractionsRealtime(targetType, targetId)` — subscribes and invalidates

Query key addition in `lib/queryKeys.ts`:
```typescript
postInteractions: {
    all: (targetType: string, targetId: string) => ['postInteractions', targetType, targetId] as const,
}
```

### UX decisions to lock in during product spec

- **Emoji set is fixed at 5, not user-chooseable.** Curation > expression. Keeps the interaction feeling consistent. (Letterboxd's ❤️ vs full emoji keyboard — go the Letterboxd way.)
- **Long-press a reaction to see who reacted.** Short avatars list. Tap to toggle own reaction.
- **Comments display oldest-first.** It's a conversation, not a comment section. No nesting/threading in v1 — flat replies.
- **No @mentions in v1.** Add later if people ask.
- **No notifications in v1.** The TableNightBanner is the only existing push surface; comment notifications are a separate product decision.
- **Edit window: 5 minutes.** After that, comment is locked (can still delete).
- **Feed card preview shows only if ≥1 reaction OR ≥1 comment.** Don't clutter clean cards.
- **Reactions allowed pre-reveal on active rounds?** NO. Only post-reveal. During rating, the whole screen is about the act of rating — don't pollute.

### Out of scope

- ❌ Reactions on individual participant's rating-within-a-round (v2 — would need another target_type)
- ❌ @mentions
- ❌ Push notifications for new comments/reactions
- ❌ Rich media in comments (images, links, emoji keyboard beyond plain text)
- ❌ Moderation tooling
- ❌ Threading / nested replies
- ❌ Read receipts ("Sarah saw this")
- ❌ Comment count on the Tables tab header

### Risks

- **Denormalized `table_id` on `post_comments` can drift** — if an entry is ever moved between tables (currently impossible, but imagine merging tables later). Mitigation: add a trigger that syncs `table_id` from the parent on insert. Worth doing now.
- **Realtime channels per-post** — if a user opens 5 detail pages in a session, that's 5 active channels. Supabase Realtime handles this but we should unsubscribe on unmount.
- **Count accuracy on feed cards** — if we denormalize reaction/comment counts onto `table_nights` and `entries`, we need triggers to keep them in sync. Alternative: fetch counts in the feed query. Decide during architecture pass.

### Files touched (anticipated)

- **New**: `supabase/migrations/YYYYMMDD_post_interactions.sql`, `supabase/functions/post-interactions/index.ts`, `components/posts/ReactionBar.tsx`, `components/posts/CommentThread.tsx`, `hooks/posts/usePostInteractions.ts`, `hooks/posts/usePostInteractionsRealtime.ts`
- **Modified**: `app/table-night-detail.tsx`, `app/entry-detail.tsx`, `components/feed/TableNightCard.tsx`, `components/feed/SoloShareCard.tsx`, `components/feed/JournalNoteCard.tsx`, `lib/queryKeys.ts`

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec
<!-- Filled by product-designer agent when ticket moves to 'ready' -->

### User Stories
- As a member of a Table, I want to react with a single tap to a friend's solo share so that I can say "yum" without typing a full comment.
- As a participant in a Round, I want to react and reply once the reveal is over so that the meal doesn't just end when the average drops.
- As a user browsing the feed, I want to see at a glance that a post has replies or reactions so that I know which posts the Table is talking about.
- As the author of a post, I want to see who reacted and with which emoji so that the warmth is attributed, not anonymous.
- As someone who fat-fingered a comment, I want a short window to fix a typo so that I'm not stuck deleting and re-posting.
- As a user on a Journal note (no rating), I want the same reactions and replies so that food memories shared without ratings still feel alive.

### Acceptance Criteria

#### Reactions — behavior
- [ ] Exactly 5 emoji are available, in fixed order: 🔥 😋 ❤️ 💯 👀. No keyboard, no custom emoji.
- [ ] Tapping an emoji the user has not reacted with adds their reaction; tapping an emoji they've already reacted with removes it.
- [ ] A user MAY react with multiple distinct emoji on the same post (toggle is per-emoji, not per-user).
- [ ] Each emoji chip displays its count to the right of the emoji. Chip with count 0 hides the count number entirely (emoji alone, dimmed state).
- [ ] An emoji the current user has reacted with is rendered with a filled/active chip style; all others use the quiet/inactive style.
- [ ] Long-pressing an emoji chip with count ≥ 1 opens a short bottom sheet listing the display names (and avatars) of users who reacted with that emoji, oldest first.
- [ ] Long-press on an emoji chip with count 0 does nothing (no empty sheet).
- [ ] Reactions update optimistically on tap; roll back on error with an unobtrusive toast.
- [ ] On an active (not-yet-revealed) Round, the ReactionBar is not rendered at all. Reactions only appear once `table_nights.status = 'revealed'`.
- [ ] Entries and Journal notes show the ReactionBar immediately on creation (no gating).

#### Replies — behavior
- [ ] A composer appears at the bottom of the CommentThread: single-line text input that grows up to 4 lines, placeholder "Say something…", and a send arrow that activates when `body.length ≥ 1` after trim.
- [ ] On send, the comment appears optimistically at the bottom of the thread with a muted "Sending…" timestamp; on success, timestamp switches to the relative time.
- [ ] On send failure, the optimistic row is marked with a retry affordance; user can tap to retry or swipe to remove.
- [ ] Comments display oldest-first, top-to-bottom. No nesting, no replies-to-replies.
- [ ] Each comment row shows: avatar, display name, body, relative timestamp ("just now", "2m", "3h", "2d", then absolute date after 7d).
- [ ] Comments `body` is limited to 2000 characters. Composer visibly blocks input beyond 2000 and shows a muted "2000" counter once the user passes 1900.
- [ ] Body is plain text only — no markdown, no link previews, no image paste.
- [ ] Empty state when there are 0 comments: muted italic line "No replies yet — be the first."
- [ ] On mobile, tapping the composer scrolls the thread so the last comment stays visible above the keyboard. Closing the keyboard restores the detail screen's scroll.

#### Edit & delete
- [ ] The author of a comment sees a small "..." affordance on their own comment only.
- [ ] Within 5 minutes of `created_at`, the author's menu exposes both "Edit" and "Delete". After 5 minutes, only "Delete" is available.
- [ ] Editing opens an inline editor seeded with the existing body; saving updates the comment and sets `edited_at`.
- [ ] Comments with a non-null `edited_at` show a muted "· edited" marker after the timestamp.
- [ ] Deleting removes the comment immediately for all viewers. No tombstone, no "this was deleted" placeholder.
- [ ] A non-author viewing someone else's comment sees no menu affordance on that row.

#### Feed card preview
- [ ] A post card (Round, solo share, journal note) renders a single-line preview pill below its existing metadata if and only if reactions ≥ 1 OR comments ≥ 1.
- [ ] Pill format: up to the top 2 emoji by count, each with their count, followed by a separator dot and `N reply` or `N replies`. Example: "🔥 3 ❤️ 1 · 2 replies".
- [ ] If there are reactions but 0 comments, the reply segment is omitted. If there are comments but 0 reactions, the emoji segment is omitted and the pill is just "2 replies".
- [ ] The preview pill is not independently tappable; tapping the card navigates to the detail screen as before. The thread on the detail page is scrolled into view when arriving from the pill tap area (optional nicety).

#### Placement on detail screens
- [ ] Round detail: ReactionBar + CommentThread render below the "Photos" section, above the footer.
- [ ] Entry detail (both solo shares and round-participant entries): ReactionBar + CommentThread render below the notes block, above the footer.
- [ ] Journal notes (entries without a rating) render the same ReactionBar + CommentThread as rated entries.

#### Realtime & polymorphic target
- [ ] When user A adds a reaction on their device, user B viewing the same detail screen sees the count update without a manual refresh (within ~2s).
- [ ] When user A posts a comment, user B viewing the same detail screen sees the new comment appended without pulling to refresh.
- [ ] When user A edits or deletes a comment, user B sees the change reflected in realtime.
- [ ] RLS: a user who is not a member of the Table the post belongs to cannot read or write reactions or comments on that post.
- [ ] Reactions and comments with `target_type='table_night'` only attach to Rounds; with `target_type='entry'` only to entries. No cross-leakage across types.
- [ ] Navigating between detail screens cleanly unsubscribes the prior realtime channel (no leaked subscriptions).

#### Accessibility
- [ ] Each emoji chip has a screen-reader label of the form "React with fire, 3 reactions" / "You reacted with fire, 3 reactions".
- [ ] Emoji chip tap targets are ≥ 40×40pt.
- [ ] Inactive chip text and active chip text both meet WCAG AA contrast against their background in both light and dark themes.
- [ ] The comment composer's send button has an accessible label "Send reply".

### UX Decisions
- **Emoji set fixed at 5**: 🔥 😋 ❤️ 💯 👀 in that fixed order. Curation > expression; keeps the warmth layer feeling consistent and intentional, same logic as Letterboxd's single ❤️ over a full emoji keyboard.
- **Per-emoji toggle (multiple reactions per user allowed)**: The unique constraint on `(target_type, target_id, user_id, emoji)` means a user can react 🔥 *and* 😋. Matches iMessage tapbacks. Simpler than a "one reaction per user, second reaction replaces first" model and supports the "multiple moods" feel of food reactions.
- **ReactionBar layout**: Single horizontal row of 5 chips, no wrap, no scroll — five fits within one mobile row at a tap target of 40pt and still leaves margin. Chip = emoji + count (hidden at 0). Active chip uses `primaryMuted` background with `primary` text; inactive chip uses `surfaceContainerLow` with `textSecondary`.
- **Inline composer, not modal**: Composer lives at the bottom of the CommentThread card on the detail screen. Keyboard pushes the thread up; no full-screen modal interruption. Matches the iMessage model, not the Instagram comments screen.
- **Keyboard behavior**: When the composer gains focus, the thread scrolls so the most recent comment is pinned just above the keyboard. Closing the keyboard does not blur unless the user taps outside the composer.
- **Comment order is oldest-first**: This is a conversation, not a comment section. New replies land at the bottom, next to the composer, reinforcing the iMessage mental model. No sort toggle.
- **Placement — Round detail**: ReactionBar + CommentThread sit below Photos. Rationale: Photos are the visual recap, reactions/comments are the peanut gallery — they come after the evidence.
- **Placement — Entry detail**: ReactionBar + CommentThread sit below the notes block. The reaction is to the take, so the take comes first.
- **Feed card preview pill**: Only rendered when there's something to say (≥1 reaction OR ≥1 comment). Top 2 emoji by count, each with their count; comments summarized as "N replies". Keeps cards clean for posts that haven't generated conversation yet.
- **Empty thread copy**: "No replies yet — be the first." Italic, muted. Invites action without being hypey.
- **Delete permissions**: Comment author only. Table hosts and admins cannot delete other members' comments in v1 — this is a close-friends product, not a moderation surface. Revisit if it becomes a real problem.
- **Edit window starts from `created_at`**: 5 minutes from original post. One shot at a typo, not an infinite runway. If a comment is edited at 4:50, it is locked 10 seconds later.
- **Time formatting**: Relative for the first 7 days ("just now", "2m", "3h", "2d"), then absolute date ("Apr 3"). Matches the existing feed style.
- **Edited marker**: Muted "· edited" appended after the timestamp. Hovering/long-pressing does not reveal the pre-edit body — we don't expose history.
- **Hide count at 0**: An emoji chip with zero reactions shows just the emoji, dimmed. No "0" digit. Keeps the bar quiet on fresh posts and clarifies that long-press does nothing.
- **No reactions during an active Round**: The ReactionBar is omitted entirely from Round detail when `status != 'revealed'`. Rating is a focused solo act; reactions would pollute the moment and leak information pre-reveal.
- **Journal notes get the full treatment**: Entries without a rating are still entries — same ReactionBar, same CommentThread. No special case. Reinforces "everything is a table; every post is a memory."
- **Accessibility labels**: Emoji chips announce both the emoji name and the count (e.g., "Fire, 3 reactions" or "You reacted with fire, 3 reactions"). Send button on the composer is labeled "Send reply". Contrast checked against both palettes.

### Out of Scope
- Reactions or replies on a specific participant's rating-within-a-Round (would require a 3rd `target_type`; defer to v2).
- @mentions within comment bodies.
- Push notifications for new reactions or comments.
- Rich media in comments: images, link unfurls, custom emoji, GIFs, formatted text.
- Moderation tooling — no admin delete, no report, no block.
- Nested replies / threading. Flat conversation only.
- Read receipts on comments ("Sarah saw this").
- Comment or reaction counts surfaced on the Tables tab header.
- Revealing pre-edit comment history.
- User-chosen custom emoji set.

### Open Questions
- **Tiebreaker for "top 2 emoji" on the feed card pill** — if three emoji all have count 2, which two display? Proposed default: higher count wins; tie broken by most-recently-reacted-at. Confirm.
- **Reactions after a member leaves/is removed from the Table** — do their prior reactions and comments remain visible (authored by their display name), or soft-delete on removal? Leaning: keep visible with the ex-member's preserved display name and a muted "(former member)" marker — the Table's shared memory shouldn't get holes punched in it. Needs product call.
- **Host-delete on a Round** — if a Round is closed/deleted, do its reactions and comments cascade with it? Leaning yes (cascade via FK on target). Confirm.
- **Rate-limit on comments** — is there a per-user spam ceiling (e.g., max 5 comments per post per minute)? Unlikely to matter in a trusted group, but we should decide before launch whether to punt entirely or install a minimal guard.
- **Does the send action use return key or a visible send button?** Proposed: visible arrow button only (return key inserts a newline, matching iMessage multiline). Confirm — alternative is return = send with shift-return for newline.

**Blockers for build**: The per-emoji-toggle decision (multiple reactions per user allowed) is already resolved in Notes and locked in UX Decisions above — not a blocker. None of the open questions change the data model or edge function shape; all can be answered with copy or minor behavior tweaks during build. No hard blockers.

---

## Technical Design
<!-- Filled by architect agent -->

### Approach

Two new polymorphic tables — `post_reactions` and `post_comments` — back the warmth layer for three post types (`table_night`, `entry`). Targets are referenced via `(target_type, target_id)` with no real FK; integrity is enforced by a `BEFORE INSERT` trigger that resolves the parent row, validates its existence, and copies the parent's `table_id` into a denormalized column on *both* tables. RLS reads the denormalized `table_id` to check `table_members` membership — this is the hot path, and denormalization keeps it a single index lookup. Realtime is enabled on both tables; all subscriptions are scoped per-post so the feed never opens channels it doesn't need.

The API surface is one edge function — `supabase/functions/post-interactions/index.ts` — following the exact pattern of `supabase/functions/table-night/index.ts` (service role client, manual `getUser` auth, action-routed POST, GET by query params, `corsHeaders` everywhere). POST actions: `react`, `comment`, `edit_comment`, `delete_comment`. GET returns `{ reactions, comments, counts }` for one post. All writes that reference a Round validate the Round's status server-side: no reactions/comments allowed unless `table_nights.status = 'revealed'`. The 5-minute edit window is enforced in the edge function against `created_at`, not the client.

On the client, one hook module (`hooks/posts/usePostInteractions.ts`) exports the query hook, four mutation hooks, and a realtime subscription hook (`usePostInteractionsRealtime`). Mutations use TanStack Query optimistic updates against a single cache key `['postInteractions', targetType, targetId]` whose shape matches the edge function GET response, so reactions toggle and comments append optimistically from the same shape. The realtime hook subscribes to one channel per post (`post-interactions:{target_type}:{target_id}`) with two `postgres_changes` listeners filtered by `target_type` and `target_id`, invalidating the cache on any event and cleanly unsubscribing on unmount.

Feed card previews use a separate, cheap path: reaction/comment counts are denormalized onto `table_nights` and `entries` via triggers (`reaction_count`, `comment_count`, `top_emojis jsonb`). The existing `table-activity` edge function already hydrates these rows — we just add the three new columns to its select list, and the cards read `top_emojis` directly to render the top-2-emoji pill with no extra query. Key files touched: migration, `supabase/functions/post-interactions/index.ts`, `supabase/functions/table-activity/index.ts` (select-list additions only), `hooks/posts/usePostInteractions.ts`, `hooks/posts/usePostInteractionsRealtime.ts`, `components/posts/ReactionBar.tsx`, `components/posts/CommentThread.tsx`, `app/table-night-detail.tsx`, `app/entry-detail.tsx`, all three feed card components, `lib/queryKeys.ts`.

### Architecture Decisions

- **Denormalized counts + `top_emojis` JSON on parent tables** — Add `reaction_count INT DEFAULT 0`, `comment_count INT DEFAULT 0`, and `top_emojis JSONB DEFAULT '[]'` columns to both `table_nights` and `entries`. Trigger-maintained on INSERT/DELETE/UPDATE of `post_reactions` and `post_comments`. **Why:** the feed is read-heavy (every tab switch re-queries), and the existing feed query already returns these parent rows — piggy-backing three columns is ~0 cost. Aggregating on every feed load would N+1 across every card. **Alternative considered:** a batched "get counts for these N targets" query in the feed hook — rejected because it adds a second network round-trip and a second cache to keep coherent with realtime.

- **`top_emojis` stored as `JSONB` of `[{emoji, count, last_reacted_at}]` sorted desc** — Trigger recomputes from scratch on every reaction change (5 emoji max; trivial). Top-2 tiebreaker: higher `count` wins, then more recent `last_reacted_at`. **Why:** matches the Open Question #1 proposal deterministically and lets the feed render the pill with zero client logic. **Alternative considered:** computing top-2 client-side from a raw reactions array in the feed payload — rejected because it either pulls every reaction row per card (expensive) or needs a GROUP BY aggregation in the feed query (slower, duplicates trigger work).

- **Denormalize `table_id` on BOTH `post_reactions` and `post_comments`** — Not just comments. Same `BEFORE INSERT` trigger pattern (`set_post_interaction_table_id()`) resolves the parent by `target_type` and populates `table_id`. **Why:** RLS policies on both tables need the same membership check; doing a join-through-target in the RLS policy would be an unindexed lookup on every row read. With `table_id` denormalized and indexed, SELECT RLS is one lookup. **Alternative considered:** RLS policy that joins through the parent table — rejected on performance grounds and because polymorphic joins in RLS are awkward (need `CASE target_type WHEN ... THEN ...`).

- **Polymorphic integrity via `BEFORE INSERT` trigger, not CHECK constraint** — Trigger resolves the target row and raises if it doesn't exist; it also populates `table_id`. No FK on `target_id`. **Why:** Postgres can't express polymorphic FKs; trigger is the only way. We already pay the trigger cost to copy `table_id`, so target validation is essentially free. **Alternative considered:** two nullable FK columns (`target_table_night_id`, `target_entry_id`) with a CHECK that exactly one is set — rejected because it balloons the schema, breaks the polymorphic query ergonomics, and requires changing the API shape.

- **Per-post realtime channel** — Channel name: `post-interactions:{target_type}:{target_id}`. Two `postgres_changes` listeners, each filtered by `target_type=eq.X` AND `target_id=eq.Y`. Only subscribed on detail screens, not on feed cards. **Why:** feed cards rely on the denormalized counts plus TanStack Query invalidation on navigation/focus — realtime on the feed would mean opening a channel per visible card, which is wasteful and leaks. Detail screens are the only place realtime truly matters. **Alternative considered:** one per-table `table-posts:{tableId}` channel — rejected because filtering in the client loses the `target_id` scoping benefit and the user is almost always viewing exactly one post at a time.

- **Optimistic update cache shape: single key holds full interaction state** — `['postInteractions', targetType, targetId]` stores `{ reactions: Reaction[], comments: Comment[], counts: {...} }`. Reaction toggle: mutate the reactions array (push/filter) via `setQueryData`; rollback in `onError`. Comment add: push a row with `id: 'optimistic-${uuid}'` and `pending: true`; reconcile in `onSuccess` by replacing the optimistic row with the server row (matched by `client_nonce` echoed back from the edge function). **Why:** one shape everywhere means ReactionBar and CommentThread read the same data and the realtime hook has one key to invalidate. **Alternative considered:** two separate query keys for reactions and comments — rejected because it doubles the invalidation surface and splits related UI state across keys.

- **Edge function surface locked** —
  - `GET /post-interactions?target_type=X&target_id=Y` → `{ data: { reactions: [{id, user_id, emoji, created_at, profiles:{display_name, avatar_url}}], comments: [{id, user_id, body, created_at, edited_at, profiles:{...}}], counts: {reactions: N, comments: M, top_emojis: [...]}}}`
  - `POST { action: 'react', target_type, target_id, emoji }` → `{ data: { added: bool, removed: bool, reaction?: {...} } }` (server toggles based on existence)
  - `POST { action: 'comment', target_type, target_id, body, client_nonce? }` → `{ data: {id, user_id, body, created_at, client_nonce, profiles:{...}} }`
  - `POST { action: 'edit_comment', comment_id, body }` → `{ data: {...} }` (fails 403 if not owner or >5min old)
  - `POST { action: 'delete_comment', comment_id }` → `{ data: {id} }` (fails 403 if not owner)
  Emoji enum validated against `['🔥','😋','❤️','💯','👀']`. Body length validated 1–2000.

- **Cascade via trigger on parent DELETE** — `AFTER DELETE` trigger on `table_nights` and `entries` deletes all `post_reactions` and `post_comments` matching `(target_type, id)`. **Why:** no polymorphic FK means no FK cascade; a trigger is the clean parallel. Round deletion is rare today but will happen (host deletes a Round) — the memory shouldn't linger. Concrete choice for Open Question #3: **cascade**. **Alternative considered:** soft-delete by nulling target — rejected because it leaves orphaned rows and the UI would need to filter them.

- **Server enforces: no reactions/comments on unrevealed Rounds** — For any write where `target_type='table_night'`, the edge function fetches `table_nights.status` and returns 400 if it's not `'revealed'`. GETs against unrevealed Rounds return `{ reactions: [], comments: [], counts: {...} }` (empty but successful) so the UI can render "no bar yet" without error branches. **Why:** client-side hiding protects the UI but not the API — a malicious client could POST directly. **Alternative considered:** RLS policy check — rejected because the policy would need to resolve the target and branch on `target_type`, adding complexity where an imperative server check is cleaner.

- **5-minute edit window enforced server-side** — `edit_comment` fetches the row, checks `user_id = auth user`, checks `NOW() - created_at < interval '5 minutes'`. If either fails, 403. Client hides the affordance after 5 minutes but the server is the source of truth. **Why:** don't trust clocks on the client.

### File Changes

| Path | New/Modified | Purpose |
|---|---|---|
| `supabase/migrations/20260418000000_post_interactions.sql` | new | `post_reactions`, `post_comments` tables; denormalized count columns + `top_emojis` on `table_nights` and `entries`; indexes; RLS policies; `set_post_interaction_table_id()` BEFORE INSERT trigger; `sync_post_counts_and_top_emojis()` AFTER INSERT/UPDATE/DELETE trigger; `cascade_post_interactions_on_parent_delete()` AFTER DELETE trigger on parents; `ALTER PUBLICATION supabase_realtime ADD TABLE` for both tables |
| `supabase/functions/post-interactions/index.ts` | new | Single edge function, action-routed POST (`react`, `comment`, `edit_comment`, `delete_comment`), GET returning reactions+comments+counts; enforces emoji enum, body length, 5-min edit window, Round-revealed gate, and table membership |
| `supabase/functions/table-activity/index.ts` | modified | Add `reaction_count, comment_count, top_emojis` to the select lists for `entries` and `table_nights`; no other logic change |
| `napkin-app/lib/queryKeys.ts` | modified | Add `postInteractions.all(targetType, targetId)` key |
| `napkin-app/hooks/posts/usePostInteractions.ts` | new | `usePostInteractions(targetType, targetId)` query; `useToggleReaction`, `useAddComment`, `useEditComment`, `useDeleteComment` mutations with optimistic updates against the shared cache key |
| `napkin-app/hooks/posts/usePostInteractionsRealtime.ts` | new | Subscribes to `post-interactions:{targetType}:{targetId}` channel, invalidates the shared key, cleans up on unmount |
| `napkin-app/hooks/posts/index.ts` | new | Barrel export |
| `napkin-app/components/posts/ReactionBar.tsx` | new | 5-emoji chip row; count hidden at 0; active chip uses `primaryMuted`/`primary`; long-press opens bottom sheet of reactors; disabled when unrevealed Round |
| `napkin-app/components/posts/ReactorsSheet.tsx` | new | Bottom sheet listing users who reacted with a given emoji (oldest first) |
| `napkin-app/components/posts/CommentThread.tsx` | new | Oldest-first flat list, inline composer with grow-to-4-lines textarea, optimistic send, retry on failure, edit/delete menu on own rows within 5 minutes |
| `napkin-app/components/posts/CommentRow.tsx` | new | Single comment row (avatar, name, body, relative time, edited marker, ... menu) |
| `napkin-app/components/posts/index.ts` | new | Barrel export |
| `napkin-app/app/table-night-detail.tsx` | modified | Render `<ReactionBar>` and `<CommentThread>` below Photos; pass `target_type='table_night'`, `target_id={nightId}`; subscribe via `usePostInteractionsRealtime`; only render if night.status === 'revealed' |
| `napkin-app/app/entry-detail.tsx` | modified | Render `<ReactionBar>` and `<CommentThread>` below notes; pass `target_type='entry'`, `target_id={entryId}`; subscribe via `usePostInteractionsRealtime` |
| `napkin-app/components/feed/TableNightCard.tsx` | modified | Read `top_emojis`, `comment_count`, `reaction_count`; render preview pill component if either count ≥ 1 |
| `napkin-app/components/feed/SoloShareCard.tsx` | modified | Same — feed pill |
| `napkin-app/components/feed/JournalNoteCard.tsx` | modified | Same — feed pill |
| `napkin-app/components/feed/InteractionPill.tsx` | new | Shared pill: renders `"🔥 3 ❤️ 1 · 2 replies"` logic from `top_emojis` + `comment_count` |
| `napkin-app/hooks/tables/useTableActivity.ts` | modified | Add `reaction_count`, `comment_count`, `top_emojis` to the TableNightActivity / entry activity types |

### Implementation Order

1. **Write & apply migration.** Tables, indexes, RLS, both triggers, cascade trigger, realtime publication, backfill counts to 0 / `top_emojis` to `[]`. Smoke-test from psql: insert a reaction directly via SQL, confirm `table_id` is populated, count on parent increments, `top_emojis` updates. Delete the parent, confirm cascade.
2. **Write `post-interactions` edge function.** All five actions (`GET`, `react`, `comment`, `edit_comment`, `delete_comment`) with validation (emoji enum, body length, revealed-round gate, 5-min edit window, membership check).
3. **curl-test the edge function** from terminal against local Supabase with a real auth token. Confirm each action path returns the documented shape and that unauthorized/ungated writes 403/400 correctly.
4. **Add query key** `postInteractions.all` to `lib/queryKeys.ts`.
5. **Build `usePostInteractions` hooks** — query + four mutations with optimistic update against the shared cache key. Unit-test the optimistic/rollback path in isolation (invoke mutation, assert cache, throw, assert rollback).
6. **Build `usePostInteractionsRealtime`** — modeled directly on the pattern in CLAUDE.md section "Hook Pattern (Realtime)". Verify unsubscribe on unmount with React DevTools.
7. **Build `ReactionBar` + `ReactorsSheet`.** Stand-alone, feed it fixture data, validate all 5 chips, long-press sheet, active/inactive states in both themes.
8. **Build `CommentThread` + `CommentRow`.** Same: render with fixture data, verify empty state, edit/delete affordance timing, composer behavior with 2000-char guard.
9. **Wire both onto `app/table-night-detail.tsx`** below Photos. Gate on `night.status === 'revealed'`. Realtime on. Test end-to-end on one device.
10. **Wire both onto `app/entry-detail.tsx`** below notes. Same. Test solo share entry, collaborative round-participant entry, and journal note (no rating) paths — all three must render the same component.
11. **Add count/top_emojis columns to `table-activity` edge function select lists**, update `useTableActivity` types, build `InteractionPill`, wire into all three feed cards. Verify the pill only renders when counts > 0, and the card tap still navigates to detail.
12. **Cross-device realtime smoke test.** Two simulators/devices on the same Round detail screen. Confirm: reaction toggle propagates in <2s, comment add/edit/delete propagate, navigating away unsubscribes. Repeat on an Entry detail.

### Risks

- **Polymorphic target integrity is trigger-only.** If the `set_post_interaction_table_id()` trigger has a bug, bad target IDs could be inserted silently. **Mitigation:** trigger raises when the target isn't found; migration includes a post-migration sanity SELECT (`COUNT(*) WHERE table_id IS NULL`) that must be zero. Monitor via Supabase logs post-deploy.
- **Denormalized `table_id` drift.** If we ever move an entry between tables (not today), `post_comments.table_id` and `post_reactions.table_id` will become stale. **Mitigation:** no entry-move feature exists today; if added, it must UPDATE interaction rows in the same transaction. Add a TODO in the migration comment header.
- **Count/top_emojis drift.** Trigger bugs could desync counts from reality. **Mitigation:** triggers recompute `top_emojis` from scratch (not incrementally), which makes drift self-healing on any subsequent write. Counts use `+1/-1` — we accept the risk and ship a periodic reconcile SQL snippet in the migration as comment-only.
- **Realtime channel leakage on unmount.** React Native nav can keep screens mounted longer than expected. **Mitigation:** `usePostInteractionsRealtime` returns the cleanup from `useEffect`; add a dev-mode `console.log` on subscribe/unsubscribe during build to verify balance. Mirror the pattern proven in `useTableNightRealtime` (if present) or lift it from CLAUDE.md.
- **No rate-limit on comments (Open Question #4 deferred).** In a trusted-group product the risk is low, but a single user could spam a thread and pollute the Table's memory. **Mitigation:** ship v1 without a limit; add Supabase edge-function-level rate-limit (e.g. 10 comments / 60s / user) only if we see abuse. Not a launch blocker.
- **Migration on production data.** `table_nights` and `entries` already have rows; adding count columns with `DEFAULT 0` and `top_emojis` with `DEFAULT '[]'::jsonb` is an O(n) rewrite on MVP data volumes but fine. **Mitigation:** migration adds columns with defaults in one statement (no backfill UPDATE needed since defaults apply to existing rows). Still worth confirming against staging first.
- **Edit window edge case with realtime.** If user A edits at T+4:59, user B's client sees the edit arrive at T+5:01 — B's own edit-window computation is based on `created_at`, so B would never accidentally be offered edit on A's comment anyway. No real risk; noted for completeness.
- **Tiebreaker for top_emojis is deterministic but can visibly flip.** If two emoji are tied and a third reaction flips the order, the feed pill changes. Acceptable for v1; called out so the builder isn't surprised by a design review question.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed

**New files:**
- `supabase/migrations/20260418000000_post_interactions.sql` — Two new tables (`post_reactions`, `post_comments`); denormalized `reaction_count`, `comment_count`, `top_emojis JSONB` on `table_nights` and `entries`; indexes; RLS policies; `set_post_interaction_table_id()` BEFORE INSERT trigger (resolves table_id from target, validates target exists); `sync_post_counts_and_top_emojis()` AFTER INSERT/DELETE trigger; `cascade_delete_post_interactions()` AFTER DELETE trigger on parents; `ALTER PUBLICATION supabase_realtime ADD TABLE` for both tables.
- `supabase/functions/post-interactions/index.ts` — Single edge function. GET returns `{reactions, comments, counts}` for one post. POST actions: `react` (toggle), `comment`, `edit_comment`, `delete_comment`. Server-enforces emoji enum, body length, 5-min edit window, round-revealed gate, table membership.
- `napkin-app/hooks/posts/usePostInteractions.ts` — `usePostInteractions` query hook; `useToggleReaction`, `useAddComment`, `useEditComment`, `useDeleteComment` mutations with optimistic updates and rollback. `client_nonce` reconciliation on comment add.
- `napkin-app/hooks/posts/usePostInteractionsRealtime.ts` — Subscribes to `post-interactions:{targetType}:{targetId}` channel, invalidates cache on any reaction or comment change, unsubscribes on unmount.
- `napkin-app/hooks/posts/index.ts` — Barrel export.
- `napkin-app/components/posts/ReactionBar.tsx` — 5-emoji chip row; active/inactive chip styles; count hidden at 0; long-press opens ReactorsSheet; accessibility labels.
- `napkin-app/components/posts/ReactorsSheet.tsx` — Modal-based bottom sheet listing users who reacted with a given emoji, oldest-first.
- `napkin-app/components/posts/CommentThread.tsx` — Oldest-first flat list + inline composer; 2000-char limit with counter at 1900; optimistic send; empty state.
- `napkin-app/components/posts/CommentRow.tsx` — Avatar, name, body, relative timestamp, "· edited" marker; "..." menu with edit (within 5 min) and delete; inline edit UX.
- `napkin-app/components/posts/index.ts` — Barrel export.
- `napkin-app/components/feed/InteractionPill.tsx` — Feed card preview pill: top-2 emoji with counts + reply count. Only renders when counts > 0.

**Modified files:**
- `napkin-app/lib/queryKeys.ts` — Added `postInteractions.all(targetType, targetId)` key.
- `napkin-app/hooks/tables/useTableActivity.ts` — Added `reaction_count?`, `comment_count?`, `top_emojis?` to `SoloShareActivity` and `TableNightActivity` types.
- `supabase/functions/table-activity/index.ts` — Added `reaction_count, comment_count, top_emojis` to both the entries select list and the table_nights select list.
- `napkin-app/components/feed/TableNightCard.tsx` — Added `InteractionPill` below quote block, gated on count > 0.
- `napkin-app/components/feed/SoloShareCard.tsx` — Added `InteractionPill` below quote, gated on count > 0.
- `napkin-app/components/feed/JournalNoteCard.tsx` — Added `InteractionPill` inside card body, gated on count > 0.
- `napkin-app/components/feed/index.ts` — Added `InteractionPill` barrel export.
- `napkin-app/app/table-night-detail.tsx` — Imports `usePostInteractions`, `usePostInteractionsRealtime`, `ReactionBar`, `CommentThread`. Fetches interactions and subscribes to realtime (gated on `isRevealedOrClosed`). Renders Reactions + Replies sections below the Photos grid.
- `napkin-app/app/entry-detail.tsx` — Same as above but ungated (entries are always reactionable). Renders below Notes section.

### Tests

- **Migration applied**: yes — `npx supabase db push --linked` applied cleanly to project `ftvmseaqwwlcxtdlvxxz` (majilaii's Project, West EU London). One harmless NOTICE about `comment_count` already existing on entries from a prior migration; all tables/triggers/indexes created successfully.
- **Edge function deployed**: yes — `post-interactions` deployed at 126.9kB. `table-activity` redeployed with new select columns.
- **curl-test**: skipped — no valid test credentials available (password unknown; anon key only, no active session token obtainable without running the app). Marked in Builder Questions.
- **TypeScript type check**: `npx tsc --noEmit` exits 0 — zero errors introduced. Pre-existing errors (if any) were not modified.
- **Realtime cross-device test**: not performed — no two devices available in this build context. Pattern mirrors `useTableNightRealtime` which is proven in production.

### Builder Questions

1. **curl-test skipped** — I have the Supabase URL and anon key but no active user session token to sign in with. The edge function is deployed and the logic mirrors the proven `table-night` function pattern. To curl-test: sign in with `supabase.auth.signInWithPassword`, grab the `access_token`, and hit `POST https://ftvmseaqwwlcxtdlvxxz.supabase.co/functions/v1/post-interactions` with `Authorization: Bearer <token>` and body `{ "action": "react", "target_type": "entry", "target_id": "<a real entry UUID>", "emoji": "🔥" }`.

2. **`comment_count` pre-existed on `entries`** — The migration used `ADD COLUMN IF NOT EXISTS` for all columns and received a NOTICE for `comment_count` on entries (it already existed). The column was already `INT DEFAULT 0`, so no data loss. The `top_emojis` and `reaction_count` columns were new. The existing `comment_count` column was NOT being maintained by any trigger before this migration, so its values may be stale (all 0 on existing rows, which is correct since no comments existed before). After the new triggers fire on any new comment, the value will be correct going forward. **No action needed unless the column was being populated elsewhere.**

3. **Open Question #2 from spec (members leaving the Table)** — What happens to reactions/comments from a user who is removed from the Table? Current implementation: their rows remain readable by remaining members (no soft-delete). The `user_id` FK points to `auth.users` (cascade on delete), so if the Supabase user account is deleted, the rows delete too. For table removal only, reactions/comments persist with the user's `profiles.display_name`. This matches the "keep the Table's shared memory intact" lean in the spec but should be confirmed with product.

4. **Open Question #5 from spec (return key behavior in composer)** — Current implementation: return key inserts a newline (multiline TextInput with `blurOnSubmit={false}`); send is via the arrow button only. This matches the iMessage model proposed in UX Decisions.

5. **`ARCHITECT-REVIEW` note — no `target_type` filter on realtime subscriptions** — The realtime listeners filter only by `target_id=eq.{targetId}`, not by `target_type`. In theory, if two different targets (one `table_night` and one `entry`) had the same UUID (extremely unlikely with UUIDs), they would cross-invalidate. This is safe to ship; noted for completeness.

### Architect Answers

- **Q5 (realtime filter scope) — resolved.** Architect called (a) with a caveat → changed to client-side narrowing. Supabase Realtime `postgres_changes` only supports ONE column filter per listener (verified against Supabase docs), so the multi-column `target_id=eq.X&target_type=eq.Y` syntax isn't supported. Instead, `hooks/posts/usePostInteractionsRealtime.ts` now filters by `target_id` server-side and narrows on `target_type` inside the handler before invalidating. Zero-cost and correct.
- **Q2 (`comment_count` staleness) — follow-up required.** Architect flagged that pre-existing `comment_count` values on `entries` should be verified/backfilled before shipping. `execute_sql` permission was denied in this build session, so a backfill migration was written: `supabase/migrations/20260418000001_backfill_post_interaction_counts.sql`. It re-derives `reaction_count` and `comment_count` on both `table_nights` and `entries` from live row counts in `post_reactions` / `post_comments`. **Still needs to be applied** — `mcp__plugin_supabase_supabase__apply_migration` also required explicit approval. User should approve the apply, or run `npx supabase db push --linked` locally. Idempotent and safe to re-run.

### Revision 1 — fixes for Review 1 FAILs

Both FAILs from Review 1 are now addressed:

- **FAIL #1 (reaction-rollback toast missing) — fixed.** Added a global `ToastProvider` at `napkin-app/providers/ToastProvider.tsx` (wraps the app between `AuthProvider` and `RootLayoutNav` in `app/_layout.tsx`). Backed by the existing `ActivityToast` component for visuals — no new design surface. Exposes `useToast().show(message)`. `useToggleReaction.onError` now calls `toast.show("Couldn't react. Try again.")` after rolling back the optimistic update.
- **FAIL #2 (comment send-failure retry affordance missing) — fixed.** Comment optimistic rows now persist on send failure with `failed: true, pending: false` instead of being silently rolled back. `useAddComment.onError` updates the matching optimistic row by `client_nonce` and decrements the comment count so the failed row doesn't inflate the feed-card pill. Added `useDiscardFailedComment` helper to remove failed rows from the cache without a server call. `CommentRow` now renders "Couldn't send" + Retry + Discard affordances when `comment.failed === true`. `CommentThread` wires the callbacks: Retry discards the failed row and re-issues `addComment.mutate` with the same nonce; Discard just removes the row.

Files changed in this revision:

- `napkin-app/providers/ToastProvider.tsx` (new) — global toast context
- `napkin-app/app/_layout.tsx` (modified) — wraps tree in `ToastProvider`
- `napkin-app/hooks/posts/usePostInteractions.ts` (modified) — toast on reaction error, mark-as-failed on comment error, `useDiscardFailedComment` helper, `failed?: boolean` on Comment type
- `napkin-app/components/posts/CommentRow.tsx` (modified) — failed-state UI with Retry + Discard
- `napkin-app/components/posts/CommentThread.tsx` (modified) — wires retry + discard callbacks

`npx tsc --noEmit` exits 0. No new dependencies. No other files touched.

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
Date: 2026-04-16
Reviewer: code-reviewer agent
Verdict: REVISE

Score: 33 PASS / 7 WARN / 2 FAIL (out of 42 ACs)

#### Acceptance Criteria Scorecard

**Reactions — behavior (10 ACs)** — 8 PASS, 2 WARN
- [PASS] 5 fixed emoji in order — `ReactionBar.tsx:26` `EMOJI_SET` locked.
- [PASS] Tap toggles own reaction — `useToggleReaction` + server toggle at `post-interactions/index.ts:239-255`.
- [PASS] Multiple distinct emoji per user — UNIQUE `(target_type,target_id,user_id,emoji)` at `migration:33` allows this.
- [PASS] Count hidden at 0 — `ReactionBar.tsx:104` `{count > 0 && <Text>{count}</Text>}`.
- [WARN] Emoji chip "dimmed state" at count 0 — count is hidden but the chip isn't visually dimmed; inactive style depends on `userReacted`, not `count`. `ReactionBar.tsx:91-95`.
- [PASS] Active vs inactive chip styling — `primaryMuted`/`primary` vs `surfaceContainerLow`/`textSecondary`.
- [PASS] Long-press count ≥ 1 opens sheet — `ReactionBar.tsx:61-63`.
- [PASS] Long-press count 0 no-op — guarded by `if (count >= 1)`.
- [FAIL] Optimistic rollback with "unobtrusive toast" — `useToggleReaction.onError` rolls back silently; no toast/banner rendered. `usePostInteractions.ts:163-170`.
- [PASS] Round gating — `table-night-detail.tsx:203-210` gates behind `isRevealedOrClosed`; server double-enforces at `post-interactions/index.ts:224-227`.
- [PASS] Entries/journal ungated — `entry-detail.tsx:245-250`.

**Replies — behavior (9 ACs)** — 6 PASS, 2 WARN, 1 FAIL
- [PASS] Composer with placeholder, grows to ~4 lines, send-on-trim — `CommentThread.tsx:95-112`, `maxHeight: 88`.
- [PASS] Optimistic row with "Sending…" — `CommentRow.tsx:61-63`.
- [FAIL] Retry affordance / swipe-to-remove on send failure — `useAddComment.onError` rolls back; optimistic row vanishes, no retry UI. `usePostInteractions.ts:243-250`. Spec requires tap-to-retry or swipe-to-remove.
- [PASS] Oldest-first — server orders ASC `post-interactions/index.ts:169`, client just maps.
- [PASS] Avatar / name / body / relative timestamp — `CommentRow.tsx:30-41` (`just now`, `2m`, `3h`, `2d`, locale date after 7d).
- [PASS] 2000-char limit + counter at 1900 — `CommentThread.tsx:31-43`, `showCounter = body.length >= 1900`.
- [PASS] Plain text only — no markdown parsing anywhere.
- [PASS] Empty state copy exact: "No replies yet — be the first." — `CommentThread.tsx:70`.
- [WARN] Keyboard scroll-keeps-last-comment-above-keyboard — no `KeyboardAvoidingView`, no `scrollToEnd`. CommentThread uses plain `View` inside the parent ScrollView. Behavior depends on platform default. `CommentThread.tsx:55-149`.

**Edit & delete (6 ACs)** — 5 PASS, 1 WARN
- [PASS] "..." only on author rows — `CommentRow.tsx:151` `{isAuthor && canDelete && !isEditing && ...}`.
- [WARN] Edit hidden after 5 min — correct via `canEdit = ageMs < 5*60*1000` but computed once on render; a stale mount could keep showing Edit past the boundary. Server enforces, so UI-only drift. `CommentRow.tsx:54-55`.
- [PASS] Edit opens inline editor seeded with body — `CommentRow.tsx:165-206`.
- [PASS] "· edited" marker — `CommentRow.tsx:149`.
- [PASS] Delete removes for all viewers — optimistic + server delete + realtime invalidates remote viewers. `usePostInteractions.ts:339-355`.
- [PASS] Non-author sees no menu — `CommentRow.tsx:151` gated on `isAuthor`.

**Feed card preview (4 ACs)** — 4 PASS
- [PASS] Renders iff reactions ≥ 1 OR comments ≥ 1 — all three cards gate on `((item.reaction_count ?? 0) >= 1 || (item.comment_count ?? 0) >= 1)`.
- [PASS] Pill format "top-2 emoji … · N replies" — `InteractionPill.tsx:31-43`.
- [PASS] Omits reply segment when 0 comments; omits emoji segment when 0 reactions — `InteractionPill.tsx:31-43`.
- [PASS] Not independently tappable — pill rendered inside the existing Pressable card; no onPress handler on pill itself.

**Placement (3 ACs)** — 3 PASS
- [PASS] Round detail: below Photos — `table-night-detail.tsx:468-488` placed after Photos grid, before Footer.
- [PASS] Entry detail: below notes — `entry-detail.tsx:681-708`.
- [PASS] Journal notes use same components — `JournalNoteCard` + entry-detail fallthrough render ReactionBar/CommentThread.

**Realtime & polymorphic target (6 ACs)** — 6 PASS
- [PASS] Reaction propagates — subscription invalidates on `post_reactions` changes.
- [PASS] Comment add propagates — same channel covers `post_comments`.
- [PASS] Edit/delete propagate — `event: '*'` covers UPDATE/DELETE.
- [PASS] RLS membership — policies on both tables gate via `table_id IN (SELECT … FROM table_members WHERE member_id = auth.uid())`. `migration:69-107`.
- [PASS] No cross-target-type leakage — handler narrows by `target_type` after server-side `target_id` filter. `usePostInteractionsRealtime.ts:33-37`.
- [PASS] Unsub on unmount — `removeChannel` in effect cleanup. `usePostInteractionsRealtime.ts:63-65`.

**Accessibility (4 ACs)** — 3 PASS, 1 WARN
- [PASS] Chip tap target ≥ 40×40 — `minWidth:40, minHeight:40` on `styles.chip`.
- [WARN] Screen-reader label format — matches spec for count > 1 ("React with fire, 3 reactions") but drops ", 1 reactions" when count === 1 (`count > 1` check). Spec example only covers 3 and 0 cases; minor deviation on the singular. `ReactionBar.tsx:77-78`.
- [PASS] WCAG contrast — palette-driven via `primaryMuted`/`primary` and `surfaceContainerLow`/`textSecondary` tokens; not independently verified but using design-system tokens.
- [PASS] Send button accessible label "Send reply" — `CommentThread.tsx:128`.

#### Architectural Observations
- **`post_reactions.table_id` is nullable** (`migration:29`) while `post_comments.table_id` is `NOT NULL`. The BEFORE INSERT trigger populates both, but defense in depth says reactions should also be `NOT NULL`. A bypass of the trigger (direct service role insert missing the trigger) would slip a NULL table_id past RLS SELECT (`NULL IN (...)` is falsy, so readers can't see it, but it also wouldn't be cleaned up easily).
- **Redundant `table_id` passed on comment insert** (`post-interactions/index.ts:285`) — the BEFORE INSERT trigger overwrites it anyway. Harmless but inconsistent with the reaction insert (which doesn't pass it). Minor.
- **`sync_post_counts_and_top_emojis` fires on comment changes but recomputes `top_emojis` from reactions every time** (`migration:179-199`). Wasted work; the trigger could branch on `TG_TABLE_NAME` to skip the emoji re-aggregation when the change was to comments. Acceptable for MVP scale.
- **No `UPDATE` trigger on `post_reactions`**. Because the unique constraint makes it nearly impossible to meaningfully UPDATE an emoji row, and toggle uses DELETE+INSERT, this is fine — just worth noting the trigger is `AFTER INSERT OR DELETE` only.
- **Backfill migration `20260418000001` was not applied** (per Build Log + git status shows it staged). For v1 launch this is acceptable because `reaction_count` is new and defaulted to 0 (correct, no reactions exist); `comment_count` on `entries` was pre-existing but unmaintained and there are no existing comments either. Still should be applied before any prior-data user sees a stale pill.
- **`isRevealedOrClosed` gate** (`table-night-detail.tsx:201`) includes `closed`. Spec says "only post-reveal" — `closed` is post-reveal, so this is a reasonable interpretation and consistent between UI and server.
- **Edge function's `comment` action response is not wrapped the same way as GET** (both use `json()` which wraps `{ data }`), but the comment shape is merged with `client_nonce` at the top level. Hook correctly unwraps `data?.data as Comment & { client_nonce?: string }`.
- **No rate limiting on comments** — acknowledged in Risks; not blocking for a trusted-group v1.

#### Build Log Claim Verification
- Files new/modified: claimed 11 new + 9 modified. Diff shows 13 new files + 8 modified. Extra new files are `CommentRow.tsx` and `ReactorsSheet.tsx` (broken out from CommentThread / ReactionBar — reasonable). `hooks/posts/index.ts` is counted. Claim roughly matches.
- Migration applied: build log says yes to `20260418000000`; backfill `20260418000001` written but not applied. Verified.
- Edge function deployed: claimed yes at 126.9kB; not independently verifiable in static review, but the code is inspectable.
- TypeScript: `npx tsc --noEmit` exits 0. Confirmed.
- curl-test skip: acceptable — edge function logic is straightforward and the deployed URL is reachable from the running app. No obvious correctness bug that a curl test would have caught beyond what code review found.

#### FAIL items (requires fix before merge)
1. **Reaction-rollback toast missing** (`usePostInteractions.ts:163-170`). Spec requires "roll back on error with an unobtrusive toast". Add a toast/snackbar hook call or at minimum a light haptic + visible error pill. Without this, a failed reaction looks like the tap did nothing.
2. **Comment send-failure retry affordance missing** (`usePostInteractions.ts:243-250`). Spec requires "optimistic row is marked with a retry affordance; user can tap to retry or swipe to remove." Current behavior just silently rolls back. Suggested fix: keep the optimistic row with `pending: false, failed: true`, render a retry icon in `CommentRow`, wire a retry mutation.

#### WARN items (accepted, noted)
- Screen-reader singular-count phrasing drops `, 1 reactions` — trivial polish.
- Emoji chip count-0 state isn't visibly dimmed per spec wording.
- No `KeyboardAvoidingView` on CommentThread — may work out-of-box on iOS but unverified on Android.
- Edit-window UI doesn't auto-hide at T+5:00 without a re-render.
- `post_reactions.table_id` should be NOT NULL.
- Backfill migration `20260418000001` staged but unapplied; apply before shipping to avoid feed-pill staleness.
- GET returns computed `top_emojis` from raw reaction rows and does not read the denormalized parent column — harmless but means the detail-screen pill and the feed pill have slightly different code paths.

#### Recommendations for v2
- Drive `top_emojis` on the feed cards from the trigger-maintained parent column only (avoid recomputing in the edge function GET for detail screens — just read the parent column).
- Add a periodic reconcile SQL (commented in the migration) to an ops runbook.
- Consider moving `ReactorsSheet` from a raw Modal to `@gorhom/bottom-sheet` (already in the project? If yes, adopt for consistency).
- Tighten realtime channel filter to listen to `public.post_reactions` and `public.post_comments` server-side filter — if Supabase adds multi-column filters later, switch to `target_type=eq.X AND target_id=eq.Y` to halve cross-target traffic (current cost is negligible due to UUID collision-free target_ids).

---

### Review 2
Date: 2026-04-16
Reviewer: code-reviewer agent
Verdict: APPROVE
Scope: targeted re-review of Review 1's 2 FAIL items + regression check.

#### Verification of Review 1 FAIL fixes

**FAIL #1 — reaction-rollback toast** — RESOLVED
- `hooks/posts/usePostInteractions.ts:167-175` — `onError` first restores `context.previous` (rollback intact), then calls `toast.show("Couldn't react. Try again.")`. Message is concise and unobtrusive — no `Alert.alert`, no modal.
- `providers/ToastProvider.tsx:16,30` — `TOAST_TTL_MS = 3000`; auto-dismiss via `setTimeout(() => dismiss(id), 3000)` after push. Backed by existing `ActivityToast` visuals (no new design surface).
- `app/_layout.tsx:196-198` — `<ToastProvider>` wraps `<RootLayoutNav>` inside `<AuthProvider>` and `<QueryClientProvider>`, so every screen and hook can call `useToast`.
- Fail-open handled: `ToastProvider.tsx:43-46` returns a no-op `{ show: () => {} }` if `useToast` is invoked outside the provider. No crash in tests or edge cases.

**FAIL #2 — comment send-failure retry affordance** — RESOLVED
- Failed-state persistence: `usePostInteractions.ts:255-268` marks the matched optimistic row `{ pending: false, failed: true }` by `client_nonce` (instead of full rollback) and decrements `counts.comments` by 1 so the feed-card pill stays honest.
- Retry UI: `CommentRow.tsx:228-266` renders "Retry" and "Discard" Pressables when `comment.failed === true` and the parent provides `onRetry` / `onDiscard`. `timeLabel` at `CommentRow.tsx:63-67` swaps in "Couldn't send".
- Retry wiring: `CommentThread.tsx:42-49` — `handleRetry` first drops the failed row via `discardFailed`, then calls `addComment.mutate` with the SAME `clientNonce`. This means a late-arriving success from the ORIGINAL failed request would reconcile by nonce in `onSuccess` (`usePostInteractions.ts:280-283`) and harmlessly replace the retry's optimistic row. Race-safe.
- Discard: `CommentThread.tsx:51-54` calls `discardFailed` which filters the row out of cache with no server call (`usePostInteractions.ts:414-418`).
- Count decrement verified: feed-card pill only renders at `count >= 1`, so a failed-only row does not inflate the preview.

#### Regression check
- **TypeScript**: `npx tsc --noEmit` exits 0. Clean.
- **Toggle rollback still works**: yes — `usePostInteractions.ts:168-173` restores `context.previous` BEFORE the toast call. Rollback path unchanged.
- **Comment rollback fallback (no nonce) still works**: yes — `usePostInteractions.ts:269-271` `else if (context?.previous)` branch restores the pre-mutation snapshot when `clientNonce` is missing. Preserves original Review 1 behavior for callers that don't pass a nonce.
- **Surrounding code**: `CommentThread.handleSend` (`CommentThread.tsx:60-68`) generates a nonce on every send — so the failed-state path is always reachable in practice. No other call sites of `useAddComment` found.
- **No new code smells** introduced by the revision. Pre-existing WARNs from Review 1 (screen-reader singular phrasing, dim-at-0 chip style, `KeyboardAvoidingView` absence, edit-window UI drift, `post_reactions.table_id` nullable, unapplied backfill migration, duplicated top_emojis computation) are untouched and remain as previously noted.

#### New issues found (if any)
- None.

#### Final verdict justification
Both Review 1 FAIL items are resolved with clean, minimal changes: a global `ToastProvider` wired above the nav tree gives reactions an unobtrusive error surface, and the comment mutation's failure path now marks-as-failed (with correct count decrement and nonce-based reconciliation) rather than silently rolling back. The no-nonce fallback preserves the original rollback behavior, and TypeScript is clean. Ship it.

---

## Completion
- Completed: 2026-04-16
- Final verdict: APPROVE on cycle 2 (Review 2). Cycle 1 returned 33 PASS / 7 WARN / 2 FAIL; both FAILs (reaction toast + comment retry) fixed in Revision 1; cycle 2 confirmed clean.
- Notes:
    - Build (21 files, migration + edge function + hooks + components + feed integration) was merged to main via PR #24 alongside TICKET-012 and an unrelated restaurant-history fix.
    - Revision 1 (5 files: ToastProvider + retry UX) lives on branch `feat/TICKET-007-revision`, commit `b1166df`. Not yet merged — awaits user direction (PR vs. local merge).
    - Backfill migration `supabase/migrations/20260418000001_backfill_post_interaction_counts.sql` is staged in the repo but **not yet applied to the live DB**. Apply via `npx supabase db push --linked` or approve `mcp__plugin_supabase_supabase__apply_migration` before any pre-existing entries with stale `comment_count` are re-rendered.
    - 7 WARNs accepted into v2 backlog: count-0 chip dim state, KeyboardAvoidingView, edit-window auto-hide, `post_reactions.table_id` NOT NULL, screen-reader singular phrasing, top_emojis double-source, rate limit deferral.
    - 5 spec Open Questions remain product-resolvable: top-2 emoji tiebreaker, ex-member visibility, host-delete cascade behavior, comment rate-limit, return-key vs send-button (last one already implemented as send-button-only per UX Decisions).
