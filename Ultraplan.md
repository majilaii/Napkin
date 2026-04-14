ontext
Napkin's moat is Tables -- a shared dining catalogue for friend groups. The concept: "a group profile entity, not a group chat." You create a Table (e.g., "Sunday Roast Club"), you eat together, everyone rates, and over time you build a shared history of your crew's dining life.
What exists today: Group management shell (create table, invite members, see avatars). The DB schema for the entire Tables system is already deployed in Supabase -- tables, table_members, table_nights, table_night_participants, etc. Edge functions for table-management and table-members work. The entries table already has table_id, table_night_id, and visibility columns.
What's hollow: Every sub-tab says "coming soon." The "Start Table Night" button shows an alert. No table-night or table-activity edge functions. No realtime hooks. The logging flow has zero connection to Tables. The table is an empty room with chairs.
What we're cutting: Explore/Friends Feed is out of scope. 100% Tables focus.

Architecture: How the pieces connect
┌─────────────────────────────────────────────────────────────────────────┐
│                         TABLES TAB (tables.tsx)                         │
│  ┌─────────────┐  ┌──────────┐  ┌─────────┐  ┌──────┐  ┌───────────┐  │
│  │ Activity    │  │ Wishlist │  │ Stats   │  │Top 4 │  │ Members   │  │
│  │ Feed       │  │          │  │         │  │      │  │ /Invite   │  │
│  └──────┬──────┘  └────┬─────┘  └────┬────┘  └──┬───┘  └───────────┘  │
│         │              │             │           │                      │
│         ▼              │             │           │                      │
│  ┌──────────────┐      │             │           │                      │
│  │ Table Night  │      │      ┌──────┴───────┐   │                      │
│  │ Event Cards  │      │      │ Computed     │   │                      │
│  │ (hero)       │      │      │ from entries │   │                      │
│  │              │      │      │ + nights     │   │                      │
│  │ Solo Share   │      │      └──────────────┘   │                      │
│  │ Cards        │      │                         │                      │
│  └──────┬───────┘      │                         │                      │
└─────────┼──────────────┼─────────────────────────┼──────────────────────┘
          │              │                         │
          ▼              ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        SUPABASE (existing schema)                       │
│                                                                         │
│  entries ──────────┐                                                    │
│  (table_id,        │   table_nights ───── table_night_participants      │
│   table_night_id,  │   (status, is_async)  (rating, ready, notes)       │
│   visibility)      │                                                    │
│                    │   user_restaurant_status                            │
│                    └── (want_to_try = wishlist)                          │
│                                                                         │
│  Edge Functions:                                                        │
│  ✅ table-management  ✅ table-members                                  │
│  🔲 table-activity    🔲 table-night    🔲 table-wishlist              │
└─────────────────────────────────────────────────────────────────────────┘

Phased Implementation
Phase 1: Activity Feed -- Make the Table Alive
The feed IS the table. Without it, nothing else matters. Everything we build flows into this feed.
Backend:

New edge function: table-activity (supabase/functions/table-activity/index.ts)

GET -- Fetch paginated entries where table_id matches, joined with profiles + restaurants
Returns two shapes: Table Night cards (grouped by table_night_id, all participants' ratings) and solo shares (individual entries shared to the table)
Query: entries WHERE table_id = X, LEFT JOIN table_nights, LEFT JOIN restaurants, LEFT JOIN profiles
Paginated with limit + offset params



Frontend:

New hook: useTableActivity (hooks/tables/useTableActivity.ts)

TanStack Query infinite query for paginated feed
Query key: queryKeys.tables.activity(tableId)


New component: ActivityFeed (components/tables/ActivityFeed.tsx)

FlatList with pull-to-refresh
Empty state: "No activity yet. Share a meal or start a Table Night!"


New component: TableNightCard (components/tables/TableNightCard.tsx)

Hero treatment: restaurant name, group average rating, participant avatars + individual ratings
Expandable "See what everyone thought" section
Photo grid if photos exist


New component: SoloLogCard (components/tables/SoloLogCard.tsx)

Smaller card: avatar, restaurant, rating, notes preview


Wire into tables.tsx -- Replace the "Activity feed coming in Phase 3" placeholder with real ActivityFeed

Files to modify:

napkin-app/app/(tabs)/tables.tsx -- swap placeholder for ActivityFeed
napkin-app/lib/queryKeys.ts -- add activity query key
napkin-app/components/tables/index.ts -- export new components

Files to create:

supabase/functions/table-activity/index.ts
napkin-app/hooks/tables/useTableActivity.ts
napkin-app/components/tables/ActivityFeed.tsx
napkin-app/components/tables/TableNightCard.tsx
napkin-app/components/tables/SoloLogCard.tsx


Phase 2: Share to Table -- Get Content Into the Feed
The feed needs food. Connect the existing logging flows to Tables.
Backend:

Modify entry edge function (supabase/functions/entry/index.ts)

Accept optional table_id and visibility in POST body
When present, set them on the created entry
No new DB migration needed -- columns already exist



Frontend:

New component: TableShareToggle (components/tables/TableShareToggle.tsx)

Toggle + multi-select table picker
Shows user's tables as chips/checkboxes
Used inside both MealLogModal and LogModal (restaurant flow)


Modify MealLogModal (components/meal-log/MealLogModal.tsx)

Add TableShareToggle to the form
Pass selected table IDs through MealLogData


Modify LogModal (components/restaurant/LogModal.tsx)

Same: add TableShareToggle


Modify useCreateEntry (hooks/entries/useCreateEntry.ts)

Pass table_id and visibility through to the edge function
Invalidate queryKeys.tables.activity(tableId) on success



Files to modify:

supabase/functions/entry/index.ts -- accept table_id + visibility
napkin-app/components/meal-log/MealLogModal.tsx -- add table share toggle
napkin-app/components/restaurant/LogModal.tsx -- add table share toggle
napkin-app/hooks/entries/useCreateEntry.ts -- pass table fields, invalidate table activity cache
napkin-app/app/(tabs)/_layout.tsx -- pass table data through to submit handler

Files to create:

napkin-app/components/tables/TableShareToggle.tsx


Phase 3: Quick Post (Async Table Night) -- Group Logging Without Real-Time
The simplest way to log a group meal. Someone says "we ate at Carbone last night," tags who was there, everyone adds their rating on their own time. No WebSocket, no countdown, no sync.
Backend:

New edge function: table-night (supabase/functions/table-night/index.ts)

POST /start -- Create a table_night with is_async = true, add host as participant, create entries for tagged members
POST /rate -- Submit rating + notes for a participant (upsert on table_night_participants)
GET /status -- Get night with all participants, ratings, ready states
Keep the function simple for now: just async mode. Real-time phases come in Phase 4.



Frontend:

New screen flow for Quick Post -- Triggered from "Start Table Night" button on Tables tab

Step 1: Search + select restaurant (reuse existing RestaurantSearch)
Step 2: Select participants from table members
Step 3: Add your rating + notes + photos
Step 4: Post -- creates the table_night + your participant entry
Tagged members see it in the table activity feed and can tap to add their rating


New component: StartTableNightModal (components/tables/StartTableNightModal.tsx)

Multi-step modal: pick restaurant -> pick members -> rate -> post


New component: AddRatingSheet (components/tables/AddRatingSheet.tsx)

Bottom sheet for members to add their rating to an existing Table Night
Shown when tapping a TableNightCard where you haven't rated yet


New hooks:

useStartTableNight -- mutation to create async table night
useSubmitRating -- mutation to add/update your rating on a table night


Modify TableNightCard -- Add "Add your rating" CTA for members who haven't rated yet

Files to create:

supabase/functions/table-night/index.ts
napkin-app/components/tables/StartTableNightModal.tsx
napkin-app/components/tables/AddRatingSheet.tsx
napkin-app/hooks/tables/useStartTableNight.ts
napkin-app/hooks/tables/useSubmitRating.ts

Files to modify:

napkin-app/app/(tabs)/tables.tsx -- wire up "Start Table Night" button to modal
napkin-app/components/tables/TableNightCard.tsx -- add CTA for unrated members
napkin-app/components/LogTypeActionSheet.tsx -- enable the "Table Event" option, route to table night flow


Phase 4: Full Table Night (Real-Time Reveal) -- The Hero Feature
The synchronized rating + reveal game. This is the Mario Party moment.
Backend:

Extend table-night edge function:

POST /start with is_async = false -- creates night in rating status
POST /ready -- mark participant as ready
POST /reveal -- host triggers reveal (requires all participants ready), sets status to revealed, sets revealed_at
Auto-generate recap data (avg, highest, lowest, controversy/stddev)



Frontend:

New screen: app/table-night/[id].tsx -- Full-screen Table Night experience

Phase display based on table_nights.status: rating -> revealed
Rating phase: hidden rating input, "Ready" button, live participant status
Reveal phase: countdown animation, card flip, recap stats


New hook: useTableNightRealtime (hooks/tables/useTableNightRealtime.ts)

Supabase Realtime subscription on table_night_participants + table_nights
Updates participant ready states live
Triggers phase transitions when status changes


New components:

ParticipantList -- avatar checkmarks showing who's ready
CountdownReveal -- 3-2-1 animation (React Native Reanimated)
RevealAnimation -- card flip showing each person's rating
RecapStats -- auto-generated stats (avg, highest, lowest, controversy)



Files to create:

napkin-app/app/table-night/[id].tsx
napkin-app/app/table-night/_layout.tsx
napkin-app/hooks/tables/useTableNightRealtime.ts
napkin-app/components/table-night/ParticipantList.tsx
napkin-app/components/table-night/CountdownReveal.tsx
napkin-app/components/table-night/RevealAnimation.tsx
napkin-app/components/table-night/RecapStats.tsx
napkin-app/components/table-night/RatingInput.tsx

Files to modify:

supabase/functions/table-night/index.ts -- add real-time flow endpoints
napkin-app/components/tables/StartTableNightModal.tsx -- add toggle for real-time vs async


Phase 5: Wishlist -- "Where Should We Eat Next?"
Backend:

Use existing user_restaurant_status.want_to_try per-member, scoped to table context
New edge function table-wishlist: aggregate want_to_try restaurants across table members, detect overlaps

Frontend:

WishlistTab component: list of restaurants with overlap counts ("3/4 want to try")
"Add to wishlist" action from restaurant search
Sort by overlap count (the "Perfect Pick" feature from the design doc)


Phase 6: Stats + Top 4
Computed from activity data. Stats: total nights, total restaurants, group average, generous rater, harsh critic, most divisive restaurant. Top 4: admin-curated group favorites.

What We're Explicitly NOT Building (For Now)

Predictions game (Phase 3 from design doc) -- adds complexity to Table Night for marginal fun
Dish-level ratings -- the README explicitly says "NO dish-level ratings for V1"
Photo likes -- nice-to-have, not core
Table Wrapped (annual stats) -- polish phase
Ghost Tags / Open Seat tagging -- growth hack, not core catalogue
External sharing / auto-wishlist from TikTok -- post-MVP
Push notifications -- need Apple Developer setup, separate effort
Explore/Friends Feed -- cut entirely for this sprint

Simplifications from the Design Doc
The design doc (TABLES_DESIGN.md) is thorough but over-specced for a first pass. Key simplifications:
Design Doc FeatureSimplificationPredictions game in Table NightSkip entirely for nowDish-level ratings (table_night_dishes)Skip -- restaurant-level onlyPhoto likes (table_night_photo_likes)Skip -- photos exist but no like mechanicCross-posting privacy matrixSimple: your entry, your choice to share to table or notBundled feed eventsSkip -- just show chronological entriesTable WrappedPhase 6+

Implementation Order + Milestones
PhaseMilestoneYou can test...1: Activity FeedTable tab shows real entriesCreate entries via Supabase dashboard with table_id set, see them in the feed2: Share to TableLogging flow connects to tablesLog a meal, toggle "share to Sunday Roast Club", see it in the table feed3: Quick PostGroup dining works end-to-endTap "Start Table Night" → pick restaurant → tag friends → rate → see grouped card in feed. Friends add their ratings later.4: Full Table NightThe wow moment worksReal-time session, hidden ratings, countdown, simultaneous reveal, auto recap5: WishlistGroup discovery worksAdd restaurants to shared wishlist, see overlap ("everyone wants to try Carbone")6: Stats + Top 4Table has identitySee group stats, curate top 4 restaurants

Verification
After each phase:

Run npx expo start and test on device/simulator
For Phase 1: manually insert entries with table_id set in Supabase dashboard, verify they appear in the feed
For Phase 2: log a meal through the app, share to a table, verify it appears
For Phase 3: start a quick post table night, have a second test user add their rating, verify grouped card
For Phase 4: use two devices/simulators with different test users, run a full Table Night flow
Run existing tests: cd napkin-app && npx jest for hook/edge function tests
Deploy edge functions: supabase functions deploy <function-name> after each backend change