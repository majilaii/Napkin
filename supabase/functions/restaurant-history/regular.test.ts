import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    loadRestaurantRegular,
    loadRestaurantRegularNonFatal,
    type LedgerCandidate,
    type LedgerCandidateRead,
    type LedgerReadPort,
} from '../_shared/ledger.ts';

const VIEWER = 'viewer';
const FRIEND = 'friend';
const STRANGER = 'stranger';
const RESTAURANT = 'restaurant';
const NOW = new Date('2026-09-01T12:00:00.000Z');

function meal(id: string, userId: string, date: string, rating: number | null = 4): LedgerCandidate {
    return {
        id,
        user_id: userId,
        restaurant_id: RESTAURANT,
        rating: rating as number,
        visited_at: date,
        created_at: date,
    };
}

function meals(userId: string, count: number, day = 10): LedgerCandidate[] {
    return Array.from({ length: count }, (_, index) =>
        meal(`${userId}-${day}-${index}`, userId, `2026-08-${String(day + index).padStart(2, '0')}T12:00:00.000Z`)
    );
}

function readerFor(
    entries: LedgerCandidate[],
    visibleIds = new Set(entries.map((entry) => entry.id)),
    profileReads?: string[][],
): LedgerReadPort {
    return {
        fetchFollowees: () => Promise.resolve([FRIEND]),
        fetchProfiles: (ids) => {
            profileReads?.push([...ids]);
            return Promise.resolve(ids.map((id) => ({
                user_id: id,
                display_name: id === VIEWER ? 'Jacky' : 'Clara',
                avatar_url: id === FRIEND ? 'clara.jpg' : null,
            })));
        },
        fetchVisibleEntryIds: (_viewerId, candidates) => Promise.resolve(new Set(
            candidates.map((candidate) => candidate.entryId).filter((id) => visibleIds.has(id)),
        )),
        fetchEntryPage: (request: LedgerCandidateRead) => {
            const dateFor = (entry: LedgerCandidate) => entry.visited_at ?? entry.created_at;
            return Promise.resolve(entries
                .filter((entry) => request.userIds.includes(entry.user_id))
                .filter((entry) => entry.restaurant_id === request.restaurantId)
                .filter((entry) => entry.rating != null)
                .filter((entry) => request.branch === 'visited'
                    ? entry.visited_at != null
                    : entry.visited_at == null)
                .filter((entry) => !request.start || dateFor(entry) >= request.start)
                .filter((entry) => dateFor(entry) < request.end)
                .filter((entry) => !request.after
                    || dateFor(entry) > request.after.date
                    || (dateFor(entry) === request.after.date && entry.id > request.after.id))
                .sort((a, b) => dateFor(a).localeCompare(dateFor(b)) || a.id.localeCompare(b.id))
                .slice(0, request.limit));
        },
    };
}

Deno.test('regular fixtures: viewer wins, followee wins, and wire copy stays a string', async (t) => {
    await t.step('viewer wins', async () => {
        const profileReads: string[][] = [];
        const entries = [...meals(VIEWER, 4), ...meals(FRIEND, 3)];
        const snapshot = await loadRestaurantRegular(
            readerFor(entries, new Set(entries.map((entry) => entry.id)), profileReads),
            VIEWER,
            RESTAURANT,
            NOW,
        );
        assertEquals(snapshot.data.regular, "you're the regular here · Clara is 1 behind");
        assertEquals(snapshot.data.regular_detail?.is_viewer, true);
        assertEquals(snapshot.data.regular_detail?.visits, 4);
        assertEquals(profileReads, [[VIEWER, FRIEND]]);
        assertEquals(snapshot.metrics.profiles, 1);
    });

    await t.step('followee wins', async () => {
        const snapshot = await loadRestaurantRegular(
            readerFor([...meals(VIEWER, 2), ...meals(FRIEND, 3)]),
            VIEWER,
            RESTAURANT,
            NOW,
        );
        assertEquals(snapshot.data.regular, 'Clara is the regular here · Jacky is 1 behind');
        assertEquals(snapshot.data.regular_detail, {
            user_id: FRIEND,
            display_name: 'Clara',
            avatar_url: 'clara.jpg',
            visits: 3,
            is_viewer: false,
            runner_up: { display_name: 'Jacky', gap: 1 },
        });
    });
});

Deno.test('regular fixtures: tie uses most-recent meal and fewer than three is null', async () => {
    const tied = [
        ...meals(VIEWER, 3, 1),
        ...meals(FRIEND, 2, 1),
        meal('friend-latest', FRIEND, '2026-08-31T12:00:00.000Z'),
    ];
    const tieSnapshot = await loadRestaurantRegular(readerFor(tied), VIEWER, RESTAURANT, NOW);
    assertEquals(tieSnapshot.data.regular_detail?.user_id, FRIEND);
    assertEquals(tieSnapshot.data.regular_detail?.runner_up?.gap, 0);

    const sparseProfileReads: string[][] = [];
    const sparseEntries = meals(FRIEND, 2);
    const sparseSnapshot = await loadRestaurantRegular(
        readerFor(
            sparseEntries,
            new Set(sparseEntries.map((entry) => entry.id)),
            sparseProfileReads,
        ),
        VIEWER,
        RESTAURANT,
        NOW,
    );
    assertEquals(sparseSnapshot.data, { regular: null, regular_detail: null });
    assertEquals(sparseProfileReads, []);
    assertEquals(sparseSnapshot.metrics.profiles, 0);
});

Deno.test('regular fixtures: cohort and visibility exclude strangers/private/hidden competitors', async () => {
    const visibleFriend = meals(FRIEND, 3);
    const privateFriend = meals(FRIEND, 2, 20);
    const hiddenCompetitor = meals(FRIEND, 4, 1);
    const stranger = meals(STRANGER, 8);
    const authorizedIds = new Set([
        ...visibleFriend.map((entry) => entry.id),
        // One private-account row authorized via Table/companion/Supper scope.
        privateFriend[0].id,
    ]);
    const snapshot = await loadRestaurantRegular(
        readerFor([...visibleFriend, ...privateFriend, ...hiddenCompetitor, ...stranger], authorizedIds),
        VIEWER,
        RESTAURANT,
        NOW,
    );

    assertEquals(snapshot.data.regular_detail?.user_id, FRIEND);
    assertEquals(snapshot.data.regular_detail?.visits, 4);
});

Deno.test('regular fixtures: unrated and 91-day-old meals never qualify', async () => {
    const entries = [
        meal('old-a', FRIEND, '2026-06-01T12:00:00.000Z'),
        meal('old-b', FRIEND, '2026-06-02T11:59:59.000Z'),
        meal('unrated', FRIEND, '2026-08-20T12:00:00.000Z', null),
        ...meals(FRIEND, 2),
    ];
    const snapshot = await loadRestaurantRegular(readerFor(entries), VIEWER, RESTAURANT, NOW);
    assertEquals(snapshot.data, { regular: null, regular_detail: null });
});

Deno.test('regular wrapper keeps a failed cohort read non-fatal', async () => {
    const reader = readerFor([]);
    reader.fetchFollowees = () => Promise.reject(new Error('follow read failed'));
    const logged: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => logged.push(args);

    try {
        const snapshot = await loadRestaurantRegularNonFatal(
            reader,
            VIEWER,
            RESTAURANT,
            NOW,
        );
        assertEquals(snapshot.data, { regular: null, regular_detail: null });
        assertEquals(snapshot.metrics, {
            month: 0,
            crown: 0,
            lookback: 0,
            visibility: 0,
            follows: 0,
            profiles: 0,
        });
        assertEquals(logged[0]?.[0], '[restaurant-history] regular unavailable (non-fatal):');
        assertEquals((logged[0]?.[1] as Error).message, 'follow read failed');
    } finally {
        console.error = originalError;
    }
});
