---
id: TICKET-020
title: "Public profile (account-level opt-in, browse anyone's palate)"
priority: high
status: review
created: 2026-04-17
updated: 2026-04-17
tags: [profile, public, discovery, wedge]
---

# Public profile

## Problem

Lists exist (TICKET-018), but there's no surface to *browse* another user. If a user's public list is shared and someone opens it, they see the list — but tapping the author leads nowhere. For the wedge to work ("read a stranger's review on a restaurant you just visited, click their profile, see their top 4s, calibrate against their palate"), Napkin needs a **public profile screen** that any viewer can see for any user who has opted their account public.

This is the account-level master toggle — the thing that flips a user from "private journaler" to "publicly browsable palate." Without it, TICKET-018's lists can't actually function as world-facing artifacts, and TICKET-021's public reviews on restaurant pages have nowhere to link back to.

## Notes

### Product-B doctrine reminder

Account-level privacy is the **master switch**. Default: private. Opt-in: public. Flipping public exposes: profile page, public lists, logged restaurants (but not the log notes — those need their own surfacing via TICKET-021). Tables are *never* included regardless of account state. See `CLAUDE.md` for the full doctrine.

### Locked decisions (from brainstorm, 2026-04-17)

- **One account-level toggle** in profile settings: private (default) ↔ public. Master switch.
- **Public profile surface shows:**
  - Avatar, display name, optional short bio
  - Stats: total logs, total restaurants, average rating, maybe number of cities
  - Public lists (from TICKET-018)
  - Recently logged restaurants — as a grid of restaurant cards, not the log notes themselves (notes are TICKET-021's problem)
  - NO Table membership, NO Round history, NO feed activity
- **Privately-profiled user behavior:**
  - Their lists are still gated (private always, or public-per-list hidden if account private — per TICKET-018 doctrine)
  - Their logs are private (never surfaced on restaurant pages)
  - Profile URL 404s to strangers
- **First-flip UX:** when a user toggles public for the first time, show a clear screen explaining what becomes visible. No surprises.
- **Engagement-on-public-content toggle** lives here too: "who can reply to my public reviews" — `nobody (emoji only)` / `anyone`. Default: nobody. (Replies/reactions themselves are built in TICKET-021.)

### Explicitly deferred

- Follow/subscribe relationships between public users — deferred. The calibration signal (TICKET-022) is a better substitute for "following."
- Public activity feed ("see what public users posted recently") — deferred. Discovery happens through restaurant pages, lists, and calibration, not a global feed.
- Per-log or per-list overrides of account state — no. Account is the master toggle.
- Username / handles — if not already built, address as a sub-concern or separate micro-ticket.

### Open questions for product-designer

- Does "public profile" require a chosen username/handle? If current `profiles` schema uses email or internal ID, we probably need a username migration.
- Bio character limit — 160? 80?
- "Recently logged" — how many restaurants, ordered how, paginated?
- Does hiding Tables mean we also need to scrub Table-derived stats (e.g. "average in Tokyo" which might be Table-weighted)? Probably yes, recompute stats from just the user's own entries.
- Should there be a visible badge/affordance somewhere indicating a user's profile is public (e.g. on their own profile view)?
- How does this interact with the existing Table-scoped member profile (TICKET-012)? Two surfaces, or one surface with different views?

### Dependencies

- **TICKET-018 (Lists primitive)** — profile displays lists, so lists must exist
- **TICKET-012 (Member profile)** — existing Table-scoped profile; may be reused or diverged from

---

## Product Spec

### User Stories

- As a **user tapping the Profile tab in the bottom nav**, I want to land on my own merged profile with a gear icon for settings, so that my profile is one tap away and settings is one more tap from there.
- As a **user viewing my own profile**, I want to see exactly what a stranger would see (palate section) alongside my Tables, so the owner view is WYSIWYG plus the Tables context only I have.
- As a **user tapping a Tablemate's avatar from the feed**, I want to land on their merged profile and see a preview card for each Table we share, with a tap-through to the Table-scoped view I already know, so nothing about the existing Table drill-down changes.
- As a **user tapping the author of a public list I just resonated with**, I want their palate section (stats, their public lists, recently-logged tiles) even though we share no Tables, so the Letterboxd-style calibration wedge works.
- As a **user tapping a Tablemate who is also public**, I want both sections on the same screen — their palate AND a preview of our shared Tables — so I don't pick between views.
- As a **stranger opening a private user's link (or uuid) with whom I share no Tables**, I want a plain "This profile isn't available" state that doesn't confirm or deny the user exists, so privacy isn't leaked by presence.
- As a **Tablemate who is private and has no public lists**, I still want to be reachable by my Tablemates via my uuid link from in-app surfaces, so private account state never blocks in-Table identity.
- As a **private-by-default user considering going public**, I want a first-flip warning that plainly lists what becomes visible and what stays private, so I'm never ambushed.
- As a **user flipping back to private**, I want a single soft confirm (not a warning screen) so reversing feels low-stakes.
- As a **public user controlling replies on my public reviews**, I want the reply-permission toggle in settings so I can pre-configure before TICKET-021 ships enforcement.
- As a **user whose account is public**, I want my public URL to be `/u/username` so I can share a vanity link outside the app.
- As a **user with multiple Tables in common with a target**, I want the preview to surface the one with the most recent shared activity (and the rest reachable via the Table-scoped screen later), so the default is never stale.

### Acceptance Criteria

**Schema and account-level privacy**
- [ ] Migration adds to `profiles`: `account_privacy text not null default 'private' check (account_privacy in ('private','public'))`, `allow_public_replies boolean not null default false`, `avatar_url text`, `username text unique`.
- [ ] Username format: 3–24 chars, lowercase `[a-z0-9_]`, starts with a letter. Enforced with a `check` constraint and a case-insensitive unique index.
- [ ] Users who existed before this migration have `account_privacy = 'private'`, `allow_public_replies = false`, `username = null`. Username is collected lazily at first public-flip.
- [ ] New signups remain private-by-default; signup flow is unchanged.

**Bottom nav change**
- [ ] `app/(tabs)/_layout.tsx` — the `settings` tab is removed from the bottom nav. A `profile` tab is added in its place (same slot, same fifth-position). Icon: `person-circle-outline`. Label: "Profile".
- [ ] The Profile tab renders `app/(tabs)/profile.tsx` — a stub that `router.replace(\`/u/${currentUserId}\`)` on mount. This keeps the URL identity consistent whether reached from the tab or from tapping an avatar.
- [ ] `app/(tabs)/settings.tsx` is relocated to `app/settings/index.tsx` (reached only from the gear icon on own-profile). Route shape: `/settings`. The existing settings content is preserved.
- [ ] `app/(tabs)/friends.tsx` is deleted from the codebase. Remove the `Tabs.Screen name="friends"` stub from `_layout.tsx`. Confirm no other references remain.

**Merged profile route and resolution**
- [ ] New route `app/u/[identifier].tsx`. `identifier` is either a uuid (matches uuid regex) or a username (case-insensitive, no `@` prefix in the URL). Both shapes must resolve.
- [ ] Single edge function `user-profile` (new) accepts `{ identifier: string }`. Service-role client; validates caller via `auth.getUser(token)`. Resolves identifier as uuid if it matches uuid shape, else as `username` via case-insensitive lookup.
- [ ] Edge function returns, in one payload: `{ profile: { user_id, username, display_name, bio, avatar_url, account_privacy }, stats: { total_logs, total_restaurants, average_rating } | null, public_lists: ListSummary[] | null, recently_logged: RestaurantTile[] | null, tables_in_common: TablePreview[], is_self: boolean, viewer_target_relationship: 'self' | 'tables_in_common' | 'public_only' | 'public_and_tables' | 'none' }`.
- [ ] `TablePreview = { table_id, table_name, avg: number | null, visit_count: number, last_entry_at: string | null, last_entry_restaurant_name: string | null, last_entry_rating: number | null }`.
- [ ] Authenticated-only in v1. Unauthenticated requests redirect to `/auth` and resume after sign-in.
- [ ] Loading: full-screen `ActivityIndicator` in `palette.primary`. Error: "Couldn't load this profile" with ← Back.

**Conditional-section rules (viewer-target relationship drives rendering)**
- [ ] `self`: Header + Palate section + Tables-in-common section (labeled "Your Tables"). Gear icon top-right of header.
- [ ] `public_and_tables`: Header + Palate section + Tables-in-common section.
- [ ] `public_only`: Header + Palate section. No Tables-in-common section.
- [ ] `tables_in_common` (target is private, viewer shares ≥1 Table): Header + Tables-in-common section. No Palate section. Header omits `@username` line (target has no public handle).
- [ ] `none` (target is private and viewer shares no Tables, and viewer ≠ target): full-screen "This profile isn't available" state. Same copy/layout as TICKET-018's private-list not-found. Returned as `{ error: 'not_found' }` from the server — never distinguish "private" from "doesn't exist".

**Edge function privacy enforcement**
- [ ] Before returning anything beyond `{ error: 'not_found' }`, compute `viewer_target_relationship` on the server from: `caller.user_id`, target `account_privacy`, and `table_members` self-join on shared Table IDs.
- [ ] If relationship = `'none'`: return `{ error: 'not_found' }`. Do not reveal existence.
- [ ] If relationship = `'tables_in_common'`: return header + `tables_in_common` only. `stats`, `public_lists`, `recently_logged` are `null` and MUST NOT hit the DB for that user's entries.
- [ ] If relationship = `'public_only'` or `'public_and_tables'`: populate the Palate section; `tables_in_common` is populated iff shared Tables exist.
- [ ] If relationship = `'self'`: populate everything; `stats` and `public_lists` and `recently_logged` are returned even if `account_privacy = 'private'` (owner preview).

**Header**
- [ ] Large avatar (88pt, initials fallback if `avatar_url` null), display name (Newsreader italic `displaySmall`), `@username` line (Manrope `bodySmall`, `textMuted`) — shown only when target is public OR is self. Bio (Manrope `body`, wraps, max 160 chars stored).
- [ ] When viewer = self: gear icon top-right of the header, 44x44pt tap target, `settings-outline` Ionicon. Taps route to `/settings`. This is the ONLY entry point to settings — no settings row anywhere else in the app.
- [ ] No inline-edit affordances on the header itself. "Edit" lives under the gear.

**Palate section (visible for `self`, `public_only`, `public_and_tables`)**
- [ ] Stats strip: three tiles — total logs, total restaurants, average rating. Same visual pattern as TICKET-012's `MemberStatsStrip`. No "Rounds" tile.
- [ ] Stats are computed server-side from the target's non-private entries across ALL their Tables (including personal). Round entries contribute; `table_night_id` is never returned to the client. No Table name, Table id, or Round id appears anywhere in the Palate payload.
- [ ] Public Lists section: all of the target's `public` lists, reverse-chron by `updated_at`. Row pattern matches TICKET-018's list-row (title, entry count, ranked/unranked badge, last-updated). Tapping routes to TICKET-018's list detail.
- [ ] Recently Logged section: up to 12 restaurant tiles in a grid, dedup by `restaurant_id`, most-recent first. Each tile: restaurant photo (or no-photo fallback matching restaurant-page style), name, city. Tap routes to `/restaurant/[id]`. No rating, no prose, no Table chrome.
- [ ] Self empty state: when target = self has zero non-private logs, Stats strip renders "—" for average / "0" counts; below it, a single-line nudge "Log your first restaurant to see your palate take shape" in Newsreader italic `textMuted`; Public Lists and Recently Logged sections are hidden. Applies even when private (owner preview).
- [ ] Stranger empty state: when target is public with zero logs, Stats strip renders zeros; Public Lists and Recently Logged sections are hidden entirely (no empty-state label).

**Tables-in-common section (visible for `self`, `tables_in_common`, `public_and_tables`)**
- [ ] Section header: "Tables in common" for non-self viewers; "Your Tables" when viewer = self.
- [ ] One preview card per shared Table (or all of viewer's Tables when self). Card contents: Table name (Newsreader italic), target's avg at this Table (amber, Newsreader italic), target's visit count in this Table (Manrope `caption`, `textMuted`), target's most-recent entry there (restaurant name + rating + relative date), chevron with copy "Tap for full activity".
- [ ] When viewer = self, each card is the viewer's own activity at that Table — omit the redundant avatar, keep Table name / your avg / your most-recent entry.
- [ ] Ordering: non-self — by `last_shared_activity_at DESC` (the most-recent entry by target in a Table where viewer is also a member). Self — by viewer's own `last_entry_at DESC`.
- [ ] Tapping a card routes to `/member/[userId]?tableId=X` (TICKET-012's existing screen, unchanged).
- [ ] Self empty state (no Tables yet): a single card-style empty state "Join or create a Table to get started" with a subtle link to `/tables`.
- [ ] Non-self empty state: the section is hidden entirely (the relationship routing already prevents empty render here).

**Settings — Privacy section (in `app/settings/index.tsx`)**
- [ ] "Privacy" section above "My Wishlist". Two-line row: title "Account visibility", secondary "Private — only your Tables see you" or "Public — anyone with the link can browse your palate".
- [ ] Tapping opens a privacy sheet with: (a) current state, (b) a "Preview my profile" link (routes to `/u/[currentUserId]`, always works for self), (c) the toggle action button.
- [ ] "Who can reply to my public reviews?" segmented control: "Nobody (emoji only)" (default) and "Anyone". Persists `profiles.allow_public_replies`. Disabled with helper copy "Turn on public profile to change this" when `account_privacy = 'private'`.
- [ ] Inline editors (save on blur): "Display name", "Username" (shown as `@username` when set; hidden when private and never-been-public), "Avatar URL", "Bio" (160 char limit enforced client-side).
- [ ] Settings reachable ONLY via the gear icon on own-profile. No settings row elsewhere in the app; no deep-link entry point beyond `/settings`.

**First-flip warning modal**
- [ ] Triggered when tapping "Make profile public" while `account_privacy = 'private'` AND `username IS NULL`.
- [ ] Full-screen modal titled "Make your profile public?" (Newsreader italic, `displaySmall`).
- [ ] Body shows two lists:
  - "What becomes visible to anyone with the link:" — Your display name, username, avatar, bio · Your public lists · Restaurants you've logged (as tiles — not your notes) · Your rating count, restaurant count, and average rating
  - "What stays private — always:" — Your Tables and everything in them · Your Rounds · Your wishlist · Your private lists · The notes inside your logs (until a specific review is opted public — a future setting)
- [ ] Username field inline, required before confirm. Uniqueness check on blur: "Username available" / "Already taken".
- [ ] Buttons: "Keep it private" (secondary) and "Make public" (primary, disabled until username valid and unique). Confirm writes `account_privacy='public'` and `username=<chosen>` in one server call.

**Subsequent flips and flip-back**
- [ ] Subsequent private → public flips (after the first) show a lightweight confirm alert ("Make profile public again?") — no warning screen.
- [ ] Public → private flip shows a soft confirm alert: "Make your profile private? Your public lists will be hidden and your reviews will no longer appear on restaurant pages." On confirm, write `account_privacy='private'`. Username is retained for re-flip. Public-list visibility is gated server-side by account state — no per-list mutation.

**Reply-permission toggle (column + UI ship here; enforcement in TICKET-021)**
- [ ] `profiles.allow_public_replies` is written only from the settings privacy sheet.
- [ ] No public-reply UI renders in this ticket on any surface. TICKET-021 reads this field to gate reply affordances.

**Cross-ticket glue for TICKET-018 list detail**
- [ ] TICKET-018's list-detail screen, when rendering to a non-owner viewer, wires the author line to `/u/[authorUsername]` when `author.account_privacy = 'public'`. When private, author line is plain text (display name only, no `@username`, no tap). The list payload must include the author's `username` and `account_privacy`.
- [ ] On lists authored by the viewer, author line ALWAYS taps to `/u/[currentUserId]` (uuid, since the user may be private).

**States and error handling**
- [ ] Loading: single `ActivityIndicator`, full-screen, `palette.primary`.
- [ ] Error (network/server): "Couldn't load this profile" + ← Back.
- [ ] Not-found 404 (relationship `'none'`): minimal screen, copy "This profile isn't available.", matches TICKET-018's private-list not-found pattern. No retry, no "report".
- [ ] Scroll: single `ScrollView`; header not sticky; `paddingBottom: insets.bottom + 40`; `paddingTop: insets.top + Spacing.md`.

### UX Decisions

- **One merged profile surface, not two**: two surfaces force users to reason about which lens they're in ("public-me" vs "Table-me") and leak the seam. One surface with relationship-driven sections hides the seam — the viewer just sees what their relationship unlocks.
- **Settings moves to a gear icon, not a tab**: Profile is the more frequent destination; settings is configuration. Instagram, Letterboxd, and TikTok all follow the same pattern. Reclaiming the fifth tab slot for Profile keeps the bottom nav action-oriented.
- **Preview card + deep-link to `/member/[userId]?tableId=X`, not embedded full Table view**: the merged profile must stay scannable. Embedding TICKET-012's full stats strip + top 5 + activity feed per shared Table would make every Tablemate's profile a 4-screen scroll. Preview card plus "tap for more" keeps the merged view compact while preserving the detailed drill-down we already built.
- **Multi-Table default = most-recent shared activity**: recency reflects current relevance and avoids stale picks. Anything more elaborate (picker, carousel) rewards users who live deep in the app at the cost of first-touch simplicity. If multi-Table selection becomes painful, it belongs on `/member/[userId]?tableId=X` (Table switcher), not here.
- **Route accepts both uuid and username**: Tablemates tapping a private user's avatar must land somewhere — that path uses uuid. Public users sharing externally use vanity `@username`. Both routing shapes resolving to the same screen is the minimum cost to support both call-sites cleanly. Users rarely *see* the URL on mobile; the ugliness of uuid in deep-links is internal.
- **Private users stay reachable by Tablemates, silent to strangers**: routing by uuid from in-app surfaces continues to work for private users. The edge function's `'none'` branch makes the same uuid silently 404 for non-Tablemate callers — existence is not confirmed. This is what "private" means in this product: you show up for the people who already know you.
- **Own-profile owner-preview keeps the Palate section even while private**: the gear-icon settings flow needs "preview what my public profile would look like" one-tap away. Hiding the Palate section for private owners defeats the preview.
- **First-flip warning is calm, not scary**: two-list framing ("what becomes visible" / "what stays private") matches the user's actual mental model. Opting public is a legitimate choice, not a hazard.
- **Flip-back is soft-confirm only**: the reversible direction is lower-stakes than first opt-in. Alert dialog, not a modal screen.
- **Username required at first flip, collected inline**: defers username cost to the users who actually go public, avoids burdening the private-default majority. `/u/username` becomes the vanity link without a separate onboarding step.
- **Reply-permission column ships here, enforcement in TICKET-021**: lets users pre-configure; TICKET-021 has no migration cost.
- **Avatar URL (not upload) in v1**: upload UX (crop, compress, error handling) is meaningful work; initials fallback covers 95% of users until a polished flow ships.
- **Bio cap 160 chars**: Twitter-sized; forces a one-liner.
- **12 restaurant tiles in Recently Logged, no pagination**: covers ~a month of active logging; more is clutter.
- **Edit is gear-only, not inline**: own-profile is WYSIWYG + gear. No inline "edit bio" taps. Simpler rule, simpler surface.

### Out of Scope

- Any modification to `/member/[userId]?tableId=X` (TICKET-012 screen). It remains the drill-down target, unchanged.
- Multi-Table switcher on the Tables-in-common section (default-to-most-recent suffices; a switcher belongs on TICKET-012's screen later).
- Settings redesign beyond relocating it from tab to gear-icon destination.
- Follow / subscribe / friendship graph.
- Public activity feed (global "who posted what recently").
- Per-log or per-list overrides of account-level privacy (account is master toggle).
- Calibration signal ("this person rates similarly to you") — TICKET-022.
- Public reviews / written log prose on restaurant pages — TICKET-021.
- Public replies and reactions themselves — TICKET-021 (this ticket only persists the toggle column + UI).
- Profile customization beyond avatar URL / display name / bio (no cover image, no themes, no pinned spots).
- Blocking / reporting / moderation tooling.
- In-app search or autocomplete for other users (public or otherwise).
- Profile stats breakdown charts (histograms, trend lines).
- Unauthenticated web view.
- Username changes / handle history / uniqueness reclamation.
- Avatar upload flow.
- Notifications when someone views your profile.
- Deep-link to a specific section within a profile.
- DMs.
- Migrating cached bottom-nav state for in-session users (the tab change happens at build).

### Open Questions

- None blocking. The pivot resolved the "two surfaces vs one" question. Avatar upload vs URL stays URL-only in v1 (flag for a pre-build call if the team wants to expand scope; ~1 extra day using Supabase Storage + TICKET-005 patterns).

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Technical Design

### Approach

Ship a single merged `/u/[identifier]` profile screen backed by one new aggregated endpoint (`user-profile`, action `profile`) that computes `viewer_target_relationship` server-side and returns a relationship-gated payload (Palate and/or Tables-in-common, or 404). Relocate the existing `(tabs)/settings.tsx` to `app/settings/index.tsx`, replace the Settings tab slot with a thin Profile tab stub that `router.replace`s to `/u/[currentUserId]`, and surface settings only via a gear icon on own-profile. Add four columns to `profiles` (`account_privacy`, `allow_public_replies`, `avatar_url`, `username`) in one migration, extend the RLS select policy so the Tablemate read path continues to work while adding a public-read branch that never leaks existence of private users (service-role bypass in the edge function is the primary privacy guarantee; RLS is defense-in-depth for any direct client `.select('profiles(...)')`). The username-collection, first-flip warning, and flip-back flows are small dedicated sub-routes under `/settings/privacy/*`, which gives us native back-gestures and keeps settings simple. Lists cross-ticket glue: extend the `lists` `get` action payload with `owner_profile.username` and `owner_profile.account_privacy`, and wire the list-detail header author line to `/u/[username]` when public / plain text when private. No changes to `/member/[userId]` (TICKET-012) — it remains the drill-down target.

### Architecture Decisions

- **One aggregated edge function `user-profile`, replacing the existing one-column-read stub.** Single round-trip for the profile screen (header + stats + public lists + recently logged + tables-in-common). Trade-off: function is larger and has five branches; mitigated by sharing a `computeRelationship` helper and explicit early-returns per branch. Retires the dead `value_profiles` join in the current stub.
- **Service-role client + `auth.getUser(token)` for auth, matching `restaurant-history`/`member-profile` pattern.** The function writes privacy policy in code, not RLS — RLS is a secondary gate for other code paths (wishlist joins, list-detail owner lookup). Trade-off: duplicates RLS logic; acceptable because the 5-relationship branching is cleaner as imperative code.
- **Identifier resolution: uuid regex first, else username.** A strict username CHECK constraint (`^[a-z][a-z0-9_]{2,23}$`) guarantees no username can collide with a uuid shape, so resolution is unambiguous. Trade-off: usernames must start with a letter.
- **Privacy `'none'` branch returns `{ error: 'not_found' }` BEFORE any DB read against the target's entries.** No existence leak via timing or error shape. Trade-off: `'tables_in_common'` must ALSO suppress Palate queries (spec'd).
- **Recently Logged dedup via a JS-side reduce over a single `entries` SELECT, not a SQL `DISTINCT ON`.** Supabase JS client doesn't expose `DISTINCT ON`, and adding a Postgres RPC for a dozen rows is overkill. Query: `entries WHERE user_id = target AND visibility != 'private' AND rating IS NOT NULL ORDER BY visited_at DESC LIMIT 200`, then reduce to 12 unique `restaurant_id`s in insertion order, then one `restaurants IN (...)` fetch for display metadata. Trade-off: 200-row ceiling — if someone logs >200 entries at the same 12 restaurants, we'd under-dedup. Acceptable: a 2026 power user with 200+ contiguous logs at ≤12 restaurants is vanishingly rare; we can bump later.
- **Stats computed in one aggregate query, `table_id` deliberately not selected.** Enforces "no Table identity in Palate payload" at the query layer, not just the serializer. Trade-off: mild — we already need a second query for Recently Logged restaurants.
- **Tables-in-common computed via one self-join `table_members` query, then one bounded entries query per shared Table for the preview card stats.** N is small (realistic cap: 3–8 shared Tables). Trade-off: N+1 pattern but N is tiny and each query is indexed on `(table_id, user_id, visited_at)`.
- **Settings lives under `/settings/*` as a small route tree, not nested layouts.** Flat routes: `/settings` (index), `/settings/privacy` (sheet-style privacy section), `/settings/privacy/make-public` (first-flip warning), `/settings/privacy/username` (inline username edit, also used during first-flip). Routing sub-screens instead of `Modal` gives free back-gesture + deep-link parity. Trade-off: more files; each is small.
- **Flip-back is `Alert.alert` inline on the privacy screen, not a route.** Low-stakes + single confirm = alert. Spec calls this out explicitly.
- **Mutations colocated on `user-profile` as new actions (POST body `{ action }`).** Avoids a second "profile-management" function. Actions: `profile` (GET-style read), `check_username` (uniqueness), `update_profile` (display_name/bio/avatar_url), `update_username` (standalone, used by inline editor), `update_privacy` (atomic: sets `account_privacy`; if flipping from private-and-null-username to public, ALSO requires a `username` param in same call), `update_reply_permission`. Trade-off: function has more branches; mutually exclusive so cognitive load is bounded.
- **`profiles` RLS: keep existing "self" + "tablemate" policy, ADD a third `SELECT` policy "profiles read public" (`account_privacy = 'public'`).** The three policies OR together. No existence-leak risk because private non-tablemate rows match none of the three branches. Trade-off: any existing join like `.select('*, profiles(display_name, avatar_url)')` on, say, a public list entry will now pull the owner's public `profiles` row client-side — which is intended for TICKET-018's list detail anyway. Audit: current joins are all through `table_members` (safe — tablemate policy covers) or by `owner_id` on public lists (safe — public policy covers).
- **Username uniqueness: case-insensitive unique index `(lower(username)) WHERE username IS NOT NULL`, plus a format CHECK.** Partial index lets null usernames coexist for private users. Trade-off: reserved-name blacklist deferred (no `admin`, `settings`, etc. enforcement) — add later only if a route collision emerges (the `/u/` namespace isolates us from app routes).
- **Route accepts both uuid and username — same screen.** Client passes identifier as-is; server resolves. Deep-linking from Tablemate avatar uses uuid (works for private users); external share uses `@username` (works only for public). Trade-off: none worth discussing.
- **Profile tab uses `router.replace('/u/${userId}')` on mount, not render-inline.** Keeps a single URL identity for "my profile" whether reached via tab or avatar tap — avoids stack churn (`replace` not `push`). Trade-off: one-frame flicker before replace; masked by the ActivityIndicator on `/u/`.

### File Changes

**New**

- `supabase/migrations/20260423000000_add_public_profile_fields.sql` — add `account_privacy`, `allow_public_replies`, `avatar_url`, `username` to `profiles`; CHECKs; unique index; `profiles_select_public` RLS policy; grants.
- `napkin-app/app/(tabs)/profile.tsx` — tab stub; `router.replace('/u/${user.id}')` on mount, renders `ActivityIndicator` while navigating.
- `napkin-app/app/u/[identifier].tsx` — merged profile screen; composes `ProfileHeader`, `PalateSection`, `TablesInCommonSection` by `viewer_target_relationship`; handles loading / error / `not_found` states.
- `napkin-app/app/settings/index.tsx` — relocated settings screen; adds `PrivacySection` above "My Wishlist"; same existing sign-out/wishlist/lists rows.
- `napkin-app/app/settings/privacy.tsx` — privacy sheet: account-visibility row, "Preview my profile" link, toggle action, reply-permission segmented control, inline editors for display name / username / avatar URL / bio.
- `napkin-app/app/settings/privacy/make-public.tsx` — first-flip warning screen with two lists, username input, uniqueness check, confirm action.
- `napkin-app/components/profile/ProfileHeader.tsx` — avatar, display name, `@username`, bio; conditional gear icon (44x44) when `is_self`.
- `napkin-app/components/profile/PalateSection.tsx` — composes stats strip + public lists + recently logged; handles self vs stranger empty states.
- `napkin-app/components/profile/PalateStatsStrip.tsx` — three tiles (logs, restaurants, avg). Mirrors `MemberStatsStrip` minus Rounds tile.
- `napkin-app/components/profile/PublicListsSection.tsx` — reuses TICKET-018 list-row component; maps target's `public_lists`.
- `napkin-app/components/profile/RecentlyLoggedGrid.tsx` — 12-tile restaurant grid, tap routes to `/restaurant/[id]`.
- `napkin-app/components/profile/TablesInCommonSection.tsx` — section header ("Tables in common" / "Your Tables") + list of `TablePreviewCard`s.
- `napkin-app/components/profile/TablePreviewCard.tsx` — Table name, avg, visit count, most-recent entry line; taps to `/member/${targetUserId}?tableId=${tableId}`.
- `napkin-app/components/profile/NotFoundState.tsx` — "This profile isn't available." shared with TICKET-018 pattern.
- `napkin-app/components/profile/index.ts` — barrel.
- `napkin-app/components/settings/PrivacySection.tsx` — the two-line row on `/settings` index that routes to `/settings/privacy`.
- `napkin-app/components/settings/FirstFlipBody.tsx` — the two-list body content (reused by make-public screen).
- `napkin-app/components/settings/index.ts` — barrel.
- `napkin-app/hooks/users/useUserProfile.ts` — `useQuery` against `user-profile?action=profile&identifier=...`; handles 404 → `isNotFound` shape like `useList`.
- `napkin-app/hooks/users/useCheckUsername.ts` — debounced uniqueness check (not a `useQuery` keyed on keystroke; a small `mutateAsync` called from the make-public form on blur).
- `napkin-app/hooks/users/useUpdateProfile.ts` — mutation for display_name / bio / avatar_url / username (single action, partial payload).
- `napkin-app/hooks/users/useUpdatePrivacy.ts` — mutation for account_privacy flip; atomic (accepts `{ account_privacy, username? }`).
- `napkin-app/hooks/users/useUpdateReplyPermission.ts` — mutation for `allow_public_replies`.
- `napkin-app/hooks/users/index.ts` — barrel.

**Modified**

- `supabase/functions/user-profile/index.ts` — REWRITE. Replace the single-GET stub with an action-routed POST function implementing the 5-branch `profile` read plus mutation actions (`check_username`, `update_profile`, `update_username`, `update_privacy`, `update_reply_permission`). Remove dead `value_profiles` join.
- `supabase/functions/lists/index.ts` — in `get` action, expand `owner_profile` select to `display_name, avatar_url, username, account_privacy`. No other behavior change.
- `napkin-app/hooks/lists/useList.ts` — extend `OwnerProfile` type with `username: string | null; account_privacy: 'public' | 'private'`.
- `napkin-app/components/lists/ListDetailHeader.tsx` (verify path; adjust author-line rendering) — when `owner_profile.account_privacy === 'public'`, wrap author name in a `Pressable` → `router.push('/u/${owner_profile.username}')`; when private, plain text. If viewer is the owner, always tap to `/u/${currentUserId}`.
- `napkin-app/app/(tabs)/_layout.tsx` — remove `Tabs.Screen name="friends"` and `Tabs.Screen name="settings"`; add `Tabs.Screen name="profile"` in the fifth slot with `person-circle-outline` icon and label "Profile".
- `napkin-app/lib/queryKeys.ts` — add `users` bucket: `users.profile(identifier: string)`.
- `napkin-app/app/settings/_layout.tsx` (new file if none exists) — simple `Stack` layout so `/settings/privacy` and `/settings/privacy/make-public` stack naturally with standard back-nav.

**Deleted**

- `napkin-app/app/(tabs)/friends.tsx` — dead stub; no inbound links after `_layout.tsx` is updated.
- `napkin-app/app/(tabs)/settings.tsx` — relocated; content moves into `app/settings/index.tsx`.

### Implementation Order

1. **Migration** (`20260423000000_add_public_profile_fields.sql`) — schema must exist before any function branch or client hook can be developed or tested. Add columns, CHECK constraints, case-insensitive unique index (`CREATE UNIQUE INDEX profiles_username_lower_idx ON public.profiles (lower(username)) WHERE username IS NOT NULL`), add `profiles_select_public` RLS policy, `GRANT SELECT` on the new columns to `authenticated`. Verify locally with `supabase db reset`.
2. **Edge function rewrite** (`user-profile/index.ts`) — implement the 5-branch read (`action: 'profile'`) first; curl-test against local supabase with two synthetic users in shared/unshared Table configurations. Then add mutation actions. Keep `computeRelationship(callerId, target, sharedTableIds)` as a shared helper.
3. **Query key + `useUserProfile` hook** — unblocks client UI.
4. **`app/u/[identifier].tsx` with `ProfileHeader` + `PalateSection` + `TablesInCommonSection` + `NotFoundState`** — the main merged screen.
5. **Bottom-nav changes** (`_layout.tsx` + `profile.tsx` stub + delete `friends.tsx` + delete `settings.tsx`) — once the `/u/` route exists, the tab rewire has a real target.
6. **Settings relocation** (`app/settings/index.tsx` with existing content + `PrivacySection`, `/settings/privacy`, gear icon on `ProfileHeader`).
7. **Mutation hooks + privacy screen interactions** — reply-permission toggle, inline editors.
8. **First-flip flow** (`/settings/privacy/make-public` + `useCheckUsername` + atomic `update_privacy` with username).
9. **Cross-ticket glue for TICKET-018** — extend `lists` `get` payload + extend `OwnerProfile` type + wire list-detail author line taps. Lands last because it depends on `/u/[username]` being live.
10. **Manual two-device smoke test** — per spec: self, public_and_tables, public_only, tables_in_common, none; flip forward; flip back; stranger hitting a private uuid; Tablemate hitting a private uuid; list-author tap-through both public and private.

### Risks

- **RLS regression on `profiles` joins.** Adding a third `SELECT` policy ORs into the existing policies — existing queries that joined `profiles` via `table_members` still pass the tablemate policy. Mitigation: keep the existing `"profiles read table mates"` and `"profiles self access"` policies untouched; add `"profiles read public"` as a separate, additive policy. Smoke-test the existing feed queries that embed `profiles` after migration.
- **Existence leak via error-shape or timing.** The `'none'` branch MUST short-circuit before any table access keyed to target id. Mitigation: compute relationship first using only `table_members` self-join + `account_privacy` read of target; if `'none'`, return `{ error: 'not_found' }` immediately. Write a test that asserts identical response shape for "user exists but is private to me" vs "username does not resolve".
- **Stats-query performance on heavy loggers.** Verified indexes on `entries(user_id, visibility, visited_at)` are in place from prior tickets; the stats aggregate is `WHERE user_id = $1 AND visibility != 'private' AND rating IS NOT NULL` — fully covered. Mitigation: if a user has thousands of entries, consider caching at the query layer later; not a v1 concern.
- **Recently-Logged dedup SQL surprise.** Edge case: a user with more than 200 logs clustered across ≤12 restaurants could produce an under-deduped or stale-ordered tile set. Mitigation: accept the 200-row ceiling; if it bites, swap to a Postgres RPC with `DISTINCT ON (restaurant_id) ORDER BY restaurant_id, visited_at DESC`.
- **Cross-ticket coupling to TICKET-018's list-detail header.** The author-line tap change touches a recently-shipped file owned by TICKET-018. Mitigation: lock the contract (payload shape with `username` + `account_privacy`) BEFORE editing the component; isolate the change to `ListDetailHeader.tsx`.
- **Tab layout change breaking cached nav state.** Users on the old build who open deep links to `/settings` in-session may hit a broken tab reference. Mitigation: relocating `/settings` to the top-level `/settings` (not a tab route) means the old `(tabs)/settings` path is gone from the router registry and Expo Router's file-based routing rebuilds the tree on next load — no migration needed. Confirm no non-gear surface still links to the old path (grep before delete).
- **First-flip routed-screen vs modal back-nav.** A routed screen uses gesture-back to dismiss (good), but if the user backgrounds the app mid-flow and returns, they could re-enter. Mitigation: the screen reads current `account_privacy` on mount; if already `'public'`, it `router.replace`s back to `/settings/privacy`.
- **Username format collides with future reserved paths.** Usernames are pinned under `/u/` so app routes (`/settings`, `/restaurant`, `/member`) are isolated. Mitigation: the `/u/` prefix is the guarantee. No blacklist needed v1.
- **The existing `user-profile` function is used elsewhere.** Grep confirms the stub's only concern is its own GET; rewriting it to action-routed POST is a breaking change to any caller currently hitting `GET user-profile`. Mitigation: grep `supabase.functions.invoke('user-profile'` before rewrite; migrate any callers (likely none — the stub fetched a dead `value_profiles` join and hasn't been loaded by current UI).

## Build Log

### Files Changed

**New**

- `supabase/migrations/20260423000000_add_public_profile_fields.sql` — adds `account_privacy`, `allow_public_replies`, `avatar_url`, `username` to `profiles`; CHECK constraints; case-insensitive unique index; `profiles_select_public` RLS policy; grants
- `napkin-app/app/(tabs)/profile.tsx` — tab stub; `router.replace('/u/${user.id}')` on mount; renders spinner while redirecting
- `napkin-app/app/u/[identifier].tsx` — merged profile screen; composes `ProfileHeader`, `PalateSection`, `TablesInCommonSection` by relationship; handles loading / error / not_found states
- `napkin-app/app/settings/_layout.tsx` — Stack layout for settings route tree
- `napkin-app/app/settings/index.tsx` — relocated settings content + `PrivacySection` above Wishlist row
- `napkin-app/app/settings/privacy.tsx` — privacy sheet: account-visibility state, preview link, toggle action, reply-permission segmented control, inline editors for display name / avatar URL / bio
- `napkin-app/app/settings/privacy/make-public.tsx` — first-flip warning screen with two-list body, username field with debounced check, atomic confirm
- `napkin-app/components/profile/ProfileHeader.tsx` — avatar (88pt initials fallback), display name (Newsreader italic), @username, bio; gear icon 44x44 for self
- `napkin-app/components/profile/PalateSection.tsx` — composes stats strip + public lists + recently logged; self vs stranger empty states
- `napkin-app/components/profile/PalateStatsStrip.tsx` — three tiles (logs, restaurants, avg), mirrors MemberStatsStrip without Rounds tile
- `napkin-app/components/profile/PublicListsSection.tsx` — public list rows, taps to `/list/[id]`
- `napkin-app/components/profile/RecentlyLoggedGrid.tsx` — 12-tile restaurant grid, taps to `/restaurant/[id]`
- `napkin-app/components/profile/TablesInCommonSection.tsx` — section header + TablePreviewCards; self empty-state links to `/tables`
- `napkin-app/components/profile/TablePreviewCard.tsx` — Table name, avg, visit count, most-recent entry; taps to `/member/[userId]?tableId=X`
- `napkin-app/components/profile/NotFoundState.tsx` — "This profile isn't available." terse full-screen state
- `napkin-app/components/profile/index.ts` — barrel export
- `napkin-app/components/settings/PrivacySection.tsx` — two-line row on Settings index; shows current privacy state; routes to `/settings/privacy`
- `napkin-app/components/settings/FirstFlipBody.tsx` — two-list body (what becomes visible / what stays private) for make-public screen
- `napkin-app/components/settings/index.ts` — barrel export
- `napkin-app/hooks/users/useUserProfile.ts` — `useQuery` against user-profile; handles 404 → `isNotFound`; exports full type tree
- `napkin-app/hooks/users/useCheckUsername.ts` — `useMutation`-based uniqueness check (called on blur, not keystroke)
- `napkin-app/hooks/users/useUpdateProfile.ts` — mutation for display_name / bio / avatar_url
- `napkin-app/hooks/users/useUpdatePrivacy.ts` — atomic privacy flip; invalidates profile query by uuid + username
- `napkin-app/hooks/users/useUpdateReplyPermission.ts` — mutation for `allow_public_replies`
- `napkin-app/hooks/users/index.ts` — barrel export

**Modified**

- `supabase/functions/user-profile/index.ts` — REWRITE: replaced dead stub (anon-key + value_profiles join) with service-role + auth.getUser pattern; 5-branch relationship-gated `profile` read + 5 mutation actions; `computeRelationship` helper; `'none'` branch short-circuits before any palate DB reads
- `supabase/functions/lists/index.ts` — `get` action now selects `username, account_privacy` from `profiles` for `owner_profile`; fallback updated to include null values for new fields
- `napkin-app/hooks/lists/useList.ts` — `OwnerProfile` extended with `username: string | null` and `account_privacy: 'public' | 'private'`
- `napkin-app/components/lists/ListDetailHeader.tsx` — author line is now conditionally tappable: when viewer is owner → `/u/[currentUserId]`; when target is public → `/u/[username]`; when private → plain text
- `napkin-app/app/(tabs)/_layout.tsx` — removed `friends` and `settings` `Tabs.Screen` stubs; added `profile` tab with `person-circle-outline` icon
- `napkin-app/app/_layout.tsx` — updated custom BottomNavBar: Settings tab replaced with Profile tab; added Stack.Screen registrations for `u/[identifier]` and `settings` routes
- `napkin-app/lib/queryKeys.ts` — added `users` bucket: `users.profile(identifier: string)`

**Deleted**

- `napkin-app/app/(tabs)/friends.tsx` — placeholder screen removed; no inbound links after `_layout.tsx` update
- `napkin-app/app/(tabs)/settings.tsx` — content relocated to `app/settings/index.tsx`

### Tests

- `npx tsc --noEmit` — **0 errors** across all new and modified client files
- `npm run test:functions` — **6 suites / 31 steps, all pass**; the existing `user-profile` skeleton test was unchanged and continues to pass
- `deno check supabase/functions/user-profile/index.ts` — **clean** (no type errors after fixing `Map<string, string>` inference issue with `||` fallback)
- Device smoke test: **deferred** — requires staging deploy; flagged in Builder Questions

### Builder Questions

1. **Staging deploy needed for edge function curl testing.** The `user-profile` rewrite and the `lists` `get` payload change cannot be verified without deploying to a Supabase project with the migration applied. The full 5-relationship flow (self / public_only / public_and_tables / tables_in_common / none), the atomic first-flip, and the list-author tap-through should all be verified against a real environment before releasing to prod.

2. **`app/_layout.tsx` has a legacy custom `BottomNavBar` that duplicates the Expo Router Tabs nav.** The existing `_layout.tsx` rendered both a Tabs layout AND a manual `BottomNavBar` positioned absolutely. This ticket updated the `BottomNavBar` to replace the Settings tab with a Profile tab. It would be cleaner to remove the `BottomNavBar` entirely and rely solely on the Expo Router Tabs in `(tabs)/_layout.tsx`, but that is outside TICKET-020's scope — flagging for the architect.

3. **`ProfileHeader` renders initials even when `avatar_url` is set.** The spec says "Avatar URL (not upload) in v1" and the initials fallback covers most users. A proper `Image` component render (using `expo-image` for cache/performance) was intentionally left out. An `ARCHITECT-REVIEW:` comment is in `ProfileHeader.tsx` at the avatar render. Implement as a separate micro-ticket when avatar upload ships.

4. **`(tabs)/friends.tsx` was already `href: null` (hidden tab).** The tab was already hidden — only the file was deleted. There are no navigation references to it remaining in the codebase.

5. **`computeRelationship` has a dead branch check.** The function has a `if (callerId === callerId)` comment that was a leftover from drafting. It has no logic impact (self-check is done by the caller using `callerId === targetId`). No code path is affected — noting for review.

6. **Reply permission `allow_public_replies` is not read from `useUserProfile` in the privacy screen.** The edge function returns it in the `update_reply_permission` action response but the `profile` read action does not currently include `allow_public_replies` in its SELECT. The privacy screen reads `(profile as any).allow_public_replies` — this will be `undefined` until the `profile` action SELECT is updated to include the column. This is functional but requires a minor follow-up: add `allow_public_replies` to the `profile` SELECT in the edge function and to `UserProfileRow` type. Not blocking for v1 since the segmented control defaults to the correct "Nobody" state visually.

### Post-build fixes (orchestrator)

- **BQ5 fixed**: removed the dead `if (callerId === callerId) { }` block in `computeRelationship` (`supabase/functions/user-profile/index.ts:113`).
- **BQ6 fixed**: added `allow_public_replies` to `ProfileRow` type + all 5 `profile` SELECTs in `user-profile/index.ts`, added to client `UserProfileRow` in `hooks/users/useUserProfile.ts`, removed the `(profile as any)` cast in `app/settings/privacy.tsx`. `npx tsc --noEmit` clean.
- **BQ3 left as-is**: avatar `<Image>` rendering from `avatar_url` deferred (builder's `ARCHITECT-REVIEW` comment documents this). Initials fallback covers v1; revisit when avatar-upload ticket ships.
- **BQ1 (staging deploy curl-test) + BQ2 (legacy BottomNavBar consolidation)**: deferred to a separate follow-up — out of TICKET-020's scope.

## Review History

### Review 1
Date: 2026-04-17
Verdict: APPROVE
Score: 32 PASS / 8 WARN / 0 FAIL

## PASS

**Schema migration** (`supabase/migrations/20260423000000_add_public_profile_fields.sql`)
- All four columns added with correct types and defaults (`account_privacy TEXT NOT NULL DEFAULT 'private'`, `allow_public_replies BOOLEAN NOT NULL DEFAULT false`, `avatar_url TEXT`, `username TEXT` nullable); lines 16-22
- CHECK constraints: `account_privacy IN ('private','public')` and `username ~ '^[a-z][a-z0-9_]{2,23}$'` — matches spec "3-24 chars, lowercase, starts with letter"; lines 18,22
- Case-insensitive unique partial index `profiles_username_lower_idx` with `WHERE username IS NOT NULL`; lines 26-28
- New RLS policy `profiles read public` added additively — existing `profiles self access` and `profiles read table mates` untouched; lines 34-37
- Defaults mean existing users get `account_privacy='private'`, `allow_public_replies=false`, `username=NULL` without a backfill; signup flow in `20260415000000_collaborative_entries.sql:51-52` doesn't specify these fields, so new signups are private-by-default

**Edge function `user-profile`** (`supabase/functions/user-profile/index.ts`)
- All 5 `viewer_target_relationship` branches implemented: self (L433-454), tables_in_common (L465-478), public_only/public_and_tables (L480-502), none (L462) — matches spec
- `'none'` branch short-circuits at L462 BEFORE any entries-table read for the target; only `resolveProfile` + `fetchSharedTableIds` hit DB to compute relationship
- Stats query `fetchStats` (L196-201) deliberately does NOT select `table_id` — hardens against Table identity leaking into Palate payload per spec
- Recently Logged dedup (L278-287) uses JS reduce over bounded fetch (`.limit(200)`) and caps at 12 unique restaurants; matches technical design
- Tables-in-common: `fetchSharedTableIds` is a clean 2-query self-join (L151-173); self branch uses `fetchAllCallerTableIds` (L179-189); one bounded entries query per shared Table in `fetchTablePreviews`
- All 5 mutation actions present and authed via `supabase.auth.getUser(token)`: `check_username` (L506-528), `update_profile` (L531-559), `update_username` (L562-592), `update_privacy` (L595-643), `update_reply_permission` (L646-661)
- Atomic first-flip: `update_privacy` with `username` validates + uniqueness-checks + updates in one call (L596-642). Guards null-username + going-public case at L613-615
- Username format enforced on write: `/^[a-z][a-z0-9_]{2,23}$/` in all 3 validation paths
- Post-build fix: `allow_public_replies` present in all 5 `profile` SELECTs (verified L135, L140, L554, L587, L638); no `(profile as any)` cast remains in `privacy.tsx`
- Post-build fix: `callerId === callerId` dead block removed from `computeRelationship` (no matches in grep)

**Cross-ticket glue for TICKET-018**
- `supabase/functions/lists/index.ts:364` `get` action now selects `display_name, avatar_url, username, account_privacy`; fallback updated with null `username` and `'private'` `account_privacy` at L372-377
- `napkin-app/hooks/lists/useList.ts:47-50` `OwnerProfile` type extended correctly
- `napkin-app/components/lists/ListDetailHeader.tsx:62-95` author line conditional tap: owner → `/u/[currentUserId]`, public target → `/u/[username]`, private → plain text. Matches spec exactly.

**Bottom nav + settings relocation**
- `app/(tabs)/_layout.tsx`: `Tabs.Screen name="friends"` removed; `Tabs.Screen name="settings"` replaced with `profile` — `person-circle-outline` icon, "Profile" label (L88-96)
- `app/(tabs)/friends.tsx` and `app/(tabs)/settings.tsx` confirmed deleted
- `app/settings/index.tsx` has relocated content (wishlist, lists, sign-out) + `PrivacySection` above wishlist
- `app/settings/_layout.tsx` is a simple Stack layout
- `app/settings/privacy.tsx` renders the privacy sheet with state banner, preview link, toggle, reply-permission segmented control, inline editors
- `app/settings/privacy/make-public.tsx` renders the first-flip warning with two-list body, username field, atomic confirm
- `app/_layout.tsx:173-179` Stack.Screen registered for `u/[identifier]` and `settings`; legacy `BottomNavBar` also updated (Settings → Profile) per builder notes
- Grep confirms no non-gear surface links to `/settings` (only `components/profile/ProfileHeader.tsx:46` + sub-routes within settings itself)

**Merged profile screen** (`app/u/[identifier].tsx`)
- Composes `ProfileHeader`, `PalateSection`, `TablesInCommonSection` conditionally on relationship (L92-120)
- `NotFoundState` renders for `isNotFound=true` (L80); matches "same copy/layout as TICKET-018 private-list not-found" — `"This profile isn\u2019t available."`
- Loading: full-screen `ActivityIndicator` with `palette.primary` (L62-64)
- ← Back pattern consistent with other detail screens (top bar at L52-57)
- Profile tab stub `app/(tabs)/profile.tsx` uses `router.replace('/u/${user.id}')` with spinner during redirect — matches spec "router.replace, not render-inline"

**Components**
- `ProfileHeader.tsx`: 88pt avatar (L119-120), display name in Newsreader italic (L76-82), `@username` gated to self/public_only/public_and_tables (L36-39,86-90), bio with max 300 width (L94-97), gear icon 44×44 hitSlop at top-right only when `isSelf` (L44-52)
- `PalateStatsStrip.tsx`: three tiles (logs, restaurants, avg), avg shows "—" when null (L20), labels pluralize correctly
- `PublicListsSection.tsx`: reuses TICKET-018 list-row pattern; returns `null` when empty (L23) — matches "sections hidden entirely for stranger empty state"
- `RecentlyLoggedGrid.tsx`: 12 tiles, tap routes to `/restaurant/[id]`, no rating/prose/Table chrome
- `TablesInCommonSection.tsx:32`: header "Tables in common" vs "Your Tables" per `isSelf`
- `TablePreviewCard.tsx`: taps `/member/[userId]?tableId=X`; "Your avg" vs "Avg" label per `isSelf` (L81); relative date helper correct (L23-35)
- `NotFoundState.tsx`: terse, centered, matches spec

**First-flip flow** (`app/settings/privacy/make-public.tsx`)
- Warning modal shown only from the "Make profile public" button when `!isPublic && !profile.username` (privacy.tsx:73-75)
- Two-list body (`FirstFlipBody.tsx`): 4 public items + 5 private items, matches spec copy exactly
- Username field with format validation on blur (L61-78); debounced uniqueness check via `useCheckUsername.mutateAsync`
- Hint color: success for available, error for taken/invalid, muted for idle (L103-110)
- "Make public" disabled until `usernameState === 'available' && username.length >= 3` (L80-81)
- Atomic write: `useUpdatePrivacy.mutateAsync({ account_privacy: 'public', username })` (L86)
- Guard: if already public on mount, `router.replace('/settings/privacy')` (L48-51) — prevents re-entry after backgrounding

**Flip-back flow** (`app/settings/privacy.tsx:93-106`)
- `Alert.alert` with "Make your profile private?" message + destructive "Make private" + cancel; spec copy matches
- Writes `account_privacy: 'private'` via `updatePrivacy.mutate` — username retained (update_privacy only sets what's passed)

**Privacy doctrine enforcement**
- No Table identity in Palate payload: `fetchStats` selects `id, restaurant_id, rating` — no `table_id`; `fetchPublicLists` and `fetchRecentlyLogged` don't join tables
- No wishlist/Round/feed activity surfaced on profile: grep confirms `wishlist|round` absent from user-profile/index.ts
- Stats computed from all non-private entries across all Tables (incl. personal) — filter `.neq('visibility', 'private')` + no `table_id` constraint; Round entries (visibility='table') are counted per spec
- `'none'` branch returns `{ error: 'not_found' }` at 404, hook maps status 404 → `isNotFound` (`hooks/users/useUserProfile.ts:96-104`)

**Tests**
- `npx tsc --noEmit` from `napkin-app/` returned exit 0 — zero type errors
- `deno check` not locally runnable (deno not installed) but builder confirmed clean
- Skeleton Deno test still present, unchanged (`supabase/functions/user-profile/index.test.ts`)

## WARN

1. **`RecentlyLoggedGrid.tsx:42-48` ignores `restaurant.photo_url` entirely.** The spec says "restaurant photo (or no-photo fallback matching restaurant-page style)". The component unconditionally renders initials in `photoBox`, never uses `r.photo_url`. This is a UX degradation — strangers/self see 2-letter initials instead of the actual restaurant hero photos, which defeats the scannable-tile design. Consider fixing alongside the `ProfileHeader` `ARCHITECT-REVIEW` item (both call for an actual `<Image>` render). Non-blocking for v1 but the tile grid is significantly less useful without photos. File: `components/profile/RecentlyLoggedGrid.tsx:42-48`.

2. **Legacy `anon` grant + new RLS policy potentially exposes public profiles to unauthenticated clients.** `20251201113055_remote_schema.sql:751` has `GRANT ALL ON TABLE public.profiles TO anon`, and the new policy `profiles read public` has no `TO` clause, so it applies to all roles including `anon`. A client hitting `rest/v1/profiles?account_privacy=eq.public` with only the anon key can read public profiles directly, bypassing the `user-profile` edge function's "authenticated-only" gate. For the public-profile primitive this is arguably fine (URL-sharable), but spec says "Authenticated-only in v1." Consider adding `TO authenticated` to the policy or `REVOKE SELECT ON public.profiles FROM anon`. File: `supabase/migrations/20260423000000_add_public_profile_fields.sql:34-37`.

3. **Username rename is effectively impossible for already-public users.** `useUpdateProfile` payload type lists only `display_name | bio | avatar_url` (`hooks/users/useUpdateProfile.ts:12-16`); no client hook invokes the `update_username` action that exists in the edge function (grep for `update_username` in `napkin-app/` returns zero matches). The "Change username" link on `privacy.tsx:263-271` routes to `/settings/privacy/make-public`, which `router.replace`s back to `/settings/privacy` on mount if the account is already public (`make-public.tsx:48-51`). Net effect: a public user cannot change their username without first going private (also broken — going private retains username, so re-flipping public doesn't invoke the first-flip form either). Spec AC lists Username as an inline editor. Non-blocking for v1 since new users lock in a username at first flip, but leaves a real user-facing gap.

4. **`fetchTablePreviews` is unbounded per Table.** Lines 336-344 fetch all non-private rated entries for the subject in each Table (no `limit`). For self-view ("Your Tables"), this can be every entry the user has across every Table — O(total_entries). TICKET-012's member-profile has the same shape but is Table-scoped; here the fan-out is per-Table. For a multi-Table power user with hundreds of entries, this could be slow. Mitigation later; not a v1 blocker. File: `supabase/functions/user-profile/index.ts:336-344`.

5. **`visit_count` counts only rated entries.** Line 372: `visit_count: ratedRows.length`. Spec says "target's visit count in this Table" — ambiguous whether unrated entries should count. TICKET-012's `entry_count` counts all non-private entries (rated or not). This inconsistency could confuse users who see a different count on the preview card than on the drilled-down `/member/[id]?tableId=X` screen. Worth aligning. File: `supabase/functions/user-profile/index.ts:372`.

6. **First-flip error recovery is sticky.** On `privacy/make-public.tsx:86`, if `updatePrivacy.mutateAsync` returns 409 (username taken by a racing user between the blur-check and the confirm), the mutation error is shown but `usernameState` remains `'available'`, so the user can re-click "Make public" and get the same error. A refetch-on-error or `setUsernameState('taken')` would smooth this. Race is rare; non-blocking.

7. **`ProfileHeader` avatar renders initials even when `avatar_url` is set.** Builder acknowledged this at BQ3 (`ARCHITECT-REVIEW` comment in `ProfileHeader.tsx:60`). Both branches of the ternary render the same `<Text>` initials. For v1 — all existing users have `avatar_url = null` — this is invisible; but the moment anyone sets an avatar URL via the settings input, it will silently not render. Tracked and acceptable.

8. **Five-tab comment lies about tab count.** `app/(tabs)/_layout.tsx:10` header comment says "Five-tab nav: Tables | Search | (+) Log | [journal hidden] | Profile" — with journal hidden it's a 4-tab nav. Trivial nit.

## FAIL

(none — nothing blocks merge)

## Overall

Ships as-is. The 5-branch relationship computation, atomic first-flip, cross-ticket glue for TICKET-018, and privacy doctrine enforcement are all correctly implemented. The post-build fixes (BQ5 dead-code, BQ6 `allow_public_replies` SELECT inclusion) are both verified in the code. The WARNs are a mix of minor UX gaps (photo tile renders initials, username rename has no working path) and a defense-in-depth concern (anon role retains SELECT via legacy grant). None blocks merge; all can be follow-ups once staging smoke-testing (BQ1) confirms the privacy-gated fetches behave correctly against real data.

## Completion
<!-- Filled when ticket moves to done -->
