# Tables Feature — Technical Design Document

## Overview

The **Tables** feature enables groups of friends to share dining experiences, maintain a collective wishlist, and participate in interactive "Table Night" sessions for real-time rating reveals.

---

## Core Concepts

| Concept | Description |
|---------|-------------|
| **Table** | A persistent group entity (like "Sunday Roast Club") with its own avatar, stats, and activity feed |
| **Table Member** | A user who belongs to a table, can be `admin` or `member` role |
| **Table Night** | A real-time session where members rate a restaurant together and reveal scores simultaneously |
| **Table Activity** | Feed of reviews shared to the table (solo logs or Table Night events) |

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
  status TEXT DEFAULT 'rating' CHECK (status IN ('rating', 'revealed', 'closed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### table_night_participants
```sql
CREATE TABLE table_night_participants (
  table_night_id UUID REFERENCES table_nights(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id),
  rating NUMERIC(2,1),  -- NULL until rated
  ready BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (table_night_id, user_id)
);

-- Enable Realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE table_night_participants;
```

### reviews (modifications)
```sql
ALTER TABLE reviews 
  ADD COLUMN table_id UUID REFERENCES tables(id),
  ADD COLUMN table_night_id UUID REFERENCES table_nights(id);

-- Index for table activity feed queries
CREATE INDEX idx_reviews_table_id ON reviews(table_id);
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
| POST | Start night | `{ table_id, restaurant_id, participant_ids[] }` |
| POST | Submit rating | `{ table_night_id, rating }` |
| POST | Reveal | `{ table_night_id }` (host only) |
| GET | Get night status | `{ table_night_id }` |

---

## Frontend Architecture

### New Files Structure
```
napkin-app/
├── app/(tabs)/
│   └── tables.tsx                    # Tables tab (list of user's tables)
├── app/tables/
│   └── [id].tsx                      # Table detail view
├── components/tables/
│   ├── TableCard.tsx                 # Card for table list
│   ├── TableHeader.tsx               # Table avatar, name, member count
│   ├── ActivityFeed.tsx              # Table activity feed
│   ├── ActivityCard.tsx              # Single activity entry (expandable)
│   ├── WishlistTab.tsx               # Shared wishlist
│   ├── StatsTab.tsx                  # Aggregate stats
│   ├── TableNightBanner.tsx          # "Start Table Night" CTA
│   ├── CreateTableModal.tsx          # Create/join table flow
│   └── index.ts                      # Barrel exports
├── components/table-night/
│   ├── TableNightScreen.tsx          # Full-screen Table Night experience
│   ├── ParticipantList.tsx           # Ready checkmarks
│   ├── RevealAnimation.tsx           # 3-2-1 reveal
│   └── ResultsDisplay.tsx            # Final scores
└── hooks/
    ├── useTables.ts                  # User's tables
    ├── useTableDetail.ts             # Single table data
    ├── useTableActivity.ts           # Table feed
    ├── useTableNight.ts              # Real-time Table Night
    └── useTableNightRealtime.ts      # Supabase Realtime subscription
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
},
tableNight: {
  detail: (nightId: string) => ['tableNight', nightId] as const,
  participants: (nightId: string) => ['tableNight', nightId, 'participants'] as const,
},
```

---

## Tables Tab UI

### Design Principles
- **No separate table list screen** — Default to one table with dropdown switcher
- **Explicit sharing only** — Solo logs don't auto-populate table feeds
- **Minimal notifications** — Only high-priority events trigger push notifications

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

- **Default table**: Last viewed OR first created (stored in AsyncStorage)
- **Dropdown**: Quick switch between tables without navigation
- **Settings gear**: Manage members, admin roles, leave/delete table

---

## Sharing Policy

### Solo Logs — Explicit Opt-In Only
```
LogModal:
├── Rate ⭐⭐⭐⭐
├── Been ✓
├── [OFF by default] Share to Table →
│   └── If toggled ON: Show table picker (multi-select)
└── Done
```

**Why:**
- Prevents spam in table feeds
- Keeps table content intentional and meaningful
- Users consciously choose what to share with each group

### Table Night Logs — Automatic
- All participants' reviews auto-appear in table feed
- Grouped as a "Table Night" event card
- No opt-in needed (it's inherently a table activity)

---

## Notification Strategy

| Event | Push? | In-App Badge? | Notes |
|-------|-------|---------------|-------|
| Table Night invite | ✅ Yes | ✅ Yes | High priority |
| @mentioned in comment | ✅ Yes | ✅ Yes | Medium priority |
| New member joined | ❌ No | ✅ Yes | Low priority |
| Comment on your review | ❌ No | ✅ Yes | Low priority |
| Like on your review | ❌ No | ❌ No | Too noisy |
| Solo log shared to table | ❌ No | ❌ No | Would cause spam |

**UI:**
- Badge on Tables tab icon (unread count)
- In-app notification list accessible from Tables tab header (optional Phase 2)

---

## Activity Card Design

### Table Night Event Card (Collapsed)
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🎉 TABLE NIGHT                                           Dec 8, 2024       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  📍 Carbone                                                                 │
│                                                                             │
│  [Photo1] [Photo2] [Photo3]                                                 │
│                                                                             │
│  ⭐ 4.2 avg  •  4 rated                                                     │
│  [Avatar] [Avatar] [Avatar] [Avatar]                                        │
│                                                                             │
│  ❤️ 3   💬 2                                                [Tap to expand] │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Solo Log Card
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  👤 SOLO LOG                                              Dec 5, 2024       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  📍 Joe's Pizza                                                             │
│                                                                             │
│  [Photo]                                                                    │
│                                                                             │
│  ⭐ 4.0  •  [Avatar] Sarah                                                  │
│  "Best slice in the city..."                                                │
│                                                                             │
│  ❤️ 1   💬 0                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Expanded View (Modal)
Shows restaurant details, all individual reviews, comments section.

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
      // Update local state with new participant data
      queryClient.invalidateQueries({ queryKey: queryKeys.tableNight.participants(nightId) });
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
      if (payload.new.status === 'revealed') {
        // Trigger reveal animation
        setShowReveal(true);
      }
    }
  )
  .subscribe();
```

---

## Testing Strategy

### Multi-User Testing Options

1. **Supabase Dashboard** (easiest)
   - Create test users directly in Auth → Users
   - Use different browsers/incognito for each user
   - Both connect to same Expo Go dev server

2. **iOS Simulator** (requires Xcode)
   - Run multiple simulator instances
   - Each can have different Expo sessions
   - Best for Table Night real-time testing

3. **Two Physical Devices**
   - Your iPhone + borrow another device
   - Both run Expo Go pointed at same dev server

4. **Automated Testing**
   - Use Supabase test client to simulate users
   - Write integration tests for API endpoints

---

## Implementation Order

1. **Database schema** (Supabase migrations)
2. **Edge functions** (table-management, table-members)
3. **Tables tab UI** (list view)
4. **Table detail view** (header, tabs shell)
5. **Activity feed** (cards, expand, likes/comments)
6. **Wishlist tab**
7. **Stats tab**
8. **Log integration** ("Share to table" in LogModal)
9. **Table Night** (Phase 5)

---

## Open Questions

- [ ] Invite link format and deep linking setup
- [ ] Push notification service for Table Night invites
- [ ] Photo upload for table avatar
- [ ] Ghost tag conversion flow for tables
