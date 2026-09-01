# Napkin UI feature map

Code-traceable operating map for agents driving the Expo app. Route inventory is based on default exports under `napkin-app/app/`; data ownership is traced through `napkin-app/hooks/`, `napkin-app/lib/queryKeys.ts`, and `supabase/functions/`. Paths in this document are repository-relative.

## 1. Verification protocol

### Launch and observe

1. Use an iOS Simulator with the Napkin development client (`com.majilaii.dining-journal-app`). The bundle identifier is declared in `napkin-app/app.config.ts`.
2. In `napkin-app/`, run `npm start` to start Metro for an already-installed development client (`napkin-app/package.json`).
3. If the development client is absent or native code/patches changed, run `npm run ios` for a fresh native build (`napkin-app/package.json`). `postinstall` applies `patch-package`, so install dependencies before judging native-patch behavior.
4. Let `app/_layout.tsx::AuthGate` choose auth, onboarding, or the signed-in shell. `/` itself redirects to `/wishlist` (`app/index.tsx`).
5. Navigate to every changed state, not merely every changed route. Capture a screenshot of each loading, content, empty, error, permission, privacy, and modal state affected by the change.
6. For a first-screen touch check, tap controls near the bottom of the first native screen mounted after launch; see TICKET-212 in section 5.

### Live-data rule

Live verification is **READ-ONLY**. Do not create, edit, react, follow, invite, RSVP, import, moderate, delete, or change settings by tapping through a live account. Exercise write paths in unit/integration tests with isolated fixtures. The safety labels in section 4 describe blast radius; even a `SAFE` control is not permission to mutate live verification data.

Reading screens, switching local tabs/filters, opening and dismissing sheets, moving/zooming a map, and taking screenshots are allowed. Treat OS permission prompts as device mutation and avoid them unless the test device is disposable (`hooks/useNearbyLocation.ts`, `components/notifications/NotifPermissionSheet.tsx`).

### Sign-in data

- `scripts/seed/demo-accounts.ts` provisions two review/demo identities through normal production Edge Function paths, completes onboarding, makes them mutual follows, creates a Table, accepts membership, and adds representative entries.
- The script reads email/password values from `DEMO_EMAIL_A`, `DEMO_EMAIL_B`, `DEMO_PASSWORD_A`, and `DEMO_PASSWORD_B`; credentials are intentionally not stored in this map.
- Use an already-provisioned authorized review account. Do **not** run the seed script during read-only verification: it writes live profiles, follows, membership, and entries.
- If no authorized review identity is available, stop rather than inventing credentials or signing up a live user. Auth UI behavior can still be covered by tests around `app/auth.tsx` and `providers/AuthProvider.tsx`.

### Shell and route-count conventions

- Five layout modules shape navigation but are not counted as pages: `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/admin/_layout.tsx`, `app/onboarding/_layout.tsx`, and `app/settings/_layout.tsx`.
- There are **63 default-export `.tsx` route modules** below: 62 intended pages plus the accidentally routable `/onboarding/OnboardingProgress` support component.
- `app/onboarding/OnboardingDraftContext.tsx` and `app/onboarding/styles.ts` are support modules, not routes.
- Root Stack configuration mentions `/day/[date]`, but no `app/day/[date].tsx` exists (`app/_layout.tsx`); it is a dangling registration, not a drivable route.
- The custom signed-in navigation is `app/_layout.tsx::BottomNavBar`; Expo's built-in tab bar is hidden in `app/(tabs)/_layout.tsx`.

## 2. Page map

Notation: `EF` = Supabase Edge Function; `RPC` = PostgREST function. Table names are the storage touched by the named hook/function, not a promise that every table renders visibly.

### Shell, primary tabs, and discovery

| Route | Component file | Feeding hook(s) / client | EF / RPC | Backing tables |
|---|---|---|---|---|
| `/` | `napkin-app/app/index.tsx` | `Redirect` | — | — |
| `/feed` | `napkin-app/app/(tabs)/feed.tsx` | `useFriendsFeed`, `useSocials`, `useFollowCandidates`, `useBrowsePublicLists` | `feed-friends` / `fn_friends_feed`; `feed-socials`; `user-profile`; `lists` | `entries`, `entry_photos`, `post_reactions`, `profiles`, `restaurants`, `clip_thumbs`, `lists`, `list_entries`, `follows` |
| `/journal` | `napkin-app/app/(tabs)/journal.tsx` | `useMySoloEntries`, `useUnreadCount` | RPC `fn_my_solo_entries`; EF `notifications` | `entries`, `entry_tables`, `restaurants`, `profiles`, `notifications` |
| `/log` | `napkin-app/app/(tabs)/log.tsx` | none; blank legacy placeholder | — | — |
| `/profile` | `napkin-app/app/(tabs)/profile.tsx` → `components/profile/ProfileScreenBody.tsx` | `useUserProfile`, `useUserSpots`, list and import hooks | `user-profile`, `lists`, `wishlist` | `profiles`, `entries`, `entry_photos`, `follows`, `lists`, `list_entries`, `table_members`, `tables`, `user_top_4`, `user_profile_takes`, `import_jobs` |
| `/search` | `napkin-app/app/(tabs)/search.tsx` | `useRestaurantSearch`, `useUserSearch`, `useSearchPublicLists`, personal list/wishlist/table hooks | `places-search`, `restaurant-history?action=search`, `user-profile`, `lists`, `wishlist`, `table-management` | `restaurants`, `profiles`, `lists`, `list_entries`, `wishlist_items`, `tables`, `table_members` |
| `/tables` | `napkin-app/app/(tabs)/tables.tsx` | `useTables`, `useTableActivity`, `useTableAtlas`, `useTableMembers`, `useTableTopFour` | `table-management`, `table-activity`, `table-atlas` | `tables`, `table_members`, `entries`, `entry_photos`, `restaurants`, `profiles`, `suppers`, `supper_members`, `gatherings`, `gathering_rsvps`, `table_shares`, `wishlist_items`, `user_top_4`, legacy `table_nights` |
| `/wishlist` | `napkin-app/app/wishlist.tsx` | `useMyWishlist`, `useUserSpots`, `useNetworkMapPins`, `useTablesOverlap`, `useTables`, list/import hooks | `wishlist`, `user-profile`, `lists`, `table-management`, `places-search` | `wishlist_items`, `entries`, `restaurants`, `profiles`, `follows`, `lists`, `list_entries`, `table_members`, `tables`, `import_jobs`, `list_imports` |

### Auth and onboarding

| Route | Component file | Feeding hook(s) / client | EF / RPC | Backing tables |
|---|---|---|---|---|
| `/auth` | `napkin-app/app/auth.tsx` | `useAuth`; Supabase Auth password/OAuth clients | Supabase Auth | Auth identities; profile gate is later in `providers/AuthProvider.tsx` |
| `/reset-password` | `napkin-app/app/reset-password.tsx` | Supabase Auth session and password update | Supabase Auth | Auth identities |
| `/onboarding` | `napkin-app/app/onboarding/index.tsx` | `OnboardingDraftContext`, auth metadata | Supabase Auth metadata update | Auth identity metadata; draft is local React state |
| `/onboarding/photo` | `napkin-app/app/onboarding/photo.tsx` | draft context, image staging/moderation helpers | `moderate-image`; object upload | profile-image staging/storage objects |
| `/onboarding/city` | `napkin-app/app/onboarding/city.tsx` | `useCoDiners`, draft context, completion client | `user-profile?action=co_diners/complete_onboarding`; RPC `fn_complete_onboarding` | `profiles`, `follows` |
| `/onboarding/follows` | `napkin-app/app/onboarding/follows.tsx` | co-diner/follow clients and draft completion | `user-profile?action=co_diners/follow/complete_onboarding` | `profiles`, `follows` |
| `/onboarding/OnboardingProgress` | `napkin-app/app/onboarding/OnboardingProgress.tsx` | none; visual support component with required props | — | —; directly routing here is unsupported |

### Entries, people, and restaurant detail

| Route | Component file | Feeding hook(s) / client | EF / RPC | Backing tables |
|---|---|---|---|---|
| `/create-entry` | `napkin-app/app/create-entry.tsx` | `useCreateEntry`, `useTables`, recent-post query, supper/merge/round helpers | `entry`, `places-search`, `table-management`, `table-night` (legacy) | `entries`, `entry_photos`, `entry_companions`, `entry_participants`, `entry_tables`, `restaurants`, `tables`, `table_members`, `suppers`, `supper_members`, legacy `table_nights`/`round_entries` |
| `/log-meal` | `napkin-app/app/log-meal.tsx` | `useCreateEntry`, `useTables`, supper attach/add helpers | `entry`, `table-management` | `entries`, `entry_photos`, `entry_companions`, `entry_tables`, `tables`, `table_members`, `suppers`, `supper_members`, `profiles` |
| `/entry-detail` | `napkin-app/app/entry-detail.tsx` | direct entry query, `useRestaurantHistory`, `usePostInteractions`, supper/legacy-round helpers | `restaurant-history`, `post-interactions`, `entry`, `account`, legacy `table-night`; RPC `is_entry_publicly_eligible` | `entries`, `entry_tables`, `entry_photos`, `entry_companions`, `profiles`, `restaurants`, `post_reactions`, `post_comments`, `post_comment_likes`, `suppers`, `supper_members`, legacy `round_entries` |
| `/diary` | `napkin-app/app/diary.tsx` | `useUserDiary` | `user-profile?action=diary`; RPC `fn_user_diary_page` | `entries`, `entry_photos`, `profiles`, `restaurants` |
| `/reviews` | `napkin-app/app/reviews.tsx` | `useUserReviews` | `user-profile?action=reviews` | `entries`, `entry_photos`, `profiles`, `restaurants` |
| `/spots` | `napkin-app/app/spots.tsx` | `useUserSpots` | `user-profile?action=spots` | `entries`, `profiles`, `restaurants` |
| `/taste` | `napkin-app/app/taste.tsx` | `useUserTaste`, `useUserSpots` | `user-profile?action=taste/spots` | `entries`, `profiles`, `restaurants` |
| `/top-fours` | `napkin-app/app/top-fours.tsx` | `useTopFours` and top-four editor hooks | `top-fours` | `user_top_4`, `user_top_4_history`, `user_claimed_cities`, `user_claim_nudge`, `entries`, `entry_photos`, `profiles`, `restaurants` |
| `/follows` | `napkin-app/app/follows.tsx` | `useFollowList`; `FollowButton` → `useFollow` | `user-profile?action=followers/following/follow` | `profiles`, `follows`, `blocked_users` |
| `/member/[userId]` | `napkin-app/app/member/[userId].tsx` | member-profile query | `member-profile` | `profiles`, `entries`, `table_members`, legacy `table_nights` |
| `/u/[identifier]` | `napkin-app/app/u/[identifier].tsx` → `components/profile/ProfileScreenBody.tsx` | `useUserProfile`, `useUserSpots`, list hooks | `user-profile`, `lists` | `profiles`, `entries`, `entry_photos`, `follows`, `lists`, `list_entries`, `table_members`, `tables`, `user_top_4`, `user_profile_takes` |
| `/restaurant/[id]` | `napkin-app/app/restaurant/[id].tsx` | `useRestaurantPage`, lookup/history/review/clip/list/wishlist hooks | `restaurant-history` + RPC `fn_visible_entry_ids`, `places-search`, `lists`, `wishlist` | `restaurants`, `entries`, `entry_tables`, `entry_photos`, `profiles`, `blocked_users`, `tables`, `table_members`, `lists`, `list_entries`, `professional_critic_reviews`, `clip_thumbs`, `wishlist_items` |
| `/restaurant-reviews` | `napkin-app/app/restaurant-reviews.tsx` | `useRestaurantReviews` | `restaurant-history?action=reviews`; RPC `get_public_reviews_page` | `entries`, `entry_photos`, `profiles`, `restaurants` |

### Tables, Supper, Gather, and legacy rounds

| Route | Component file | Feeding hook(s) / client | EF / RPC | Backing tables |
|---|---|---|---|---|
| `/create-table` | `napkin-app/app/create-table.tsx` | `useCreateTable`, `useAddMember`, `useCreateInvite`, user search | `table-management`, `user-profile` | `tables`, `table_members`, `table_invites`, `table_invitations`, `profiles`, `follows` |
| `/join-table` | `napkin-app/app/join-table.tsx` | `useJoinByInvite` | `table-management` | `table_invites`, `tables`, `table_members` |
| `/table/[id]/settings` | `napkin-app/app/table/[id]/settings.tsx` | `useTables`, member query, update/leave/delete hooks | `table-management` | `tables`, `table_members`, `table_invites`, `table_invitations` |
| `/table/[id]/atlas/[city]` | `napkin-app/app/table/[id]/atlas/[city].tsx` | table atlas and member hooks | `table-atlas` | `entries`, `entry_photos`, `profiles`, `restaurants`, `tables`, `table_members`, `suppers`, `supper_members`, legacy `table_nights` |
| `/table-map` | `napkin-app/app/table-map.tsx` | `useTableWishlist`, `useTableMapPins`, `useTables`, `useMyLists`, `useList`, `useNearbyLocation` | `wishlist`, `table-atlas`, `table-management`, `lists` | `wishlist_items`, `entries`, `restaurants`, `tables`, `table_members`, `suppers`, `supper_members`, `lists`, `list_entries` |
| `/looking-back` | `napkin-app/app/looking-back.tsx` | `useTableActivity`, `useTableMembers`, `useTables` | `table-activity`, `table-management` | `entries`, `entry_photos`, `profiles`, `restaurants`, `tables`, `table_members`, `suppers`, `gatherings`, legacy `table_nights` |
| `/seed-from-solo` | `napkin-app/app/seed-from-solo.tsx` | `useTables`, `useTableActivity`; local selection only | `table-management`, `table-activity` | `tables`, `table_members`, activity-side `entries`/`table_shares` |
| `/supper/[id]` | `napkin-app/app/supper/[id].tsx` | `useSupper`, add-take/delete helpers | `entry?action=supper-detail/add-take/delete-supper` | `suppers`, `supper_members`, `entries`, `entry_photos`, `profiles`, `restaurants`, `tables`, `table_members` |
| `/gathering/[id]` | `napkin-app/app/gathering/[id].tsx` | `useGathering`, `useRescueGathering` | `gatherings?action=get/rescue` | `gatherings`, `gathering_rsvps`, `profiles`, `restaurants`, `tables`, `table_members`, `wishlist_items`, `suppers`, `supper_members` |
| `/table-night` | `napkin-app/app/table-night.tsx` | `useTableNightStatus`, join/rate/ready/reveal hooks, Realtime presence | `table-night`; start/rate/reveal RPCs | legacy `table_nights`, `table_night_participants`, `round_entries`, `entries`, `restaurants`, `table_members` |
| `/table-night-detail` | `napkin-app/app/table-night-detail.tsx` | table-night status, direct entries/photos, history/interactions | `table-night`, `restaurant-history`, `post-interactions` | legacy `table_nights`, `round_entries`, `entries`, `entry_photos`, `profiles`, `restaurants`, reactions/comments |

`/table-night` and `/table-night-detail` are retained code, not live product surfaces. The live group-meal model is Supper: `supper_id` clusters individual entries (`supabase/functions/entry/index.ts`, `hooks/suppers/index.ts`). Do not resurrect round UI when changing Tables.

### Lists, handoffs, notifications, and imports

| Route | Component file | Feeding hook(s) / client | EF / RPC | Backing tables |
|---|---|---|---|---|
| `/lists` | `napkin-app/app/lists.tsx` | `useMyLists`, `useSavedLists`, delete/save hooks | `lists` | `lists`, `list_entries`, `list_saves`, `profiles`, `tables`, `table_members` |
| `/list/new` | `napkin-app/app/list/new.tsx` | `useCreateList` | `lists?action=create` | `lists`, `table_members`, `tables` |
| `/list/[id]` | `napkin-app/app/list/[id].tsx` | `useList`, add/remove/reorder/note/save hooks, wishlist/handoff hooks | `lists`, `wishlist`, `handoff`; RPC `fn_add_list_entries_canonical`, `is_table_member` | `lists`, `list_entries`, `list_saves`, `wishlist_items`, `profiles`, `tables`, `table_members` |
| `/list/[id]/edit` | `napkin-app/app/list/[id]/edit.tsx` | `useList`, `useUpdateList`, `useDeleteList` | `lists` | `lists`, `list_entries`, `tables`, `table_members` |
| `/handoff` | `napkin-app/app/handoff.tsx` | handoff resolver and spot-save client | `handoff`, `resolve-url?action=save_spots` | `entries`, `list_entries`, `lists`, `profiles`, `wishlist_items`, `wishlist_shares` |
| `/share-detail` | `napkin-app/app/share-detail.tsx` | `usePostInteractions`, share removal client | `post-interactions`, `table-activity`/direct share removal path | `table_shares`, `entries`, `profiles`, reactions/comments, `table_members` |
| `/notifications` | `napkin-app/app/notifications.tsx` | `useNotifications`, `useUnreadCount`, mark-read and invitation-response hooks | `notifications`, `table-management` | `notifications`, `profiles`, `restaurants`, `table_invites`, `table_invitations`, `tables`, `entries`, `user_restaurant_status` |
| `/import` | `napkin-app/app/import.tsx` | local import queue/App Group bridge; `ImportLinkSheet` | `resolve-url`, `wishlist` save paths | local manifests plus `import_jobs`, `import_resolutions`, `restaurants`, `wishlist_items`, `table_shares`, `clip_thumbs` |
| `/import-review` | `napkin-app/app/import-review.tsx` | local manifest reader, `useMyLists`, `useTables`, import queue processor | `resolve-url`, `wishlist`, `lists`, `table-management` | local manifest plus `import_jobs`, `import_resolutions`, `wishlist_items`, `lists`, `list_entries`, `tables`, `table_members` |
| `/import-kickoff` | `napkin-app/app/import-kickoff.tsx` | large-job manifest and queue trigger | `resolve-url`, `wishlist`, `notifications` through `useProcessImportQueue` | local large-job state plus `import_jobs`, `import_resolutions`, `wishlist_items` |
| `/import-progress` | `napkin-app/app/import-progress.tsx` | active local manifests, recent import hooks, completeness hooks | `wishlist`, `restaurant-completeness` | local manifests plus `import_jobs`, `list_imports`, `import_resolutions`, `restaurants` |
| `/import-digest` | `napkin-app/app/import-digest.tsx` | local digest manifest, correction/list/wishlist hooks | `places-search`, `restaurant-completeness`, `lists`, `wishlist` | local manifest plus `import_jobs`, `import_resolutions`, `restaurants`, `lists`, `list_entries`, `wishlist_items` |
| `/imports/[jobId]` | `napkin-app/app/imports/[jobId].tsx` | import-batch, repoint/remove/add-spot and list hooks | `wishlist`, `places-search`, `lists` | `import_jobs`, `list_import_items`, `import_resolutions`, `restaurants`, `wishlist_items`, `lists`, `list_entries` |

### Settings and administration

| Route | Component file | Feeding hook(s) / client | EF / RPC | Backing tables |
|---|---|---|---|---|
| `/settings` | `napkin-app/app/settings/index.tsx` | `useUserProfile`, permission readers, account deletion client | `user-profile`, `account?action=delete-account` | `profiles`, `account_deletions`, `blocked_users`, `follows`, `table_members`, `tables`, user-owned image/data tables |
| `/settings/name` | `napkin-app/app/settings/name.tsx` | `useUserProfile`, `useUpdateProfile` | `user-profile` | `profiles` |
| `/settings/bio` | `napkin-app/app/settings/bio.tsx` | `useUserProfile`, `useUpdateProfile` | `user-profile` | `profiles` |
| `/settings/city` | `napkin-app/app/settings/city.tsx` | `useUserProfile`, `useUpdateProfile` | `user-profile` | `profiles` |
| `/settings/photo` | `napkin-app/app/settings/photo.tsx` | profile/photo update and image moderation helpers | `user-profile`, `moderate-image`; object upload | `profiles`, profile-image storage/staging |
| `/settings/username` | `napkin-app/app/settings/username.tsx` | availability check and profile update | `user-profile` | `profiles` |
| `/settings/privacy` | `napkin-app/app/settings/privacy.tsx` | `useUserProfile`, privacy/reply-permission mutations | `user-profile` | `profiles` |
| `/settings/privacy/make-public` | `napkin-app/app/settings/privacy/make-public.tsx` | username check/update and privacy mutation | `user-profile` | `profiles` |
| `/settings/blocked` | `napkin-app/app/settings/blocked.tsx` | blocked-list and unblock hooks | `account` | `blocked_users`, `profiles` |
| `/settings/import-tutorial` | `napkin-app/app/settings/import-tutorial.tsx` | local tutorial state | — | device-local state only |
| `/admin/critics` | `napkin-app/app/admin/critics.tsx` | `useIsAdmin`, critic-list/edit hooks | `critics-admin` | `admin_users`, `professional_critic_reviews`, `restaurants` |

### Data-shape rules that affect every route

- `entries` has no foreign key to `profiles`. Entry/profile surfaces batch-fetch profile IDs (`hooks/entries/useMySoloEntries.ts`, `supabase/functions/user-profile/index.ts`, `supabase/functions/restaurant-history/index.ts`); never add an ambiguous `profiles` embed.
- `table_members` identifies a person with `member_id`, not `user_id` (`supabase/functions/table-management/index.ts`, `hooks/tables/useTableMembers.ts`).
- Tables are private membership-scoped groups (`supabase/functions/table-activity/index.ts`, `supabase/functions/table-management/index.ts`). Profiles are public unless `profiles.account_privacy` makes them private (`supabase/functions/user-profile/index.ts`).
- Saves are public-by-default profile signals gated by `account_privacy`, read through SECURITY DEFINER RPC `fn_restaurant_saves_visible` (`supabase/functions/restaurant-history/index.ts`, `supabase/migrations/20260710160000_fn_restaurant_saves_visible.sql`).
- `visibility='private'` entries are hidden; public eligibility is centralized in `is_entry_publicly_eligible` (`supabase/functions/post-interactions/index.ts`, `app/entry-detail.tsx`).

## 3. Per-card states

“Intended-empty” below means the query completed and code received an empty array/zero/null allowed by its contract. “Broken-empty” means a query errored, never enabled, lost identity/parameters, or returned an unexpected shape. Preserve this distinction in screenshots and fixes.

### Feed and feed cards

Source: `app/(tabs)/feed.tsx`, `components/feed/FollowingFeed.tsx`, `components/feed/ForYouFeed.tsx`, `components/feed/FriendFeedCard.tsx`, `components/feed/FeedActionRow.tsx`, `hooks/feed/useFriendsFeed.ts`, `hooks/feed/useSocials.ts`.

- Tabs are **Friends** and **For You**, in that order; Friends is the default on every Feed landing. The internal Friends mode key remains `following`. Switching tabs is local/read-only.
- Friends initial load with no cached rows: centered spinner.
- Friends initial failure with zero rows: explicit error state and retry.
- Friends later failure with cached rows: existing cards remain; do not call the retained list an empty success.
- Friends settled zero rows: invitation/switch-tab empty state. This is intended-empty only when `isError` is false.
- Friends content: chronological friend entry cards; pagination adds a footer spinner. A sparse/end tail is deliberate when the backend reports no more eligible entries.
- For You independently loads social clips, people, and public lists. Any non-empty block renders even while a sibling block loads or fails.
- For You with no visible blocks and any active request: spinner. With any failed request: retry state. With all requests settled empty: “nothing here just yet” invitation.
- Friend cards render a ledger entry or note treatment, photo/no-photo variants, table context, comments, and the author's own overflow controls.
- Reactions are heart-only. `FeedActionRow` toggles like/unlike; legacy non-heart reaction rows can count as liked and are removed by unlike, but no picker is rendered.
- Tables activity cards may be entries, Suppers, Gathers, shares, floats, top-four changes, or list additions (`hooks/tables/useTableActivity.ts`, `components/tables/`). Round cards are legacy residue, not a new state to extend.

### Journal

Source: `app/(tabs)/journal.tsx`, `components/journal/JournalList.tsx`, `hooks/entries/useMySoloEntries.ts`.

- Initial load: spinner. Failure: explicit retry/error state. Success with zero entries: empty journal CTA. Success with rows: month-grouped journal cards.
- The historical hook name `useMySoloEntries` is misleading: RPC `fn_my_solo_entries` now returns **all entries authored by the user, including table-shared entries**. There is no Table filter.
- Intended empty is a successful zero-row RPC response. Broken empty is `isError`, absent authenticated user ID, or a profile/restaurant batch hydration failure; the route has an explicit query error branch.

### Entry detail

Source: `app/entry-detail.tsx`, `lib/screenLoadState.ts`.

- A genuinely pending entry or night-to-entry resolution shows the centered spinner. Cached entry data remains readable during a failed refetch.
- A failed entry read, failed `resolveEntryIdByNight`, or a settled route with no resolved entry shows “could not load this entry.” The back control is always present; retry appears when the route has enough identity to replay the request.
- Loaded entry content retains its eligibility, privacy, Supper, legacy Round, interaction, and editing states. A missing required entry is broken-empty, never loading or intended-empty.

### Restaurant page sections

Source: `app/restaurant/[id].tsx`, `components/restaurants/ScoreBand.tsx`, `components/restaurants/VoicesStream.tsx`, `components/restaurants/AllReviewsFolio.tsx`, `hooks/restaurants/useRestaurantPage.ts`.

- A persisted restaurant starts with a loading treatment. A Places payload/lookup can synthesize a ghost identity before a canonical row exists.
- Persisted history failure with cached identity retains the page and shows “could not load visit history” with retry. Failure before identity exists shows a dedicated “could not load this restaurant” state with both back and retry; it never paints blank paper. **A deleted/unknown id resolves 200 with `restaurant: null` — not an error — and reaches that same shell via `isResolvedEmpty` (drive-through 2026-08-27; before the fix this exact case painted blank paper whose only escape was the iOS edge-swipe). Verify with `napkin://restaurant/<unknown-uuid>`; broken-empty here is always the shell, never a bare page.** Ghost lookup failure can only degrade to the route's available identity parameters; do not mistake missing optional history for a hard crash.
- `MapHero` is a geographic map, not a photo masthead. The detail page deliberately has **no restaurant/Places hero photo**.
- `ScoreBand` has a skeleton/cold state. Napkin score signals and the external Google rating are sibling cells; never merge Google into Napkin aggregates.
- The Napkin distribution and both photo rails are viewer-specific but use separate content modes. The aggregate filters on privacy only (blocks, private accounts, and private visibility), never note length; photos additionally require canonical review-content parity. Unblocked Tablemates, companions, and Supper members retain their scoped access.
- “Your history” is viewer-specific, bounded inline, and absent when the viewer has no visits. A histogram appears only when rating data exists.
- `VoicesStream` shows at most two inline public reviews (`visiblePublic.slice(0, 2)`). `AllReviewsFolio` is the doorway to `/restaurant-reviews`.
- With no review band, the invitation/quote and folio treatment is intentional. Query errors are represented by the page error/history message, not by pretending reviews succeeded empty.
- Featured lists, social clips, and Table atlas context are conditional arrays. Their absence is intended only after their respective requests settle successfully.

### Profile sections

Source: `components/profile/ProfileScreenBody.tsx`, `hooks/users/useUserProfile.ts`, `hooks/users/useUserSpots.ts`, `supabase/functions/user-profile/index.ts`.

- Missing route identity or initial load: spinner. Query error: “Couldn't load”. `isNotFound`: not-found page.
- `blocked_by_viewer`: blocked-user stub with an unblock doorway. This is not a missing profile.
- `private_stub`: identity, relationship controls, and allowed counts remain; journal/palate content is withheld with a private-account message.
- Normal self/public profile: identity header plus conditional palate, top-four, quick-take, list, activity, and spot sections.
- Self with zero logs: cold-start nudge. Empty top fours, quick takes, lists, or imports are omitted by their array/gate logic; imports are self-only and appear when an action is owed.
- Intended empty is an explicit server state (`private_stub`, `blocked_by_viewer`, `isNotFound`) or successful empty section array. Broken empty is `isError`, an unresolved identity, or a section request that failed while the main profile stayed cached.

### Wishlist and Map

Source: `app/wishlist.tsx`, `components/wishlist/WishlistMapView.tsx`, `components/wishlist/WishlistGrid.tsx`, `hooks/wishlist/useMyWishlist.ts`, `hooks/users/useUserSpots.ts`, `hooks/users/useNetworkMapPins.ts`, `hooks/wishlist/useTablesOverlap.ts`.

- Primary surface toggles ledger and map locally. Sources include saved, been, network, Table-overlap, and selected-list rows; some heavier sources arm only when selected.
- Initial wishlist load: spinner. Pending imports render separately from pinned rows. A true zero-row result produces the designed empty invitation.
- Wishlist-query failure with no cached rows shows “could not load your spots” plus retry in both pinned-list and Your-map modes. It never renders the first-run invitation or the map's zero-geocode murmur. Cached rows remain visible after a later refetch failure.
- The populated pinned ledger supports pull-to-refresh. Pagination fetches keep their footer spinner and do not activate the pull-to-refresh indicator.
- Map success with zero geocoded items: map empty murmur. Missing coordinates produce an unmappable count and repair sheet; they are data-quality rows, not a network failure.
- Location denied/unrequested: global map remains usable; nearby affordances request or explain permission (`hooks/useNearbyLocation.ts`).
- Filters can legitimately reduce a non-empty source to zero. Clear cuisine/price/city/list filters before diagnosing data loss.
- Zooming out does **not** cluster pins (`WishlistMapView` renders all pins directly). Separate Table-overlap pins with `overlap.count >= 2` currently render an amber numeric face; see the doctrine mismatch in section 5.

### Handoff

Source: `app/handoff.tsx`, `hooks/wishlist/useResolveHandoff.ts`, `lib/handoffNavigation.ts`.

- Loading shows warm paper; a live share shows candidate rows and the pin action; revoked, invalid, missing-token, and save-revoked states show the existing tombstone.
- Every back/close path and successful pin dismisses one level when a parent stack exists. A cold deep link with no parent replaces to `/wishlist`, so no exit is a no-op.
- Failed individual saves retain the candidate rows for retry. A terminal share error is not an empty successful handoff.

### Settings privacy

Source: `app/settings/privacy.tsx`, `hooks/users/useUserProfile.ts`, `lib/screenLoadState.ts`.

- Initial profile load shows the centered spinner. Cached profile data remains readable during a failed refetch.
- A failed or settled-missing profile shows “could not load visibility” with back and retry; the hidden navigator header never leaves this state without an escape control.
- A loaded profile renders public/private mode and reply controls. Missing profile data is broken-empty, not an indefinitely loading privacy state.

### Imports

Source: `app/import.tsx`, `app/import-review.tsx`, `app/import-kickoff.tsx`, `app/import-progress.tsx`, `app/import-digest.tsx`, `app/imports/[jobId].tsx`, `hooks/wishlist/useProcessImportQueue.ts`, `lib/importFastPath.ts`, `lib/largeImportJob.ts`.

- Queue/manifest phases include reading, saving, review, kickoff, completed/digest, and failed/poisoned. The hub may retain history after active work ends.
- `/import-progress` with active manifests shows per-import progress; with recent history shows completed/failed cards; with neither shows education/empty hub.
- `/import-review` with candidates shows approve/exclude/destination controls. Missing manifest or zero spots produces “nothing to review”; inspect local manifest presence to distinguish expired/broken handoff from an intentional zero-candidate extraction.
- `/import-digest` shows saved/rejected/repair rows. Missing job/manifest and “nothing left” are distinct code paths.
- Import candidate “not this?” correction starts from the bare extracted name and sends structured city/area plus granted-only device coordinates to `places-search`; it never duplicates `best_query` locality.
- `/imports/[jobId]` shows load, not-found, populated batch, and “no spots in this import” states. Error/not-found is not an empty successful batch.
- Video import runs OCR/perception on device before server resolution (`useProcessImportQueue`). TikTok's cheap fast path is single-candidate-only (`lib/importFastPath.ts`); multi-candidate TikTok input escalates.
- Maps lists over 20 return `mode:'large_list'`, use a client-pumped background job in chunks of 20, and post a local completion notification when backgrounded (`lib/largeImportJob.ts`, `useProcessImportQueue`).
- A long “reading” state can be active local OCR/background work, not a dead server request. Confirm the manifest phase/timestamps before declaring it stuck.

### Supper and Gather

Source: `components/suppers/SupperCard.tsx`, `app/supper/[id].tsx`, `components/gatherings/GatheringCard.tsx`, `components/gatherings/GatherSheet.tsx`, `app/gathering/[id].tsx`, `hooks/suppers/index.ts`, `hooks/gatherings/index.ts`.

- Supper cards distinguish empty, filling with viewer seat empty, filling with viewer take present, and gathered. Pending members may appear as ghost seats.
- Supper detail: loading; populated roster/takes; or “not available” for missing/error/unauthorized data. Host-only destructive controls and viewer add-take doorways are conditional.
- An empty viewer seat is intended when the authenticated member has no attached entry. A failed supper query uses the unavailable/error branch, not an empty seat.
- Gather lifecycle states include proposed, dispatched, expired, rescued, and cancelled. Viewer RSVP can be unanswered, in, out, or countered.
- Host affordances include reschedule/cancel/clear/rescue under state gates. `GONE_CODES` are terminal server states; a cache seed may remain briefly while a detail refetch resolves.
- Rescue is host-only for an expired, unrescued Gather and opens a nested table-selection flow. A transient fetch error is not an expired Gather.

### Search

Source: `app/(tabs)/search.tsx` (Places pane is inline), `components/search/SearchLocalityBar.tsx`, `components/search/PeopleSearchPane.tsx`, `components/search/ListsSearchPane.tsx`, `hooks/search/useRestaurantSearch.ts`, `hooks/search/useSearchLocality.ts`, `providers/AuthProvider.tsx`, `hooks/users/useUserSearch.ts`, `hooks/lists/useSearchPublicLists.ts`.

- Places with no query: viewer recents/pins/lists sections appear only when non-empty. A brand-new account can therefore show a deliberately quiet canvas.
- Search requests do not fire below the pane's minimum query length. With a valid query: spinner before rows, result list on success, explicit places error/retry, or no-results state.
- The Places pane always shows a quiet locality bar below its search field. Auto mode labels granted coordinates as `current location`; without coordinates it surfaces the owner profile's lowercased `home_city` (or `anywhere` when none exists); a chosen city shows its lowercased name.
- Tapping the locality bar opens the warm-paper sheet. `current location` returns to auto and only an `undetermined` permission may prompt; a curated or free-text city becomes the session-only locality. The locality store resets to auto on cold start and every auth identity change.
- Auto mode preserves the shipped request behavior: granted coordinates send lat/lng plus `global_fallback`; otherwise the request stays bare for the server-side home-city weld. A chosen city sends only `city` with the query, never coordinates or `global_fallback`, and occupies a distinct city locality bucket in both result caches.
- The empty Places canvas now contains only recents, nearby pins, and lists when populated; its former `use my location` row is removed because the locality sheet owns that user-initiated affordance.
- An empty nearby-biased Places pass may append a single **Farther afield** section when the opt-in world pass succeeds. Those flagged rows stay after every local row and show city before street address.
- Cached results may remain during a refetch; do not label them stale/broken solely because a spinner is absent.
- People with no query shows suggestions; a valid query can show loading, people rows, or an invite-via-SMS no-results doorway. Check hook error state because no-results and failure have less visual separation than Places.
- Lists below the minimum length shows guidance; valid queries show loading, public list rows, or empty copy. Check `useSearchPublicLists` error state before accepting empty copy as intended.

## 4. Write paths

`SAFE` means self-scoped and reversible or device-local. `NEVER` means irreversible, shared, sends/notifies another person, changes moderation/visibility, or deletes. **Live verification remains read-only for both labels.** Read-only navigation controls are omitted unless they request an OS permission or launch outbound contact.

| Surface / mutating control | Call / storage | Refusal conditions enforced by UI/server | Live safety |
|---|---|---|---|
| Auth: sign in / OAuth | Supabase Auth via `providers/AuthProvider.tsx`, `app/auth.tsx` | valid credentials/provider result; timeout/error stays on auth | SAFE (session-scoped) |
| Auth: sign up, password-reset email | Supabase Auth | valid email/password; rate/provider errors | NEVER — creates identity or sends email |
| Auth: sign out | `AuthProvider.signOut`; clears session/query state | authenticated session | SAFE |
| Entry: create log/note, upload photos | `useCreateEntry` → EF `entry`; RPC `fn_create_entry_with_tables`; storage/RPC photo append | auth, restaurant/note contract, rating when required, uploads settled, selected Table memberships; missing visibility derives `'table'` with any Table id and `'friends'` otherwise | NEVER — creates visible/shared content |
| Entry: edit, merge restaurant, attach to Supper | EF `entry` update/merge/attach actions | author; target/membership/restaurant compatibility; valid Supper | NEVER — changes shared content |
| Entry: delete | EF `entry` or `account` path | author/authorized owner; confirmation | NEVER — deletion |
| Entry: like/unlike | `usePostInteractions` → EF `post-interactions` | auth and permission to view eligible entry | NEVER — social signal/notification |
| Entry: add/edit/delete comment, comment-like | EF `post-interactions` | auth; table membership for Table content; public eligibility and reply-permission gates | NEVER — sends or deletes social content |
| Entry: report/block author | EF `account` | auth; valid non-self target/content | NEVER — moderation/relationship impact |
| Wishlist: pin/unpin own spot | EF `wishlist`; pin sheets on restaurant/search/import | auth, canonical restaurant; dedupe | SAFE — self-scoped/reversible, but publicly visible when account is public |
| Wishlist: fix/repoint unmappable spot | EF `places-search`/`wishlist` correction | auth, owned/import row, valid replacement | SAFE — self-scoped/reversible data repair |
| Wishlist: local filters, source/list choice, clear local import history | component/device state | source available; no server membership change | SAFE |
| Map: request location | `useNearbyLocation` → OS permission | platform permission state | SAFE only on disposable simulator/device |
| Import: enqueue URL/video, approve/save, retry, exclude/repoint | local manifest + `resolve-url`, `wishlist`, `lists` | auth/owner manifest, valid URL/candidates/destination; Table membership for shared destination | NEVER — creates saves/list/Table shares and may notify |
| Import: share-extension handoff | App Group/import protocol in `app/import.tsx` | signed-in owner or pending-auth handoff; valid manifest | NEVER — begins a write workflow |
| Profile: edit name/bio/city/photo/username/top fours/takes | `user-profile`, `top-fours`, `moderate-image` | auth/owner; format, availability, image moderation, city/entry constraints | SAFE — self-scoped/reversible, but changes public profile |
| Profile: switch privacy/reply permission | EF `user-profile` | auth/owner; making public requires valid username (`settings/privacy/make-public.tsx`) | NEVER — changes audience/safety policy |
| Profile: follow/unfollow | EF `user-profile?action=follow/unfollow` | auth; not self; block constraints | NEVER — relationship and possible notification |
| Profile: block/unblock | EF `account` | auth; not self; existing block as appropriate | NEVER — relationship/visibility impact |
| Lists: create/update personal list | EF `lists` | auth/owner; valid title/privacy | SAFE only for private personal list; otherwise NEVER |
| Lists: create/update Table/public list | EF `lists` | auth; Table membership/creator permission; valid title | NEVER — shared/public content |
| Lists: add/remove/reorder/note an entry | EF `lists`; RPC `fn_add_list_entries_canonical` | owner or permitted Table member; canonical restaurant; list limits | SAFE only for private personal list; otherwise NEVER |
| Lists: save/unsave another list | EF `lists` | auth, visible list, not disallowed by privacy/block rules | SAFE — self-scoped/reversible signal |
| Lists: delete list | EF `lists` | owner/authorized Table list creator; confirmation | NEVER — deletion |
| Handoff: create/share/revoke/accept | EF `handoff`, `resolve-url?action=save_spots` | auth; live nonexpired token; owner for revoke; destination authorization | NEVER — outbound/shared write |
| Tables: create Table | EF `table-management` | auth; non-empty valid name | NEVER — creates private group |
| Tables: invite/add/approve/decline member | EF `table-management` | auth; owner/recipient gates; mutual-follow/existing/pending checks where applicable | NEVER — sends/changes membership |
| Tables: rename/change cover or top fours | EF `table-management`/`top-fours` | owner/member role and valid payload | NEVER — shared group state |
| Tables: leave Table | EF `table-management` | authenticated member; owner cannot use leave path | NEVER — membership loss |
| Tables: delete Table | EF `table-management` | owner and confirmation | NEVER — deletion |
| Tables: mark timeline seen / dismiss local nudge | EF seen marker or component state (`app/(tabs)/tables.tsx`) | member/current viewer | SAFE — self-scoped read marker/local state |
| Table share/float: create, share, dismiss/remove | table activity/share endpoints | membership, visibility, author/recipient gates | NEVER — shared timeline state |
| Supper: create/set Table/attach entry/add take | EF `entry` Supper actions | auth; Table membership; matching restaurant/Table; roster/seat and duplicate-entry checks | NEVER — shared group meal |
| Supper: delete | EF `entry?action=delete-supper` | host/authorized owner and state gate | NEVER — deletion |
| Gather: create | EF `gatherings?action=create` via `GatherSheet` | auth, selected Table and restaurant, membership, no duplicate active Gather | NEVER — sends to Table |
| Gather: RSVP/counter | EF `gatherings` | invited member; proposed/live state; valid option/date | NEVER — sends shared response |
| Gather: reschedule/cancel/clear | EF `gatherings` | host; lifecycle-specific gates; deletion/lock checks | NEVER — shared state/deletion |
| Gather: rescue into Supper | EF `gatherings?action=rescue` | host, expired and unrescued Gather, valid Table/crew/restaurant | NEVER — creates shared Supper |
| Legacy round: start/join/rate/ready/reveal | EF `table-night` and RPCs | auth, Table membership, legacy lifecycle/rating gates | NEVER — shared legacy state; do not use as product verification |
| Notifications: mark one/all read | EF `notifications` | authenticated recipient | SAFE — self-scoped read state |
| Notifications: accept/decline Table invitation | EF `table-management` | authenticated intended recipient; invitation pending | NEVER — membership change |
| Notifications: enable notifications | OS prompt from `NotifPermissionSheet` | soft-prompt cadence and current OS permission | SAFE only on disposable simulator/device |
| Settings: delete account | EF `account?action=delete-account` | auth and destructive confirmation | NEVER — irreversible deletion |
| Admin: create/edit/delete critic review | EF `critics-admin` | `admin_users` gate; valid critic/restaurant/review payload | NEVER — moderation/editorial production write |
| Restaurant: directions/website | external URL handlers in `app/restaurant/[id].tsx` | valid URL/map coordinates | SAFE read-only outbound navigation |
| Restaurant: call | `tel:` handler in `app/restaurant/[id].tsx` | phone number available | NEVER — can contact a real business |
| Search/people/list: SMS or system-share invite | Linking/share APIs in search/profile/list components | target/contact/share payload available | NEVER — sends to others |

Composer visibility (fixed 2026-08-26, TICKET-217 P0-1/P1-4): `lib/composer.ts::buildEntryPayload` emits `visibility='friends'` with zero selected Tables and `'table'` otherwise — matching `components/logging/FastLogForm.tsx` and the 2026-07-22 founder order (never `'private'` as a silent default). The atomic SQL writer `fn_create_entry_with_tables` independently applies the same Table/friends fallback when visibility is absent. `lib/composer.test.ts` asserts the client contract. A public account sees "also appears on your public profile" at save time in both `app/log-meal.tsx` and `app/create-entry.tsx`.

## 5. Known illusions and incidents

| Looks broken / incident | What the code says and how to verify | Pointer |
|---|---|---|
| Bottom ~116 pt of the **first mounted screen** painted but ignored taps | A stale `react-native-screens` content-wrapper frame could be shorter than its screen. `patch-package` now synchronizes the wrapper size except the `formSheet` case. Test bottom controls on the first screen after cold launch. | `napkin-app/patches/react-native-screens+4.16.0.patch`; `/Users/jacky/Napkin/.kanban/review/TICKET-212-first-screen-dead-touch-band.md`; PR #329 |
| iPad auth looked frozen/clipped | Auth is scrollable/keyboard-safe and async sign-in legs have timeout/error recovery. Verify compact and iPad widths without issuing live auth writes. | `napkin-app/app/auth.tsx`; `/Users/jacky/Napkin/.kanban/done/TICKET-211-ipad-review-freeze-hardening.md`; PR #328 |
| `PGRST201` after multi-Table entries | Multiple `entries → tables` relationships made implicit PostgREST embeds ambiguous. Server code names the intended FK or queries/batch-hydrates explicitly. The same rule prohibits pretending `entries` embeds `profiles`. | `supabase/functions/restaurant-history/index.ts`; `/Users/jacky/Napkin/.kanban/done/TICKET-043-multi-table-per-entry.md` |
| Map crashes only under New Architecture | The maps patch guards stale/out-of-range child insertion and nil subviews in Apple/Google map managers. `postinstall` must have run before reproducing. | `napkin-app/patches/react-native-maps+1.20.1.patch`; `napkin-app/components/wishlist/WishlistMapView.tsx` |
| Settings field autofocus flickers or steals focus | New Architecture transitions can outlive `InteractionManager`; `useFocusAfterTransition` waits for native `transitionEnd` with a fallback before focusing. | `napkin-app/components/settings/useFocusAfterTransition.ts`; `/Users/jacky/Napkin/.kanban/done/TICKET-158-settings-editors-heirloom.md` |
| A chooser opened from a sheet appears behind it or fails to present | Under Fabric/iOS, a stacked `Modal` must be nested inside the currently open `Modal` so it presents from the right view controller. | `napkin-app/components/profile/ProfileTopFourSheet.tsx`; `napkin-app/components/wishlist/UnmappedSpotsSheet.tsx`; `napkin-app/components/gatherings/GatherSheet.tsx`; `/Users/jacky/Napkin/.kanban/done/TICKET-186-list-detail-sheet-over-map.md` |
| Previous user's cached rows flash after account switch | Viewer-specific keys must contain the viewer ID, and owner-bound local import state is fenced/reset when auth identity changes. Explicit sign-out also clears query state; an identity swap without reset is a bug. | `napkin-app/lib/queryKeys.ts`; `napkin-app/providers/AuthProvider.tsx`; `napkin-app/lib/importOwnerGuard.ts`; `/Users/jacky/Napkin/.kanban/done/TICKET-199-table-map-parity.md` |
| Restaurant detail has no photo masthead | Deliberate founder revert. `MapHero` is geographic context; photos belong on other surfaces. | `napkin-app/app/restaurant/[id].tsx`; `/Users/jacky/Napkin/.kanban/done/TICKET-205-revert-restaurant-page-photo-plate.md` |
| Restaurant has two ratings that do not combine | Google rating and Napkin signals are siblings in `ScoreBand`; Google is not input to Napkin aggregates. | `napkin-app/components/restaurants/ScoreBand.tsx`; `napkin-app/app/restaurant/[id].tsx` |
| Restaurant Napkin count or photo rails differ by viewer | This is privacy filtering, not missing data. The service-role `restaurant-history` endpoint sends separate aggregate and photo batches through `fn_visible_entry_ids`. The aggregate filters on privacy only (blocks, private accounts, and private visibility), never note length; photos additionally require canonical review-content parity. Authorized Table/companion/Supper scopes remain. | `supabase/functions/restaurant-history/index.ts`; `supabase/migrations/20260826155643_ticket_217_restaurant_privacy_gates.sql` |
| Only two reviews appear inline | `VoicesStream` intentionally slices to two; use the folio doorway for all reviews. | `napkin-app/components/restaurants/VoicesStream.tsx`; `napkin-app/components/restaurants/AllReviewsFolio.tsx` |
| Journal includes Table-shared entries despite `useMySoloEntries` name | This is current scope by design: all entries authored by the user, no Table filter. | `napkin-app/hooks/entries/useMySoloEntries.ts`; `supabase/migrations/20260616000100_my_journal_all_entries.sql` |
| Feed has no emoji reaction picker | Heart-only like/unlike is deliberate; legacy emoji-shaped backend fields remain compatibility data. | `napkin-app/components/feed/FeedActionRow.tsx`; `napkin-app/components/feed/FriendFeedCard.tsx`; `supabase/functions/post-interactions/index.ts` |
| Round/table-night cards or routes exist | They are legacy/dead product code. New group meals are Suppers grouped by `supper_id`. | `napkin-app/app/table-night.tsx`; `napkin-app/app/table-night-detail.tsx`; `napkin-app/hooks/suppers/index.ts`; `supabase/functions/entry/index.ts` |
| Private profile looks like a partial/broken profile | `private_stub` is an explicit server variant; a blocked view is a separate `blocked_by_viewer` variant. | `napkin-app/components/profile/ProfileScreenBody.tsx`; `supabase/functions/user-profile/index.ts` |
| Saved pin appears on somebody's profile without a review | Saves are standalone public-by-default signals gated only by account privacy, read by `fn_restaurant_saves_visible`. | `supabase/functions/restaurant-history/index.ts`; `supabase/migrations/20260710160000_fn_restaurant_saves_visible.sql` |
| Import progress remains on “reading” | On-device OCR/perception and background list draining can legitimately outlive a navigation transition; inspect manifest phase and job heartbeat before calling it stuck. | `napkin-app/hooks/wishlist/useProcessImportQueue.ts`; `napkin-app/lib/largeImportJob.ts` |

### Doctrine/code contradictions visible at time of authoring

These are not silently resolved here; agents should preserve the code truth and escalate the product mismatch.

1. **Bottom-nav `+`:** doctrine says Ionicons + labels with a floating terracotta `+` is non-negotiable. `app/_layout.tsx::BottomNavBar` renders five Ionicon/label items and explicitly comments that the nav has had no `+` since TICKET-069. The hidden Expo tab bar in `app/(tabs)/_layout.tsx` does not supply one.
2. **Solo visibility default:** RESOLVED 2026-08-26 (TICKET-217 P0-1). All composer paths (`lib/composer.ts`, `components/logging/FastLogForm.tsx`) now emit `'friends'` for solo / `'table'` for table-shared, and the server paths in `supabase/functions/entry/index.ts` (`merge_with`, `attach-take`) fall back to `'table'`, never `'private'`. If any path is ever seen emitting `'private'` as a default again, that is a regression against the 2026-07-22 founder order — flag it, do not preserve it.
3. **Map count bubbles:** doctrine says the Map has no cluster/count bubbles. `components/wishlist/WishlistMapView.tsx` correctly removed zoom-out clustering and renders individual pins, but it deliberately renders an amber numeric face for Table overlaps where `overlap.count >= 2`; `app/table-map.tsx` also describes overlap count bubbles. Cluster bubbles are absent; overlap count bubbles remain.

## 6. How to reach a state

All recipes are read-only unless they explicitly say **fixture/test only**. Prefer an existing seeded review identity from section 1; never manufacture these states in live data.

### First run / onboarding

1. In an isolated test or disposable local Supabase fixture, authenticate a user whose `profiles.onboarded_at` is null (`providers/AuthProvider.tsx`, `app/_layout.tsx::AuthGate`).
2. Cold-launch. The gate routes to `/onboarding`; advance through photo and city/follows using mocked Edge Function results.
3. Capture the first screen, validation-disabled controls, photo moderation failure, city suggestions empty/error, and final completion transition (`app/onboarding/*`, `OnboardingDraftContext.tsx`).
4. Do not navigate directly to `/onboarding/OnboardingProgress`; it is a prop-driven support component accidentally exported as a route.

### Empty journal

1. **Fixture/test only:** return `{items: [], next_cursor: null}` from RPC `fn_my_solo_entries` for an authenticated user (`hooks/entries/useMySoloEntries.ts`).
2. Open `/journal`; capture the empty journal CTA.
3. In a separate case reject the RPC and capture the error/retry state. This pair proves intended-empty versus broken-empty.

### Private account viewing

1. Use two fixture identities. Set the subject's `profiles.account_privacy` to private and leave the viewer unauthorized by the server relationship rules (`supabase/functions/user-profile/index.ts`).
2. Open `/u/[username]`; the response variant must be `private_stub`, not an empty normal profile.
3. Separately seed `blocked_users` with viewer as blocker to reach `blocked_by_viewer`; capture both variants (`components/profile/ProfileScreenBody.tsx`).

### Table with pending Supper

1. **Fixture/test only:** seed a private Table using `table_members.member_id`, a filling `suppers` row, and `supper_members` rows where at least one member has no `entry_id` (`supabase/functions/entry/index.ts`).
2. Open `/tables`; capture the Supper card with a pending/ghost seat (`components/suppers/SupperCard.tsx`).
3. Open `/supper/[id]`; capture the roster and the viewer-empty-seat/add-take gate. Mock a rejected detail request separately for “not available”.

### Import in progress

1. **Fixture/test only:** inject an owner-bound local manifest in `reading` or `saving` phase through the same durable import-store helpers used by `hooks/wishlist/useProcessImportQueue.ts`.
2. Open `/import-progress`; capture active progress, then advance the mock manifest to review/digest/failed and capture each destination.
3. For a Maps list over 20, return the typed `large_list` envelope and exercise chunk progress in `lib/largeImportJob.ts`; mock background AppState to verify local completion notification without touching production.
4. For TikTok, test one high-confidence candidate for fast path and two candidates for escalation (`lib/importFastPath.ts`).

### Blocked-user views

1. **Fixture/test only:** insert `blocked_users(blocker_id=viewer, blocked_id=subject)` through the account test fixture.
2. Open `/u/[identifier]`; capture the blocked stub and unblock doorway.
3. Reverse blocker/blocked direction in a separate fixture and verify the server's visibility/error variant; do not infer one direction from the other (`supabase/functions/account/index.ts`, `supabase/functions/user-profile/index.ts`).

### Feed empty versus feed failure

1. Mock `feed-friends` with an empty successful `fn_friends_feed` page and open Following; capture the intended empty invitation.
2. Mock the same request failing before any cache exists; capture the retry state.
3. Seed cached cards, then fail the next page/refetch; confirm cards remain and only the incremental failure treatment changes (`components/feed/FollowingFeed.tsx`).
4. For For You, vary social/people/list queries independently to cover partial content, all-loading, any-error, and all-success-empty (`components/feed/ForYouFeed.tsx`).

### Search empty versus failure

1. Open `/search` with an empty query to capture the quiet/recent state.
2. Enter a below-threshold query and confirm no request starts.
3. With a valid query, mock zero results and then an error for each Places, People, and Lists pane. Capture both because People/Lists visually separate them less strongly (`components/search/*Pane.tsx`).

### Gather expired/rescue state

1. **Fixture/test only:** return an expired, unrescued Gather hosted by the viewer from EF `gatherings?action=get`.
2. Open `/gathering/[id]?rescue=1`; the rescue Table sheet auto-opens once, backed by `useRescueGathering` (`app/gathering/[id].tsx`).
3. Mock a non-host and a `GONE_CODES` response separately to verify the rescue refusal and terminal-state treatment.

### Unmappable Map rows and denied location

1. Mock successful wishlist/list rows with null coordinates; open Map and the unmappable repair sheet (`components/wishlist/UnmappedSpotsSheet.tsx`).
2. Mock the same source request failing to distinguish broken-empty from unmappable data.
3. Set simulator location permission to denied and confirm the global map remains usable while nearby UI explains/requests permission (`hooks/useNearbyLocation.ts`).
