---
id: TICKET-001
title: "Unified collaborative logger — tag friends, shared entries, personal table"
priority: high
status: done
created: 2026-04-14
updated: 2026-04-14
tags: [core, logger, collaborative, entries]
---

# Unified Collaborative Logger

## Problem

The core value of Napkin is a shared food journal for your dining circle — logging meals and building a catalog of experiences together over time. Right now the logger (`create-entry`) works, but it's a solo journaling tool that posts to a group feed. There's no way to say "I was here with Sarah and Marcus" and have that entry belong to all of you. And there's no concept of a personal table, so the data model awkwardly splits between "solo entries" and "table entries" instead of treating everything as table content.

Meanwhile, Table Night (the live group rating game) got heavy investment but represents maybe 10% of actual usage. The daily loop — someone logs a meal, tags who was there, friends add their own take — doesn't exist yet. That's the 90% feature.

**Who has this problem:** Every user, every time they open the app. The logger is the main action and it doesn't feel collaborative.

**Why it matters:** Without collaborative logging, the feed is just individual posts. The "shared food journal" vision — looking back and seeing "wow that was a fun night" with everyone's take — requires entries that belong to multiple people.

## Notes

### Core insight from brainstorm
"Everything is a table." Even your solo journal is a table of one. Entries always belong to a table. This eliminates the solo vs group split entirely.

### The unified flow
```
Tap +  ->  Pick restaurant (or custom place)  ->  Pick table (or default)  ->  Tag who was there  ->  Rate + notes  ->  Done
```

### Key design decisions
- **Personal table on signup:** Every user gets a default personal table. It's their food diary. They can rename it, it's just theirs.
- **Tagging participants:** When logging, you can tag table members who were at the meal. This doesn't require those people to do anything — they're marked as "was there."
- **Add your take (async):** Tagged friends can add their own rating and notes to the same entry whenever they want. At the restaurant, on the train home, next morning. No live session needed.
- **Grouped feed card:** When multiple people contribute to an entry, the feed card shows all of them: "Jacky, Sarah, Marcus went to Osteria" with individual ratings visible.
- **Table Night stays but is deprioritized:** It's an optional "game mode" layer on top of collaborative entries, not the core flow. ~10% use case.

### What exists today that we build on
- `create-entry.tsx` — solid base, needs: table picker, participant tagging
- `entry` edge function — needs: participants support
- Activity feed (`tables.tsx`) — already renders different card types, needs grouped entry card
- `useCreateEntry` hook — needs participant data in mutation

### What needs to be new
- `entry_participants` table (or similar) — lightweight, no ready/reveal machinery
- "Add your take" screen or inline expansion in feed
- Personal table auto-creation on signup (trigger or edge function)
- Table picker UI in create flow

### What this is NOT
- Not Table Night. No live sessions, no reveal, no locking ratings.
- Not a social network. No public feed, no likes, no comments (yet).
- Not a rewrite. We're extending the existing logger, not replacing it.

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec
<!-- Filled by product-designer agent when ticket moves to 'ready' -->

### User Stories

1. **As a user logging a meal**, I want to pick which table to post to (or default to my personal table), so that every entry has a home and I never wonder where it went.

2. **As a user dining with friends**, I want to tag table members who were with me, so the entry reflects the shared experience and shows up for everyone involved.

3. **As a tagged friend**, I want to see a prompt in the feed to "add my take" on a shared entry, so I can add my own rating and notes without creating a duplicate entry.

4. **As a feed reader**, I want to see grouped cards when multiple people have contributed to the same entry (e.g., "Jacky, Sarah, Marcus went to Osteria" with individual ratings), so the feed tells the story of the group, not just one person.

5. **As a new user**, I want a personal table created automatically at signup so I can log meals immediately without any setup.

6. **As a solo diner**, I want to log a meal without tagging anyone, and have it post to my personal table by default, so the flow is just as fast as today when I'm eating alone.

7. **As a user who was tagged**, I want to see the entry in my table's feed even if I haven't added my take yet, so I know someone logged a meal I was part of.

### Acceptance Criteria

**Data model**
- [ ] New `entry_participants` table exists with columns: `entry_id` (FK to entries), `user_id` (FK to auth.users), `rating` (nullable numeric, 0.5-5.0), `notes` (nullable text), `created_at`. Primary key is `(entry_id, user_id)`.
- [ ] The entry creator is always inserted into `entry_participants` with their rating and notes at creation time (they are participant zero, not a separate concept).
- [ ] Every user gets a personal table on signup. The `tables` row has a `is_personal` boolean (default false) set to true for personal tables. Created via a Supabase database trigger on auth.users insert.

**Create flow (create-entry.tsx)**
- [ ] Table picker appears between restaurant selection and rating. Shows the user's tables as tappable chips. Personal table is pre-selected by default.
- [ ] When a non-personal table is selected, a "Who was there?" section appears showing table members as tappable avatar chips. Tapping toggles selection. The creator is always included and cannot be deselected.
- [ ] Tagged participant user IDs are sent to the entry edge function in a `participant_ids` array field.
- [ ] Submitting with no table selected posts to the personal table (never orphaned).

**Edge function (entry/index.ts)**
- [ ] Accepts optional `participant_ids: string[]` in the POST body.
- [ ] After creating the entry, inserts a row into `entry_participants` for the creator (with their rating and notes) AND one row per tagged participant (with null rating and null notes).
- [ ] Validates that all `participant_ids` are members of the target table. Returns 400 if any are not.

**Feed display (tables.tsx)**
- [ ] Entries with multiple participants render as a grouped card showing all contributor names, the restaurant, and each person's rating (or "pending" if they haven't added their take).
- [ ] Entries with a single participant render as the existing SoloShareCard (no visual change).

**Add your take**
- [ ] Tapping a grouped card where the current user is a participant but has not yet rated opens an "Add Your Take" screen (or bottom sheet) with rating slider and notes field.
- [ ] Submitting "your take" calls a new edge function action (or PATCH on entry) that updates the user's `entry_participants` row with their rating and notes.
- [ ] After submitting, the feed card updates to show the new rating inline.

**Personal table**
- [ ] Personal table appears in the table picker with a distinct label (e.g., "My Journal" or the user's first name + "'s Table").
- [ ] Personal table does not show the "Who was there?" tagging section (only one member).
- [ ] Personal table is not deletable.

**Query invalidation**
- [ ] Creating an entry invalidates `queryKeys.tables.activity(tableId)` and `queryKeys.entries.list(userId)`.
- [ ] Adding your take invalidates `queryKeys.tables.activity(tableId)`.

### UX Decisions

- **Table picker format**: Horizontal row of chips below the restaurant field. Personal table chip is always first and pre-selected. Other tables show by name. Single-select (an entry belongs to exactly one table). Reasoning: keeps the flow linear and fast; a dropdown or modal would add a tap.

- **Participant tagging UI**: Grid of avatar chips (initials + first name) showing all members of the selected table. Tap to toggle. Creator's chip is visually distinct (filled, not toggleable). Only appears when a group table is selected. Reasoning: table memberships are small (3-8 people typically), so showing all at once is faster than a search field.

- **"Add your take" trigger**: Tapping the grouped feed card opens a bottom sheet (not a new screen) with the restaurant name as header, a rating slider, and a notes field. A "Save" button submits. Reasoning: it should feel lightweight and in-context, not like starting a new entry from scratch.

- **Grouped card layout**: Shows restaurant name prominently, then a row of participant "pills" (avatar + name + rating or "---" if pending). If 2+ people have rated, also shows the group average. Reasoning: this mirrors the Table Night card aesthetic already in the feed, creating visual consistency.

- **Personal table naming**: Auto-named "{First Name}'s Journal" on creation. User can rename it later (uses existing table edit flow). Reasoning: "Journal" reinforces the personal diary metaphor without needing new UI.

- **Default table behavior**: Personal table is always the default selection when opening the create flow, unless the user navigated from a specific table context (i.e., `tableId` param is passed). Reasoning: solo logging should be zero-friction; posting to a group is an intentional upgrade.

### Out of Scope

- Table Night integration (separate ticket, different UX paradigm)
- Push notifications for "you were tagged" or "add your take" prompts
- Photo attachments on entries or participant takes
- Dish-level ratings (entry is restaurant-level only)
- Editing or deleting your take after submission
- Reacting to or commenting on other people's takes
- Any public feed or cross-table visibility
- Async table night (the "async" concept here is just "add your rating whenever" -- no game, no reveal)
- Entry editing after creation (existing limitation, unchanged)
- Migration of existing entries into the participant model (existing entries stay as-is, single-participant)

### Open Questions

1. **Should tagged participants get an in-app indicator (badge, dot) that they have pending takes?** A subtle badge on the Tables tab or a "You have 2 meals to rate" banner in the feed would drive engagement, but adds complexity. Could be a fast follow-up if the base flow works.

2. **Can a user add their take to an entry they weren't tagged in?** For example, if someone logs a meal at a restaurant you also went to but they forgot to tag you. The simplest answer is "no, only tagged participants can add takes" -- but this may cause friction. Alternative: allow any table member to "add themselves" to an entry.

3. **Should the personal table be visible to the user in the table switcher header on tables.tsx, or only in the create flow?** If it shows in the main tab's table cycler, users can view their personal journal as a feed. If not, it's write-only from the main tab. Recommendation: yes, show it -- it becomes the user's personal food diary view.

---

## Technical Design
<!-- Filled by architect agent -->

### Approach

We are extending the existing entry creation pipeline to support collaborative logging: tagging table members as participants, storing per-person ratings/notes in a new `entry_participants` join table, and surfacing grouped entries in the activity feed. The design follows the "everything is a table" principle -- every user gets a personal table on signup, every entry belongs to a table, and the `entry_participants` table tracks who was there and their individual takes. We extend 4 existing files (migration, entry edge function, table-activity edge function, create-entry screen), add 2 new hooks and the missing query keys, and introduce 1 new screen (add-your-take bottom sheet). No new edge functions -- the existing `entry` function gains a `participant_ids` field on create and a new POST action `add-take` for updating a participant's rating/notes.

### Architecture Decisions

- **[Single `entry_participants` table, not reusing `table_night_participants`]**: A new `entry_participants` table with `(entry_id, user_id)` PK because collaborative entries have fundamentally different semantics from Table Night (no ready/reveal, no locking, async by nature). Sharing the table_night_participants table would require nullable columns, confusing foreign keys, and couples two features that should evolve independently. Trade-off: a second participants table, but it's 5 columns and keeps both features clean.

- **[Extend the existing `entry` edge function rather than creating a new one]**: The `entry` edge function at `supabase/functions/entry/index.ts` already handles entry creation and is the single entry point for logging. Adding `participant_ids` to the POST body and a new `add-take` POST action keeps the entry domain in one place. Trade-off: the function grows larger, but it stays cohesive -- all entry mutations live together.

- **[Personal table created via DB trigger, not edge function]**: The existing `handle_new_user()` trigger already runs on `auth.users` INSERT and creates profiles and value_profiles. We extend it to also create a personal table (with `is_personal = true`) and insert a `table_members` row. This is atomic with signup -- no race condition where a user exists without a personal table. Trade-off: trigger logic is harder to debug than edge function code, but the existing pattern is already established and this is a simple INSERT.

- **["Add your take" as a POST action on the `entry` edge function, not PATCH]**: The CORS headers only allow GET, POST, OPTIONS (see `_shared/cors.ts`). Rather than updating CORS across all functions, we add `{ action: "add-take", entry_id, rating, notes }` as a POST body action, matching the `table-night` function's action-routing pattern. Trade-off: slightly less RESTful, but consistent with the codebase and avoids a CORS change that would touch every function.

- **[Bottom sheet for "Add Your Take", not a full screen]**: The spec calls for a lightweight in-context experience. We use `@gorhom/bottom-sheet` (already a dependency in the RN gesture-handler ecosystem) or a simple Modal + Animated.View since the app already has `react-native-reanimated` and `react-native-gesture-handler`. The bottom sheet shows rating slider + notes + save -- three fields, no navigation. Trade-off: slightly more complex than a screen push, but much better UX for a 10-second interaction.

- **[Feed distinguishes `collaborative_entry` from `solo_share` by participant count, not a separate type flag]**: The table-activity edge function already fetches entries. We join `entry_participants` and if `count > 1`, the client renders a grouped card. No new `type` column on `entries`. Trade-off: requires a join, but avoids schema pollution and the source of truth is the participants table, not a denormalized flag.

- **[`useTables` hook returns `is_personal` on the Table type -- used by create-entry to sort personal table first and suppress "Who was there?"]**: The `table-management` GET endpoint already returns full table data. After the migration adds `is_personal`, it flows through automatically. No edge function change needed for this.

### File Changes

**Database**
- `supabase/migrations/20260415000000_collaborative_entries.sql` -- NEW -- Creates `entry_participants` table, adds `is_personal` column to `tables`, updates `handle_new_user()` trigger to create personal table + table_members row, adds RLS policies for entry_participants, enables realtime publication for entry_participants.

**Edge Functions**
- `supabase/functions/entry/index.ts` -- MODIFY -- Accept `participant_ids: string[]` in POST body. After creating entry, insert rows into `entry_participants` for creator (with rating + notes) and each tagged participant (null rating, null notes). Add validation that all participant_ids are members of the target table. Add new POST action `add-take` that accepts `{ action: "add-take", entry_id, rating, notes }`, validates the caller is a participant with null rating, and updates their `entry_participants` row.
- `supabase/functions/table-activity/index.ts` -- MODIFY -- Join `entry_participants` when fetching entries. For entries with participants, include the participant array (user_id, rating, notes, profiles). Tag entries with `participant_count > 1` as `type: 'collaborative_entry'` instead of `type: 'solo_share'`. Compute `average_rating` for collaborative entries (only counting non-null ratings).
- `supabase/functions/_shared/cors.ts` -- MODIFY -- Add `PUT` to allowed methods (future-proofing, though we use POST actions for now -- actually, leave this unchanged for now to minimize blast radius).

**Query Keys & Hooks**
- `napkin-app/lib/queryKeys.ts` -- MODIFY -- Add `entries` key group: `{ list: (userId: string) => ['entries', userId] as const, detail: (entryId: string) => ['entry', entryId] as const, participants: (entryId: string) => ['entry', entryId, 'participants'] as const }`.
- `napkin-app/hooks/tables/useCreateEntry.ts` -- MODIFY -- Add `participant_ids?: string[]` to `CreateEntryInput` interface. Pass it through to the edge function body.
- `napkin-app/hooks/tables/useAddTake.ts` -- NEW -- Mutation hook that calls `supabase.functions.invoke('entry', { body: { action: 'add-take', entry_id, rating, notes } })`. On success, invalidates `queryKeys.tables.activity(tableId)`.

**Screens & Components**
- `napkin-app/app/create-entry.tsx` -- MODIFY -- Add table picker (horizontal chips below restaurant search, personal table pre-selected). Add participant tagging section (avatar chips for table members, visible only when non-personal table selected). Wire `participant_ids` into `createEntry.mutateAsync()`. Fetch user's tables via `useTables` hook. Fetch table members via `useTableMembers(tableId)` (new query or inline fetch).
- `napkin-app/hooks/tables/useTableMembers.ts` -- NEW -- Query hook that fetches members of a specific table. Calls `supabase.functions.invoke('table-management/${tableId}', { method: 'GET' })` and returns the members array. Uses `queryKeys.tables.members(tableId)` with 5-min staleTime.
- `napkin-app/app/(tabs)/tables.tsx` -- MODIFY -- Add `CollaborativeEntryCard` component alongside existing `SoloShareRow` and `TableNightRow`. The card shows restaurant name, participant pills (avatar + name + rating or "---"), group average. Tapping it when current user is a pending participant opens the add-your-take sheet.
- `napkin-app/components/AddYourTakeSheet.tsx` -- NEW -- Bottom sheet / modal component with restaurant name header, rating slider (reuses same Slider pattern from create-entry), notes TextInput, and "Save" button. Calls `useAddTake` mutation on submit. Receives `entryId`, `tableId`, `restaurantName` as props.
- `napkin-app/hooks/tables/useTableActivity.ts` -- MODIFY -- Add `CollaborativeEntryActivity` interface to the union type. Update `ActivityItem` type to include the new shape. No fetch logic changes needed (the edge function handles the shape).

**Type Updates**
- `napkin-app/hooks/tables/useTables.ts` -- MODIFY -- Add `is_personal?: boolean` to the `Table` interface.

### Data Shapes

**`entry_participants` table:**
```sql
CREATE TABLE public.entry_participants (
    entry_id    UUID NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rating      DOUBLE PRECISION CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5.0)),
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (entry_id, user_id)
);
```

**New activity item shape (from table-activity edge function):**
```typescript
interface CollaborativeEntryActivity {
    type: 'collaborative_entry';
    id: string;                    // entry id
    user_id: string;               // creator
    restaurant_id: string | null;
    visited_at: string;
    created_at: string;
    sort_date: string;
    restaurants: { id: string; name: string; address: string | null; city: string | null } | null;
    participants: {
        user_id: string;
        rating: number | null;     // null = hasn't added their take yet
        notes: string | null;
        profiles: { display_name: string; avatar_url: string | null };
    }[];
    average_rating: number | null; // computed from non-null ratings
}
```

**Entry edge function `add-take` action request:**
```typescript
{ action: "add-take", entry_id: string, rating: number | null, notes: string | null }
```

**Entry edge function create request (extended):**
```typescript
{ ...existingFields, participant_ids?: string[] }
```

### Implementation Order

1. **Migration (`20260415000000_collaborative_entries.sql`)** -- because everything depends on the schema. Creates `entry_participants`, adds `is_personal` to `tables`, updates `handle_new_user()` trigger. This must be applied before any backend code can reference the new table.

2. **Query keys (`lib/queryKeys.ts`)** -- because hooks reference `queryKeys.entries` and it currently doesn't exist. This is a 5-line change that unblocks both the existing `useCreateEntry` (which already references it but crashes) and the new hooks.

3. **Entry edge function (`supabase/functions/entry/index.ts`)** -- extends POST to accept `participant_ids`, inserts into `entry_participants`, adds `add-take` action. This is the core backend work. Test with curl: create an entry with participants, then add a take as a different user.

4. **Table-activity edge function (`supabase/functions/table-activity/index.ts`)** -- joins `entry_participants` on entries, tags multi-participant entries as `collaborative_entry`, computes average. Test with curl: verify the feed returns the new shape.

5. **`useTableMembers` hook + `useAddTake` hook** -- new hooks, no dependencies beyond query keys existing. `useTableMembers` fetches table members for the participant picker. `useAddTake` calls the `add-take` action.

6. **`useCreateEntry` hook update** -- add `participant_ids` to the interface. Trivial change.

7. **`useTables` hook + `useTableActivity` type updates** -- add `is_personal` to Table interface, add `CollaborativeEntryActivity` to ActivityItem union.

8. **`create-entry.tsx` screen update** -- add table picker chips and participant tagging UI. Depends on steps 5-7 for `useTableMembers` and the updated `CreateEntryInput`.

9. **`CollaborativeEntryCard` in `tables.tsx`** -- new feed card component for grouped entries. Depends on step 7 for the type, step 4 for the data.

10. **`AddYourTakeSheet` component** -- bottom sheet for adding your take. Depends on step 5 for `useAddTake`. Wire it into the `CollaborativeEntryCard` tap handler.

### Migration Detail

```sql
-- 20260415000000_collaborative_entries.sql

-- 1. entry_participants table
CREATE TABLE public.entry_participants (
    entry_id    UUID NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rating      DOUBLE PRECISION CHECK (rating IS NULL OR (rating >= 0.5 AND rating <= 5.0)),
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (entry_id, user_id)
);

ALTER TABLE public.entry_participants ENABLE ROW LEVEL SECURITY;

-- RLS: service_role bypasses, but for direct client access:
CREATE POLICY "entry_participants_select" ON public.entry_participants
    FOR SELECT USING (true);
CREATE POLICY "entry_participants_insert" ON public.entry_participants
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "entry_participants_update" ON public.entry_participants
    FOR UPDATE USING (auth.uid() = user_id);

GRANT ALL ON TABLE public.entry_participants TO authenticated;
GRANT ALL ON TABLE public.entry_participants TO service_role;

CREATE INDEX idx_entry_participants_user ON public.entry_participants(user_id);
CREATE INDEX idx_entry_participants_entry ON public.entry_participants(entry_id);

-- 2. Add is_personal to tables
ALTER TABLE public.tables ADD COLUMN IF NOT EXISTS is_personal BOOLEAN DEFAULT false;

-- 3. Update handle_new_user trigger to create personal table
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    personal_table_id UUID;
    user_display_name TEXT;
BEGIN
    -- Create profile
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (new.id, COALESCE(new.raw_user_meta_data ->> 'display_name', 'New User'));

    -- Create value profile
    INSERT INTO public.value_profiles (user_id, flavor, ambience, value, service)
    VALUES (new.id, 10, 10, 10, 10);

    -- Derive display name for personal table
    user_display_name := COALESCE(new.raw_user_meta_data ->> 'display_name', 'My');

    -- Create personal table
    INSERT INTO public.tables (owner_id, name, is_personal)
    VALUES (new.id, user_display_name || '''s Journal', true)
    RETURNING id INTO personal_table_id;

    -- Add user as admin member of personal table
    INSERT INTO public.table_members (table_id, member_id, role)
    VALUES (personal_table_id, new.id, 'admin');

    RETURN new;
END;
$$;

-- 4. Prevent deletion of personal tables
CREATE OR REPLACE FUNCTION public.prevent_personal_table_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.is_personal = true THEN
        RAISE EXCEPTION 'Personal tables cannot be deleted';
    END IF;
    RETURN OLD;
END;
$$;

CREATE TRIGGER trg_prevent_personal_table_delete
    BEFORE DELETE ON public.tables
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_personal_table_delete();
```

### Entry Edge Function Changes (supabase/functions/entry/index.ts)

**In the POST handler, after entry creation succeeds (after line ~165):**

```typescript
// After entryData is created successfully...

// Insert entry_participants
const participantIds: string[] = body.participant_ids ?? [];

// Always include the creator
const allParticipantIds = [user.id, ...participantIds.filter(id => id !== user.id)];

// Validate all participants are members of the target table (if table_id provided)
if (table_id && participantIds.length > 0) {
    const { data: members } = await supabase
        .from('table_members')
        .select('member_id')
        .eq('table_id', table_id)
        .in('member_id', participantIds);

    const memberSet = new Set((members ?? []).map(m => m.member_id));
    const nonMembers = participantIds.filter(id => !memberSet.has(id));
    if (nonMembers.length > 0) {
        return new Response(
            JSON.stringify({ error: `Some participants are not members of this table: ${nonMembers.join(', ')}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
}

// Insert participant rows
const participantRows = allParticipantIds.map(pid => ({
    entry_id: entryData.id,
    user_id: pid,
    rating: pid === user.id ? ratingValue : null,
    notes: pid === user.id ? (content?.trim() || null) : null,
}));

const { error: partError } = await supabase
    .from('entry_participants')
    .insert(participantRows);

if (partError) {
    console.error('entry_participants insert error (non-fatal):', partError);
}
```

**New `add-take` action (added before the `Method not allowed` return):**

```typescript
if (req.method === 'POST') {
    const body = await req.json();

    if (body.action === 'add-take') {
        const { entry_id, rating, notes } = body;
        if (!entry_id) {
            return new Response(
                JSON.stringify({ error: 'entry_id is required' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // Validate rating if provided
        if (rating !== null && rating !== undefined) {
            if (typeof rating !== 'number' || rating < 0.5 || rating > 5.0) {
                return new Response(
                    JSON.stringify({ error: 'Rating must be 0.5 to 5.0' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
        }

        // Validate user is a participant with null rating
        const { data: participant, error: partError } = await supabase
            .from('entry_participants')
            .select('rating')
            .eq('entry_id', entry_id)
            .eq('user_id', user.id)
            .single();

        if (partError || !participant) {
            return new Response(
                JSON.stringify({ error: 'You are not a participant in this entry' }),
                { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (participant.rating !== null) {
            return new Response(
                JSON.stringify({ error: 'You have already added your take' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const ratingValue = (rating === 0 || rating === undefined || rating === null) ? null : rating;

        const { data: updated, error: updateError } = await supabase
            .from('entry_participants')
            .update({
                rating: ratingValue,
                notes: notes?.trim() || null,
            })
            .eq('entry_id', entry_id)
            .eq('user_id', user.id)
            .select()
            .single();

        if (updateError) throw updateError;

        return new Response(
            JSON.stringify({ data: updated }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    // ... existing entry creation code (no action field) ...
}
```

### Table-Activity Edge Function Changes (supabase/functions/table-activity/index.ts)

**Replace the solo entries section to join entry_participants:**

After fetching solo entries (the existing query), add a second pass to fetch participants for those entries:

```typescript
// Fetch entry_participants for all fetched entries
const entryIds = (soloEntries ?? []).map(e => e.id);
const { data: entryParticipants } = entryIds.length > 0
    ? await supabase
        .from('entry_participants')
        .select(`
            entry_id,
            user_id,
            rating,
            notes,
            profiles:user_id (
                display_name,
                avatar_url
            )
        `)
        .in('entry_id', entryIds)
    : { data: [] };

// Group participants by entry_id
const participantsByEntry = new Map<string, typeof entryParticipants>();
for (const p of (entryParticipants ?? [])) {
    const list = participantsByEntry.get(p.entry_id) ?? [];
    list.push(p);
    participantsByEntry.set(p.entry_id, list);
}

// Tag entries: solo_share (0-1 participants) or collaborative_entry (2+)
const taggedEntries = entriesWithProfiles.map(entry => {
    const participants = participantsByEntry.get(entry.id) ?? [];
    if (participants.length > 1) {
        const ratings = participants.filter(p => p.rating !== null).map(p => p.rating as number);
        const average = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
        return {
            ...entry,
            type: 'collaborative_entry' as const,
            participants,
            average_rating: average,
            sort_date: entry.visited_at || entry.created_at,
        };
    }
    return {
        ...entry,
        type: 'solo_share' as const,
        sort_date: entry.visited_at || entry.created_at,
    };
});
```

### Hooks

**`napkin-app/hooks/tables/useTableMembers.ts` (NEW):**
```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface TableMember {
    member_id: string;
    role: string;
    joined_at: string;
    profiles: {
        display_name: string;
        avatar_url: string | null;
    };
}

async function fetchTableMembers(tableId: string): Promise<TableMember[]> {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke(
        `table-management/${tableId}`,
        {
            method: 'GET',
            headers: session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : undefined,
        }
    );
    if (error) throw error;
    return data?.data?.members ?? [];
}

export function useTableMembers(tableId: string | null | undefined) {
    return useQuery<TableMember[], Error>({
        queryKey: queryKeys.tables.members(tableId!),
        queryFn: () => fetchTableMembers(tableId!),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 5,
    });
}
```

**`napkin-app/hooks/tables/useAddTake.ts` (NEW):**
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

interface AddTakeInput {
    entry_id: string;
    table_id: string;
    rating: number | null;
    notes: string | null;
}

async function addTake(input: AddTakeInput) {
    const { data: { session } } = await supabase.auth.getSession();
    const { data, error } = await supabase.functions.invoke('entry', {
        body: { action: 'add-take', entry_id: input.entry_id, rating: input.rating, notes: input.notes },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data?.data;
}

export function useAddTake() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: addTake,
        onSuccess: (_data, variables) => {
            qc.invalidateQueries({ queryKey: queryKeys.tables.activity(variables.table_id) });
        },
    });
}
```

### Create-Entry Screen Additions

The table picker and participant tagging UI are inserted between the restaurant search field group and the rating toggle. The flow becomes:

1. Restaurant search (existing)
2. **Table picker** (new) -- horizontal ScrollView of chips. `useTables(user.id)` provides the list. Personal table (where `is_personal === true`) is always first and pre-selected. Single-select. When a table is tapped, `setSelectedTableId(id)` updates state. The `tableId` from `useLocalSearchParams` overrides the default if present.
3. **"Who was there?"** (new) -- only visible when selected table is not personal. Shows `useTableMembers(selectedTableId)` as tappable avatar chips. Creator chip is filled/non-toggleable. Tapping toggles `selectedParticipantIds` set state.
4. Rating toggle + slider (existing)
5. Dish/Notes (existing)
6. Submit (existing, updated to pass `participant_ids` and `table_id`)

### Risks

- **Existing users have no personal table**: The migration only updates `handle_new_user()` for new signups. Existing users will not have a personal table. **Mitigation**: Add a one-time backfill query at the end of the migration that creates personal tables for all existing users who don't have one. Something like: `INSERT INTO tables (owner_id, name, is_personal) SELECT p.user_id, p.display_name || '''s Journal', true FROM profiles p WHERE NOT EXISTS (SELECT 1 FROM tables t WHERE t.owner_id = p.user_id AND t.is_personal = true)` followed by the corresponding `table_members` inserts.

- **entry_participants join on profiles may fail**: The existing code references `profiles.avatar_url` in selects, but the `profiles` table (per the migration schema) does not have an `avatar_url` column. The table-activity edge function manually constructs the profile map and defaults `avatar_url: null`. The `table-management` edge function's member query does `profiles (display_name, avatar_url)` which would fail if the column doesn't exist. **Mitigation**: Verify the production schema. If `avatar_url` was added via a non-migration change, it exists. If not, add it to the migration. The edge functions use service_role and bypass RLS, so the select will just return null for missing columns -- but a missing column would be a hard error. Check before deploying.

- **Creator rating duplication**: The creator's rating is stored both on `entries.rating` and on `entry_participants.rating`. This is intentional -- `entries.rating` is the legacy field that existing queries use, and `entry_participants` is the new collaborative field. **Mitigation**: The entry edge function writes both. For display, the feed uses `entry_participants` for collaborative entries and `entries.rating` for solo entries. No conflict because the values are identical for the creator.

- **Personal table visible in table-management GET response**: The `table-management` GET endpoint returns all tables the user is a member of, including the new personal table. This is desired (the create-entry screen needs it), but the `tables.tsx` table switcher will also show it. **Mitigation**: This is actually the intended behavior per Open Question #3 in the spec ("yes, show it -- it becomes the user's personal food diary view"). The personal table is sorted first in the picker and identified by `is_personal` flag.

- **Bottom sheet library dependency**: If `@gorhom/bottom-sheet` is not installed, we need to add it (or use a simpler Modal-based approach). **Mitigation**: Use React Native's built-in `Modal` component with `animationType="slide"` and `presentationStyle="pageSheet"` on iOS. This requires zero new dependencies and achieves the same bottom-sheet feel. The `create-entry.tsx` already uses `KeyboardAvoidingView` so the pattern is established.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed

**New files:**
- `supabase/migrations/20260415000000_collaborative_entries.sql` — creates `entry_participants`, adds `is_personal` to `tables`, updates `handle_new_user()` trigger, adds delete-prevention trigger, backfills personal tables for existing users
- `napkin-app/hooks/tables/useTableMembers.ts` — query hook fetching table members via `table-management/:id` GET
- `napkin-app/hooks/tables/useAddTake.ts` — mutation hook calling `entry` edge function `add-take` action

**Modified files:**
- `napkin-app/lib/queryKeys.ts` — added `entries` key group (`list`, `detail`, `participants`)
- `supabase/functions/entry/index.ts` — added `participant_ids` support on create (validates table membership, inserts `entry_participants` rows); added `add-take` POST action
- `supabase/functions/table-activity/index.ts` — joins `entry_participants` after fetching entries, tags entries with 2+ participants as `collaborative_entry`, computes `average_rating`
- `supabase/functions/table-management/index.ts` — added `is_personal` to the list query select
- `napkin-app/hooks/tables/useCreateEntry.ts` — added `participant_ids?: string[]` to `CreateEntryInput`
- `napkin-app/hooks/tables/useTables.ts` — added `is_personal?: boolean` to `Table` interface
- `napkin-app/hooks/tables/useTableActivity.ts` — added `CollaborativeEntryActivity` interface; updated `ActivityItem` union type
- `napkin-app/app/create-entry.tsx` — added table picker (horizontal chip row, personal table first/pre-selected), participant tagging grid (only for group tables, creator always selected), wired `participant_ids` and dynamic `table_id` into mutation; submit label adapts to selected table type
- `napkin-app/app/(tabs)/tables.tsx` — added `CollaborativeEntryActivity` import; added `CollaborativeEntryCard` component (restaurant name, participant pills with rating or pending indicator, "Tap to add your take" prompt); added `AddYourTakeSheet` Modal bottom sheet (rating toggle+slider, notes, save button); updated `ActivityRow` to handle `collaborative_entry` type; added required RN imports (Modal, TextInput, KeyboardAvoidingView, Platform, Alert, Slider)

### Tests
- No automated tests exist in this codebase (no test runner configured). Manual testing required:
  1. Apply migration, verify `entry_participants` table and `is_personal` column exist
  2. Sign up new user, verify personal table auto-created
  3. Create entry with `participant_ids` via curl, verify `entry_participants` rows inserted
  4. Call `add-take` action, verify participant's rating updated; second call returns 400
  5. Hit `table-activity` feed, verify entries with 2+ participants return `type: "collaborative_entry"` with participants array
  6. Open create-entry screen, verify table picker shows with personal table first and pre-selected
  7. Select group table, verify participant chips appear
  8. From feed, tap a collaborative entry where you're a pending participant, verify sheet opens and save works

### Builder Questions
- **`profiles.avatar_url` column existence**: The technical design flags this as a risk. The existing `table-activity` edge function already selects `profiles (id, display_name, avatar_url)` without issues, so the column appears to exist. The new `entry_participants` join also selects `avatar_url` — if it's missing, this will be a hard error. Flagging for architect review if deploy fails.
- **Personal table in tables.tsx tab switcher**: Currently `tables.tsx` uses `tables?.[0]?.tables` as `activeTable`, which will now often be the personal table (since personal tables appear first in the memberships list). This means the default feed view is the personal journal, not a group table. The spec says personal table should be visible in the tab switcher (Open Question #3 answer: "yes, show it"), but the existing single-table switcher design may need a future ticket to add proper multi-table navigation. For now, the behavior is consistent with the existing pattern — first table wins.
- **`useCreateEntry` hook re-instantiation**: The hook is called with `selectedTableId` which can change as the user picks tables. This means the hook is re-created on each render where `selectedTableId` changes. This is valid React behavior (no stale closure issues) but worth noting.

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
Date: 2026-04-14
Verdict: REVISE

Spec compliance: 14/17 acceptance criteria met
- [x] `entry_participants` table with correct columns and PK — PASS
- [x] Entry creator inserted into `entry_participants` with rating/notes at creation time — PASS
- [x] Personal table on signup via DB trigger with `is_personal` boolean — PASS
- [x] Table picker with horizontal chips, personal table pre-selected — PASS
- [x] "Who was there?" section for non-personal tables with tappable avatar chips, creator non-deselectable — PASS
- [x] `participant_ids` sent to edge function — PASS
- [x] Submitting with no table selected posts to personal table (falls through to default) — PASS
- [x] Edge function accepts optional `participant_ids: string[]` — PASS
- [x] Creator row + tagged participant rows inserted into `entry_participants` — PASS
- [x] Validates `participant_ids` are table members, returns 400 if not — PASS (logic correct but ordering bug, see below)
- [ ] Feed: entries with multiple participants render as grouped card — FAIL: `profiles:user_id` join in `table-activity/index.ts:121` will fail at runtime (see issue #1)
- [x] Entries with single participant render as existing SoloShareCard — PASS
- [x] Tapping grouped card where current user is pending participant opens AddYourTakeSheet — PASS
- [x] Submitting "your take" calls `add-take` action, updates `entry_participants` row — PASS
- [x] After submitting, feed card updates (via query invalidation) — PASS
- [x] Personal table has distinct label, no "Who was there?" section, not deletable — PASS
- [x] Query invalidation: creating entry invalidates activity + entries.list; adding take invalidates activity — PASS

Correctness: FAIL — `profiles:user_id` join on `entry_participants` will produce a runtime error; participant validation runs after entry INSERT creating orphaned entries on failure
Edge Cases: WARN — `add-take` allows submitting with both `rating: null` and `notes: null`, which is a no-op update that blocks future takes (the `participant.rating !== null` guard won't fire, but the row stays null — actually this is fine since the update sets rating to null again, but the user can never retry because the code checks `participant.rating !== null` on line 95 which would be false, so they CAN retry. Acceptable.)
Error Handling: WARN — entry_participants insert error is logged as non-fatal (line 291-293), meaning an entry can silently exist without its participant rows
Security: PASS — auth validated, table membership checked, participant ownership enforced on add-take
Performance: PASS — indexed on entry_id and user_id, participant fetch batched per page
Design Compliance: WARN — `AddYourTakeSheet` was designed as a standalone component at `components/AddYourTakeSheet.tsx` but was inlined in `tables.tsx`; acceptable for now but noted

Key issues:

1. **BLOCKING — `profiles:user_id` join will fail at runtime** (`supabase/functions/table-activity/index.ts:121`): The `entry_participants` table FK on `user_id` points to `auth.users(id)`, not `profiles(user_id)`. PostgREST cannot resolve `profiles:user_id (display_name, avatar_url)` without a FK path from `entry_participants` to `profiles`. The `table_night_participants` table works because it has an explicit FK to `profiles(user_id)` (see migration `20251222023333`). **Fix**: Either (a) add a FK from `entry_participants.user_id` to `profiles.user_id` in the migration, or (b) fetch participant profiles in a separate query (like the existing solo-entry profile fetch pattern at lines 97-103). Option (a) is cleaner.

2. **Participant validation after entry creation** (`supabase/functions/entry/index.ts:262-278`): If a non-member `participant_id` is passed, the entry is already committed to the DB (line 215-237) before validation runs. The 400 response returns but the orphaned entry persists with no `entry_participants` rows. **Fix**: Move the participant membership validation (lines 262-278) to before the entry INSERT (before line 215). This is a straightforward reorder.

3. **`entry_participants` insert error is silently swallowed** (`supabase/functions/entry/index.ts:291-293`): If the participant insert fails (e.g., duplicate key, constraint violation), the entry is returned as successful but has no participant data. The feed will show it as a solo entry. **Fix**: Consider making this a hard error (throw) rather than non-fatal, or at minimum include a warning in the response so the client can inform the user.

### Review 2
Date: 2026-04-14
Verdict: APPROVE

**Prior issue verification:**
1. BLOCKING `profiles:user_id` join -- FIXED: FK `entry_participants_user_id_profiles_fkey` added at `supabase/migrations/20260415000000_collaborative_entries.sql:31-34`, referencing `profiles(user_id)`. PostgREST can now resolve the join at `table-activity/index.ts:121`.
2. Participant validation after INSERT -- FIXED: Validation moved to `entry/index.ts:217-232`, before entry INSERT at line 235.
3. Swallowed insert error -- FIXED: `entry/index.ts:292-294` now throws on `partInsertError`.

Spec compliance: 17/17 acceptance criteria met
- [x] `entry_participants` table with correct columns and PK — PASS
- [x] Entry creator inserted into `entry_participants` with rating/notes at creation time — PASS
- [x] Personal table on signup via DB trigger with `is_personal` boolean — PASS
- [x] Table picker with horizontal chips, personal table pre-selected — PASS
- [x] "Who was there?" section for non-personal tables with tappable avatar chips, creator non-deselectable — PASS
- [x] `participant_ids` sent to edge function — PASS
- [x] Submitting with no table selected posts to personal table — PASS
- [x] Edge function accepts optional `participant_ids: string[]` — PASS
- [x] Creator row + tagged participant rows inserted into `entry_participants` — PASS
- [x] Validates `participant_ids` are table members, returns 400 if not — PASS
- [x] Feed: entries with multiple participants render as grouped card — PASS
- [x] Entries with single participant render as existing SoloShareCard — PASS
- [x] Tapping grouped card where current user is pending participant opens AddYourTakeSheet — PASS
- [x] Submitting "your take" calls `add-take` action, updates `entry_participants` row — PASS
- [x] After submitting, feed card updates (via query invalidation) — PASS
- [x] Personal table has distinct label, no "Who was there?" section, not deletable — PASS
- [x] Query invalidation: creating entry invalidates activity + entries.list; adding take invalidates activity — PASS

Correctness: PASS — all three prior blocking issues resolved correctly
Edge Cases: WARN — participant tagging without `table_id` skips membership validation (`entry/index.ts:217`); only exploitable via direct API call since UI always sends `table_id`
Error Handling: PASS — participant insert errors now hard-fail; add-take validates participant existence and idempotency
Security: PASS — auth validated, table membership checked before entry creation, participant ownership enforced on add-take
Performance: PASS — indexed on entry_id and user_id, participant fetch batched per page
Design Compliance: PASS — all file changes match the technical design; AddYourTakeSheet inlined in tables.tsx is acceptable per prior review

Notes:
- Pre-existing: `table-activity/index.ts:101` queries `profiles` by `id` column (not `user_id`). This works if `profiles` has both columns, but is not introduced by this ticket.
- Minor: `create-entry.tsx:481` has `opacity: isCreator ? 1 : 1` which is a no-op; cosmetic only.

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: 2026-04-14
- Final verdict: APPROVE (Review 2, 17/17 criteria passed)
- Notes: 3 issues found in Review 1 (FK for profiles join, validation ordering, error handling). All fixed and verified in Review 2. One WARN accepted: participant tagging without table_id skips membership validation (API-only, UI always sends table_id).
