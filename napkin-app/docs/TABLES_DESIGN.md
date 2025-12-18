# Tables Feature — Technical Design Document

## Overview

The **Tables** feature enables groups of friends to share dining experiences in a curated "supper club" format. The hero feature is **Table Night** — a real-time rating reveal game that captures the magic of dining together and comparing scores like a Mario Party mini-game or Spotify Wrapped reveal.

---

## Design Philosophy

| Principle | Decision |
|-----------|----------|
| **Supper club essence** | Tables = intimate group memory, not another personal feed |
| **Real-time magic** | Table Night requires sync participation (encourages app downloads) |
| **Laissez-faire sharing** | No hard caps on solo shares — visual distinction only |
| **Auto-populated recaps** | System generates stats/insights, not user-entered notes |
| **No guest proxies** | Table Night is for app users only (growth mechanic) |

---

## Sharing Visibility Matrix

A meal log can go to any combination of:

| Destination | Description | Default |
|-------------|-------------|---------|
| **Personal Journal** | Private, only you see it | Always ✓ |
| **Friends Feed** | Visible to your followers | Based on privacy settings |
| **Table(s)** | Visible in specific table feeds | Explicit opt-in per log |

### Privacy Settings (User-Level)
```
Share with followers:
○ Everything (restaurant visits + home cooked)
○ Restaurant visits only  
○ Nothing (private diary mode)
```

### LogModal Sharing Flow
```
LogModal
├── Rate + Log (always saved to personal journal)
├── [Based on settings] → Auto-shares to Friends Feed
└── [Toggle] Share to Tables → Multi-select table picker
```

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Table** | Persistent group entity (like "Sunday Roast Club") with avatar, stats, activity feed |
| **Table Member** | App user who belongs to a table (`admin` or `member` role) |
| **Table Night** | Real-time session where members rate together and reveal scores simultaneously |
| **Table Activity** | Feed of Table Night events + solo logs shared to the table |
| **Friends Feed** | Explore page showing logs from people you follow |

---

## Table Night — The Core Experience

### Flow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: SETUP                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Host (any member) starts a Table Night                                     │
│  • Select restaurant                                                        │
│  • App shows members who are "present" (in app or invited)                  │
│  • Participants opt-in (or get push notification)                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: RATING (Real-Time / Socket)                                       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Each participant enters their rating (hidden from others, locked in)     │
│  • Tap "Ready" when done                                                    │
│  • Live status: "3/5 ready" with avatar checkmarks                          │
│  • Optional: Add photos, notes (can be added later too)                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: PRE-REVEAL GAME (Optional Gamification)                           │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • "Guess Sarah's rating" — quick prediction round                          │
│  • Predictions locked in before reveal                                      │
│  • Adds anticipation + friendly competition                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: REVEAL (The Magic Moment)                                         │
│  ─────────────────────────────────────────────────────────────────────────  │
│  • Host triggers reveal (or auto when all ready)                            │
│  • Countdown animation: 3... 2... 1...                                      │
│  • All ratings flip simultaneously (poker card flip UX)                     │
│  • Gasps, laughs, debates ensue IRL                                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 5: RECAP (Auto-Generated)                                            │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Instant stats displayed:                                                   │
│  • Average score: ⭐ 4.2                                                    │
│  • Highest: Sarah (4.5) 👑                                                  │
│  • Lowest: Jake (3.5) 💀                                                    │
│  • Closest to average: You!                                                 │
│  • Controversy score: 0.8 (high variance = divisive pick)                   │
│  • If predictions enabled: "Best guesser: Alex (2/3 correct)"               │
│                                                                             │
│  Saved to table feed as a "Table Night" card                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Real-Time Requirements
- **Supabase Realtime** for `table_night_participants` changes
- Websocket connection while Table Night is active
- At least 2 participants required to start reveal
- Late joiners can hop in during rating phase (until reveal triggered)

---

## Database Schema

### tables
```sql
CREATE TABLE tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_by UUID REFERENCES profiles(user_id) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: Members can read, admins can update
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
```

### table_members
```sql
CREATE TABLE table_members (
  table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (table_id, user_id)
);

-- RLS: Users can see tables they're members of
ALTER TABLE table_members ENABLE ROW LEVEL SECURITY;
```

### table_top_4
```sql
CREATE TABLE table_top_4 (
  table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
  position INTEGER CHECK (position BETWEEN 1 AND 4),
  restaurant_id UUID REFERENCES restaurants(id),
  custom_photo_url TEXT,
  updated_by UUID REFERENCES profiles(user_id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (table_id, position)
);
```

### table_nights
```sql
CREATE TABLE table_nights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id UUID REFERENCES tables(id) ON DELETE CASCADE,
  restaurant_id UUID REFERENCES restaurants(id),
  host_user_id UUID REFERENCES profiles(user_id),
  status TEXT DEFAULT 'rating' 
    CHECK (status IN ('rating', 'pre_reveal', 'revealed', 'closed')),
  predictions_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revealed_at TIMESTAMPTZ  -- When reveal happened (for recap timestamp)
);
```

### table_night_participants
```sql
CREATE TABLE table_night_participants (
  table_night_id UUID REFERENCES table_nights(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id),
  rating NUMERIC(2,1),  -- NULL until rated
  ready BOOLEAN DEFAULT FALSE,
  notes TEXT,  -- Optional thoughts
  PRIMARY KEY (table_night_id, user_id)
);

-- Enable Realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE table_night_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE table_nights;
```

### table_night_predictions (optional gamification)
```sql
CREATE TABLE table_night_predictions (
  table_night_id UUID REFERENCES table_nights(id) ON DELETE CASCADE,
  predictor_user_id UUID REFERENCES profiles(user_id),  -- Who made the guess
  target_user_id UUID REFERENCES profiles(user_id),     -- Who they're predicting
  predicted_rating NUMERIC(2,1),
  PRIMARY KEY (table_night_id, predictor_user_id, target_user_id)
);
```

### table_night_photos
```sql
CREATE TABLE table_night_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_night_id UUID REFERENCES table_nights(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id),
  photo_url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);
```

### table_night_photo_likes
```sql
CREATE TABLE table_night_photo_likes (
  photo_id UUID REFERENCES table_night_photos(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (photo_id, user_id)
);
```

### table_night_dishes (for dish-level ratings)
```sql
CREATE TABLE table_night_dishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_night_id UUID REFERENCES table_nights(id) ON DELETE CASCADE,
  dish_name TEXT NOT NULL,
  created_by UUID REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE table_night_dish_ratings (
  dish_id UUID REFERENCES table_night_dishes(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id),
  rating NUMERIC(2,1),
  PRIMARY KEY (dish_id, user_id)
);
```

### reviews (modifications)
```sql
ALTER TABLE reviews 
  ADD COLUMN table_id UUID REFERENCES tables(id),
  ADD COLUMN table_night_id UUID REFERENCES table_nights(id),
  ADD COLUMN visibility TEXT DEFAULT 'private' 
    CHECK (visibility IN ('private', 'friends', 'table', 'both'));

-- Index for table activity feed queries
CREATE INDEX idx_reviews_table_id ON reviews(table_id);
CREATE INDEX idx_reviews_visibility ON reviews(visibility);
```

### table_activity_interactions
```sql
CREATE TABLE table_activity_likes (
  review_id UUID REFERENCES reviews(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (review_id, user_id)
);

CREATE TABLE table_activity_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id UUID REFERENCES reviews(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### table_nights is_async flag
```sql
-- Add to table_nights for async/quick post mode
ALTER TABLE table_nights ADD COLUMN is_async BOOLEAN DEFAULT FALSE;
```

---

## Table Night Post — Collaborative Content Model

A Table Night post is a **collaborative memory** where all participants can contribute:

| Content Type | Who Can Add | Editable After Reveal? |
|--------------|-------------|------------------------|
| **Rating** | Each participant | ❌ Locked after reveal |
| **Personal notes** | Each participant | ✅ Can edit their own |
| **Photos** | Everyone | ✅ Can add anytime |
| **Post description** | Host | ✅ Host can update |
| **Dish ratings** | Each participant | ❌ Locked after reveal |
| **Comments** | Everyone in table | ✅ Standard comments |
| **Auto-stats** | System | 🤖 Auto-generated |

### Rating Edit Rules
- **Before reveal**: Users can change their rating freely
- **After reveal**: Ratings are **locked** — the snapshot moment is the point
- **Rationale**: If you want a different personal rating later, log a separate solo review

### "See What Everyone Thought" Button
Expandable section showing all participants' ratings + notes:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [ 📊 See What Everyone Thought ]                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                          ▼ Expands to:
┌─────────────────────────────────────────────────────────────────────────────┐
│  EVERYONE'S THOUGHTS                                                        │
│  ─────────────────────────────────────────────────────────────────────────  │
│  [Avatar] Sarah — ⭐ 4.5                                                    │
│  "The rigatoni was incredible, but service was slow"                        │
│                                                                             │
│  [Avatar] Jake — ⭐ 3.5                                                     │
│  "Overhyped. The vodka sauce was too sweet for me."                         │
│                                                                             │
│  [Avatar] You — ⭐ 4.0                                                      │
│  "Great vibe, would come back for the tiramisu"                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Photo Handling

### The Problem
6 people × 5 photos each = 30 photos on one post. Need organization.

### Solution: Hero + Liked Sort + Person Filter
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [HERO: Most liked photo displayed prominently]                             │
│                                                                             │
│  📸 All photos (23)                    [Filter: Most Liked ▼] [By: All ▼]   │
│                                                                             │
│  [Grid of thumbnails, each with small avatar badge showing uploader]        │
│  [Photo] [Photo] [Photo] [Photo]                                            │
│  [Photo] [Photo] [Photo] [Photo]                                            │
└─────────────────────────────────────────────────────────────────────────────┘

Filter options:
├── Most Liked (default)
├── Newest
└── Oldest

By options:
├── All (default)
├── Sarah
├── Jake
├── You
└── Alex
```

---

## Dish-Level Ratings

### Setup Flow
Host pre-populates dishes during Table Night setup:
```
Setup Phase:
├── Select restaurant
├── [Optional] Add dishes to rate:
│   ├── + Rigatoni
│   ├── + Tiramisu  
│   └── + Add dish...
├── [Toggle] Enable real-time reveal game
└── Start Table Night
```

### Rating Flow
```
Rate this restaurant:
├── Overall: ⭐⭐⭐⭐ (4.0)
└── Dishes (optional):
    ├── Rigatoni: ⭐⭐⭐⭐⭐ (5.0)
    ├── Tiramisu: ⭐⭐⭐⭐ (4.0)
    └── [Skip dishes I didn't try]
```

### Recap Display
```
📊 DISH BREAKDOWN                                    
─────────────────────────────────────────────────────
Rigatoni      ⭐ 4.8 avg  (5 rated)   👑 Table favorite
Tiramisu      ⭐ 4.2 avg  (4 rated)
Vodka Martini ⭐ 3.5 avg  (3 rated)   🌶️ Most divisive
```

---

## Async Mode ("Quick Post")

For when you want a group memory without the real-time reveal game:

### Creation Flow
```
Create Table Night:
├── Select table
├── Select restaurant
├── [Toggle] 🎮 Real-time reveal game
│   ├── ON = Full gamified flow (rating → reveal → recap)
│   └── OFF = Quick Post mode (no sync needed)
├── Tag participants from table
├── Add your rating + notes + photos
└── Post
```

### Quick Post Behavior
- Immediately visible in table feed
- Tagged participants get notification: "Jake added you to a Table Night at Carbone"
- They can add their own rating, notes, photos at any time
- No "reveal" moment — ratings visible as added
- Still auto-generates recap stats once 2+ people rate

### Schema
```sql
-- is_async = TRUE → Skip rating/reveal phases, immediately 'revealed' status
-- is_async = FALSE → Full gamified flow
table_nights.is_async BOOLEAN DEFAULT FALSE
```

---

## Cross-Posting Privacy

### The Scenario
- Table Night at Carbone with Sarah, Jake, Alex
- Jake wants to share to his Friends Feed
- But Sarah's privacy is set to "Tables only"

### Rule: Your Post = Your Content Only
When sharing a Table Night review to Friends:
- You share **your own** rating + notes + photos
- The "Table Night" context (who was there) stays private
- Friends see a regular solo log, no mention of other participants

### Why This Works
- Each participant owns their content
- Table Night metadata is a *table* memory
- Your personal review is *yours* to share
- No privacy conflicts

### Implementation
```
Jake's Friends Feed Post (what his followers see):
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Jake's Avatar] Jake • 2h ago                                              │
│  📍 Carbone                                                                 │
│  [Jake's photos only]                                                       │
│  ⭐ 4.0 — "Great night, the rigatoni was 🔥"                                │
│  ❤️ 5   💬 2                                                                │
└─────────────────────────────────────────────────────────────────────────────┘

Note: No mention of Table Night, no other participants shown
```

---

## API Endpoints (Edge Functions)

### table-management
| Method | Action | Body |
|--------|--------|------|
| POST | Create table | `{ name, avatar_url? }` |
| GET | Get user's tables | - |
| PUT | Update table | `{ table_id, name?, avatar_url? }` |
| DELETE | Delete table | `{ table_id }` (admin only) |

### table-members
| Method | Action | Body |
|--------|--------|------|
| POST | Invite member | `{ table_id, user_id or email }` |
| DELETE | Remove member | `{ table_id, user_id }` |
| PUT | Change role | `{ table_id, user_id, role }` |

### table-activity
| Method | Action | Body |
|--------|--------|------|
| GET | Get table feed | `{ table_id, limit, offset }` |
| POST | Like activity | `{ review_id }` |
| POST | Comment | `{ review_id, content }` |

### table-night
| Method | Action | Body |
|--------|--------|------|
| POST | Start night | `{ table_id, restaurant_id, predictions_enabled? }` |
| POST | Join night | `{ table_night_id }` |
| POST | Submit rating | `{ table_night_id, rating, notes? }` |
| POST | Mark ready | `{ table_night_id }` |
| POST | Submit prediction | `{ table_night_id, target_user_id, predicted_rating }` |
| POST | Reveal | `{ table_night_id }` (host only, all must be ready) |
| GET | Get night status | `{ table_night_id }` |
| POST | Add photo | `{ table_night_id, photo_url }` |

### friends-feed
| Method | Action | Body |
|--------|--------|------|
| GET | Get feed | `{ limit, offset }` — returns reviews from followed users |
| GET | Get user activity | `{ user_id, limit, offset }` — for profile view |

---

## Frontend Architecture

### New Files Structure
```
napkin-app/
├── app/(tabs)/
│   ├── tables.tsx                    # Tables tab (table switcher + detail)
│   └── explore.tsx                   # Friends Feed (logs from followed users)
├── app/tables/
│   └── [id].tsx                      # Table detail view (if deep-linked)
├── app/table-night/
│   └── [id].tsx                      # Full-screen Table Night experience
├── components/tables/
│   ├── TableCard.tsx                 # Card for table list
│   ├── TableHeader.tsx               # Table avatar, name, member count
│   ├── TableSwitcher.tsx             # Dropdown to switch tables
│   ├── ActivityFeed.tsx              # Table activity feed
│   ├── ActivityCard.tsx              # Single activity entry (expandable)
│   ├── TableNightCard.tsx            # Table Night event in feed
│   ├── SoloLogCard.tsx               # Solo share in table feed
│   ├── WishlistTab.tsx               # Shared wishlist
│   ├── StatsTab.tsx                  # Aggregate stats + Wrapped
│   ├── TableNightBanner.tsx          # "Start Table Night" CTA
│   ├── CreateTableModal.tsx          # Create/join table flow
│   └── index.ts                      # Barrel exports
├── components/table-night/
│   ├── TableNightScreen.tsx          # Full-screen Table Night experience
│   ├── ParticipantList.tsx           # Ready checkmarks + avatars
│   ├── RatingInput.tsx               # Hidden rating entry
│   ├── PredictionGame.tsx            # "Guess their rating" UI
│   ├── CountdownReveal.tsx           # 3-2-1 animation
│   ├── RevealAnimation.tsx           # Card flip effect
│   ├── RecapStats.tsx                # Auto-generated stats display
│   └── PhotoUpload.tsx               # Add photos to the night
├── components/explore/
│   ├── FriendsFeed.tsx               # Vertical feed of friend activity
│   ├── FeedCard.tsx                  # Review card in friends feed
│   └── EmptyFeed.tsx                 # "Follow people to see their logs"
└── hooks/
    ├── useTables.ts                  # User's tables
    ├── useTableDetail.ts             # Single table data
    ├── useTableActivity.ts           # Table feed
    ├── useTableNight.ts              # Table Night mutations
    ├── useTableNightRealtime.ts      # Supabase Realtime subscription
    ├── useFriendsFeed.ts             # Explore feed data
    └── useTableWrapped.ts            # Annual stats calculations
```

### Query Keys (add to queryKeys.ts)
```typescript
tables: {
  all: () => ['tables'] as const,
  detail: (tableId: string) => ['tables', tableId] as const,
  activity: (tableId: string) => ['tables', tableId, 'activity'] as const,
  members: (tableId: string) => ['tables', tableId, 'members'] as const,
  wishlist: (tableId: string) => ['tables', tableId, 'wishlist'] as const,
  top4: (tableId: string) => ['tables', tableId, 'top4'] as const,
  wrapped: (tableId: string) => ['tables', tableId, 'wrapped'] as const,
},
tableNight: {
  detail: (nightId: string) => ['tableNight', nightId] as const,
  participants: (nightId: string) => ['tableNight', nightId, 'participants'] as const,
  predictions: (nightId: string) => ['tableNight', nightId, 'predictions'] as const,
},
explore: {
  feed: () => ['explore', 'feed'] as const,
  userActivity: (userId: string) => ['explore', 'user', userId] as const,
},
```

---

## Tables Tab UI

### Design Principles
- **No separate table list screen** — Default to one table with dropdown switcher
- **Explicit table sharing** — Solo logs require explicit opt-in to share to tables
- **Visual hierarchy** — Table Night events get hero treatment, solo shares are smaller
- **Minimal notifications** — Only high-priority events trigger push

### Tab Layout (Single Table View with Dropdown)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Dropdown: Sunday Roast Club ▼]               [+ Create]  [⚙️ Settings]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [Table Avatar]                                                             │
│  4 members • Est. Jan 2024                                                  │
│  [Avatar1] [Avatar2] [Avatar3] [Avatar4]                                    │
│                                                                             │
│  [ 🎉 START TABLE NIGHT ]                                                   │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  [Activity]  [Wishlist]  [Stats]  [Top 4]                                   │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  (Content based on selected tab)                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Explore Tab (Friends Feed)

### Purpose
- Shows logs from people you follow
- Default visibility based on user's privacy settings
- Distinct from Tables (Tables = curated group, Explore = one-way follow)

### Layout
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  EXPLORE                                                    [🔔 Activity]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  [Avatar] Sarah • 2h ago                                            │    │
│  │  📍 Carbone                                                         │    │
│  │  [Photo]                                                            │    │
│  │  ⭐ 4.5 — "The spicy rigatoni lives up to the hype"                 │    │
│  │  ❤️ 12   💬 3                                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  [Avatar] Jake • 5h ago                                             │    │
│  │  🏠 Home Cooked                                                     │    │
│  │  [Photo of pasta]                                                   │    │
│  │  ⭐ 4.0 — "Finally nailed carbonara"                                │    │
│  │  ❤️ 8   💬 1                                                        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Sharing Policy (Final)

### Default Behavior (Privacy Settings Controlled)
```
User Settings → Privacy:
├── Share with followers: [Everything / Restaurants only / Nothing]
└── Default affects all new logs
```

### LogModal Sharing
```
LogModal:
├── Rate + Log (always saved to personal journal)
├── [Auto based on settings] → Friends Feed
├── [Toggle: OFF by default] Share to Tables →
│   └── If ON: Multi-select table picker
└── Done
```

### Table Night Logs — Automatic
- All participants' reviews auto-appear in table feed
- Grouped as a "Table Night" event card
- Also appears in Friends Feed (it's your review, followers see it)

---

## Activity Card Design

### Table Night Event Card (Hero Treatment)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🎉 TABLE NIGHT                                           Dec 8, 2024       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  📍 Carbone                                                                 │
│                                                                             │
│  [Photo1] [Photo2] [Photo3]                                                 │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ⭐ 4.2 avg  •  Controversy: Low                                    │    │
│  │  ────────────────────────────────────────────────────────────────── │    │
│  │  👑 Highest: Sarah (4.5)                                            │    │
│  │  💀 Lowest: Jake (3.5)                                              │    │
│  │  📊 Closest to avg: You (4.0)                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  [Avatar] [Avatar] [Avatar] [Avatar]  — 4 rated                             │
│                                                                             │
│  ❤️ 3   💬 2                                                [Tap to expand] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Solo Log Card (Smaller, Grouped)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  👤 [Avatar] Sarah shared a log                           Dec 5, 2024       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  📍 Joe's Pizza                                                             │
│  [Small Photo]  ⭐ 4.0  "Best slice in the city..."                         │
│  ❤️ 1   💬 0                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Table Wrapped (Annual Stats)

Auto-generated end-of-year (or on-demand) stats for each table:

### Stats Available
| Stat | Description | Query |
|------|-------------|-------|
| Total Table Nights | How many times you dined together | `COUNT(table_nights)` |
| Total restaurants rated | Unique restaurants | `COUNT(DISTINCT restaurant_id)` |
| Top rated restaurant | Highest avg rating | `AVG(rating) GROUP BY restaurant ORDER BY DESC` |
| Most divisive | Highest variance | `STDDEV(rating) ... ORDER BY DESC` |
| Generous rater | Who rates highest on average | `AVG(rating) GROUP BY user_id ORDER BY DESC` |
| Harsh critic | Who rates lowest on average | `AVG(rating) GROUP BY user_id ORDER BY ASC` |
| Most active member | Most Table Nights attended | `COUNT(*) GROUP BY user_id` |
| Rating spread | Your avg vs table avg | Per-user calculation |
| Prediction accuracy | If predictions enabled | % correct guesses |

### UI Concept
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🎊 SUNDAY ROAST CLUB — 2024 WRAPPED                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  You dined together 23 times                                                │
│  at 18 different restaurants                                                │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  🏆 TOP RATED                        🌶️ MOST DIVISIVE                       │
│  Carbone — ⭐ 4.8                    Joe's Pizza — σ 1.2                    │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  👑 GENEROUS RATER                   � HARSH CRITIC                        │
│  Sarah — avg ⭐ 4.3                  Jake — avg ⭐ 3.6                       │
│                                                                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│                                                                             │
│  YOUR RATING STYLE                                                          │
│  You rate 0.2 stars above the group average                                 │
│                                                                             │
│  [Share to Instagram Stories]                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Real-time Architecture (Table Night)

### Supabase Realtime Setup
```typescript
// useTableNightRealtime.ts
const channel = supabase
  .channel(`table-night:${nightId}`)
  .on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'table_night_participants',
      filter: `table_night_id=eq.${nightId}`,
    },
    (payload) => {
      // Update participant status (ready checkmarks, etc)
      queryClient.invalidateQueries({ 
        queryKey: queryKeys.tableNight.participants(nightId) 
      });
    }
  )
  .on(
    'postgres_changes',
    {
      event: 'UPDATE',
      schema: 'public',
      table: 'table_nights',
      filter: `id=eq.${nightId}`,
    },
    (payload) => {
      const newStatus = payload.new.status;
      if (newStatus === 'pre_reveal') {
        // Start prediction game if enabled
        setPhase('predictions');
      } else if (newStatus === 'revealed') {
        // Trigger reveal animation
        setPhase('reveal');
        triggerCountdownAnimation();
      }
    }
  )
  .subscribe();
```

---

## Notification Strategy

| Event | Push? | In-App Badge? | Notes |
|-------|-------|---------------|-------|
| Table Night started | ✅ Yes | ✅ Yes | "Jake started a Table Night at Carbone!" |
| All ready, reveal imminent | ✅ Yes | ✅ Yes | "Everyone's ready! Reveal in 10 seconds" |
| @mentioned in comment | ✅ Yes | ✅ Yes | Medium priority |
| New member joined | ❌ No | ✅ Yes | Low priority |
| Comment on your review | ❌ No | ✅ Yes | Low priority |
| Like on your review | ❌ No | ❌ No | Too noisy |
| Solo log shared to table | ❌ No | ❌ No | Would cause spam |

---

## Testing Strategy

### Multi-User Testing Options

1. **Supabase Dashboard** (easiest for Table Night)
   - Create 2-3 test users in Auth → Users
   - Use different browsers/incognito for each
   - All connect to same Expo Go dev server
   - Test real-time updates, reveal sync

2. **iOS Simulator** (requires Xcode)
   - Run 2+ simulator instances
   - Best for testing actual animations

3. **Two Physical Devices**
   - Your iPhone + partner's phone
   - Real-world supper club test!

---

## Implementation Order

### Phase 1: Foundation
1. Database schema (Supabase migrations)
2. RLS policies for all new tables
3. Edge functions: `table-management`, `table-members`

### Phase 2: Tables Tab
4. Tables tab shell with switcher
5. Table detail view (header, member avatars)
6. Create/join table flow

### Phase 3: Activity Feed
7. Activity feed with Table Night cards
8. Solo log cards (smaller treatment)
9. Likes/comments on activities
10. LogModal "Share to Tables" toggle

### Phase 4: Explore Feed
11. Explore tab shell
12. Friends feed (following users' logs)
13. Privacy settings integration

### Phase 5: Table Night (The Magic)
14. Table Night screen (full-screen takeover)
15. Real-time participant status
16. Rating input + ready state
17. Prediction game (optional)
18. Countdown + reveal animation
19. Auto-generated recap stats

### Phase 6: Polish
20. Table Wrapped annual stats
21. Push notifications
22. Deep linking for invites
23. Share to Instagram Stories

---

## Open Questions

### Resolved

- [x] **Invite link format**: `https://napkin.app/table/join/[invite_code]`
- [x] **Deep linking**: Use `expo-linking` + `expo-router` to handle URLs
- [x] **Push notifications**: Expo Notifications for MVP (trigger via Supabase Edge Functions calling Expo's push API)
- [x] **Reveal animation**: React Native Reanimated (no Lottie, no artist needed — code-based card flip)
- [x] **Photo upload for table avatar**: Same flow as profile avatar

### Post-MVP

- [ ] Shareable Wrapped image (use `react-native-view-shot` + `expo-sharing` for Instagram Stories)
