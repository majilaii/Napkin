---
id: TICKET-006c
title: "Realtime Presence & Activity (Phase 3 of Live Round Experience)"
priority: medium
status: ready
created: 2026-04-16
updated: 2026-04-16
tags: [tables, rounds, realtime, ux]
---

# Realtime Presence & Activity (Phase 3 of Live Round Experience)

## Problem
Right now a Round feels like filling out a form in isolation. You submit your rating, wait, reveal. There's no *energy*. You can't see that Elena is currently typing her notes, that Marcus just uploaded a photo, that the group is vibing. The round is a silent waiting room.

The dream: a Round feels like a **live shared document** — Figma-style multiplayer cursors but for dining. You see who's online, who's actively voting, who just uploaded a photo. The round buzzes with life.

## Notes
- Supabase Realtime already used for round status transitions (`useTableNightRealtime` subscribes to `table_nights` and `table_night_participants` changes)
- This phase adds **Presence** (Supabase Realtime Presence API) — a separate channel concept from DB change subscriptions
- Presence gives us: who's currently viewing the round screen, typing indicators, upload activity
- Activity feed within the round: "Marcus added a photo", "Elena is writing notes...", "Jacky marked ready"

### Inspiration
- Figma multiplayer cursors / "who's viewing" avatars
- Google Docs "N people viewing" + typing indicators
- iMessage typing bubbles
- Notion live collaboration indicators

### Dependencies
- TICKET-006 (Phase 1) — multi-photo infrastructure ✅ DONE
- TICKET-006b (Phase 2) — shared photo pool (nice to have, not blocking)

### Key decisions to make in spec phase
1. **Presence channel architecture**: One Supabase Presence channel per active round (`round:{nightId}`). Each participant tracks state: `{ userId, status: 'viewing' | 'rating' | 'uploading' | 'ready', lastActive }`.
2. **UI treatment**: Avatar row at top of round screen with colored ring/pulse indicating activity state? Or a live activity log?
3. **Typing/activity indicators**: How granular? "Elena is rating..." vs "Elena is writing notes..." vs just "Elena is active"? Simpler is better for V1.
4. **Battery/performance**: Presence heartbeats every 10-15s. Unsubscribe when app backgrounds. Don't over-poll.
5. **Stale presence cleanup**: Supabase handles presence leave on disconnect, but app crash / force-quit may leave ghost presence. Presence has built-in TTL — verify it works.
6. **"Just uploaded a photo" toasts**: When another participant uploads a photo during the round, show a subtle toast/banner? Or just update their avatar indicator?

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec
<!-- Filled by product-designer agent when ticket moves to 'ready' -->

### User Stories
- As a round participant, I want to see who else is currently on the round screen, so the experience feels live and shared rather than isolated.
- As a round participant, I want to see what others are doing (rating, uploading a photo, already locked in), so I feel the momentum of the group and know the round is progressing.
- As a round host, I want to see at a glance how many people are present and who still needs to act, so I can decide when to nudge or reveal.
- As a round participant, I want to be notified when someone uploads a photo or locks in their vote, so I feel the energy of the table even though we are all on our own phones.
- As a round participant, I want my presence to disappear when I leave the screen or background the app, so others get an accurate picture of who is actually here.

### Acceptance Criteria

**Presence tracking**
- [ ] When a user opens the round screen, they join a Supabase Presence channel scoped to that round (`round-presence:{nightId}`). This is a separate channel subscription from the existing DB-changes channel.
- [ ] Each participant's presence payload includes: `userId`, `displayName`, `status` (one of `viewing`, `rating`, `uploading`, `ready`), and `lastActive` (ISO timestamp).
- [ ] Status updates to `rating` when the user interacts with the star slider or category sliders. Status updates to `uploading` while any photo slot is in the `uploading: true` state. Status returns to `viewing` after 5 seconds of inactivity on sliders. Status becomes `ready` when the user locks in.
- [ ] Heartbeat interval is 10 seconds (Supabase Presence default). No custom polling added on top.
- [ ] When the app is backgrounded (AppState changes to `background` or `inactive`), the user unsubscribes from the presence channel. When foregrounded, they re-subscribe and re-track.
- [ ] When a user navigates away from the round screen, the presence channel is cleaned up via the hook's effect cleanup.

**Presence indicators on round screen**
- [ ] A horizontal "presence row" appears below the hero and above the voting card (or above "The Table's Verdict" section). It shows one avatar circle per table member who has been invited/joined the round, regardless of whether they are currently present.
- [ ] Online participants (present in the channel) show a colored ring around their avatar: amber (`palette.tertiary`) when `rating` or `uploading`, olive green (`palette.success`) when `viewing`, and a solid terracotta (`palette.primary`) ring when `ready`. The ring pulses gently (reusing the `PulseDot` animation pattern) for `rating` and `uploading` states.
- [ ] Offline participants (not present in the channel and not yet `ready` in the DB) show a dimmed avatar with no ring, matching the current `opacity: 0.5` treatment on VoterCard.
- [ ] A small count label below the row reads "X of Y here" using Manrope (`Type.labelSmall`, `palette.textSecondary`).

**Activity toasts**
- [ ] When another participant locks in (detected via DB change subscription: `ready` transitions from `false` to `true`), a subtle toast appears at the top of the screen: "[Name] locked in". Toast auto-dismisses after 3 seconds. (Photos are submitted atomically with lock-in, so no separate photo toast is needed in V1.)
- [ ] Toasts stack if multiple arrive within the 3-second window (max 2 visible; older ones dismiss to make room).
- [ ] Toasts use the existing card aesthetic: `palette.surfaceContainerLow` background, ambient shadow, `Radius.sm`, Manrope text. They slide in from the top with a spring animation.
- [ ] No toast is shown for your own actions.

**Edge cases**
- [ ] If a user force-quits the app, Supabase's built-in presence TTL removes them. No ghost cleanup logic needed in V1.
- [ ] If only one person is in the round, the presence row still renders (showing just their avatar) but no toasts fire.
- [ ] The presence row does not appear after reveal -- once the round is revealed, presence is irrelevant and the screen should focus on results.

### UX Decisions
- **Presence row placement: below hero, above voting card** because this is the natural "status bar" position. Placing it inside the hero would fight with the restaurant name; placing it lower would bury it under the fold. The row is compact (avatar circles + count label) and does not add significant scroll height.
- **Colored ring on avatar, not a separate indicator** because it communicates state without adding extra UI elements. The ring color maps to activity semantics the user already understands from the PulseDot on the "Voting Live" badge.
- **Three activity states (viewing/rating/uploading) plus ready, not more granular** because distinguishing "adjusting vibe slider" from "adjusting flavor slider" or "writing notes" adds complexity without meaningful user benefit. The point is to convey "they are actively engaged" vs "they have the screen open" vs "they are done."
- **Toasts rather than a scrolling activity log** because the round screen is already dense with the voting card and verdict section. A persistent activity log would compete for attention. Toasts are ephemeral and match the "moment in time" nature of a live round. A persistent log can be revisited in a future version if demand exists.
- **Separate Presence channel from existing DB-changes channel** because Supabase Presence and postgres_changes are different subscription types. The existing `table-night:{nightId}` channel handles data invalidation; the new `round-presence:{nightId}` channel handles ephemeral who-is-here state. Keeping them separate avoids coupling lifecycle management.
- **Unsubscribe on background, not just stop tracking** because presence heartbeats consume battery and network. A user who backgrounds the app mid-round should disappear from the presence list rather than appear as a ghost. Re-subscribing on foreground is cheap.
- **5-second inactivity timeout before reverting to "viewing"** because slider interactions fire rapidly, and we do not want the status to flicker between `rating` and `viewing` on every pause between slider drags. Five seconds is long enough to cover a thoughtful pause but short enough that stale "rating" status clears promptly.

### Out of Scope
- Typing indicators for notes (too granular for V1; notes are a minor field)
- Cursor-style indicators showing where someone is on the screen (Figma-style -- aspirational but not V1)
- Push notifications for presence events (this is all in-app, on-screen only)
- Persisting presence/activity history after the round ends
- "Nudge" or "poke" feature to prompt absent participants
- Presence on any screen other than the active round screen (no presence in the table feed, table detail, etc.)
- Sound effects or haptics on toast events

### Open Questions
- **Toast for photo uploads -- DB change or Presence?** The spec currently proposes detecting photo additions via the existing DB-change subscription (photo_urls array length change on `table_night_participants`). An alternative is to broadcast a custom event on the Presence channel when a photo upload completes. The DB-change approach is simpler and already wired, but has slightly higher latency. Is the latency acceptable, or should we add a custom broadcast?
- **Should the presence row show ALL table members or only those who have joined the round?** Currently, not all table members necessarily join every round. Showing all members could create social pressure ("Marcus hasn't joined yet"), which could be good (encouraging participation) or bad (guilt-inducing). The spec currently says "table members who have been invited/joined" -- but the data model may not track "invited." Should we scope it to only participants who have a row in `table_night_participants`, or show all table members?

---

## Technical Design
<!-- Filled by architect agent -->

### Approach

Add a Supabase Presence channel alongside the existing DB-change realtime channel to give round participants live awareness of who is on the screen and what they are doing. A new `usePresence` hook manages the presence lifecycle (track/untrack on mount/unmount, AppState-aware subscribe/unsubscribe, debounced status updates). A `PresenceRow` component renders avatar circles with colored activity rings below the hero section. An `ActivityToast` component renders ephemeral slide-in notifications for lock-in events and photo additions detected through the existing `table_night_participants` DB-change subscription. The existing `useTableNightRealtime` hook is extended with a callback to surface participant-level change payloads (ready transitions and entry_photos inserts) so the toast system can react without a second subscription.

### Architecture Decisions

- **Separate Presence channel from the existing DB-changes channel**: `round-presence:{nightId}` (Presence) vs `table-night:{nightId}` (postgres_changes). These are different Supabase Realtime subscription types with different lifecycle semantics. Presence tracks ephemeral who-is-here state and dies with the connection; DB changes track durable data mutations. Coupling them into one channel would mean unsubscribing from Presence (on app background) also kills data invalidation, which would break cache freshness for users who background and return. Trade-off: two channel subscriptions per round participant instead of one; this is negligible at Napkin's group sizes (2-8 people).

- **Detect photo additions from the existing `table_night_participants` DB-change subscription, not from `entry_photos`**: The product spec says to detect photo_urls array length increases on `table_night_participants`, but that column does not exist. Photos are stored as `entry_photos` rows created atomically with the `rate` action (which also sets `ready: true`). Rather than adding a new realtime subscription to `entry_photos`, we detect the photo event indirectly: when the DB-change callback fires for a `table_night_participants` UPDATE where `ready` transitions from `false` to `true`, we re-fetch the night status (already happening via query invalidation) and check whether the newly ready participant's entry has photos by looking at the refreshed data. In practice, since photos and lock-in happen atomically in one edge function call, the toast becomes "[Name] locked in" for no-photo submissions and "[Name] locked in with photos" when entry_photos exist. This avoids adding a subscription to a table (`entry_photos`) that is not filtered by `table_night_id` and would require a join to determine relevance. Trade-off: no real-time "uploading a photo right now" toast -- but the Presence status ring already shows `uploading` state for that.

- **Presence row shows only `table_night_participants` rows, not all table members**: Per the resolved open question. The hook filters the presence state against the participants array from `useTableNightStatus`. Participants who have a row in `table_night_participants` but are not currently present in the channel render as dimmed avatars. This avoids social pressure on non-participants and keeps the data model simple (no "invited" concept needed). Trade-off: users who haven't joined the round yet are invisible, so the host cannot see "3 of 6 table members are here."

- **Debounced status updates with 5-second inactivity revert**: Slider `onValueChange` fires on every drag frame. We use a `useRef` timer that resets on each interaction. When the timer fires (5s after last interaction), status reverts to `viewing`. The `track()` call is debounced to at most one call per 2 seconds to avoid hammering the Presence channel. Trade-off: there's a 0-2 second lag between user action and other participants seeing the status change.

- **Use RN `Animated` API (not Reanimated) for toast animations**: The toast is a simple slide-in/slide-out. The codebase already uses `Animated` from RN for `PulseDot`. Reanimated is a listed dependency but not yet used anywhere. Staying with `Animated` avoids adding Reanimated to the critical path of this ticket and keeps toast animation code consistent with `PulseDot`. Trade-off: `Animated` runs on JS thread, but toast animations are simple opacity+translateY and won't cause jank.

- **Toast state managed via `useReducer` in `ActivityToast` parent, not global state**: Toast events originate from two sources (presence status changes for lock-in, query data comparison for photos) and are consumed in one place (the round screen). A local reducer in `table-night.tsx` accumulates toast events and auto-dismisses them. No need for a global toast provider since toasts only exist on this one screen. Trade-off: if toasts are ever needed elsewhere, this must be lifted.

### File Changes

- `napkin-app/hooks/tables/usePresence.ts` -- **NEW** -- Supabase Presence hook. Exports `usePresence(nightId, userId, displayName)`. Manages channel lifecycle: subscribe on mount, unsubscribe on unmount. Listens to AppState changes to unsubscribe on background and re-subscribe on foreground. Exposes `presenceState: Record<string, PresencePayload>` (keyed by `userId`), `updateStatus(status)` function, and `isConnected` boolean. Internally debounces `channel.track()` calls to max 1 per 2 seconds. Defines `PresencePayload` type: `{ userId: string; displayName: string; status: 'viewing' | 'rating' | 'uploading' | 'ready'; lastActive: string }`. Returns stable references via `useCallback`/`useMemo`.

- `napkin-app/hooks/tables/useTableNightRealtime.ts` -- **MODIFY** -- Add an optional `onParticipantChange?: (payload: RealtimePostgresChangesPayload) => void` callback to the options interface. In the `table_night_participants` subscription handler, call `onParticipantChange?.(payload)` before invalidating queries. This gives the round screen access to the raw change payload to detect `ready` transitions for toasts without adding a second subscription. Approximately 5 lines changed (interface addition + callback invocation).

- `napkin-app/components/table-night/PresenceRow.tsx` -- **NEW** -- Renders a horizontal row of avatar circles. Props: `participants: TableNightParticipant[]`, `presenceState: Record<string, PresencePayload>`, `palette: Palette`. For each participant, renders the existing `Avatar` component (from `components/feed/Avatar.tsx`) wrapped in a `View` with a 3px colored border: amber (`palette.tertiary`) for `rating`/`uploading` with a pulsing opacity animation, green (`palette.success`/`palette.secondary`) for `viewing`, solid terracotta (`palette.primary`) ring for `ready`, and no ring + `opacity: 0.5` for offline/not-present. Below the avatar row, renders a "X of Y here" label using `Type.labelSmall` and `palette.textSecondary`. Component is ~80 lines.

- `napkin-app/components/table-night/ActivityToast.tsx` -- **NEW** -- Renders a stack of up to 2 ephemeral toast notifications. Props: `toasts: Toast[]`, `onDismiss: (id: string) => void`, `palette: Palette`. Each toast is a small card (`palette.surfaceContainerLow` background, `Shadow.ambient`, `Radius.sm`) that slides in from top with `Animated.spring` (translateY from -60 to 0, opacity 0 to 1). Auto-dismisses after 3 seconds via `setTimeout` calling `onDismiss`. Uses `Manrope_600SemiBold` for text. Positioned absolutely at `top: insets.top + 8`. Component is ~100 lines. Defines `Toast` type: `{ id: string; message: string; timestamp: number }`.

- `napkin-app/components/table-night/index.ts` -- **NEW** -- Barrel export for `PresenceRow` and `ActivityToast`.

- `napkin-app/app/table-night.tsx` -- **MODIFY** -- Integration changes at multiple points:
  1. **Import additions** (~line 6-41): Import `AppState` from `react-native`, `usePresence` from new hook, `PresenceRow` and `ActivityToast` from new components, add `Toast` type import.
  2. **Toast reducer** (~line 135, new block after existing state declarations): Add `useReducer` for toast state with actions `ADD_TOAST` and `DISMISS_TOAST`. Max 2 toasts; oldest dismissed when third arrives. Each toast has `id` (random), `message` (string), `timestamp` (Date.now()).
  3. **Presence hook wiring** (~line 152, after realtime hook): Call `usePresence(nightId, user?.id, user?.display_name)`. Store returned `presenceState`, `updateStatus`, `isConnected`.
  4. **Status tracking on slider interaction** (~line 168-175, modify `updateCategory` and `updateStar`): Call `updateStatus('rating')` inside both `updateCategory` and `updateStar` callbacks. This triggers the debounced presence track.
  5. **Status tracking on photo upload** (~line 198-225, modify `startUploadForSlot`): Call `updateStatus('uploading')` when upload starts. Call `updateStatus('viewing')` when upload completes/errors (the 5s inactivity timer handles revert from `rating`, but upload completion is explicit).
  6. **Realtime callback for toasts** (~line 152, modify `useTableNightRealtime` call): Add `onParticipantChange` callback that checks if `payload.new.ready === true && payload.old.ready === false && payload.new.user_id !== user?.id`. If so, dispatch `ADD_TOAST` with the participant's display name (looked up from `nightStatus.participants`). Message format: "[Name] locked in".
  7. **PresenceRow in JSX** (~line 470, after hero closing tag `</View>` and before the voting slip): Insert `{!isRevealed && <PresenceRow participants={nightStatus.participants} presenceState={presenceState} palette={palette} />}` wrapped in a `View` with `paddingHorizontal: Spacing.lg, marginTop: Spacing.md`.
  8. **ActivityToast in JSX** (~line 413, inside the outer `<View style={{ flex: 1 }}>` before `<ScrollView>`): Insert `<ActivityToast toasts={toasts} onDismiss={(id) => dispatch({ type: 'DISMISS_TOAST', id })} palette={palette} />` positioned absolutely so it floats above scroll content.

### Implementation Order

1. **`usePresence.ts` hook** -- because it is the foundational primitive. All other changes consume its output. Can be tested in isolation by logging presence state to console. No backend changes needed; Supabase Presence works client-side only against the existing Realtime infrastructure.

2. **`PresenceRow.tsx` component** -- depends on step 1 for the `presenceState` type. Can be built with mock data first, then wired to the real hook. Reuses the existing `Avatar` component from `components/feed/Avatar.tsx`.

3. **`ActivityToast.tsx` component** -- independent of steps 1-2. Pure presentational component driven by a `toasts` array prop. Can be built and tested with hardcoded toast data.

4. **Modify `useTableNightRealtime.ts`** -- adds the `onParticipantChange` callback. Small, surgical change (~5 lines). Must be done before step 5 so the round screen can consume the callback.

5. **Integrate into `app/table-night.tsx`** -- depends on all previous steps. Wire the presence hook, add the toast reducer, insert `PresenceRow` and `ActivityToast` into the JSX tree, and connect slider/photo interactions to `updateStatus`. This is the largest single change but is purely integration work.

6. **Create barrel export `components/table-night/index.ts`** -- trivial, do alongside step 5.

### Risks

- **Presence heartbeat battery drain on older devices**: Supabase Presence sends a heartbeat every ~10 seconds. On older iPhones this WebSocket activity could contribute to battery drain during long rounds. Mitigation: the hook unsubscribes on app background (AppState listener) and the round screen itself has a natural end (reveal), so the subscription is bounded in time. Monitor battery impact during real-device testing in Step 8 (test at dinner).

- **Stale presence after app crash or force-quit**: If a user force-quits the app, the WebSocket closes and Supabase's server-side presence TTL (default ~30 seconds) removes them. During that 30-second window, they appear as a ghost in the presence row. Mitigation: acceptable for V1 per the spec. The 30-second TTL is short enough that it self-heals without user confusion. If this becomes a problem, we can add a "last seen X seconds ago" label.

- **Race condition between presence status and DB state**: A user might show `status: 'rating'` in Presence but their DB participant row already shows `ready: true` (if the edge function completed before the presence track updated). Mitigation: the `PresenceRow` component should treat DB `ready: true` as authoritative -- if a participant is `ready` in the DB, show the `ready` ring regardless of their current Presence status. Presence is a hint for the pre-ready states; DB is the source of truth for terminal states.

- **Toast flood on simultaneous lock-ins**: If 5 participants all lock in within 3 seconds (common right before reveal), 5 toasts queue up but only 2 are visible. The older ones get dismissed immediately, so the user might miss names. Mitigation: the 2-toast max with oldest-first dismissal is the right UX trade-off. The presence row already shows who is ready, so the toasts are supplementary delight, not critical information.

- **No `photo_urls` column on `table_night_participants`**: The product spec's photo toast mechanism assumed a `photo_urls` array column that does not exist. Photos are stored in `entry_photos` and created atomically with lock-in. The design works around this by combining the photo toast with the lock-in toast ("[Name] locked in with photos"). If a future ticket adds real-time photo uploads (before lock-in), a separate `entry_photos` subscription or Presence broadcast would be needed. This is explicitly not in scope for V1.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed
- `napkin-app/hooks/tables/usePresence.ts` — NEW: Supabase Presence hook with AppState lifecycle, debounced tracking, inactivity timeout
- `napkin-app/components/table-night/PresenceRow.tsx` — NEW: Avatar row with colored activity rings (pulsing amber for rating/uploading, green for viewing, terracotta for ready)
- `napkin-app/components/table-night/ActivityToast.tsx` — NEW: Ephemeral slide-in toast notifications, max 2 visible, 3s auto-dismiss
- `napkin-app/components/table-night/index.ts` — NEW: Barrel export
- `napkin-app/hooks/tables/useTableNightRealtime.ts` — MODIFIED: Added `onParticipantChange` callback to expose raw participant change payloads
- `napkin-app/app/table-night.tsx` — MODIFIED: Integrated presence hook, PresenceRow, ActivityToast, toast reducer, status tracking on sliders/photos/lock-in

### Tests
- TypeScript check: 0 new errors (2 pre-existing: missing slider types, implicit `any` on slider callback)
- Manual testing needed: Two devices on same round to verify presence sync and toast firing

### Builder Questions
- None — all open questions resolved before build

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
```
Date: 2026-04-16
Verdict: REVISE

Spec compliance: 13/16 acceptance criteria met
- [x] User joins Supabase Presence channel scoped to round (`round-presence:{nightId}`) — PASS
- [x] Presence payload includes userId, displayName, status, lastActive — PASS
- [x] Status updates to `rating` on slider interaction, `uploading` during photo upload, reverts to `viewing` after 5s inactivity, becomes `ready` on lock-in — PASS
- [x] Heartbeat interval is 10s default, no custom polling — PASS
- [x] App background/foreground unsubscribe/re-subscribe — PASS
- [x] Cleanup on navigate away via effect cleanup — PASS
- [x] Horizontal presence row below hero, above voting card, one avatar per participant — PASS
- [x] Colored rings: amber pulsing for rating/uploading, solid ring for ready — PASS
- [ ] Green ring for `viewing` uses `palette.primary` per spec — WARN: spec says `palette.primary` for viewing (line 67) but primary is terracotta, not green. Code uses `palette.success` (olive green) matching the technical design. Likely a spec typo. Code behavior is sensible.
- [x] Offline participants dimmed at opacity 0.5 with no ring — PASS
- [x] "X of Y here" count label with Manrope/labelSmall — PASS
- [x] Toast on another participant's ready transition: "[Name] locked in", auto-dismiss 3s — PASS
- [ ] Toast on photo addition detected via DB change subscription — FAIL: no photo-addition toast implemented. The tech design acknowledged this limitation (photos are atomic with lock-in), but the acceptance criteria still lists it as a requirement. The code only fires "[Name] locked in" toasts, never "[Name] added a photo".
- [x] Toasts stack max 2, oldest dismissed — PASS
- [x] Toast aesthetic: surfaceContainerLow, ambient shadow, Radius.sm, Manrope, spring slide-in — PASS
- [x] No toast for own actions — PASS
- [x] Force-quit handled by Supabase TTL — PASS (by design, no code needed)
- [x] Presence row renders for single participant — PASS
- [x] Presence row hidden after reveal — PASS

Correctness: FAIL — onParticipantChange callback instability causes channel churn
Edge Cases: WARN — deferred track in doTrack captures stale payload if status changes rapidly
Error Handling: PASS — presence failures are silent (appropriate for ephemeral feature)
Security: PASS — no sensitive data in presence payloads
Performance: WARN — callback instability causes repeated channel teardown/setup
Design Compliance: WARN — viewing ring color diverges from spec text (but matches intent)
```

Key issues:

1. **CRITICAL: Channel re-subscription churn due to unstable `onParticipantChange` callback**
   `app/table-night.tsx:190-206` — `handleParticipantChange` depends on `nightStatus?.participants`, which is a new array reference on every React Query refetch. Since `useTableNightRealtime` (line 62) includes `onParticipantChange` in its effect dependency array, every query invalidation causes the DB-change channel to unsubscribe and resubscribe. This creates a feedback loop: DB change -> invalidate query -> refetch -> new participants ref -> new callback -> effect re-runs -> channel teardown/setup.
   **Fix:** Use a `useRef` to hold the latest callback and pass a stable wrapper to `useTableNightRealtime`:
   ```typescript
   const participantChangeRef = useRef(handleParticipantChange);
   participantChangeRef.current = handleParticipantChange;
   const stableParticipantChange = useCallback((payload: any) => {
       participantChangeRef.current(payload);
   }, []);
   ```
   Alternatively, remove `onParticipantChange` from the dependency array in `useTableNightRealtime.ts:62` and use a ref internally.

2. **MEDIUM: `onReveal` and `onParticipantChange` in useTableNightRealtime dependency array**
   `hooks/tables/useTableNightRealtime.ts:62` — Both callbacks are in the effect deps. The `onReveal` is `() => {}` (stable inline arrow, but recreated each render). Same channel churn issue. Either use refs for all callbacks inside the hook, or document that callers must provide stable references.
   **Fix:** In `useTableNightRealtime.ts`, store callbacks in refs and exclude them from the dep array:
   ```typescript
   const onRevealRef = useRef(onReveal);
   onRevealRef.current = onReveal;
   const onParticipantChangeRef = useRef(onParticipantChange);
   onParticipantChangeRef.current = onParticipantChange;
   // effect deps: [nightId, queryClient] only
   ```

3. **LOW: Deferred track sends stale payload**
   `hooks/tables/usePresence.ts:56-59` — The deferred `setTimeout` in `doTrack` captures `payload` at call time, but the `channel.track(payload)` inside the timeout sends that captured payload. If `updateStatus` is called again before the timeout fires, the timeout is cleared (line 55), so this is mostly safe. However, if `updateStatus('rating')` is called, then `updateStatus('uploading')` is called within 2 seconds, the first deferred track is cleared but the second also gets deferred. The second deferred track correctly sends `uploading`. No real bug here on closer inspection -- the clearing logic is correct. Downgrading to informational.

4. **LOW: Missing photo addition toast**
   Acceptance criteria line 72 requires a toast when "a new photo is detected for another participant." The technical design explicitly punted this (photos are atomic with lock-in), but the acceptance criteria was not updated to reflect this. Either update the AC to match reality, or implement the combined "[Name] locked in with photos" toast mentioned in the tech design.
   **Fix:** At minimum, update the acceptance criteria. Optionally, enhance the toast message to include "with photos" when the refetched data shows photos for the participant.

### Review 2
```
Date: 2026-04-16
Verdict: REVISE

Spec compliance: 16/16 acceptance criteria met
- [x] User joins Supabase Presence channel scoped to round (`round-presence:{nightId}`) — PASS
- [x] Presence payload includes userId, displayName, status, lastActive — PASS
- [x] Status updates to `rating` on slider interaction, `uploading` during photo upload, reverts to `viewing` after 5s inactivity, becomes `ready` on lock-in — PASS
- [x] Heartbeat interval is 10s default, no custom polling — PASS
- [x] App background/foreground unsubscribe/re-subscribe — PASS
- [x] Cleanup on navigate away via effect cleanup — PASS
- [x] Horizontal presence row below hero, above voting card, one avatar per participant — PASS
- [x] Colored rings: amber pulsing for rating/uploading, green for viewing, terracotta solid for ready — PASS
- [x] Offline participants dimmed at opacity 0.5 with no ring — PASS
- [x] "X of Y here" count label with Manrope/labelSmall — PASS
- [x] Toast on another participant's lock-in: "[Name] locked in", auto-dismiss 3s — PASS (AC updated to reflect atomic photo+lock-in)
- [x] Toasts stack max 2, oldest dismissed — PASS
- [x] Toast aesthetic: surfaceContainerLow, ambient shadow, Radius.sm, Manrope, spring slide-in — PASS
- [x] No toast for own actions — PASS
- [x] Force-quit handled by Supabase TTL — PASS (by design)
- [x] Presence row hidden after reveal — PASS

Review 1 fixes verified:
- [x] Channel churn fix: callbacks stored in useRef, effect deps reduced to [nightId, queryClient] — useTableNightRealtime.ts:20-24,68 — PASS
- [x] Photo toast AC updated to reflect atomic lock-in — AC line 72 — PASS

Correctness: FAIL — unstable onDismiss causes toast timer reset on every parent re-render
Edge Cases: PASS — single-participant, reveal-hide, background/foreground all handled
Error Handling: PASS — presence failures are silent (appropriate for ephemeral feature)
Security: PASS — no sensitive data in presence payloads
Performance: WARN — toast effect re-fires on every render due to unstable callback dep
Design Compliance: PASS — matches technical design
```

Key issues:

1. **MEDIUM: Toast dismiss timer resets on every parent re-render**
   `components/table-night/ActivityToast.tsx:77` — `ToastItem`'s `useEffect` depends on `[toast.id, onDismiss, translateY, opacity]`. The `onDismiss` prop is an inline arrow created in `app/table-night.tsx:479` (`(id) => dispatchToast(...)`) which produces a new reference every render. Each presence state update or query invalidation re-renders `TableNightScreen`, recreates `onDismiss`, and re-triggers the toast effect — restarting both the slide-in animation and the 3-second auto-dismiss timer. In a busy round with frequent presence heartbeats, toasts may never auto-dismiss.
   **Fix:** Stabilize `onDismiss` in `table-night.tsx` with `useCallback`:
   ```typescript
   const handleDismissToast = useCallback((id: string) => {
       dispatchToast({ type: 'DISMISS_TOAST', id });
   }, []);
   ```
   Then pass `handleDismissToast` instead of the inline arrow. Alternatively, store `onDismiss` in a ref inside `ToastItem` and remove it from the effect deps (same pattern used to fix `useTableNightRealtime`).

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: 2026-04-16
- Final verdict: APPROVE (after 2 revision cycles)
- Notes: Review 1 caught channel re-subscription churn (unstable callback in effect deps) and missing photo toast AC. Review 2 caught toast timer reset from unstable onDismiss. All three fixed: refs for callbacks in useTableNightRealtime, useCallback for toast dismiss handler, ref for onDismiss inside ToastItem.
