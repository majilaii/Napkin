import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    projectSearchRows,
    resolveVisibleFolloweeEntryIds,
    type SearchRatingEntry,
} from './searchProjection.ts';

const VIEWER = '00000000-0000-4000-8000-000000000001';
const FOLLOWEE_X = '00000000-0000-4000-8000-000000000002';
const FOLLOWEE_Y = '00000000-0000-4000-8000-000000000003';
const TABLEMATE = '00000000-0000-4000-8000-000000000004';

function entry(
    id: string,
    user_id: string,
    restaurant_id: string,
    rating: number,
): SearchRatingEntry {
    return { id, user_id, restaurant_id, rating };
}

Deno.test('search ratings prefer you, then visible friends, then labelled google', () => {
    const rows = projectSearchRows([
        { id: 'you', name: 'You', google_rating: 4.9 },
        { id: 'friends', name: 'Friends', google_rating: 4.8 },
        { id: 'google', name: 'Google', google_rating: 4.6 },
        { id: 'none', name: 'None', google_rating: null },
    ], {
        viewerId: VIEWER,
        followedUserIds: new Set([FOLLOWEE_X]),
        pinnedRestaurantIds: new Set(['you']),
        ratingEntries: [
            entry('self', VIEWER, 'you', 4.5),
            entry('friend', FOLLOWEE_X, 'friends', 4),
        ],
        visibleFolloweeEntryIds: new Set(['friend']),
    });

    assertEquals(rows.map((row) => row.rating), [
        { tier: 'you', value: 4.5, scale: 5 },
        { tier: 'friends', value: 4, scale: 5 },
        { tier: 'google', value: 4.6, scale: 5 },
        null,
    ]);
    assertEquals(rows.map((row) => row.is_pinned), [true, false, false, false]);
    assertEquals(rows[0].name, 'You');
    const { is_pinned: _pin, friends_been_count: _count, rating: _rating, ...existing } = rows[0];
    assertEquals(existing, { id: 'you', name: 'You', google_rating: 4.9 });
});

Deno.test('friends mean is the mean of per-person averages, never entry-weighted', () => {
    const rows = projectSearchRows([{ id: 'r', google_rating: 4.9 }], {
        viewerId: VIEWER,
        followedUserIds: new Set([FOLLOWEE_X, FOLLOWEE_Y]),
        pinnedRestaurantIds: new Set(),
        ratingEntries: [
            entry('x1', FOLLOWEE_X, 'r', 5),
            entry('x2', FOLLOWEE_X, 'r', 4),
            entry('y1', FOLLOWEE_Y, 'r', 2),
        ],
        visibleFolloweeEntryIds: new Set(['x1', 'x2', 'y1']),
    });

    assertEquals(rows[0].rating, { tier: 'friends', value: 3.3, scale: 5 });
    assertEquals(rows[0].friends_been_count, 2);
});

Deno.test('all inaccessible, blocked, private, and unfollowed fixtures are excluded', () => {
    const ratingEntries = [
        entry('table-not-shared', FOLLOWEE_X, 'r', 5),
        entry('shared-table', FOLLOWEE_X, 'r', 4),
        entry('public-eligible', FOLLOWEE_Y, 'r', 3),
        entry('blocked-either-way', FOLLOWEE_Y, 'r', 5),
        entry('private', FOLLOWEE_X, 'r', 5),
        entry('unfollowed-tablemate', TABLEMATE, 'r', 5),
    ];
    const rows = projectSearchRows([{ id: 'r', google_rating: null }], {
        viewerId: VIEWER,
        followedUserIds: new Set([FOLLOWEE_X, FOLLOWEE_Y]),
        pinnedRestaurantIds: new Set(),
        ratingEntries,
        // This is exactly the SECURITY DEFINER RPC output for the fixtures.
        visibleFolloweeEntryIds: new Set(['shared-table', 'public-eligible']),
    });

    assertEquals(rows[0].friends_been_count, 2);
    assertEquals(rows[0].rating, { tier: 'friends', value: 3.5, scale: 5 });
});

Deno.test('followee candidates call fn_visible_entry_ids with require_content=true', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const visible = await resolveVisibleFolloweeEntryIds({
        rpc: (name, args) => {
            calls.push({ name, args });
            return Promise.resolve({ data: [{ entry_id: 'shared-table' }], error: null });
        },
    }, VIEWER, [entry('shared-table', FOLLOWEE_X, 'r', 4)]);

    assertEquals([...visible], ['shared-table']);
    assertEquals(calls, [{
        name: 'fn_visible_entry_ids',
        args: {
            p_viewer: VIEWER,
            p_entry_ids: ['shared-table'],
            p_require_content: true,
        },
    }]);
});
