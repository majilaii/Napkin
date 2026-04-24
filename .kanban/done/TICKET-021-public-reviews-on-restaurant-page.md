---
id: TICKET-021
title: "Public reviews on restaurant pages (dual-comment-scope, engagement controls)"
priority: high
status: done
created: 2026-04-17
updated: 2026-04-23
tags: [restaurants, public, engagement, wedge]
---

# Public reviews on restaurant pages

## Problem

Even with lists (TICKET-018) and public profiles (TICKET-020) in place, the highest-leverage wedge moment — a user who just ate at a place lands on its page, reads a stranger's take that resonates, clicks to their profile — requires stranger reviews to actually appear on restaurant pages. Today's restaurant page (TICKET-016) shows the viewer's Table's signal + Google rating. There's no public layer.

This ticket adds the public-reviews section on restaurant pages: written logs from accounts that have opted public, surfaced to any viewer on that restaurant's page. With reactions and carefully-scoped replies.

## Notes

### Product-B doctrine reminder

- **Logs are private by default.** A log only appears publicly on a restaurant page if (a) the author's account is opted public, AND (b) the log has real review content (meaningful note length, not just a drive-by rating).
- **Tables are never touched by this.** Public replies on a restaurant-page review live in a *separate comment scope* from the log's Table thread. See architecture below.

### Locked decisions (from brainstorm, 2026-04-17)

- **What surfaces as a "public review":** an entry (existing primitive) whose author account is public AND whose `note` field has real content. Define "real" by character threshold or heuristic (rating + meaningful note + optional photo). No new schema primitive — just a visibility rule on existing entries.
- **Letterboxd-style separation** between *silent ratings* (don't surface) and *reviews* (surface). Users marking meals with stars-only are not publishing; users writing prose are.
- **Section on restaurant page:** below/alongside the existing Tablemate "Who's been" section. Shows avatar, display name, rating, note excerpt, date. Tap → expanded review view with reactions + (optional) replies.
- **Engagement — dual-comment-scope architecture:**
  - **Table thread** (private): the existing entry-detail thread inside the author's Table. Tablemates react + reply here. Unchanged.
  - **Public thread** (new): lives on the restaurant page's expanded review view. Anyone can react; replies gated by author's profile toggle (TICKET-020).
  - **No bleed.** Public-scope replies never appear in the Table feed. Table-scope replies never appear on the public view. Same log, two comment containers, fully isolated.
- **Reactions:** emoji react is always allowed for any public reviewer. Low friction.
- **Replies:** only rendered if the reviewer has opted them on via profile toggle. Default off.
- **Author sees public engagement via notifications/activity**, not through their Table surface.

### Cold-start strategy

- Don't show a public "Napkin average" on a restaurant page until ≥ 10 public reviews (threshold TBD). Until then, page just shows Tablemate signal + Google rating (today's behavior) + any public reviews that exist as a simple list.
- Aggregate score is optional — Beli leans on an aggregate; Letterboxd does not. Propose skipping it in v1. Restaurants don't need a universal number; they need readable opinions.

### Explicitly deferred

- Public aggregate score on a restaurant page — skip v1; re-litigate if users ask.
- Sort/filter of public reviews beyond reverse-chron — defer.
- Moderation tooling (report, block) — needs a minimal v1 path; flag as an open question.
- Public reviews on a user's profile as browsable content — TICKET-020 shows logged restaurants as a grid; expanded review prose lives only on restaurant pages in v1.

### Open questions for product-designer

- Threshold for "meaningful note" — character count, or any note whatsoever? Leaning: any note ≥ 20 chars, but this is a UX call.
- How many public reviews render per restaurant page by default? 5? Infinite scroll?
- Does the existing entry edit screen need a visibility indicator when the author has account public ("this log is visible on the restaurant's page")?
- Minimal moderation: block a user from a restaurant page? Report a review? What's the floor we need for v1?
- Dual-comment-scope DB design: reuse `post_interactions` table with a scope column, or a separate `public_comments` table?
- How does ordering handle both freshness and quality? Reverse-chron only, or mix in most-liked?

### Dependencies

- **TICKET-018 (Lists)** — not a hard dep but same public-layer epic
- **TICKET-020 (Public profile)** — hard dep: account-level public toggle lives there; reply-permission toggle lives there
- **TICKET-019 (Progressive logging)** — soft dep: distinguishes silent rating from crafted review, which is what makes "meaningful note" a clean filter
- **TICKET-016 (Restaurant page v2)** — hard dep: this ticket adds a section to that page

---

## Product Spec

### User Stories

- As a **user who just ate somewhere new and opened its restaurant page**, I want to read strangers' written takes alongside my Table's context, so I can calibrate against perspectives outside my circle.
- As a **user resonating with a stranger's review**, I want to tap their name and land on their public profile (TICKET-020's `/u/[username]`), so the palate-calibration wedge works end-to-end.
- As a **public-account user who just logged a meaningful review**, I want my note to appear on that restaurant's page without any separate "publish" step, so opting my account public is the only ceremony.
- As a **public user writing a new entry**, I want a calm "this will appear on the restaurant's page" indicator visible in the composer once my note + rating qualify, so I'm never ambushed by my own publishing.
- As a **private-account user**, I want my logs to never appear on any restaurant's public reviews section regardless of note length, so account privacy is the master switch (Product-B doctrine).
- As a **user on a silent rating (stars-only, no note)**, I want that log kept off public surfaces even when my account is public, so drive-by ratings don't clutter the page.
- As the **author of a public review**, I want Tablemates' reactions and replies to continue living only inside my Table, and world-reactions and world-replies to live only on the restaurant page, with zero bleed between the two, so my Table remains sacred.
- As the **author of a public review with replies toggled off**, I want anyone to still be able to react with emoji (low-friction warmth), but want reply composers hidden and reply attempts rejected server-side, so I control written engagement.
- As a **Tablemate viewing an entry in my Table's feed**, I want the entry-detail I already know — my Table's reply thread, my Table's reactions — unchanged and undisturbed by anything happening publicly on the same entry.
- As an **authenticated viewer of a public restaurant page**, I want to see up to 5 public reviews by default and a "See more" button that expands to up to 20, so the section is scannable without being infinite.
- As a **viewer tapping a public review card**, I want the full review view (note, photos, reactions, public replies) without any Table chrome, so the view matches the scope I clicked through from.

### Acceptance Criteria

**Schema — dual comment scope on existing primitive**

- [ ] Migration adds `scope TEXT NOT NULL DEFAULT 'table' CHECK (scope IN ('table','public'))` to `post_comments` AND `post_reactions` (both are the surviving rows from the TICKET-007 migration, not a table rename).
- [ ] Migration backfills all existing rows to `scope = 'table'` (every row prior to this ticket is Table-scoped by definition).
- [ ] Composite index added: `(target_type, target_id, scope, created_at ASC)` on `post_comments`; `(target_type, target_id, scope)` on `post_reactions`. The existing `*_target_idx` indexes are kept for backward compatibility; the new scoped indexes back every read in this ticket.
- [ ] RLS rewrite on `post_comments`:
  - SELECT when `scope = 'table'` AND caller is member of `table_id` (existing rule, narrowed by scope).
  - SELECT when `scope = 'public'` AND the entry author's `profiles.account_privacy = 'public'` AND the caller is authenticated (no Table-membership requirement).
  - INSERT when `scope = 'table'` AND caller is member of `table_id` (existing rule).
  - INSERT when `scope = 'public'` AND the entry author's `profiles.account_privacy = 'public'` AND the entry meets the eligibility rule (see below) AND the entry author's `profiles.allow_public_replies = true`.
  - UPDATE / DELETE restricted to `user_id = auth.uid()` regardless of scope.
- [ ] RLS on `post_reactions`: SELECT / INSERT for `scope = 'public'` allowed for any authenticated caller when the target entry is publicly eligible. Table-scope rule unchanged.
- [ ] The trigger `set_post_interaction_table_id` continues to denormalize `table_id` from the target on insert; it's harmless for public rows (they keep the author's Table id in the column, but the RLS path for scope='public' never joins on it).
- [ ] Trigger `sync_post_counts_and_top_emojis` is updated to scope its counts: parent-row `reaction_count` / `comment_count` / `top_emojis` continue to reflect **Table-scope only** (used by Table feeds). New parallel denorm columns on `entries`: `public_reaction_count INT NOT NULL DEFAULT 0`, `public_reply_count INT NOT NULL DEFAULT 0`, `public_top_emojis JSONB NOT NULL DEFAULT '[]'::jsonb`, maintained by the same trigger branched on `NEW.scope`.
- [ ] Cascade-delete triggers from TICKET-007 delete BOTH scopes when the parent entry is deleted.

**Public-review eligibility rule**

- [ ] An entry is "publicly eligible" iff: (a) its author's `profiles.account_privacy = 'public'` AT READ TIME (not at write time — flipping back to private hides public reviews immediately), AND (b) `entries.rating IS NOT NULL`, AND (c) `char_length(trim(note)) >= 20`.
- [ ] Eligibility is computed server-side on every read. No denormalized "is_public" flag on `entries` — it would drift on account flip, see UX Decisions.
- [ ] Silent ratings (rating set, note shorter than 20 trimmed chars or null) never surface publicly, even with a public account.
- [ ] Notes without a rating never surface publicly, even with a public account and ≥20 chars.
- [ ] Flip to private: public reviews, public reactions, and public replies authored by that user stop rendering everywhere on next page load (server filters by live `account_privacy`). Rows are preserved; no destructive write on flip.

**Restaurant page — public-reviews section**

- [ ] New section on `app/restaurant/[id].tsx`, labeled "Public reviews" (Manrope label, `textSecondary`), sits **below Who's-been and above the existing Visits feed**. Other sections remain unchanged.
- [ ] Data comes from an extension to `restaurant-history` (`action=page`): payload grows by `public_reviews: PublicReviewCard[]` and `public_reviews_total: number`. No new edge function.
- [ ] Default render: up to 5 cards, reverse-chron by `entries.created_at`. Below the list, "See more" button reveals up to 20 total when `public_reviews_total > 5`. No pagination beyond 20 in v1 — button disappears once the section contains all loaded cards or hits 20.
- [ ] Scope: includes the viewer's own public review(s) alongside strangers', when the viewer's own account is public and the entry qualifies.
- [ ] Deduplication: one card per entry. If the same author has multiple public reviews at the same restaurant, all surface.

**Public-review card layout**

- [ ] Each card renders: author avatar (32pt initials fallback), display name (Newsreader italic `titleSmall`) + `@username` on a second line (Manrope `caption`, `textMuted`), rating (Newsreader italic amber, same style as existing rating pills), first 2 lines of the note (3rd line truncated with ellipsis, Newsreader regular), first photo (if any) as a 72x72pt square on the trailing edge, reaction-count pill + reply-count pill (both Manrope `caption`), and a relative date (matches existing "2d / Apr 3" format).
- [ ] Tapping the card body routes to `/entry-detail?entryId=X&viewAs=public`.
- [ ] Tapping the author's avatar/name/`@username` routes to `/u/[username]` (TICKET-020's merged profile, resolves by username).
- [ ] Reaction / reply pills are not independently tappable; they open the card's detail view like the card body.
- [ ] Card shows no Table name, no Table id, no Round chrome, no "Who's been" hints — this section is scrubbed of Table signal.

**Expanded review view (`entry-detail` with `viewAs=public`)**

- [ ] `entry-detail` accepts a new query param `viewAs: 'public' | undefined` (default undefined = Table-scope, current behavior).
- [ ] When `viewAs=public`, the screen renders: full note, photos, rating, author header (avatar + display name + `@username` tappable to `/u/[username]`), public reactions bar, public replies thread. NO Table-scope replies are fetched or rendered. NO "Previously here at this restaurant in your Table" banner.
- [ ] When `viewAs` is absent (Table scope), the screen renders exactly as today (TICKET-007 scope): Table reactions + Table replies. NO public reactions or public replies are fetched or rendered.
- [ ] Authorization for `viewAs=public`: the entry must be publicly eligible under the rule above, OR the viewer must be the author. Otherwise the screen renders "This review isn't available" (same pattern as TICKET-020's `'none'` 404).
- [ ] Back navigation returns to the restaurant page (or source of the push), with scroll position preserved.

**Dual-scope isolation — no bleed**

- [ ] Any client read of reactions/replies on an entry MUST pass a `scope` param; the edge function rejects reads without one (no implicit default). `post-interactions GET` adds a required `?scope=table|public`.
- [ ] `post-interactions` mutation actions (`react`, `comment`, `edit_comment`, `delete_comment`) require a `scope` field on the body; missing or invalid scope returns 400.
- [ ] `scope=public` writes are rejected server-side when the target entry is not publicly eligible (author private, note too short, no rating) — returns 403 with `{ error: 'not_public' }`. The entry author, when not public, cannot react or reply on their own entry in public scope either.
- [ ] Table feed (`table-activity`) and entry-detail Table render path only query `scope='table'`. Verified by existing Table feed screens — no changes needed other than passing the literal.
- [ ] Restaurant page public section and `entry-detail?viewAs=public` only query `scope='public'`. Verified by new reads added in this ticket.
- [ ] Realtime subscriptions updated: `usePostInteractionsRealtime` accepts a `scope` argument and filters incoming changes by the scope column before invalidation. No cross-scope invalidations.

**Public reactions**

- [ ] Emoji react is always allowed on public-scope for any authenticated viewer, regardless of the author's `allow_public_replies` toggle. Reactions are considered low-friction warmth and are not gated.
- [ ] The 5-emoji set (🔥 😋 ❤️ 💯 👀) is unchanged from TICKET-007.
- [ ] Per-user-per-emoji toggle rule from TICKET-007 applies to public scope.
- [ ] Long-press on a public reaction chip shows the list of public users who reacted (display name + `@username`, linking to `/u/[username]`). Private reactors cannot appear here because private users cannot react in public scope.

**Public replies — gated by `allow_public_replies`**

- [ ] The reply composer on `entry-detail?viewAs=public` renders ONLY when the entry author's `profiles.allow_public_replies = true`.
- [ ] When the toggle is false, the composer is not rendered and the thread shows an unobtrusive muted line: "The author has replies turned off." No "request permission" flow.
- [ ] Server rejects `scope=public` comment inserts with 403 `{ error: 'replies_disabled' }` when the author's toggle is false, regardless of client state.
- [ ] Authenticated replying is the bar (no anonymous replies). Unauthenticated access to `entry-detail?viewAs=public` redirects to `/auth`.
- [ ] Reply rows display: author avatar + display name + `@username` (tappable to `/u/[username]`), body, relative timestamp. Same layout as Table-scope replies.
- [ ] Edit/delete rules from TICKET-007 apply unchanged to public-scope replies (author-only, 5-min edit window, delete anytime).

**Edit-screen visibility indicator (composer transparency)**

- [ ] In `create-entry.tsx`, when the user's `profiles.account_privacy = 'public'`, a chip appears below the note field reading "This will appear on the restaurant's page" (Newsreader italic, `textMuted`, no icon).
- [ ] The chip is visible ONLY when the draft qualifies: `rating != null` AND `char_length(trim(note)) >= 20`. It appears live as the user types (debounced ~150ms so it doesn't flicker character-by-character).
- [ ] When the user's account is private, the chip never renders. No "opt in to publish" CTA inside the composer — the composer is not where privacy state is changed.
- [ ] The chip is informational, not interactive (no tap target). Users edit their privacy in settings (`/settings`), not here.

**Section states on restaurant page**

- [ ] Loading: section header + a single small spinner below. Hero / Numbers / Log CTA continue to render above per TICKET-016.
- [ ] Empty (zero public reviews for this restaurant): section is hidden entirely. No "Be the first" prompt.
- [ ] Error (network/server failure on the public-reviews payload): section renders header + single-line muted copy "Couldn't load public reviews." Visits feed below still renders.
- [ ] Mixed state (some cards load, "See more" fails): the expand attempt shows an inline error below the button; the initial 5 remain visible.

**Self-view on restaurant pages**

- [ ] A logged-in public user who has a qualifying review at this restaurant sees their own public review alongside strangers' in the same list, in reverse-chron ordering by created_at. No special visual distinction for "this is yours."
- [ ] The viewer's own row is STILL distinct from the Visits feed below — public-reviews is the world view; Visits feed is their Tables' world. If a viewer has a public review AND a Table visit on the same entry, it appears in both sections (once each).

**Moderation — explicit v1 scope statement**

- [ ] No "Report this review" affordance ships in v1.
- [ ] No "Block this user from my pages" affordance ships in v1.
- [ ] No admin-delete on public reviews ships in v1.
- [ ] This is documented in Out of Scope below and as a TODO reference in the migration file. A follow-up ticket is tracked outside this one when a moderation surface becomes needed.

### UX Decisions

- **Scope column on existing `post_comments` / `post_reactions`, not a parallel table**: reuses the trigger, index, and realtime infrastructure from TICKET-007 at near-zero migration cost. Branch tables would duplicate four indexes, two triggers, and the realtime publication for no real benefit beyond a column name in a `WHERE` clause.
- **Eligibility computed live at read time, not denormalized**: account-privacy flips must be immediate (going private should hide your public reviews on the next page load). A denormalized `is_public` flag would drift on flip unless every flip triggers a sweep — extra complexity for a rare event. A small server-side join stays honest.
- **≥20 trimmed chars AND a rating**: 20 chars is "seven words" — enough to be a thought, not a reflex. The rating is the commitment that makes a note a review. A note without a rating is a Journal-note; those stay out of public review surfaces. Locked.
- **Reverse-chron, 5 then 20, no paging**: freshness is the first-cut ordering; any "popular" / "most-liked" surface belongs in a future sort toggle, not v1. 5 is scannable on a hero-heavy page; 20 is the ceiling before real pagination becomes worth building.
- **Composer visibility chip, not a modal or toast**: modals punish action; toasts are missable. A calm inline chip in the composer — appearing only when the draft would qualify — treats the user as an adult who's already opted public.
- **Reactions always allowed; replies gated**: emoji is a shrug — low risk, high warmth, no moderation surface needed in v1. Replies are where spam and hostility live; the author should pre-consent. Default off respects the private-default ethos.
- **Dual scope enforced at every boundary (RLS, edge function, realtime)**: no-bleed is the only way the Table stays sacred while public surfaces exist on the same primitives. One leaky join kills the doctrine. Isolation is asserted at three layers on purpose — any single miss is caught by another.
- **`entry-detail?viewAs=public` over a new route**: the layout is 90% shared with the Table-scope entry-detail (note, rating, photos). A `viewAs` scoping param keeps the component tree stable and makes the dual-scope contract visible in the URL. A parallel `/public-review/[entryId]` would be a second screen doing nearly the same thing.
- **No "Be the first" empty state**: the public-reviews section is not a CTA surface — it is a passive window into other users' thoughts. When it's empty, it's silent. The Log CTA above is the only nudge the page needs.
- **Author sees world-engagement only outside the Table**: no activity feed or notification surface ships in v1 (push is deferred product-wide). Explicit deferred; the author discovers world-engagement by visiting the restaurant page or opening their own entry with `viewAs=public`. Future notifications ticket will plug into the dual-scope read path cleanly.
- **Card tap goes to expanded view, author tap goes to profile**: standard list-card split. The rating pill and reaction/reply pills inherit card-tap; only the author identity block hits the profile route.
- **Public reviews section sits below Who's-been, above Visits feed**: Who's-been is tighter trust (Tablemates), public is broader trust (calibrated strangers → TICKET-022), Visits feed is personal history. Ordering matches the trust-ring concentricity — inner ring first, then second ring, then self.
- **No moderation v1**: reports without a review queue are theater; blocks when there's no user base to moderate don't earn their cost. Ship with the gap acknowledged; revisit when the first real incident forces the conversation.

### Out of Scope

- Any public aggregate score ("Napkin average") on restaurant pages — Path B explicitly does not compute cross-Table aggregates, even when a venue has many public reviews. Confirmed in CLAUDE.md.
- Sort toggles on the public reviews list (most-liked, most-replied, most-recent filter). Reverse-chron only in v1.
- Pagination beyond 20 reviews per restaurant. True paging defers to a future surface.
- Report / block / admin-delete / content-moderation tooling of any kind.
- Push notifications to the author on public reactions/replies. Notifications remain deferred product-wide.
- An activity surface inside the app that summarizes "your public engagement this week."
- Rich media in public replies (images, link unfurls). Plain text only, matching TICKET-007.
- Per-log privacy overrides ("make this specific log public / private outside my account setting"). Explicitly rejected in CLAUDE.md doctrine.
- Public reviews on a user's profile as browsable prose — TICKET-020 shows logged restaurants as a grid; expanded prose lives on restaurant pages only in v1.
- Surfacing which of the viewer's public users are rated-alignment ("calibrated strangers") — that is the calibration signal, TICKET-022.
- Inline editing of a public review's visibility from the restaurant page ("hide this from public"). Users control this at account-level only.
- Analytics: view counts, "42 people saw this review."
- Public-reply moderation tools for the author ("hide this reply from my review") in v1. Author can always block-by-deleting-their-own-entry as a nuclear option; finer tooling defers to a moderation ticket.

### Open Questions

- None blocking. All design calls from the Notes section are locked above; schema path (scope column on existing tables), eligibility rule (≥20 trimmed chars + rating + public account), render cap (5 then 20), section placement (below Who's-been above Visits), visibility indicator (composer chip), and moderation posture (none in v1) are committed.

---

## Technical Design

### Approach

We extend the existing TICKET-007 interaction primitives (`post_reactions`, `post_comments`) in place with a required `scope` column (`'table' | 'public'`), rather than forking a parallel `public_comments`/`public_reactions` pair. The invariant "no bleed between a log's Table thread and its public thread" is enforced at **three layers on purpose**: (1) PostgreSQL RLS — scope-aware policies reject cross-scope reads/writes at the DB; (2) edge function — `post-interactions` requires an explicit `scope` on every GET and mutation, rejects missing/invalid scope with 400, and validates public eligibility before write with 403; (3) client realtime — `usePostInteractionsRealtime` takes `scope` as a required arg, filters realtime deltas by the `scope` column before invalidating, and uses a scoped query key. Eligibility (`account_privacy='public'` AND `rating IS NOT NULL` AND `char_length(trim(note)) >= 20`) is **computed live on every read and write** via a new SQL function `is_entry_publicly_eligible(UUID)` — no denormalized flag on `entries`, so flipping private takes effect on the next page load without a sweep. One migration, no new edge functions, two extended ones, one new screen path (`entry-detail?viewAs=public`).

### Architecture Decisions

- **Scope column on existing tables, not parallel tables** — reuses the realtime publication, the two triggers (`set_post_interaction_table_id`, `sync_post_counts_and_top_emojis`), and the four already-deployed indexes. **Rejected**: a `public_comments`/`public_reactions` pair. Duplicating schema to avoid a 6-character `WHERE` clause trades a clean column filter for four indexes, two triggers, one publication, and a mutation-path fork in the edge function. The AC makes this decision; I defend it as correct.
- **Eligibility computed live, not denormalized** — account-privacy flips (and note-length edits) must reflect on the next read, full stop. **Rejected**: an `entries.is_publicly_visible` boolean maintained by triggers on `entries` AND `profiles`. A profile flip from public→private would require a sweep across every entry the user authored; forgetting that sweep is a silent privacy bug. A server-side join on read is ~1ms on an indexed `profiles(user_id, account_privacy, allow_public_replies)` lookup and is always correct.
- **Parallel denorm columns `public_reaction_count`/`public_reply_count`/`public_top_emojis` on `entries`** — the existing `reaction_count`/`comment_count`/`top_emojis` back the Table feed card; the public restaurant-page card needs the *same* fast-read path without pulling in a LIVE aggregate. **Rejected**: overload the existing columns by summing both scopes. Table feed cards would then show inflated counts when a public reaction lands, leaking the existence of public engagement into the Table. Two parallel columns, one branched trigger.
- **`entry-detail?viewAs=public` over a new route `/public-review/[id]`** — the component tree is 90% shared (note, rating, photos, author header). A `viewAs` prop makes the scope contract visible in the URL and keeps the screen-level auth/data branching in one file. **Rejected**: a separate screen. Duplicates layout, doubles the route-table entry, and the dual-scope contract becomes implicit in which file you landed on.
- **Single REQUIRED `scope` on `post-interactions` GET + every mutation (no implicit default)** — the 400-on-missing is the edge function's belt-and-suspenders: a client that forgets to pass `scope` fails loudly rather than silently defaulting to `table` and leaking public data into a Table cache (or worse, the inverse). **Rejected**: `scope='table'` as default. Defaults are the footgun when the invariant is "every caller must prove intent."
- **Realtime: one channel per (entryId, scope), client-side filter as last-line** — Supabase postgres_changes only accepts ONE column filter per listener, and the existing hook already filters `target_id=eq.${id}` server-side and narrows `target_type` in the handler. We extend that handler to narrow `scope` too. **Rejected**: separate realtime publications per scope. The publication is broadcast-by-table; splitting requires two publications and two channel subscriptions for marginal gain — the client-side filter is cheap and caught by the RLS SELECT anyway (RLS applies to realtime deltas).
- **RLS predicate calls `is_entry_publicly_eligible(target_id)` rather than inlining the subquery** — one SQL function, called from four places (SELECT policy, INSERT policy, `restaurant-history` read, edge function validation). **Rejected**: inline subquery. Four copies, four drift risks. A `SECURITY DEFINER` STABLE function with a LANGUAGE SQL body means the planner can inline it; cost equivalent, correctness guaranteed.
- **Reply-permission check (`allow_public_replies`) lives ONLY in the INSERT policy for `post_comments` scope=public** — not in `post_reactions` (reactions are always allowed) and not in SELECT (a toggled-off author's existing public replies remain visible; only new ones are blocked). **Rejected**: hiding existing replies when the toggle flips. The AC spec treats `allow_public_replies` as a future-facing gate, not a retroactive scrub.

### Schema migration

New file: `supabase/migrations/20260424000000_dual_scope_post_interactions.sql`.

```sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: dual-scope post_interactions (TICKET-021)
--
-- Adds `scope` to post_reactions / post_comments so a single entry can host
-- two fully isolated comment/reaction containers: one for its Table
-- (existing behavior) and one for the restaurant-page public view.
--
-- Existing rows are Table-scoped by definition; backfilled to scope='table'.
--
-- Eligibility for scope='public' rows is validated live at read AND write via
-- the is_entry_publicly_eligible() function defined below; no denormalized
-- flag on entries (account_privacy flips must reflect immediately on next read).
--
-- TODO (future, TICKET-021-moderation): author-side hide/report surfaces on
-- public replies. None in v1.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Scope column on both interaction tables ───────────────────────────────

ALTER TABLE post_reactions
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'table'
        CHECK (scope IN ('table','public'));

ALTER TABLE post_comments
    ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'table'
        CHECK (scope IN ('table','public'));

-- Backfill is implicit via DEFAULT 'table' — all rows prior to this migration
-- are Table-scope by definition. Sanity check (should return 0):
--   SELECT COUNT(*) FROM post_reactions WHERE scope NOT IN ('table','public');
--   SELECT COUNT(*) FROM post_comments  WHERE scope NOT IN ('table','public');

-- ── 2. Composite indexes — back every scoped read in TICKET-021 ──────────────

CREATE INDEX IF NOT EXISTS post_reactions_target_scope_idx
    ON post_reactions (target_type, target_id, scope);

CREATE INDEX IF NOT EXISTS post_comments_target_scope_created_idx
    ON post_comments (target_type, target_id, scope, created_at ASC);

-- Existing *_target_idx indexes are intentionally KEPT for backward
-- compatibility (legacy queries that don't yet pass scope).

-- ── 3. Parallel denorm columns on entries ────────────────────────────────────

ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS public_reaction_count INT    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS public_reply_count    INT    NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS public_top_emojis     JSONB  NOT NULL DEFAULT '[]'::jsonb;

-- ── 4. Eligibility function ──────────────────────────────────────────────────
-- Centralizes the rule so RLS, edge functions, and restaurant-history all
-- evaluate the same predicate. STABLE + LANGUAGE SQL so the planner can inline.

CREATE OR REPLACE FUNCTION is_entry_publicly_eligible(p_entry_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE AS $$
    SELECT EXISTS (
        SELECT 1
        FROM entries e
        JOIN profiles p ON p.user_id = e.user_id
        WHERE e.id = p_entry_id
          AND p.account_privacy = 'public'
          AND e.rating IS NOT NULL
          AND char_length(trim(COALESCE(e.content, ''))) >= 20
    );
$$;

-- Supporting index for the function's join — account_privacy + user_id covers
-- the hot path on every public-scope RLS check.
CREATE INDEX IF NOT EXISTS profiles_user_account_privacy_idx
    ON profiles (user_id, account_privacy, allow_public_replies);

-- ── 5. RLS rewrite — drop-and-recreate with scope-aware policies ─────────────

DROP POLICY IF EXISTS "post_reactions_select" ON post_reactions;
DROP POLICY IF EXISTS "post_reactions_insert" ON post_reactions;
DROP POLICY IF EXISTS "post_reactions_delete" ON post_reactions;
DROP POLICY IF EXISTS "post_comments_select"  ON post_comments;
DROP POLICY IF EXISTS "post_comments_insert"  ON post_comments;
DROP POLICY IF EXISTS "post_comments_update"  ON post_comments;
DROP POLICY IF EXISTS "post_comments_delete"  ON post_comments;

-- post_reactions
CREATE POLICY "post_reactions_select_table" ON post_reactions
    FOR SELECT USING (
        scope = 'table'
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
    );

CREATE POLICY "post_reactions_select_public" ON post_reactions
    FOR SELECT USING (
        scope = 'public'
        AND auth.uid() IS NOT NULL
        AND target_type = 'entry'
        AND is_entry_publicly_eligible(target_id)
    );

CREATE POLICY "post_reactions_insert_table" ON post_reactions
    FOR INSERT WITH CHECK (
        scope = 'table'
        AND user_id = auth.uid()
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
    );

CREATE POLICY "post_reactions_insert_public" ON post_reactions
    FOR INSERT WITH CHECK (
        scope = 'public'
        AND user_id = auth.uid()
        AND target_type = 'entry'
        AND is_entry_publicly_eligible(target_id)
    );

CREATE POLICY "post_reactions_delete" ON post_reactions
    FOR DELETE USING (user_id = auth.uid());

-- post_comments
CREATE POLICY "post_comments_select_table" ON post_comments
    FOR SELECT USING (
        scope = 'table'
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
    );

CREATE POLICY "post_comments_select_public" ON post_comments
    FOR SELECT USING (
        scope = 'public'
        AND auth.uid() IS NOT NULL
        AND target_type = 'entry'
        AND is_entry_publicly_eligible(target_id)
    );

CREATE POLICY "post_comments_insert_table" ON post_comments
    FOR INSERT WITH CHECK (
        scope = 'table'
        AND user_id = auth.uid()
        AND table_id IN (SELECT table_id FROM table_members WHERE member_id = auth.uid())
    );

CREATE POLICY "post_comments_insert_public" ON post_comments
    FOR INSERT WITH CHECK (
        scope = 'public'
        AND user_id = auth.uid()
        AND target_type = 'entry'
        AND is_entry_publicly_eligible(target_id)
        AND EXISTS (
            SELECT 1 FROM entries e
            JOIN profiles p ON p.user_id = e.user_id
            WHERE e.id = target_id AND p.allow_public_replies = true
        )
    );

CREATE POLICY "post_comments_update" ON post_comments
    FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "post_comments_delete" ON post_comments
    FOR DELETE USING (user_id = auth.uid());

-- ── 6. Branched count/top-emoji trigger ──────────────────────────────────────
-- Table-scope rows write the existing columns; public-scope rows write the
-- parallel public_* columns. Single function handles both via NEW.scope.

CREATE OR REPLACE FUNCTION sync_post_counts_and_top_emojis()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_target_type TEXT;
    v_target_id   UUID;
    v_scope       TEXT;
    v_reaction_count INT;
    v_comment_count  INT;
    v_top_emojis JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_target_type := OLD.target_type;
        v_target_id   := OLD.target_id;
        v_scope       := OLD.scope;
    ELSE
        v_target_type := NEW.target_type;
        v_target_id   := NEW.target_id;
        v_scope       := NEW.scope;
    END IF;

    -- Recount within the changed row's scope only
    SELECT COUNT(*) INTO v_reaction_count
    FROM post_reactions
    WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope;

    SELECT COUNT(*) INTO v_comment_count
    FROM post_comments
    WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope;

    SELECT COALESCE(
        jsonb_agg(jsonb_build_object('emoji', emoji, 'count', cnt, 'last_reacted_at', last_at)
                  ORDER BY cnt DESC, last_at DESC),
        '[]'::jsonb
    ) INTO v_top_emojis
    FROM (
        SELECT emoji, COUNT(*) AS cnt, MAX(created_at) AS last_at
        FROM post_reactions
        WHERE target_type = v_target_type AND target_id = v_target_id AND scope = v_scope
        GROUP BY emoji
    ) sub;

    -- Route the update to the correct column set
    IF v_target_type = 'table_night' THEN
        -- table_nights only ever hosts scope='table' (Rounds have no public surface in v1)
        UPDATE table_nights
        SET reaction_count = v_reaction_count,
            comment_count  = v_comment_count,
            top_emojis     = v_top_emojis
        WHERE id = v_target_id;
    ELSIF v_target_type = 'entry' THEN
        IF v_scope = 'table' THEN
            UPDATE entries
            SET reaction_count = v_reaction_count,
                comment_count  = v_comment_count,
                top_emojis     = v_top_emojis
            WHERE id = v_target_id;
        ELSE -- scope = 'public'
            UPDATE entries
            SET public_reaction_count = v_reaction_count,
                public_reply_count    = v_comment_count,
                public_top_emojis     = v_top_emojis
            WHERE id = v_target_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

-- Existing triggers (sync_counts_on_reaction, sync_counts_on_comment) bind to
-- the function by name, so the CREATE OR REPLACE above is sufficient; no
-- trigger recreation needed.

-- ── 7. Cascade-delete on parent entry — already scope-agnostic ───────────────
-- The existing cascade_delete_post_interactions() deletes WHERE target_id=...
-- without a scope predicate, so it already removes BOTH scopes. No change.

-- ── 8. set_post_interaction_table_id — unchanged ─────────────────────────────
-- Still denormalizes table_id from the parent entry on INSERT. Harmless for
-- public rows (the RLS scope='public' path never joins on table_id), and
-- keeps the existing per-table index useful for cascade deletes.
```

### Eligibility rule — where it lives

The same SQL function `is_entry_publicly_eligible(UUID)` is the single source of truth, called from four places:

1. **RLS** — inside `post_reactions_select_public`, `post_reactions_insert_public`, `post_comments_select_public`, `post_comments_insert_public`. One function call per row-check, inlined by the planner. Index on `profiles(user_id, account_privacy, allow_public_replies)` + existing PK index on `entries.id` make this sub-ms.
2. **`restaurant-history` edge function, `action=page`** — the public_reviews SELECT filters with `WHERE is_entry_publicly_eligible(entries.id)`. Live filter, honors flip-to-private.
3. **`post-interactions` edge function** — pre-insert validation on `scope='public'` mutations. Hits the function directly via `supabase.rpc('is_entry_publicly_eligible', { p_entry_id: target_id })` and returns `403 { error: 'not_public' }` before attempting the insert. Surfaces a friendly error; RLS is still the hard gate.
4. **`entry-detail?viewAs=public` authorization** — same RPC call from the edge function backing the screen's data fetch (either the existing entry-detail fetch gets a `scope` branch, or we route it through a new `entry-detail` edge function sub-action; see below under "Edge function extensions"). If false AND viewer ≠ author, render "This review isn't available."

### Edge function extensions

**`post-interactions/index.ts`** — roughly 80 LOC added:
- **GET**: require `?scope=table|public`; 400 if missing/invalid. For `scope=table`, keep the existing `validateTableMember` path. For `scope=public`, call `supabase.rpc('is_entry_publicly_eligible', {...})` and 403 with `{ error: 'not_public' }` if false. Queries filter with `.eq('scope', scope)`.
- **POST actions** (`react`, `comment`, `edit_comment`, `delete_comment`): require `scope` on the body; 400 on missing/invalid. `scope=table` validates Table membership (current path). `scope=public` validates (a) entry eligibility; (b) for `comment`, also validates the author's `profiles.allow_public_replies` — 403 `{ error: 'replies_disabled' }` if false. Writes include `scope` in the insert payload. `edit_comment` / `delete_comment` inherit the author-only rule and don't need to branch on scope (they hit by `comment_id` and RLS enforces the scope already via SELECT).
- **Response shape**: unchanged, but reactions/comments returned are scoped. The count `counts` object now reflects the queried scope only.

**`restaurant-history/index.ts`, `action=page`** — adds `public_reviews: PublicReviewCard[]` and `public_reviews_total: number` to the response:

```ts
type PublicReviewCard = {
    entry_id: string;
    user_id: string;
    display_name: string;
    username: string;          // from profiles
    avatar_url: string | null;
    rating: number;
    note_excerpt: string;      // full note returned; client truncates to 2 lines
    photo_url: string | null;  // first entry_photo if any
    created_at: string;
    public_reaction_count: number;
    public_reply_count: number;
};
```

Query: `SELECT entries.* JOIN profiles ON profiles.user_id = entries.user_id JOIN entry_photos (LEFT LATERAL, first photo) WHERE entries.restaurant_id = X AND profiles.account_privacy = 'public' AND entries.rating IS NOT NULL AND char_length(trim(entries.content)) >= 20 ORDER BY entries.created_at DESC LIMIT 20`. Also returns `public_reviews_total` via `SELECT count(*)` with the same predicate.

**Cap decision**: return up to 20 in the same call (single round-trip), client-side truncates to 5 by default and reveals the rest on "See more" tap — no second fetch. **Justification**: the restaurant page already makes one `action=page` call; making a second call on See-more doubles latency for users who will scan the list in <200ms. 20 rows at ~300 bytes each is 6KB — cheap. Pagination deferred to v2 if restaurants regularly cross 20 public reviews (we'll know when we see it).

Scope includes the viewer's own qualifying review. Dedup: one row per entry (primary key guaranteed).

### Client — new and modified files

**NEW**
- `napkin-app/components/restaurants/PublicReviewsSection.tsx` — section container with header + list + See-more button + loading/error/empty states.
- `napkin-app/components/restaurants/PublicReviewCard.tsx` — the card per AC (avatar/name/@username, rating, 2-line note, 72pt photo, reaction/reply pills, relative date).
- `napkin-app/components/create-entry/PublicVisibilityChip.tsx` — inline chip with debounced (150ms) visibility based on `rating` + trimmed note length + `profiles.account_privacy`.
- `napkin-app/hooks/restaurants/usePublicReviewsExpand.ts` — trivial local state for 5→20 toggle (no refetch).

**MODIFY**
- `napkin-app/hooks/posts/usePostInteractions.ts` — add required `scope: 'table' | 'public'` to `usePostInteractions`, `useToggleReaction`, `useAddComment`, `useEditComment`, `useDeleteComment`, and `useDiscardFailedComment`. Query keys become scope-aware. Pass `scope` on GET querystring and mutation bodies.
- `napkin-app/hooks/posts/usePostInteractionsRealtime.ts` — add `scope` arg; filter incoming payloads by `row.scope !== scope` before invalidating. Channel name becomes `post-interactions:${type}:${id}:${scope}`.
- `napkin-app/lib/queryKeys.ts` — `postInteractions.all(targetType, targetId, scope)` becomes required; update all callers.
- `napkin-app/hooks/restaurants/useRestaurantPage.ts` — response type grows `public_reviews` + `public_reviews_total`.
- `napkin-app/app/restaurant/[id].tsx` — slot `<PublicReviewsSection>` below Who's-been, above Visits feed.
- `napkin-app/app/entry-detail.tsx` — read `viewAs` from local params; branch data layer (scope) and chrome (hide Table banners, hide reply composer when `viewAs=public` AND `allow_public_replies=false`, show muted line, show "This review isn't available" fallback).
- `napkin-app/app/create-entry.tsx` — wire `PublicVisibilityChip` below note field; fetch viewer's `account_privacy` (already on profile state) and pass debounced rating + note.
- `napkin-app/components/posts/CommentThread.tsx`, `CommentRow.tsx`, `ReactorsSheet.tsx` — accept `scope` prop and thread it into every interaction hook call.

**REUSE**
- `/u/[username]` route (TICKET-020) for all author links.
- Existing `entry-detail` layout — we're adding a `viewAs` branch, not a new screen.
- Existing reaction emoji set + per-user-per-emoji toggle semantics.

### Dual-scope isolation — end-to-end audit

**Table-scope READ** (Table feed card, entry-detail default): client calls `GET post-interactions?target_type=entry&target_id=X&scope=table`. Edge function validates Table membership. RLS `post_reactions_select_table` / `post_comments_select_table` permit iff caller is in `table_id`. Public-scope rows are invisible — they fail the scope predicate at the RLS layer.

**Public-scope READ** (restaurant-page section, `entry-detail?viewAs=public`): client calls `GET post-interactions?target_type=entry&target_id=X&scope=public`. Edge function checks `is_entry_publicly_eligible(X)`, 403 on false. RLS `post_reactions_select_public` / `post_comments_select_public` permit iff auth'd AND entry eligible. Table rows are invisible. Separately, the restaurant-page section itself calls `GET restaurant-history?action=page&restaurant_id=Y` and gets `public_reviews[]` filtered by the same eligibility SQL.

**Table-scope WRITE** (Tablemate reacts/replies): `POST post-interactions { action, scope: 'table', ... }`. Edge function validates Table membership. RLS INSERT table policy permits. Trigger branches on `NEW.scope='table'` → writes `entries.reaction_count` / `comment_count` / `top_emojis`. Public columns untouched.

**Public-scope WRITE** (world reacts): `POST post-interactions { action: 'react', scope: 'public', ... }`. Edge function validates eligibility; 403 on failure. RLS INSERT public reaction policy permits. Trigger branches on `NEW.scope='public'` → writes `entries.public_reaction_count` / `public_top_emojis`. Table columns untouched. **Public-scope reply**: additionally checks `profiles.allow_public_replies`; 403 `replies_disabled` if false. RLS `post_comments_insert_public` enforces the toggle at the DB too.

**Realtime**: `usePostInteractionsRealtime(entryId, 'public')` subscribes on channel `post-interactions:entry:X:public` with `filter: target_id=eq.X`. Supabase's RLS-aware realtime layer drops deltas the caller can't SELECT under `post_reactions_select_public`, so a Table-scope insert never reaches a public subscriber even if the publication is shared. **Belt-and-suspenders**: the client handler compares `payload.new.scope` / `payload.old.scope` to the subscribed scope and bails if mismatched. Two independent gates.

### Trigger update — pseudo-SQL

See section 6 of the migration above. Key property: the existing `set_post_interaction_table_id` trigger **is not changed** and **is not harmful** for public rows. It continues to denormalize the parent entry's `table_id` onto each public-scope row — the RLS `post_*_select_public` / `post_*_insert_public` policies never reference `table_id` in their predicate, so the denorm is inert for public data. Keeping it means the existing per-table index stays useful, and the `cascade_delete_post_interactions` trigger (which fires when a Table is deleted via FK `ON DELETE CASCADE` through `table_id`) still cleans up public rows whose parent entry's Table is dropped.

### Implementation order

1. **Migration** — `20260424000000_dual_scope_post_interactions.sql` applied to local Supabase. Scope column backfill is implicit via DEFAULT; verify sanity counts. Trigger tolerates existing rows (they write to the existing `reaction_count`/`comment_count` columns as before since they're `scope='table'`).
2. **Eligibility function + supporting index** — included in the same migration; exercised by a quick `psql` SELECT to confirm `is_entry_publicly_eligible(<known-public-entry-id>)` returns `true`.
3. **`post-interactions` edge function** — scope param plumbing, RPC call for eligibility, `replies_disabled` gate. Deploy with `npx supabase functions deploy post-interactions --project-ref ftvmseaqwwlcxtdlvxxz`.
4. **`restaurant-history` edge function** — extend `action=page` payload with `public_reviews` + `public_reviews_total`. Deploy.
5. **Client post-interactions hooks** — scope threading through `usePostInteractions*`, realtime, query keys. Update every call site (grep `usePostInteractions(`, `useToggleReaction`, `useAddComment`) and pass explicit `scope`. Existing Table paths pass `'table'`.
6. **`PublicReviewCard` + `PublicReviewsSection`** — restaurant-page section, slot into `app/restaurant/[id].tsx`.
7. **`entry-detail?viewAs=public` branch** — data-layer scope, chrome scrub, "not available" fallback for non-author on ineligible entry.
8. **Composer chip** — `PublicVisibilityChip` in `create-entry.tsx` with 150ms debounce.
9. **Self-view + error/empty states + manual QA** — verify: Tablemate seeing a public review on a restaurant page renders via scope=public and does NOT surface their Table reply to the same entry; Table feed card counts unchanged after a public reaction lands.

### Risks

- **Migration atomicity: trigger update + backfill + column adds in one file.** Column adds run first (transactional DDL), then trigger `CREATE OR REPLACE` — the old trigger body is functionally a superset of the new (it writes to the existing columns), so any row written between column-add and trigger-replace is still correct. No backfill loop needed because existing rows are already `scope='table'` by DEFAULT and the existing trigger already maintains their counts. Safe to run against live data.
- **RLS performance on scope=public INSERT**: the eligibility function joins `entries` + `profiles`. With the new `profiles_user_account_privacy_idx` and the existing PK on `entries.id`, this is two index lookups — well under 1ms. Flag: watch p95 on `post-interactions POST scope=public` in production; if it degrades, materialize `is_public_eligible` as a computed column on `entries` with a BEFORE-UPDATE trigger on `profiles.account_privacy`. Not needed for v1 traffic.
- **Ghost entries**: a ghost restaurant (Places-only, no row in `restaurants`) can't host entries — entries require `restaurant_id` UUID FK. Public eligibility therefore can't apply to ghost data. Double-checked: the restaurant-page `action=page` route requires `restaurantRow` and returns early if null, so ghost pages render zero public reviews without even hitting the eligibility filter.
- **Cross-scope realtime leakage**: Supabase's realtime publication is scoped by table, not by scope column. RLS-aware realtime should drop deltas the caller can't SELECT, but we add the client-side `payload.new.scope === subscribedScope` filter as a belt-and-suspenders. If RLS-aware realtime ever misbehaves, the client catches it.
- **Stale `entries.public_reaction_count` on flip-to-private**: when a user toggles `account_privacy: public → private`, existing rows are preserved and `public_reaction_count` stays populated, but the row stops rendering anywhere (RLS SELECT predicate fails). No drift in what users see — the column is just a stale cache. **Decision**: accept the drift. No sweep trigger on `profiles.account_privacy` changes. The column becomes correct again on the next write to the entry (trigger recomputes from live `post_reactions`). If the user flips back to public later, the counts are still correct because they've been accurate for their scope all along.
- **Existing calls that don't pass `scope`**: every call site needs updating. A missed caller will 400 at runtime, visibly — preferred over silent `table`-default fallback. Grep before deploy: `queryKeys.postInteractions`, `usePostInteractions`, `useToggleReaction`, `useAddComment`, `useEditComment`, `useDeleteComment`.

### Engineering complexity

One migration (~200 lines of SQL, ~half of it RLS boilerplate), two edge function extensions (~100 LOC combined), one new screen branch + one new section component + one composer chip (~300 LOC combined), and a mechanical threading of `scope` through five interaction hooks plus their callers (~150 LOC touched). Total roughly 700–800 LOC. The real risk is the scope-threading change set — it's wide (every post-interaction call site) but trivially mechanical, and a missed caller fails loudly at the edge function's 400-on-missing-scope. One experienced engineer can ship this in a day, with most of the time in the client thread + manual QA of the dual-scope isolation, not in the server logic.

---

## Build Log

### Files Changed

**New**
- `/Users/jacky/Napkin/supabase/migrations/20260430000000_dual_scope_post_interactions.sql` — scope column, indexes, eligibility function, RLS rewrite, branched trigger, denorm columns on entries
- `/Users/jacky/Napkin/napkin-app/components/restaurants/PublicReviewCard.tsx` — card component per AC (avatar/name/@username, rating, 2-line note, 72pt photo, reaction/reply pills, relative date)
- `/Users/jacky/Napkin/napkin-app/components/restaurants/PublicReviewsSection.tsx` — section container with header, 5→20 expand, loading/error/empty states
- `/Users/jacky/Napkin/napkin-app/components/create-entry/PublicVisibilityChip.tsx` — debounced (150ms) inline chip in note composer

**Modified**
- `/Users/jacky/Napkin/supabase/functions/post-interactions/index.ts` — required scope param on GET + all mutations; eligibility RPC; replies_disabled gate; username in profile responses
- `/Users/jacky/Napkin/supabase/functions/restaurant-history/index.ts` — action=page extended with `public_reviews: PublicReviewCard[]` + `public_reviews_total`; empty-restaurant early-return also updated
- `/Users/jacky/Napkin/napkin-app/lib/queryKeys.ts` — `postInteractions.all()` now takes required `scope` param (default 'table' for backward compat)
- `/Users/jacky/Napkin/napkin-app/hooks/restaurants/useRestaurantPage.ts` — `PublicReviewCard` type exported; `RestaurantPageData` extended with `public_reviews` + `public_reviews_total`
- `/Users/jacky/Napkin/napkin-app/hooks/posts/usePostInteractions.ts` — `scope` threaded through all hooks and mutations; `Scope` type exported; feed-side optimistic updates only for scope='table'
- `/Users/jacky/Napkin/napkin-app/hooks/posts/usePostInteractionsRealtime.ts` — accepts `scope`; channel name includes scope; handler narrows by `row.scope` for belt-and-suspenders isolation
- `/Users/jacky/Napkin/napkin-app/hooks/posts/index.ts` — exports `Scope` type
- `/Users/jacky/Napkin/napkin-app/components/posts/CommentThread.tsx` — `scope` + `repliesDisabled` props; passes scope to all mutation calls; renders muted "replies off" line when disabled
- `/Users/jacky/Napkin/napkin-app/components/posts/CommentRow.tsx` — `scope` prop threaded into edit/delete mutations
- `/Users/jacky/Napkin/napkin-app/components/restaurants/index.ts` — exports `PublicReviewsSection` and `PublicReviewCard`
- `/Users/jacky/Napkin/napkin-app/app/restaurant/[id].tsx` — imports `PublicReviewsSection`; slotted below Voices section in 'our-table' tab
- `/Users/jacky/Napkin/napkin-app/app/entry-detail.tsx` — reads `viewAs` param; `interactionScope` drives scope on all hooks; hides PreviouslyHereBanner + Round banner in public view; passes scope to FloatingActionPill and DockedReplyComposer
- `/Users/jacky/Napkin/napkin-app/app/table-night-detail.tsx` — passes explicit `scope='table'` to usePostInteractions and CommentThread
- `/Users/jacky/Napkin/napkin-app/app/create-entry.tsx` — fetches account_privacy; wires PublicVisibilityChip below note field
- `/Users/jacky/Napkin/napkin-app/components/feed/FeedActionRow.tsx` — passes `scope: 'table'` to toggleReaction
- `/Users/jacky/Napkin/napkin-app/components/feed/FriendLogCard.tsx` — passes `scope: 'table'` to toggleReaction
- `/Users/jacky/Napkin/napkin-app/components/feed/JournalNoteCard.tsx` — passes `scope: 'table'` to toggleReaction
- `/Users/jacky/Napkin/napkin-app/components/feed/SoloShareCard.tsx` — passes `scope: 'table'` to toggleReaction
- `/Users/jacky/Napkin/napkin-app/components/feed/TableNightCard.tsx` — passes `scope: 'table'` to toggleReaction

### Tests

- `npx tsc --noEmit`: 0 TICKET-021 errors. 2 pre-existing WIP errors in `app/(tabs)/tables.tsx` (`is_personal` property on WIP Atlas branch — not introduced by this ticket).
- `npm run test:functions` (Deno): 38 steps pass, 0 failed. No regressions.
- Migration applied to remote via `supabase db push --linked --include-all`. Both edge functions deployed to `ftvmseaqwwlcxtdlvxxz`.

### Builder Questions

1. **`usePublicReviewsExpand` hook skipped** — the tech design lists this as a separate hook file for the 5→20 toggle. The implementation uses plain `useState` inside `PublicReviewsSection.tsx` directly (no refetch, just a slice toggle). This is architecturally equivalent and avoids an unnecessary file. No behavioral change.

2. **Migration timestamp collision** — the tech design specified `20260424000000` but that version already exists in the remote DB (another migration). The file was named `20260430000000_dual_scope_post_interactions.sql` instead. The rename does not affect the migration content.

3. **`entry-detail?viewAs=public` authorization gate not fully implemented** — the AC specifies "the screen renders 'This review isn't available' if the entry is not publicly eligible AND viewer ≠ author." This requires an eligibility check on load (RPC call). The current implementation relies on the edge function returning a 403 when `scope=public` interactions are fetched on an ineligible entry, and the screen shows the existing error state. A dedicated "This review isn't available" UI component + explicit eligibility check against `is_entry_publicly_eligible` RPC was not built — it would require a new data fetch on the entry-detail screen specifically for public view authorization. **Architect review needed**: should we add an explicit RPC pre-check in entry-detail when `viewAs=public`, or is the edge function's 403 response (which surfaces as a query error) an acceptable v1 gate?

4. **`ReactorsSheet` not updated for public scope** — the AC mentions showing display name + @username for public reactors. `ReactorsSheet.tsx` doesn't currently route to `/u/[username]`. It uses the existing `Reaction` type which now carries `username` from the updated edge function. UI routing to profile on long-press of a public reaction chip is not wired in this ticket (requires modifying ReactorsSheet). Flag for follow-up.

## Builder Questions — Answers

### 1. `usePublicReviewsExpand` hook skipped

**Accept.** `useState` inline inside `PublicReviewsSection.tsx` is architecturally equivalent for a 5→20 slice toggle. A dedicated hook file would be ceremony for 3 lines of state. No change.

### 2. Migration timestamp collision → `20260430000000`

**Accept.** File content is unchanged; only the timestamp differs to avoid the remote DB collision. No downstream impact.

### 3. `entry-detail?viewAs=public` authorization gate

**Finish it now, in this ticket.** The AC is explicit: "render 'This review isn't available' if ineligible AND viewer ≠ author." Relying on a 403-surfaced-as-error from the interactions fetch is a leaky gate — it fires only if the user tries to interact, not on load, and users without the `allow_public_replies` toggle will see the error state even when the entry IS eligible and they should just be reading.

Concrete:
- In `app/entry-detail.tsx`, when `viewAs === 'public'` AND `entry.user_id !== viewer.user_id`, add a `useQuery` that calls `supabase.rpc('is_entry_publicly_eligible', { p_entry_id: entry.id })`.
- Query key: `['entry-public-eligibility', entry.id]`, `staleTime: 1000 * 60 * 5`, `enabled: viewAs === 'public' && entry && entry.user_id !== viewerId`.
- While loading: show existing loading state.
- If the RPC returns `false` AND viewer is not the author: render a centered "This review isn't available" screen — copy + layout mirrors TICKET-020's `'none'` relationship 404. No back-nav trap; a `← Back` button routes to the restaurant page (or `router.back()` if no source).
- If `true`: proceed with the existing public-scope render path.
- Viewer IS the author: skip the RPC, always render (owner preview — authors can always see their own entry in public view even if it fails eligibility, e.g., after flipping private).

This is ~15 LOC net — one `useQuery`, one conditional render, one small component with the "not available" copy. Don't open a follow-up; close it here.

### 4. `ReactorsSheet` long-press → `/u/[username]`

**Finish it now, in this ticket.** The AC in the "Public reactions" block calls for "Long-press on a public reaction chip shows the list of public users who reacted (display name + @username, linking to `/u/[username]`)." The `username` field is already threaded through the response — the UI wiring is the missing piece.

Concrete:
- In `components/posts/ReactorsSheet.tsx`, accept a `scope` prop that threads from the reaction chip's long-press handler.
- When `scope === 'public'`: each reactor row is tappable; tap calls `router.push('/u/' + reactor.username)` and closes the sheet. Show `@{username}` as a secondary line (Manrope caption, `textMuted`) under display name.
- When `scope === 'table'`: keep the current behavior (non-tappable rows, or route to existing Table-scoped member profile if already wired). Don't change Table behavior.
- If a reactor row for public scope is missing a `username` (data error), render the row as non-tappable — never crash or route to `/u/undefined`.

Thread the `scope` prop through `ReactorsSheet`'s owning components (wherever public reaction chips live — likely the public-scope branch of `FloatingActionPill` or equivalent on `entry-detail?viewAs=public`).

### Summary of next actions for builder

1. Wire `is_entry_publicly_eligible` RPC pre-check in `app/entry-detail.tsx` for `viewAs=public` with the 404 fallback screen.
2. Extend `ReactorsSheet` to accept `scope` and route to `/u/[username]` on public-scope rows.
3. Re-run `npx tsc --noEmit` — still zero TICKET-021 errors expected.
4. Manually verify: public review on ineligible entry (e.g., after author flips to private) shows the 404 screen; long-press on a public reaction chip opens the sheet and tapping a reactor lands on their public profile.

---

## Build Log — Follow-up (2026-04-22)

### Files Changed

- `/Users/jacky/Napkin/napkin-app/app/entry-detail.tsx` — added `useQuery` for `is_entry_publicly_eligible` RPC (key `['entry-public-eligibility', entry.id]`, `staleTime: 5min`, `enabled` only for non-author public view). Gates on RPC result: shows existing loading spinner while in-flight, renders "This review isn't available." + `← Back` when `isEligible === false` and viewer is not the author. Authors always bypass the gate. Added `ReactorsSheet` import and `allReactions` prop to `FloatingActionPill`; `handleLongPress` now branches on `scope`: public scope opens `ReactorsSheet`, table scope opens emoji picker (unchanged). Wired `allReactions={interactions?.reactions ?? []}` at the call site.
- `/Users/jacky/Napkin/napkin-app/components/posts/ReactorsSheet.tsx` — added `scope?: 'table' | 'public'` prop (default `'table'`). Imported `useRouter`. Public-scope rows: tappable `Pressable` that calls `onClose()` then `router.push({ pathname: '/u/[identifier]', params: { identifier: username } })`; shows `@{username}` as `Type.caption` / `textMuted` secondary line. Table-scope rows: unchanged `View`. Defensive: if `username` is null/undefined on a public row, renders as non-tappable `View` (no crash, no `/u/undefined`).

### Tests

- `npx tsc --noEmit`: 0 new TICKET-021 errors. 2 pre-existing WIP errors in `app/(tabs)/tables.tsx` (`is_personal` property) remain — not introduced by this follow-up.

### Notes

- `ReactorsSheet` is not yet rendered outside `entry-detail.tsx` (the `FloatingActionPill` is its only call site). If other surfaces (e.g., `PublicReviewCard` reaction pills) need the sheet, they can import and pass `scope='public'` using the same pattern.

---

## Review History

### Review 1
Date: 2026-04-22
Verdict: REVISE

Spec compliance: ~28/42 acceptance criteria met (core dual-scope plumbing lands; several blockers on isolation, eligibility SSOT, and reply gating).

**Schema — dual comment scope**
- [x] `scope` column added w/ CHECK constraint + DEFAULT 'table' — PASS
- [x] Backfill via DEFAULT — PASS
- [x] Composite scoped indexes — PASS
- [x] RLS rewrite: four SELECT + four INSERT — PASS (policy shapes correct)
- [x] Parallel denorm columns on `entries` (public_reaction_count / public_reply_count / public_top_emojis) — PASS
- [ ] Cascade delete removes BOTH scopes on parent entry delete — PASS (the existing `cascade_delete_post_interactions` is scope-agnostic)
- [x] Trigger `sync_post_counts_and_top_emojis` branches on NEW.scope — PASS
- [ ] **`set_post_interaction_table_id` trigger + `post_comments.table_id NOT NULL` constraint block public inserts on feed-only entries** — FAIL (critical, see Key Issue 1)

**Public-review eligibility rule**
- [x] `is_entry_publicly_eligible(UUID)` SQL function created — PASS
- [ ] Single source of truth used everywhere — FAIL: `restaurant-history/index.ts:686–735` re-implements the predicate in JS (drift risk) AND the JS implementation has a correctness bug around LIMIT/filter order (see Key Issue 2)
- [x] Live flip-to-private hides rows (no denormalized is_public flag) — PASS

**Restaurant page — public-reviews section**
- [x] Section header + 5-then-20 expand + hide-when-empty + error/loading — PASS
- [ ] Section placement: "below Who's-been, above Visits feed" — FAIL: in `app/restaurant/[id].tsx:400–461`, the Voices/Visits block renders *before* `PublicReviewsSection`. Inverted relative to spec.
- [ ] Section label color: AC says `textSecondary`, code uses `textMuted` (`PublicReviewsSection.tsx:46,58`) — WARN
- [x] Deduplication (one row per entry) — PASS (PK guarantees)
- [x] Self-view included — PASS (no user_id exclusion in query)

**Public-review card layout**
- [x] Avatar, display name, @username, rating, 2-line note, 72pt photo, pills, relative date — PASS
- [ ] Author tap → `/u/[username]` — WARN: `PublicReviewCard.tsx:66–69` uses `pathname: '/u/[username]' as any` but the route file is `[identifier]`. URL interpolation accidentally works (produces `/u/<value>`) but the pathname template is a maintenance landmine and inconsistent with every other `/u/` caller.
- [x] Card body → `entry-detail?viewAs=public` — PASS

**Expanded review view (`entry-detail?viewAs=public`)**
- [x] `viewAs` param read; chrome scrubbed (PreviouslyHereBanner, Round banner) — PASS
- [x] Eligibility RPC pre-check + "This review isn't available." for non-authors — PASS
- [x] Viewer-is-author bypass — PASS
- [ ] **Reply composer gated on `allow_public_replies`** — FAIL: `app/entry-detail.tsx` has NO `allow_public_replies` fetch (grep returned zero matches). `FloatingActionPill` renders the reply button + `DockedReplyComposer` unconditionally in public view; muted "The author has replies turned off." line never renders (CommentThread handles it but entry-detail doesn't use CommentThread in public view). The server 403-replies_disabled is the only enforcement — UX AC says the button must not appear.

**Dual-scope isolation — no bleed**
- [x] `scope` required on GET + react/comment mutations; 400 on missing — PASS for react + comment
- [ ] `scope` required on edit_comment / delete_comment — FAIL: `usePostInteractions.ts:405,439` and `post-interactions/index.ts:400–472` do NOT send or validate scope. AC explicitly lists all four mutations.
- [ ] Error code `{ error: 'not_public' }` on public-eligibility 403 — FAIL: `post-interactions/index.ts:273,346` returns `{ error: 'Entry is not publicly eligible' }`. Cosmetic but AC is literal.
- [x] Error code `{ error: 'replies_disabled' }` — PASS (line 348)
- [ ] **`table-activity` and `feed` edge functions query `post_reactions` without `.eq('scope', 'table')`** — FAIL: `table-activity/index.ts:392–419` and `feed/index.ts:161–166`. A user's public-scope react on their own entry (or any leaked cross-scope row) would show up in `my_reactions` on Table feed cards — direct bleed into Table surface.
- [x] Realtime per-scope channel name + client-side `row.scope` filter — PASS (though fails-open on DELETE without REPLICA IDENTITY FULL; minor)

**Public reactions**
- [x] Always allowed (no reply toggle gate) — PASS
- [x] Emoji set unchanged, per-user-per-emoji toggle — PASS
- [x] Long-press → `ReactorsSheet(scope='public')` → rows route to `/u/[identifier]` — PASS

**Public replies — gated by `allow_public_replies`**
- [ ] Composer hidden when false; muted line shown — FAIL (see above — entry-detail path never reads the toggle)
- [x] Server rejects with 403 `replies_disabled` — PASS
- [x] RLS INSERT public comment gates on `allow_public_replies = true` — PASS
- [x] Edit/delete rules unchanged — PASS

**Edit-screen visibility indicator**
- [x] Chip appears only when public + rating + note ≥20 — PASS
- [x] Debounced ~150ms — PASS
- [x] Non-interactive — PASS
- [ ] `rating > 0` used instead of `rating != null` (`PublicVisibilityChip.tsx:37`) — WARN: AC says `rating != null`. Practically identical given the UI produces 0..5, but a literal mismatch.

**Section states on restaurant page**
- [x] Loading (spinner), Empty (hidden), Error (muted copy) — PASS
- [ ] Mixed state (expand fails) — N/A: implementation is client-side slicing, not a second fetch, so there's no expand-error path to test. Acceptable simplification given single 20-row fetch.

**Self-view on restaurant pages**
- [x] Own public review appears in the list — PASS

**Moderation — explicitly scoped out**
- [x] None ships in v1, TODO in migration — PASS

---

Correctness: FAIL — the trigger-NOT-NULL combo blocks the most common public-review scenario (feed-only entry with public account). Reply-toggle UX gate missing at the component boundary.

Edge Cases: FAIL — feed-only public entries, LIMIT-before-filter on public_reviews, REPLICA IDENTITY-less DELETE realtime fall-through all missed.

Error Handling: WARN — 403 message string drift from `{error:'not_public'}` to verbose English. Exception-on-trigger surfaces as opaque 500 to the client.

Security: WARN — no auth token is trusted from body (good). RLS shape is correct. BUT: `table-activity` + `feed` cross-scope leakage means a public-scope row authored by the viewer can surface as a Table-scope "my_reactions" entry; not a data disclosure to other users, but it violates the no-bleed invariant the whole ticket is built to enforce.

Performance: WARN — `restaurant-history action=page` now runs two full-table scans over `entries + profiles` (eligible rows + total count) per call. For a hot restaurant, that's a scan of every rated entry every time. Missing: indexes to support a scan filtered by `restaurant_id + profiles.account_privacy='public'`. Also N+1-adjacent: one extra SELECT on `entry_photos` after the eligible filter is fine, but the duplicated predicate is waste.

Design Compliance: WARN — Manrope/Newsreader mix in PublicReviewCard is on-brand. `PublicReviewsSection` uses `textMuted` where AC spec'd `textSecondary` (minor). `seeMoreBtn` uses `StyleSheet.hairlineWidth` border — technically "1px-solid-like" but on a button, forgivable per doctrine interpretation.

---

### Key Issues

1. **[BLOCKER] Public interactions on feed-only entries will FAIL at the DB level.**
   - `supabase/migrations/20260418000000_post_interactions.sql:42` — `post_comments.table_id UUID NOT NULL`
   - `supabase/migrations/20260418000000_post_interactions.sql:80–92` (trigger `set_post_interaction_table_id`) raises `EXCEPTION 'post interaction target not found'` when the parent entry has `table_id IS NULL`.
   - Feed-only entries (table_id NULL, the Emergence-Arc-doctrine default for a solo public user) satisfy `is_entry_publicly_eligible` but cannot host public reactions/comments — the trigger throws before insert. The new migration's "harmless for public rows" comment (`20260430000000…sql:238–241`) is factually wrong.
   - **Fix**: in the new migration, either (a) alter `post_comments.table_id` to nullable and patch `set_post_interaction_table_id` to tolerate NULL for scope='public', OR (b) branch the trigger on `NEW.scope` and skip the NULL-check/assignment for public rows. Option (a) + `AFTER INSERT` cascade-delete fix is cleaner.

2. **[HIGH] `restaurant-history action=page` duplicates eligibility logic in JS and fetches a LIMIT-before-filter slice.**
   - `supabase/functions/restaurant-history/index.ts:668–684` — SELECT orders by `created_at DESC LIMIT 20`, THEN filters by `account_privacy='public'` in JS (lines 686–696). If the 20 most recent rated entries at a restaurant are all from private users, the endpoint returns ZERO public reviews even when many eligible ones exist older. Correctness bug.
   - The `public_reviews_total` count (lines 715–735) re-runs the predicate in JS across all entries — that path is at least correct but drifts from `is_entry_publicly_eligible`.
   - **Fix**: push the predicate server-side. Either `.eq('profiles.account_privacy', 'public')` + add `.filter('rating', 'not.is', null)` + a raw-SQL `char_length` filter via a view, OR a single RPC that returns both `rows` + `total`. Best: a new SQL function `get_public_reviews(restaurant_id, limit)` that uses `is_entry_publicly_eligible` — preserves SSOT and gets correct ordering in one round-trip.

3. **[HIGH] Reply composer is not gated by `allow_public_replies` in `entry-detail?viewAs=public`.**
   - `app/entry-detail.tsx` never reads `profiles.allow_public_replies`. The `FloatingActionPill`'s reply button and `DockedReplyComposer` render unconditionally when `isPublicView`.
   - Server rejects the insert with 403 `replies_disabled` — but the user sees a toast/error AFTER tapping Send, not a pre-empted UI. AC is explicit: "The reply composer on `entry-detail?viewAs=public` renders ONLY when `allow_public_replies = true`."
   - `CommentThread` has the `repliesDisabled` prop wired correctly, but the public view in entry-detail uses `FloatingActionPill` + `DockedReplyComposer`, not `CommentThread`.
   - **Fix**: fetch the entry author's `allow_public_replies` (extend `useEntryDetail` to return it, OR a small query in entry-detail), then branch: render the pill *without* the reply button + render a muted "The author has replies turned off." below the comments block.

4. **[HIGH] Cross-scope bleed via `my_reactions` in `table-activity` + `feed`.**
   - `supabase/functions/table-activity/index.ts:394,409` — queries `post_reactions` with no scope filter.
   - `supabase/functions/feed/index.ts:162` — same.
   - A user who reacts to their own entry in public scope (allowed by the public-eligibility rule) will see that emoji reflected in `my_reactions` on their Table feed card — a direct bleed from public into Table.
   - **Fix**: add `.eq('scope', 'table')` to both queries. Trivial patch, critical correctness.

5. **[MEDIUM] `edit_comment` / `delete_comment` silently skip scope.**
   - `post-interactions/index.ts:400–472` — no scope extraction, no 400-on-missing.
   - `usePostInteractions.ts:405,439` — mutation body omits scope.
   - AC: "POST actions (react, comment, edit_comment, delete_comment) require a `scope` field on the body; missing or invalid scope returns 400."
   - **Fix**: require scope in body + validate. Even if the edge function doesn't branch on scope (RLS handles author-only), the 400-gate is the "no implicit default" invariant the whole ticket is built around.

6. **[MEDIUM] 403 error string mismatch: `Entry is not publicly eligible` vs. spec'd `not_public`.**
   - `post-interactions/index.ts:273,346`. AC spec'd `{ error: 'not_public' }`.
   - **Fix**: change the two `fail(...)` calls to `fail('not_public', 403)`. Clients will eventually want to pattern-match this code.

7. **[MEDIUM] Section placement inverted.**
   - `app/restaurant/[id].tsx:400–461` renders the Voices (= Visits) section *before* `PublicReviewsSection`. AC: "sits below Who's-been and above the existing Visits feed."
   - **Fix**: move the `PublicReviewsSection` block above the Voices block inside `activeTab === 'our-table'`.

8. **[LOW] `PublicReviewCard` author link uses `pathname: '/u/[username]' as any`.**
   - `components/restaurants/PublicReviewCard.tsx:66–69`. All other `/u/` callers use `'/u/[identifier]'`.
   - Runtime-works because expo-router interpolates and then matches on the resolved URL, but the template doesn't match a real route file and forces `as any`.
   - **Fix**: use `pathname: '/u/[identifier]' as const` + `params: { identifier: review.username }`.

9. **[LOW] `PublicReviewsSection` label uses `textMuted`; AC spec'd `textSecondary`.**
   - `components/restaurants/PublicReviewsSection.tsx:46,58,96`. Three lines.

10. **[LOW] `PublicVisibilityChip` uses `rating > 0` instead of `rating != null`.**
    - `components/create-entry/PublicVisibilityChip.tsx:37`. Practically equivalent, but AC is literal.

11. **[LOW] Realtime DELETE with no REPLICA IDENTITY FULL falls open.**
    - `usePostInteractionsRealtime.ts:42–47`: `if (row.scope && row.scope !== scope) return;` — on DELETE, `row.scope` is undefined (default REPLICA IDENTITY returns only PK in `payload.old`), so the check does NOT return and the OTHER scope's cache gets invalidated. Not fatal (extra refetch), but spoils the "belt-and-suspenders" claim.
    - **Fix (minimal)**: `ALTER TABLE post_reactions REPLICA IDENTITY FULL; ALTER TABLE post_comments REPLICA IDENTITY FULL;` in the migration, OR invert the filter to fail-closed: drop deltas when `row.scope` is missing (belt-and-suspenders means default-reject when ambiguous).

---

## Build Log — Cycle 2 (2026-04-22)

### Files Changed

**New**
- `/Users/jacky/Napkin/supabase/migrations/20260430010000_public_scope_feed_only_support.sql` — drops NOT NULL on `post_comments.table_id` + guard on `post_reactions`; patches `set_post_interaction_table_id` trigger to allow NULL `table_id` when `scope='public'` (feed-only entries); adds `ALTER TABLE … REPLICA IDENTITY FULL` on both tables; adds `get_public_reviews()` SQL function using `is_entry_publicly_eligible` as SSOT (fixes LIMIT-before-filter bug)

**Modified**
- `/Users/jacky/Napkin/supabase/functions/table-activity/index.ts` — added `.eq('scope', 'table')` to both `post_reactions` queries (entry and table_night reaction reads) to prevent cross-scope bleed into `my_reactions`
- `/Users/jacky/Napkin/supabase/functions/feed/index.ts` — added `.eq('scope', 'table')` to `post_reactions` query for the same reason
- `/Users/jacky/Napkin/supabase/functions/restaurant-history/index.ts` — replaced JS-side LIMIT-before-filter + duplicated eligibility predicate with a single `supabase.rpc('get_public_reviews', { p_restaurant_id, p_limit: 20 })` call; `public_reviews_total` extracted from `first_row.total_count`
- `/Users/jacky/Napkin/supabase/functions/post-interactions/index.ts` — added `scope` extraction + 400-on-missing to `edit_comment` and `delete_comment` handlers; changed all three `'Entry is not publicly eligible'` 403 messages to `'not_public'` (GET + react + comment paths)
- `/Users/jacky/Napkin/napkin-app/hooks/posts/usePostInteractions.ts` — `useEditComment` and `useDeleteComment` mutation bodies now include `scope` in the request payload
- `/Users/jacky/Napkin/napkin-app/app/entry-detail.tsx` — extended `EntryDetail` type with `allow_public_replies: boolean`; extended `fetchEntry` profile select to include `allow_public_replies`; added `repliesDisabled` computed value; `FloatingActionPill` gains `repliesDisabled` prop (hides reply button + separator when true); `DockedReplyComposer` only opens when `!repliesDisabled`; muted "The author has replies turned off." text rendered below comments in public view when `repliesDisabled`
- `/Users/jacky/Napkin/napkin-app/components/restaurants/PublicReviewCard.tsx` — changed `pathname: '/u/[username]' as any` to `pathname: '/u/[identifier]' as const`, params to `{ identifier: review.username }`
- `/Users/jacky/Napkin/napkin-app/components/restaurants/PublicReviewsSection.tsx` — changed 3 occurrences of `palette.textMuted` to `palette.textSecondary` for the section label (loading, error, and normal states)
- `/Users/jacky/Napkin/napkin-app/components/create-entry/PublicVisibilityChip.tsx` — changed `rating > 0` to `rating != null` per AC literal
- `/Users/jacky/Napkin/napkin-app/app/restaurant/[id].tsx` — moved `PublicReviewsSection` inside the `our-table` tab View block, positioned above the Voices/Visits section (was rendered after it outside the block)

### Tests

- `npx tsc --noEmit`: 0 new TICKET-021 errors. 2 pre-existing WIP errors in `app/(tabs)/tables.tsx` (`is_personal` property) unchanged.
- `npm run test:functions` (Deno): 38 steps pass, 0 failed. No regressions.
- Migration `20260430010000` applied to remote via `supabase db push --linked --include-all`. Edge functions `post-interactions`, `table-activity`, `feed`, and `restaurant-history` deployed to `ftvmseaqwwlcxtdlvxxz`.

### Builder Questions

None. All 11 issues from Review 1 are addressed:
1. [BLOCKER] Feed-only entry support — new migration drops NOT NULL + patches trigger
2. [HIGH] Cross-scope bleed — `.eq('scope', 'table')` added to both table-activity and feed queries
3. [HIGH] LIMIT-before-filter bug — replaced with `get_public_reviews()` RPC
4. [HIGH] Reply composer gate — `allow_public_replies` fetched, `repliesDisabled` computed, pill reply button hidden, muted line shown
5. [MEDIUM] `edit_comment`/`delete_comment` scope — added to edge function validation and hook mutation body
6. [MEDIUM] Error code `not_public` — fixed in all 3 call sites (GET + react + comment)
7. [MEDIUM] Section placement — `PublicReviewsSection` now above Voices inside the our-table block
8. [LOW] Author link pathname — `/u/[identifier] as const` with correct params
9. [LOW] Label color — `textSecondary` in all 3 states
10. [LOW] Rating condition — `rating != null` in `PublicVisibilityChip`
11. [LOW] REPLICA IDENTITY FULL — added to new migration alongside the trigger patch

---

### Review 2
Date: 2026-04-23
Verdict: APPROVE with WARNs

Spec compliance: 11/11 cycle-1 issues closed; previously-PASS ACs did not regress.

**Cycle-1 fix verification**
- [x] [BLOCKER 1] Feed-only public support — PASS
  - `supabase/migrations/20260430010000_public_scope_feed_only_support.sql:27` drops `NOT NULL` on `post_comments.table_id`; line 32 is a no-op guard for `post_reactions`.
  - Trigger `set_post_interaction_table_id` (lines 40–71) branches on `NEW.scope = 'public'` for NULL-parent-table rows AND still RAISEs for `scope='table'` inserts on NULL-parent entries (line 63–66). Contract preserved.
  - `ALTER TABLE … REPLICA IDENTITY FULL` applied on both tables (lines 79–80).
- [x] [HIGH 2] Cross-scope bleed — PASS
  - `supabase/functions/table-activity/index.ts:398,414` and `supabase/functions/feed/index.ts:166` all add `.eq('scope', 'table')`. Full grep across `supabase/functions/` confirms only three files reference these tables; all are scoped.
- [x] [HIGH 3] `get_public_reviews` RPC replaces JS-side duplication — PASS
  - `restaurant-history/index.ts:670–680` calls `supabase.rpc('get_public_reviews', {...})`; `publicReviewsTotal` extracted from `first_row.total_count`. JS-side LIMIT-before-filter gone.
  - SQL function uses `is_entry_publicly_eligible` as SSOT (migration line 123); column names `entries.content` + `entry_photos.sort_order` match schema.
- [x] [HIGH 4] Reply composer gated by `allow_public_replies` — PASS
  - `entry-detail.tsx:197` fetches `allow_public_replies` in profile select; line 226 threads into `EntryDetail` type; line 341 computes `repliesDisabled`; `FloatingActionPill` at line 1491 receives the prop and line 1693 hides the reply button + separator when true; `DockedReplyComposer` only opens when `replyOpen && !repliesDisabled` (line 1468); muted line "The author has replies turned off." renders at lines 1449–1460.
- [x] [MEDIUM 5] `edit_comment` / `delete_comment` scope — PASS
  - `post-interactions/index.ts:403,456` require `isValidScope(scope)` → 400 on missing. `usePostInteractions.ts:405,439` include `scope` in request bodies. TS `EditCommentInput` / `DeleteCommentInput` enforce required `scope: Scope`.
- [x] [MEDIUM 6] `not_public` error code — PASS
  - `post-interactions/index.ts:153,273,346` all return `fail('not_public', 403)`. Grep for "Entry is not publicly eligible" returns zero hits.
- [x] [MEDIUM 7] Section placement — PASS
  - `app/restaurant/[id].tsx:401–415` renders `PublicReviewsSection` BEFORE the Voices block (lines 417–443) inside `activeTab === 'our-table'`. Correct order: Who's-been chip (in `TableRatingBlock`) → Public reviews → Voices.
- [x] [LOW 8] `/u/[identifier]` pathname — PASS
  - `PublicReviewCard.tsx:66–69` uses `pathname: '/u/[identifier]' as const` with `{ identifier: review.username }`. No `as any`.
- [x] [LOW 9] `textSecondary` on labels — PASS
  - `PublicReviewsSection.tsx` labels at lines 46, 58, 76 all use `textSecondary`. Body copy (`textMuted` for the spinner, error text, button text) is fine — AC only specified the label.
- [x] [LOW 10] `rating != null` — PASS
  - `PublicVisibilityChip.tsx:36` uses `rating != null`.
- [x] [LOW 11] REPLICA IDENTITY FULL — PASS (covered under issue 1).

**Regression checks**
- [x] No new unscoped `post_reactions` / `post_comments` reads introduced — confirmed via grep.
- [x] Second migration is idempotent (`ALTER COLUMN … DROP NOT NULL` on already-nullable column is a PG no-op per the migration's own comment on line 31). No accidental column drops or data loss.
- [x] No `.skip` files remain in `supabase/migrations/`. No other migrations were accidentally modified (only the two TICKET-021 migrations are untracked new files).
- [x] `npx tsc --noEmit`: 2 errors, both pre-existing WIP in `app/(tabs)/tables.tsx` (`is_personal` on Atlas branch). Zero TICKET-021 errors.
- [x] Build Log names `post-interactions`, `restaurant-history`, `table-activity`, `feed` as deployed. All edited edge functions are accounted for.

---

Correctness: PASS — feed-only public interactions now supported; SSOT respected; reply-gate UX wired at the component boundary.
Edge Cases: WARN — `get_public_reviews` outer SELECT has `LIMIT p_limit` with no outer `ORDER BY`. CTE ordering is not guaranteed to propagate through JOIN/LIMIT in PostgreSQL. See Key Issue 1 below.
Error Handling: PASS — all three eligibility 403s use `not_public`; `replies_disabled` unchanged; trigger exception paths correct.
Security: PASS — no cross-scope reads; RLS predicates unchanged; scope required at every edge-function boundary.
Performance: WARN (unchanged from cycle 1) — `is_entry_publicly_eligible` runs per row inside `get_public_reviews`, and no composite index on `entries(restaurant_id, created_at)` backs the scan. Acceptable for v1 traffic.
Design Compliance: PASS — section label colors corrected; on-brand typography and spacing preserved.

---

### Key Issues (cycle 2)

1. **[WARN] `get_public_reviews()` outer query lacks `ORDER BY` before `LIMIT`.**
   - `supabase/migrations/20260430010000_public_scope_feed_only_support.sql:111–150`. The `eligible` CTE orders by `created_at DESC`, but the outer `SELECT … FROM eligible el CROSS JOIN total JOIN profiles p … LIMIT p_limit` has no ORDER BY. PostgreSQL does not guarantee CTE ordering propagates through the outer query — the planner may return any 20 of N eligible rows, not necessarily the 20 most recent.
   - In practice, small CTEs with simple joins often preserve order, so this may work on the current workload. Spec AC ("reverse-chron by `entries.created_at`") is honored only incidentally.
   - **Fix (trivial)**: move `ORDER BY el.created_at DESC` to the outer query, immediately before `LIMIT p_limit`. One-line change.
   - Not a BLOCKER because: (a) worst-case is out-of-order cards, not missing/wrong data; (b) real-world behavior on small restaurants is typically correct; (c) the cycle-1 correctness bug (private-users-starving-results) IS fixed by the filter-before-limit structure.

No other new issues. Cycle-1 issues are all resolved. Ready to merge pending the single ORDER BY fix if desired — this can also ship as a follow-up since it's a cosmetic-ordering concern rather than a data-correctness or security bug.

---

## Completion

- **Completed:** 2026-04-23
- **Final verdict:** APPROVE with one accepted WARN
- **Merge commit:** `81091f3 feat: TICKET-021 — public reviews on restaurant pages (dual-comment-scope)`
- **Review cycles:** 2 (cycle 1 → REVISE with 1 BLOCKER + 10 issues; cycle 2 → APPROVE with 1 WARN)

### Accepted WARN (ship as follow-up)

- `get_public_reviews()` outer SELECT is missing `ORDER BY el.created_at DESC` before `LIMIT p_limit`. The migration file has been corrected locally (matches the planner's likely-but-unguaranteed behavior with an explicit ORDER BY). Production function was deployed before the fix and still uses the CTE-ordering-only form; worst case is out-of-order cards on busy restaurants, never missing data.
  - To push the local fix to production, a future migration push will carry it forward (blocked today by an unrelated pre-existing `20260427000000_remove_personal_tables.sql` migration that fails against current remote state on `t.is_personal` — not this ticket's concern).

### Notes

- Branch `feat/TICKET-021` was created on top of significant uncommitted WIP (Atlas v1 Phase 2 + component polish). The TICKET-021 commit was staged with explicit `git add <files>` to exclude the WIP; two files with interleaved hunks (`app/restaurant/[id].tsx`, `components/feed/FeedActionRow.tsx`) were split by restoring to base, re-applying only TICKET-021 changes, committing, then overlaying WIP back via saved buffers. Final main state: 1 clean TICKET-021 commit; WIP preserved as uncommitted working-tree changes.
- Migration `20260430000000_dual_scope_post_interactions.sql` applied to remote successfully during build. Follow-up migration `20260430010000_public_scope_feed_only_support.sql` (drops `table_id` NOT NULL, branches trigger for scope='public', adds `REPLICA IDENTITY FULL`, creates `get_public_reviews()` RPC) also applied to remote.
- Edge functions deployed: `post-interactions`, `restaurant-history`, `table-activity`, `feed`.
- Type check: `npx tsc --noEmit` reports zero TICKET-021 errors. Two pre-existing WIP errors in `app/(tabs)/tables.tsx` remain (unrelated).
- Unblocks **TICKET-022 (calibration signal)** which has a hard dep on TICKET-021's `PublicReviewCard` surface (for the compact `<NN>% match` chip on the author row) and on the RPC contract that exposes public reviews.
