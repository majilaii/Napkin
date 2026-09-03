# Napkin UI feature map

Code-traceable operating map for agents driving the Expo app. Route inventory is based on default exports under `napkin-app/app/`; data ownership is traced through `napkin-app/hooks/`, `napkin-app/lib/queryKeys.ts`, and `supabase/functions/`. Paths in this document are repository-relative.

## 1. Verification protocol

### Launch and observe

1. Use an iOS Simulator with the Napkin development client (`com.majilaii.dining-journal-app`). The bundle identifier is declared in `napkin-app/app.config.ts`.
2. In `napkin-app/`, run `npm start` to start Metro for an already-installed development client (`napkin-app/package.json`).
3. If the development client is absent or native code/patches changed, run `npm run ios` for a fresh native build (`napkin-app/package.json`). `postinstall` applies `patch-package`, so install dependencies before judging native-patch behavior.
4. Let `app/_layout.tsx::AuthGate` choose auth, onboarding, or the signed-in shell. `/` itself redirects to `/(tabs)/places` (`app/index.tsx`).
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
- There are **71 default-export `.tsx` modules** under `app/`: five layouts plus **66 route modules** (65 intended pages and the accidentally routable `/onboarding/OnboardingProgress` support component).
- `app/onboarding/OnboardingDraftContext.tsx` and `app/onboarding/styles.ts` are support modules, not routes.
- Root Stack configuration mentions `/day/[date]`, but no `app/day/[date].tsx` exists (`app/_layout.tsx`); it is a dangling registration, not a drivable route.
- The custom signed-in navigation is `app/_layout.tsx::BottomNavBar`: **FEED · TABLE · PLACES · PROFILE**. Expo's built-in tab bar is hidden in `app/(tabs)/_layout.tsx`; `/wishlist` and the legacy `/search` redirect both mark PLACES active.

## 2. Page map

Notation: `EF` = Supabase Edge Function; `RPC` = PostgREST function. Table names are the storage touched by the named hook/function, not a promise that every table renders visibly.

### Shell, primary tabs, and discovery

| Route | Component file | Feeding hook(s) / client | EF / RPC | Backing tables |
|---|---|---|---|---|
| `/` | `napkin-app/app/index.tsx` | `Redirect` | — | — |
| `/feed` | `napkin-app/app/(tabs)/feed.tsx` | `useFriendsFeed`, `useSocials`, `useFollowCandidates`, `useBrowsePublicLists` | `feed-friends` / `fn_friends_feed`; `feed-socials`; `user-profile`; `lists` | `entries`, `entry_photos`, `post_reactions`, `profiles`, `restaurants`, `clip_thumbs`, `lists`, `list_entries`, `follows` |
| `/journal` | `napkin-app/app/(tabs)/journal.tsx` | `useMySoloEntries`, `useUnreadCount` | RPC `fn_my_solo_entries`; EF `notifications` | `entries`, `entry_tables`, `restaurants`, `profiles`, `notifications` |
| `/log` | `napkin-app/app/(tabs)/log.tsx` | none; blank legacy placeholder | — | — |
| `/profile` | `napkin-app/app/(tabs)/profile.tsx` → `components/profile/ProfileScreenBody.tsx` | `useUserProfile`, `useUserSpots`, `useLedger`, list and import hooks | `user-profile`, `lists`, `wishlist`; RPC `fn_visible_entry_ids` | `profiles`, `entries`, `entry_photos`, `follows`, `lists`, `list_entries`, `table_members`, `tables`, `user_top_4`, `user_profile_takes`, `import_jobs` |
| `/places` | `napkin-app/app/(tabs)/places.tsx` | `useRestaurantSearch`, `useMyWishlist`, `useUserSpots`, `useNetworkMapPins`, `useMyLists`, `useSavedLists`, `useUserSearch`, `useSearchPublicLists`, `useSearchLocality`, `useClipTray` (`useActiveImports` + `useRecentImports` + `useExhaustedCompletenessItems`); `placesScreenState` | `places-search`, `restaurant-history?action=search`, `wishlist` (`list_imports`), `restaurant-completeness?action=exhausted`, `user-profile`, `lists`; RPC `fn_visible_entry_ids`; local App-Group import manifests | `restaurants`, `entries`, `profiles`, `follows`, `wishlist_items`, `lists`, `list_entries`, `import_jobs`, `restaurant_completeness_queue` |
| `/search` | `napkin-app/app/(tabs)/search.tsx` | param-preserving `Redirect` (`q`, `mode`) to `/(tabs)/places` | — | — |
| `/tables` | `napkin-app/app/(tabs)/tables.tsx` | `useTables`, `useTableActivity`, `useTableAtlas`, `useTableMembers`, `useTableTopFour`, `TableLedgerModule` → `useLedger` | `table-management`, `table-activity`, `table-atlas`, `user-profile?action=ledger` | `tables`, `table_members`, `entries`, `entry_photos`, `restaurants`, `profiles`, `suppers`, `supper_members`, `gatherings`, `gathering_rsvps`, `table_shares`, `wishlist_items`, `user_top_4`, `blocked_users`, legacy `table_nights` |
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
| `/create-entry` | `napkin-app/app/create-entry.tsx` | `useCreateEntry`, `useTables`, `useUserSearch`, `useRecentCompanions`, recent-post query, supper/merge/round helpers | `entry`, `user-profile`, `places-search`, `table-management`, `table-night` (legacy) | `entries`, `entry_photos`, `entry_companions`, `entry_participants`, `entry_tables`, `restaurants`, `profiles`, `follows`, `blocked_users`, `tables`, `table_members`, `suppers`, `supper_members`, legacy `table_nights`/`round_entries` |
| `/log-meal` | `napkin-app/app/log-meal.tsx` | `useCreateEntry`, `useTables`, `useUserSearch`, `useRecentCompanions`, supper attach/add helpers | `entry`, `user-profile`, `table-management` | `entries`, `entry_photos`, `entry_companions`, `entry_tables`, `tables`, `table_members`, `suppers`, `supper_members`, `profiles`, `follows`, `blocked_users` |
| `/entry-detail` | `napkin-app/app/entry-detail.tsx` | direct entry query, `useRestaurantHistory`, `usePostInteractions`, `useUserSearch`, `useRecentCompanions`, supper/legacy-round helpers | `restaurant-history`, `post-interactions`, `user-profile`, `entry`, `account`, legacy `table-night`; RPC `is_entry_publicly_eligible` | `entries`, `entry_tables`, `entry_photos`, `entry_companions`, `profiles`, `follows`, `blocked_users`, `restaurants`, `post_reactions`, `post_comments`, `post_comment_likes`, `suppers`, `supper_members`, legacy `round_entries` |
| `/diary` | `napkin-app/app/diary.tsx` | `useUserDiary` | `user-profile?action=diary`; RPC `fn_user_diary_page` | `entries`, `entry_photos`, `profiles`, `restaurants` |
| `/reviews` | `napkin-app/app/reviews.tsx` | `useUserReviews` | `user-profile?action=reviews` | `entries`, `entry_photos`, `profiles`, `restaurants` |
| `/spots` | `napkin-app/app/spots.tsx` | `useUserSpots` | `user-profile?action=spots` | `entries`, `profiles`, `restaurants` |
| `/taste` | `napkin-app/app/taste.tsx` | `useUserTaste`, `useUserSpots` | `user-profile?action=taste/spots` | `entries`, `profiles`, `restaurants` |
| `/ledger` | `napkin-app/app/ledger.tsx` → `components/ledger/LedgerScreen.tsx` | `useLedger` (`users.ledger(viewer, month, tz, tableId?)`) | `user-profile?action=ledger`; RPC `fn_visible_entry_ids` | `follows`, `profiles`, `tables`, `table_members`, `entries`, `entry_tables`, `entry_companions`, `supper_members`, `blocked_users` |
| `/top-fours` | `napkin-app/app/top-fours.tsx` | `useTopFours` and top-four editor hooks | `top-fours` | `user_top_4`, `user_top_4_history`, `user_claimed_cities`, `user_claim_nudge`, `entries`, `entry_photos`, `profiles`, `restaurants` |
| `/follows` | `napkin-app/app/follows.tsx` | `useFollowList`; `FollowButton` → `useFollow` | `user-profile?action=followers/following/follow` | `profiles`, `follows`, `blocked_users` |
| `/member/[userId]` | `napkin-app/app/member/[userId].tsx` | member-profile query | `member-profile` | `profiles`, `entries`, `table_members`, legacy `table_nights` |
| `/u/[identifier]` | `napkin-app/app/u/[identifier].tsx` → `components/profile/ProfileScreenBody.tsx` | `useUserProfile`, `useUserSpots`, list hooks | `user-profile`, `lists` | `profiles`, `entries`, `entry_photos`, `follows`, `lists`, `list_entries`, `table_members`, `tables`, `user_top_4`, `user_profile_takes` |
| `/restaurant/[id]` | `napkin-app/app/restaurant/[id].tsx` + `components/restaurants/RestaurantPageV3.tsx` | `useRestaurantPage`, `useReserveLink`, lookup/clip/featured-list/list-membership/wishlist hooks | `restaurant-history?action=page/reserve_link` + RPC `fn_visible_entry_ids`, `places-search`, `lists`, `wishlist` | `restaurants`, `entries`, `entry_tables`, `entry_photos`, `table_nights`, `table_night_participants`, `round_entries`, `profiles`, `blocked_users`, `tables`, `table_members`, `lists`, `list_entries`, `professional_critic_reviews`, `clip_thumbs`, `wishlist_items` |
| `/restaurant-history` | `napkin-app/app/restaurant-history.tsx` | `useRestaurantPage` (`restaurants.page`, preserving optional `tableId`), `useIsWishlisted`, `useMyLists`, `useListsContainingRestaurant`, `useRestaurantClippings` | `restaurant-history?action=page/social_clippings`, `wishlist?action=check`, `lists?action=list_mine/lists_containing` | `entries`, `entry_photos`, `table_nights`, `table_night_participants`, `round_entries`, `wishlist_items`, `lists`, `list_entries`, `clip_thumbs` |
| `/restaurant-reviews` | `napkin-app/app/restaurant-reviews.tsx` | `useRestaurantReviews` | `restaurant-history?action=reviews`; RPC `get_public_reviews_page` | `entries`, `entry_photos`, `profiles`, `restaurants` |

### Tables, Supper, Gather, and legacy rounds

| Route | Component file | Feeding hook(s) / client | EF / RPC | Backing tables |
|---|---|---|---|---|
| `/create-table` | `napkin-app/app/create-table.tsx` | `useCreateTable`, `useAddMember`, `useCreateInvite`, mutual-only user search | `table-management`, `user-profile` | `tables`, `table_members`, `table_invites`, `table_invitations`, `profiles`, `follows` |
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

Entry companion pickers list mutual follows only. Search uses `user-profile?action=search` with `mutual_only=true` and suppresses non-mutual rows; the recent row uses `user-profile?action=recent_companions`, which rechecks current mutual-follow and either-direction block state before hydration.

`/table-night` and `/table-night-detail` are retained code, not live product surfaces. The live group-meal model is Supper: `supper_id` clusters individual entries (`supabase/functions/entry/index.ts`, `hooks/suppers/index.ts`). Do not resurrect round UI when changing Tables.

- On a social Table with at least two current members, `TableLedgerModule` sits in Activity after `UpcomingStrip` and before invitations/feed content. Loading, query error, and an all-zero response are deliberately hidden with no spacer; populated state shows the first three rows and a trailing viewer rank when needed. The whole module opens `/ledger?tableId=` while leaving each trio member's summary available to accessibility readers.
- The Table Wishlist row and its `/table-map` consumer show up to three overlapping 22pt saver avatars and `+N` beyond three. One saver is one avatar with no count label; the numeric pill no longer exists.
- `/create-table` uses the standard back chevron, an upright 28/34 Newsreader Table-name field, `Invite`, and the single-line `no mutual follows yet` empty result. The enabled-without-invites CTA and mutation behavior are unchanged.

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

Source: `app/(tabs)/feed.tsx`, `components/feed/FollowingFeed.tsx`, `components/feed/ForYouFeed.tsx`, `components/feed/FriendFeedCard.tsx`, `hooks/feed/useFriendsFeed.ts`, `hooks/feed/useSocials.ts`.

- Tabs are **Friends** and **For You**, in that order; Friends is the default on every Feed landing. The internal Friends mode key remains `following`. Switching tabs is local/read-only.
- Friends initial load with no cached rows: centered spinner.
- Friends initial failure with zero rows: explicit error state and retry.
- Friends later failure with cached rows: existing cards remain; do not call the retained list an empty success.
- Friends settled zero rows: invitation/switch-tab empty state. This is intended-empty only when `isError` is false.
- Friends content: chronological friend entries in three visual weights; pagination adds a footer spinner. A sparse/end tail is deliberate when the backend reports no more eligible entries.
- For You independently loads social clips, people, and public lists. Any non-empty block renders even while a sibling block loads or fails.
- For You with no visible blocks and any active request: spinner. With any failed request: retry state. With all requests settled empty: “nothing here just yet” invitation.
- Friend-entry routing is literal and client-only (`feedWeight`): no prose + no photos → `ledger`; prose or one photo → paper-level `note` (one photo is a 42pt thumb); two or more photos, with or without prose → compressed `card`.
- Friends-feed rows carry no engagement controls. Compressed cards show only non-zero public like/reply counts; liking or replying requires opening entry detail. Tapping any weight opens entry detail, and long-pressing an owned entry opens owner actions.
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

Source: `app/restaurant/[id].tsx`, `app/restaurant-history.tsx`, `components/restaurants/LedgerLine.tsx`, `components/restaurants/ledgerLineFormatter.ts`, `components/restaurants/MemoriesStrip.tsx`, `components/restaurants/RestaurantHistoryRows.tsx`, `components/restaurants/RestaurantPageV3.tsx`, `components/restaurants/RestaurantRegularRow.tsx`, `hooks/restaurants/useRestaurantPage.ts`, `hooks/restaurants/useRestaurantClippings.ts`, `lib/restaurantPhoto.ts`.

- A persisted restaurant starts with a loading treatment. A Places payload/lookup can synthesize a ghost identity before a canonical row exists. Failure before identity exists shows the escaped “could not load this restaurant” shell with back + retry; a resolved `restaurant:null` is broken-empty, never blank paper.
- Cold success chooses one of two mastheads. Photo mode is a full-bleed, fixed-height pager capped at 52% of a short window, with safe-area back/pin fabs, name/meta over the photo, and paper overlapping its lower edge. Its status glyphs stay light only while the photo remains under the status bar, then turn dark over paper. No-photo success retains the prior plain top bar + upright typographic masthead without a spacer or alternate invitation copy.
- `resolveMastheadPhotos(page, { clippings, settled })` is the detail-page owner for entry photos → stored clip thumbnail → attributed Places hero → none. Entry photos come from `self_log[].photos`, `photos.from_your_table`, `photos.from_others`, and `public_reviews[].photo_url`; they dedupe and cap at four, reset to page one when the set changes, and open the backing entry when its id is present. The independent clipping query starts unsettled with `[]`; a settled durable `thumb_url` can upgrade a lower-priority Places or typographic masthead in place, while an entry photo is never displaced. Places mode requires `photo_source='places'`, uses the stored/proxied `photo_url`, and reuses the shared fail-closed Places credit parser; a credit matching the restaurant name is suppressed as redundant. Places and clip mastheads are inert.
- The ledger line is intended-empty when neither the viewer nor a rated followee has history. Self states are `you 4.5 · N visits` or `you · N visits`; FRIENDS is the average and cohort size from followee `public_reviews`, deduped by author. The current payload has no unrated-followee visit projection, so it never fabricates `friends · N been`. The row opens `/restaurant-history` and shows its chevron only when the viewer's visit count is positive; a friends-only row is inert. The friend spread derives from the same followee cohort and is intended-empty below three people.
- The memories strip follows the actions for persisted restaurants only. It keeps its authorized source order and first-12 cap, removes duplicate URLs, and also excludes every entry photo already promoted into the masthead. Ghosts, zero remaining authorized photos, and legacy payloads without the `photos` projection render no section or spacer. Entry-backed tiles open entry detail; projection rows without an entry id stay inert.
- `FROM FRIENDS` renders at most two followee public notes and opens `/restaurant-reviews`; with public reviews but no followee cards it collapses to one `REVIEWS · all N reviews` doorway row. `FROM <TABLE>` renders at most two rows from one authorized `table_notes` share-edge group and opens `/(tabs)/tables?selected=&section=activity`. Table-note authors must be current members of that exact shared Table; the rings never cross-feed.
- When an older server omits `self_log`, its compatible `personal.visit_count` controls the viewer's ledger count and history tap gate. Warm scoped and unscoped arrivals reuse the exact `restaurants.page(id, tableId?)` cache; a cold `/restaurant-history?id=` deep link shows loading, then the ledger, and its back control replaces to the restaurant when no parent exists. Query error without cache is broken-empty (`ErrorState` + retry); a warm refetch error keeps cached content and shows a one-line retry state on both screens.
- The amber `RestaurantRegularRow` follows the masthead ledger/actions/memories group but is not inside the ledger's self-history gate: a followee can hold the rolling-90-day crown when the viewer has no visit here. It is hidden when `regular_detail` is null; crown-read failures are non-fatal and suppress only this row, never the core restaurant page. Eligible meals are rated restaurant entries; cohort filtering precedes the shared visibility RPC, so public strangers and unauthorized private logs never affect the crown while authorized Table/companion/Supper rows can.
- `/restaurant-history` renders every viewer-authored visit as a paper-level row, including unrated, non-host, revealed, and closed legacy takes. Rows keep full notes, optional companions, and 96pt photo layouts (one/two squares or a three-up fill with `+N` on overflow), separated only by `dividerSoft`; there is no card fill or shadow. A resolved empty `self_log` is an intended empty invitation; an omitted legacy-server projection shows the degraded inline retry state and never fabricates an empty ledger. `table_notes` follows the same optional-projection rule, so omission hides the section. `ELSEWHERE` is intended-empty unless a pin, containing list, or self clipping exists. It is read-only: row navigation and list doorways mutate nothing.
- Featured lists, social clips, Table atlas context, hours, phone, website, Google rating, and reserve are conditional real-data sections. Reserve is hidden until the lazy resolver yields a real booking page. Hours make an `open until` claim only with `place_details.open_now === true`; otherwise Details uses the weekday line. Google is the last faint DETAILS fact (`N.N on google` plus `· N ratings` only when a positive count exists), can be the block's only row, and appears nowhere in the masthead ledger. On Socials keeps its rail behavior under the shared left-kicker heading. The Tables `section=activity` arrival is consumed once per stable navigation params object; later pane/Table changes stay selected, while a new params object re-applies and omitting `section` preserves the current pane.

### Profile sections

Source: `components/profile/ProfileScreenBody.tsx`, `components/profile/ProfileNapkinsLine.tsx`, `hooks/users/useUserProfile.ts`, `hooks/users/useUserSpots.ts`, `hooks/users/useLedger.ts`, `supabase/functions/user-profile/index.ts`.

- Missing route identity or initial load: spinner. Query error: “Couldn't load”. `isNotFound`: not-found page.
- `blocked_by_viewer`: blocked-user stub with an unblock doorway. This is not a missing profile.
- `private_stub`: identity, relationship controls, and allowed counts remain; journal/palate content is withheld with a private-account message.
- Normal self/public profile: identity header plus conditional palate, top-four, quick-take, list, activity, and spot sections.
- The monthly napkins line is rendered and fetched only for `isSelf && inTab`; its cache key uses the authenticated viewer id. `/u/[identifier]` neither paints nor enables the ledger query. It opens the friends-scoped `/ledger` one level down from Profile.
- Self with zero logs: cold-start nudge. Empty top fours, quick takes, lists, or imports are omitted by their array/gate logic; imports are self-only and appear when an action is owed.
- Intended empty is an explicit server state (`private_stub`, `blocked_by_viewer`, `isNotFound`) or successful empty section array. Broken empty is `isError`, an unresolved identity, or a section request that failed while the main profile stayed cached.

### The ledger

Source: `app/ledger.tsx`, `components/ledger/LedgerScreen.tsx`, `hooks/users/useLedger.ts`, `supabase/functions/_shared/ledger.ts`, `supabase/functions/user-profile/index.ts`.

- Friends scope is the viewer plus their 500 most-recently-followed accounts (maximum cohort 501). This implementation cap is intentionally not on-screen copy.
- Table scope is the 500 most-recent current members by `joined_at`; it is entered only from a Table doorway. Membership is checked after month/time-zone validation and before candidate reads; non-members receive structured `NOT_A_MEMBER` 403. Private solo entries remain invisible while entries shared through an authorized Table/companion/Supper scope can survive the same gate.
- Month and IANA time zone are required. The server derives half-open local-month bounds; past months snapshot at month end, the current month ends at now, and future months return structured `FUTURE_MONTH` 400.
- Every meal, crown-window, and new-place lookback read uses separate paginated `visited_at` and null-`visited_at`/`created_at` branches. Cohort filtering happens before one deduplicated visibility pass over all non-self candidates; self rows bypass RPC. Meals, visible-first new places, and crowns are aggregated only after that gate.
- The masthead kicker identifies only `FRIENDS` or the Table name; the picker owns the single month label and there is no scope toggle. The month arrows move one calendar month, refresh their future gate when the route regains focus, and use 44pt hit targets. A friends ring with no followees shows `follow a few friends and the ledger fills itself`; loading and error remain distinct states. Rows are read-only, ranked, virtualized through `FlatList`, and the viewer row alone uses `primaryMuted`.

### Wishlist and Map

Source: `app/wishlist.tsx`, `app/table-map.tsx`, `components/wishlist/WishlistMapView.tsx`, `components/wishlist/WishlistGrid.tsx`, `components/wishlist/TableWishlistRow.tsx`, `hooks/wishlist/useMyWishlist.ts`, `hooks/users/useUserSpots.ts`, `hooks/users/useNetworkMapPins.ts`, `hooks/wishlist/useTablesOverlap.ts`.

The former bottom-nav Map item is superseded by Places. `/wishlist` remains a supported direct/deep-link workspace and still uses its existing Saved/Been/Network behavior; the four-item bar marks PLACES active there.

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

### Places (supersedes the Search tab and nav Map item)

Source: `app/(tabs)/places.tsx`, `components/wishlist/WishlistMapView.tsx`, `components/wishlist/ClipTray.tsx`, `components/wishlist/clipTrayUtils.ts`, `components/sheets/SnapSheet.tsx`, `components/places/PlacesListsPane.tsx`, `components/places/placesPresentation.ts`, `components/search/SearchLocalityBar.tsx`, `components/search/PeopleSearchPane.tsx`, `components/search/ListsSearchPane.tsx`, `components/search/RecentSearchesList.tsx`, `components/search/ListRow.tsx`, `hooks/lists/useMyLists.ts`, `hooks/lists/useSavedLists.ts`, `hooks/users/useNetworkMapPins.ts`, `hooks/search/useRestaurantSearch.ts`, `hooks/search/placesScreenState.ts`, `hooks/search/useSearchLocality.ts`, `providers/AuthProvider.tsx`.

- **Browse header / nearby:** `places · lists · people` is always present above the sheet shelf. Places defaults to the deduped union of pinned and been restaurants; overlaps render once with the been marker and friends never leak into `all`. Pinned, been, and friends are mutually exclusive narrowing filters, and tapping the active chip releases to `all`; the horizontal locality/filter line keeps every chip reachable. Valid coordinates permit nearest-first order and distance tokens; denied/no coordinates preserve source order and omit distance. A cold active-source failure renders retryable broken-empty; a refetch failure with cached rows preserves those rows and adds compact inline retry.
- **Browse Lists shelf:** switching to Lists leaves the current detent and last committed Places map unchanged. One sheet-connected native list renders Your lists, `new list`, then Saved lists with author metadata; taps push one level to `/list/[id]`, so back returns with Lists still active. The shelf distinguishes loading, my-lists cold failure, settled empty (`no lists yet` plus creation), rows, and warm/partial retry states. Saved lists are requested only while the zero-query shelf is visible.
- **Friends layer:** selecting friends alone arms caller-scoped `user-profile?action=network_map_pins`; all/pinned/been make zero network-pin calls. Avatar-face markers carry the followee entry payload, but rows replace the rating cell with the followee name and captions read `<friend> · N friends been`; neither surface exposes that followee rating as a friends-tier numeral. Empty reads `nothing from friends yet`; cold and warm network failures use full and inline retry respectively. Row and caption taps always open the restaurant page.
- **Clip doorway:** the unchanged 48×48 download pill rests with no attention, shows an indeterminate terracotta ring while any local manifest is `reading`/`saving`, or shows the exact first-page needs-look item count when nothing is clipping; clipping wins and `review`/`kickoff`/`failed` manifests stay visually quiet. Search mode removes the whole pill without shifting the search or chip rows. Every pill state opens the warm-paper clip tray: `CLIP A PLACE` launches the existing URL/video/screenshot import paths through a nested `ImportLinkSheet`, and `LANDED` renders live local manifests followed by newest saved batches. Needs-look rows group exhausted items by `job_id`; at most five rows render, then `older ·` opens `/import-progress`. No-history is intended-empty with the single line “what you clip lands here.” Batch/detail pushes wait for tray dismissal, so `/imports/[jobId]` back returns one level to Places with the tray closed. The mounted first exhausted page polls at 60s; recent imports never poll and update from the existing exact invalidations.
- **Focused search / sections:** focusing the shared field or arriving with `q` opens the sheet at full height; in the guidance state (empty or below-threshold query) the sheet is locked and the map is dimmed and frozen, while the results state unlocks the sheet and commits the live result projection so result pins are usable when the sheet is dragged down. Focus replaces the search glyph with a back chevron, keeps locality visible, hides browse chips/import/filters, and keeps the `places · lists · people` header at the top of the sheet body. Empty Places search renders only data-bearing sections in order: RECENT (max 8 + clear), NEAR YOU (nearest 6 from pinned ∪ been), YOUR LISTS (max 4). NEAR YOU is absent without auto-locality coordinates and in explicit-city mode. One character shows the threshold line; clearing returns to sections. Back or the map scrim dismisses the keyboard, clears the query, and restores the previous browse detent and layer.
- **Searching / results:** two or more characters replace focused sections and enable both `places-search` and `restaurant-history?action=search` only while the `places` segment is active. Results render labelled rating tiers (`you`, `friends`, or `google`); Google always reads `<value> · google`. Results unlock the sheet and commit the live result projection; Lists and People continue to freeze the last Places projection. A cold failure from either search source renders broken-empty; a failed refresh keeps merged cached rows with inline retry.
- **Selected pin / ghost pin:** marker selection remains controlled by per-user `placesScreenState`; the compact caption opens the same route as its row. Opening a row or pin carrying a full sanitized Place never buys a duplicate Details call. Text-search ghosts are explicitly marked deferred, so the restaurant page may buy one required Details enrichment when their payload is still thin (`googleRating == null` is thin); a full enriched payload keeps the production lookup gate disabled.
- **Sheet geometry / handoff:** the Places sheet exposes about 250pt at browse peek including navigation, without changing List Detail defaults; focused search locks FULL. A bottom-left frosted `list` / `map` control derives both its label and offset from the settled detent/inset, moves PEEK/HALF → FULL or FULL → PEEK, and hides in search or behind a selected-pin caption. Places, Lists, People, and focused-section/state lists use the same native-list scroll adapter. Every segment, shelf-state, branch, and debounced-query transition composes a distinct `contentKey`; changing it remounts the content subtree and resets native handoff state.
- **Pagination / repair / share:** the all and pinned browse ledgers page the 40-row wishlist cursor on end reached and show a `+` count until exhaustion; been, friends, Lists, People, and every query never request the next wishlist page. Coordinate-less loaded pins surface the existing repair murmur/sheet only under all or pinned. The pinned-only share icon opens the unscoped wishlist handoff with the unfiltered loaded pinned total even when facets narrow the visible ledger.
- **Recent searches:** successful per-user search queries appear in the focused-empty RECENT section. Selecting one searches again; clear removes the scoped history. This is the reader paired with `searchCache.addRecent`.
- **Lists search / shelf:** `mode=lists` selects Lists, focuses the shared field, and explicitly clears stale immediate, debounced, and stored query state when `q` is absent. Zero characters show the same Your/Saved shelf as browse, exactly one character shows `type one more letter`, and two or more reuse `ListsSearchPane` public results.
- **People at the focused FULL detent:** reuses `PeopleSearchPane`. An empty query suggests the viewer's following list plus unfollowed `co_diners`; companion-picker recents are not reused here. An arrival without `q` clears stale query state. Both restaurant queries are disabled, including while typing. Pins, selection, and camera remain the last projection committed by Places browse; the frozen snapshot is never committed in focused search or outside the Places segment. Leaving People for another segment stays FULL; leaving focused search restores the prior browse detent.
- **People-hidden fallback:** with `FRIEND_TEST.hidePeopleSearch`, `mode=people` still reveals the two-segment header but selects Places in focused FULL mode and permits restaurant search.
- **Locality / distance:** auto mode uses granted coordinates for bias, the native dot, locate, distance, and nearby order. A selected city sends only `city`; real device coordinates remain only the native dot/locate target. Explicit-city and denied/no-location rows/captions omit distance, preserve source/server order, and frame the result collection without geocoding.
- **Framing stability:** result-collection framing depends on a stable selection dispatcher whose latest parent callback lives in a ref. An inline `onSelectedChange` identity change cannot cancel the pending 260ms fit.
- **Per-user isolation:** query, selection, scroll, snap, active segment (including Lists), layer filter (including friends), search/People detent restoration, locality, caches, and recent-search storage reset at auth identity change. The old device-global recents key is deleted, never migrated.

## 4. Write paths

`SAFE` means self-scoped and reversible or device-local. `NEVER` means irreversible, shared, sends/notifies another person, changes moderation/visibility, or deletes. **Live verification remains read-only for both labels.** Read-only navigation controls are omitted unless they request an OS permission or launch outbound contact.

| Surface / mutating control | Call / storage | Refusal conditions enforced by UI/server | Live safety |
|---|---|---|---|
| Auth: sign in / OAuth | Supabase Auth via `providers/AuthProvider.tsx`, `app/auth.tsx` | valid credentials/provider result; timeout/error stays on auth | SAFE (session-scoped) |
| Auth: sign up, password-reset email | Supabase Auth | valid email/password; rate/provider errors | NEVER — creates identity or sends email |
| Auth: sign out | `AuthProvider.signOut`; clears session/query state | authenticated session | SAFE |
| Entry: create log/note, upload photos | `useCreateEntry` → EF `entry`; RPC `fn_create_entry_with_tables`; storage/RPC photo append | auth, restaurant/note contract, rating when required, uploads settled, selected Table memberships; missing visibility derives `'table'` with any Table id and `'friends'` otherwise | NEVER — creates visible/shared content |
| Entry: edit, merge restaurant, attach to Supper | EF `entry` update/merge/attach actions | author; target/membership/restaurant compatibility; valid Supper | NEVER — changes shared content |
| Entry: tag companions | `CompanionPickerSheet` → EF `entry` create/`update-companions`; EF `user-profile` search/recent actions | author; not a mutual follow / blocked → dropped server-side | NEVER — grants entry access and may notify |
| Entry: delete | EF `entry` or `account` path | author/authorized owner; confirmation | NEVER — deletion |
| Entry: like/unlike | `usePostInteractions` → EF `post-interactions` | auth and permission to view eligible entry | NEVER — social signal/notification |
| Entry: add/edit/delete comment, comment-like | EF `post-interactions` | auth; table membership for Table content; public eligibility and reply-permission gates | NEVER — sends or deletes social content |
| Entry: report/block author | EF `account` | auth; valid non-self target/content | NEVER — moderation/relationship impact |
| Wishlist: pin/unpin own spot | EF `wishlist`; pin sheets on restaurant/search/import | auth, canonical restaurant; dedupe | SAFE — self-scoped/reversible, but publicly visible when account is public |
| Wishlist: fix/repoint unmappable spot | EF `places-search`/`wishlist` correction | auth, owned/import row, valid replacement | SAFE — self-scoped/reversible data repair |
| Wishlist: local filters, source/list choice, clear local import history | component/device state | source available; no server membership change | SAFE |
| Places locality sheet / Map: request location | locality sheet or Map → `useNearbyLocation` → OS permission | user-initiated; platform permission state | SAFE only on disposable simulator/device |
| Places clip tray: paste URL / choose video or screenshot | nested `ImportLinkSheet` → existing `resolve-url`, local import queue, `wishlist`, list/Table destination paths | authenticated owner, valid URL or selected media, valid candidates/destinations; Table membership for a shared destination | NEVER — starts an import and can create public saves, list entries, or Table shares |
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

Successful entry creation, editing, deletion, Supper-take creation, and legacy merge creation invalidate the exact `restaurants.page(restaurantId)` prefix plus that viewer's restaurant history and the restaurant reviews key. This refreshes restaurant counts and memories without blanket-invalidating every restaurant page.

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
| Restaurant detail shows a typographic masthead instead of a photo | The resolver found no authorized entry photo, durable clipping thumbnail, or attributed Places hero. This is an intended fallback, not a loading state. | `napkin-app/lib/restaurantPhoto.ts`; `napkin-app/app/restaurant/[id].tsx`; `napkin-app/components/restaurants/RestaurantPageV3.tsx` |
| Restaurant ratings do not combine | The single ledger line keeps YOU and rated FRIENDS as sibling signals; Google is a faint DETAILS-only fact and is never input to a Napkin aggregate. Table notes are not FRIENDS. | `napkin-app/components/restaurants/ledgerLineFormatter.ts`; `napkin-app/lib/restaurantPageV3.ts`; `napkin-app/components/restaurants/RestaurantPageV3.tsx` |
| Restaurant Napkin count or photo rails differ by viewer | This is privacy filtering, not missing data. The service-role `restaurant-history` endpoint sends separate aggregate and photo batches through `fn_visible_entry_ids`. The aggregate filters on privacy only (blocks, private accounts, and private visibility), never note length; photos additionally require canonical review-content parity. Authorized Table/companion/Supper scopes remain. | `supabase/functions/restaurant-history/index.ts`; `supabase/migrations/20260826155643_ticket_217_restaurant_privacy_gates.sql` |
| Only two notes appear inline per restaurant ring | Each of the Friends and chosen-Table sections caps at two. Their independent “all” doorways lead to public reviews and the exact Table Activity pane respectively. | `napkin-app/components/restaurants/RestaurantPageV3.tsx`; `napkin-app/lib/restaurantPageV3.ts` |
| Journal includes Table-shared entries despite `useMySoloEntries` name | This is current scope by design: all entries authored by the user, no Table filter. | `napkin-app/hooks/entries/useMySoloEntries.ts`; `supabase/migrations/20260616000100_my_journal_all_entries.sql` |
| Feed has no emoji reaction picker | Heart-only like/unlike is deliberate; legacy emoji-shaped backend fields remain compatibility data. | `napkin-app/components/feed/FeedActionRow.tsx`; `supabase/functions/post-interactions/index.ts` |
| Round/table-night cards or routes exist | They are legacy/dead product code. New group meals are Suppers grouped by `supper_id`. | `napkin-app/app/table-night.tsx`; `napkin-app/app/table-night-detail.tsx`; `napkin-app/hooks/suppers/index.ts`; `supabase/functions/entry/index.ts` |
| Private profile looks like a partial/broken profile | `private_stub` is an explicit server variant; a blocked view is a separate `blocked_by_viewer` variant. | `napkin-app/components/profile/ProfileScreenBody.tsx`; `supabase/functions/user-profile/index.ts` |
| Saved pin appears on somebody's profile without a review | Saves are standalone public-by-default signals gated only by account privacy, read by `fn_restaurant_saves_visible`. | `supabase/functions/restaurant-history/index.ts`; `supabase/migrations/20260710160000_fn_restaurant_saves_visible.sql` |
| Import progress remains on “reading” | On-device OCR/perception and background list draining can legitimately outlive a navigation transition; inspect manifest phase and job heartbeat before calling it stuck. | `napkin-app/hooks/wishlist/useProcessImportQueue.ts`; `napkin-app/lib/largeImportJob.ts` |

### Doctrine/code contradictions visible at time of authoring

These are not silently resolved here; agents should preserve the code truth and escalate the product mismatch.

1. **Bottom-nav `+`: RESOLVED by TICKET-228.** The founder-approved bar is FEED · TABLE · PLACES · PROFILE with 24px outline Ionicons and uppercase labels. There is no floating `+`; restaurant detail remains the write doorway.
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

### Places states and failure

1. Open `/places` with overlapping pinned/been fixtures. Capture the always-on segment header, default union with no chip lit, and bottom-left `list` control; narrow to pinned, release it to all, then switch to been. Tap `list` for the FULL ledger and `map` for PEEK. Separately reject each active source so intended-empty and cold broken-empty stay distinct; seed cached rows and confirm inline retry.
2. From browse peek, focus the field and capture the FULL focused-empty screen with RECENT / NEAR YOU / YOUR LISTS fixtures. Repeat with all three sources empty and confirm the single muted search invitation renders. Confirm browse chips are absent, locality remains, and the dimmed map cannot change selection. Type `parisik` and capture the result row; clear for sections, then use the back chevron and map scrim separately to verify the prior detent and union pins return.
3. Enter a below-threshold query and confirm no restaurant request starts. With a valid query, capture spinner, zero results, cold error, and cached-row refresh error. Confirm browse peek leaves about 250pt visible including navigation.
4. Set locality to Paris while simulator coordinates remain in London; focus the empty field and confirm NEAR YOU is absent. Search `parisik` and confirm the result row has no distance token and that no geocode request is issued; drag the results sheet down and confirm result pins are shown.
5. In browse, enter Lists at PEEK and capture Your lists → `new list` → Saved lists while the map and detent stay fixed. Drive loading, empty, my-lists cold failure, saved-lists partial failure, and populated states. Seed a saved query, then open `/(tabs)/places?mode=lists` without `q`; confirm the focused field is cleared and the same shelf appears. Enter one character for the threshold line, then two for public results. Scroll the shelf at FULL, return to offset zero, and verify a downward drag returns the sheet.
6. With People visible, enter it from peek and half: it must rise to full, clear a stale query on a no-`q` mode arrival, freeze pins/selection/camera, issue no restaurant searches, and restore the prior detent on exit. Scroll People away from zero and verify native-list handoff. Repeat `mode=people` with the hidden flag in a test fixture for the two-segment Places fallback.
7. With fixture/local import state only, capture the clip doorway in four states without exercising a live write: resting pill + tray empty; `reading`/`saving` manifest with ring + clipping row; landed batch with two exhausted items showing count dot + matching amber row chip; and plain five-row history + `older ·`. Advance the local manifest into landed data while the tray remains open and confirm the row changes without reopening. Capture search mode with the pill absent and compare the search/chip y-offsets against all four browse frames. Open a landed row, then go back and confirm Places returns with the tray closed. Verify URL/video/screenshot write paths in isolated tests only.
8. Select friends with a fixture network pin, capture the avatar face, row (`clara` rating cell plus headcount metadata), selected caption, and restaurant route; confirm there is no rating numeral or Google suffix. Drive cold empty/error and cached refresh-error states, then release friends to confirm all restores without friend pins.
9. Load more than 40 pins and drive the FULL all/pinned ledger to exhaustion, confirming `40+` before the next page and an exact count after. Include one coordinate-less pin and open its repair sheet. Under pinned, narrow a facet and confirm the handoff still reports the full loaded pinned total.

### Gather expired/rescue state

1. **Fixture/test only:** return an expired, unrescued Gather hosted by the viewer from EF `gatherings?action=get`.
2. Open `/gathering/[id]?rescue=1`; the rescue Table sheet auto-opens once, backed by `useRescueGathering` (`app/gathering/[id].tsx`).
3. Mock a non-host and a `GONE_CODES` response separately to verify the rescue refusal and terminal-state treatment.

### Unmappable Map rows and denied location

1. Mock successful wishlist/list rows with null coordinates; open Map and the unmappable repair sheet (`components/wishlist/UnmappedSpotsSheet.tsx`).
2. Mock the same source request failing to distinguish broken-empty from unmappable data.
3. Set simulator location permission to denied and confirm the global map remains usable while nearby UI explains/requests permission (`hooks/useNearbyLocation.ts`).
