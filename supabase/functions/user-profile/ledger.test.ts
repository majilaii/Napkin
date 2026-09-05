import {
    assert,
    assertEquals,
    assertRejects,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    LedgerAuthorizationError,
    LEDGER_PAGE_SIZE,
    ledgerErrorResponse,
    loadFriendsLedger,
    loadTableLedger,
    type LedgerBounds,
    type LedgerCandidate,
    type LedgerCandidateRead,
    type LedgerProfile,
    type LedgerReadPort,
    validateLedgerInput,
} from '../_shared/ledger.ts';

const VIEWER = '00000000-0000-0000-0000-000000000001';
const FRIEND = '00000000-0000-0000-0000-000000000002';
const STRANGER = '00000000-0000-0000-0000-000000000003';
const RESTAURANT = '10000000-0000-0000-0000-000000000001';
const NOW = new Date('2026-10-15T12:00:00.000Z');

function bounds(month = '2026-09', tz = 'UTC', now = NOW): LedgerBounds {
    const result = validateLedgerInput(month, tz, now);
    if (result.ok === false) throw new Error(result.code);
    return result;
}

function row(
    id: string,
    userId: string,
    date: string,
    overrides: Partial<LedgerCandidate> = {},
): LedgerCandidate {
    return {
        id,
        user_id: userId,
        restaurant_id: RESTAURANT,
        rating: 4,
        visited_at: date,
        created_at: date,
        ...overrides,
    };
}

type FakeOptions = {
    followees?: string[];
    entries?: LedgerCandidate[];
    visibleIds?: Set<string>;
    profiles?: LedgerProfile[];
    tableMembership?: { table_name: string } | null;
    tableMembers?: { member_id: string; joined_at: string }[];
};

function fakeReader(options: FakeOptions = {}) {
    const entries = options.entries ?? [];
    const followees = options.followees ?? [];
    const visibleIds = options.visibleIds ?? new Set(entries.map((entry) => entry.id));
    const profiles = options.profiles ?? [
        { user_id: VIEWER, display_name: 'Viewer', avatar_url: null },
        { user_id: FRIEND, display_name: 'Friend', avatar_url: null },
    ];
    const reads: LedgerCandidateRead[] = [];
    const profileCalls: string[][] = [];
    const visibilityCalls: string[][] = [];
    let followsCalls = 0;

    const reader: LedgerReadPort = {
        fetchFollowees() {
            followsCalls += 1;
            return Promise.resolve(followees);
        },
        fetchTableMembership() {
            return Promise.resolve(options.tableMembership ?? null);
        },
        fetchTableMembers() {
            return Promise.resolve(options.tableMembers ?? []);
        },
        fetchProfiles(userIds) {
            profileCalls.push(userIds);
            return Promise.resolve(profiles.filter((profile) => userIds.includes(profile.user_id)));
        },
        fetchEntryPage(request) {
            reads.push(request);
            const dateFor = (entry: LedgerCandidate) => entry.visited_at ?? entry.created_at;
            const result = entries
                .filter((entry) => request.userIds.includes(entry.user_id))
                .filter((entry) => entry.restaurant_id != null && (request.category === 'lookback' || entry.rating != null))
                .filter((entry) => request.branch === 'visited'
                    ? entry.visited_at != null
                    : entry.visited_at == null)
                .filter((entry) => !request.restaurantId
                    || entry.restaurant_id === request.restaurantId)
                .filter((entry) => !request.restaurantIds
                    || request.restaurantIds.includes(entry.restaurant_id))
                .filter((entry) => !request.start || dateFor(entry) >= request.start)
                .filter((entry) => (request.category === 'lookback' && request.branch === 'created') || dateFor(entry) < request.end)
                .filter((entry) => !request.after
                    || dateFor(entry) > request.after.date
                    || (dateFor(entry) === request.after.date && entry.id > request.after.id))
                .sort((a, b) =>
                    dateFor(a).localeCompare(dateFor(b)) || a.id.localeCompare(b.id)
                )
                .slice(0, request.limit);
            return Promise.resolve(result);
        },
        fetchVisibleEntryIds(_viewerId, candidates) {
            visibilityCalls.push(candidates.map((candidate) => candidate.entryId));
            return Promise.resolve(new Set(
                candidates
                    .map((candidate) => candidate.entryId)
                    .filter((id) => visibleIds.has(id)),
            ));
        },
    };

    return {
        reader,
        reads,
        profileCalls,
        visibilityCalls,
        followsCalls: () => followsCalls,
    };
}

Deno.test('ledger input contract rejects before reads with exact response status/code', async () => {
    const cases: Array<[unknown, unknown, string]> = [
        [undefined, 'UTC', 'INVALID_MONTH'],
        ['2026-13', 'UTC', 'INVALID_MONTH'],
        ['2026-09', undefined, 'INVALID_TZ'],
        ['2026-09', 'Not/AZone', 'INVALID_TZ'],
        ['2026-11', 'UTC', 'FUTURE_MONTH'],
    ];
    for (const [month, tz, code] of cases) {
        const result = validateLedgerInput(month, tz, NOW);
        assertEquals(result.ok, false);
        if (result.ok === false) {
            const response = ledgerErrorResponse(
                result.code,
                result.message,
                result.status,
            );
            assertEquals(response.status, 400);
            const payload = await response.json();
            assertEquals(payload.error.code, code);
            assertEquals(typeof payload.error.message, 'string');
        }
    }
});

Deno.test('ledger bounds are half-open, current-month ends now, and tz changes UTC bounds', () => {
    const london = bounds('2026-09', 'Europe/London');
    const tokyo = bounds('2026-09', 'Asia/Tokyo');
    assertEquals(london.monthStart, '2026-08-31T23:00:00.000Z');
    assertEquals(london.monthEnd, '2026-09-30T23:00:00.000Z');
    assertEquals(tokyo.monthStart, '2026-08-31T15:00:00.000Z');
    assert(london.monthStart !== tokyo.monthStart);

    const current = bounds('2026-10', 'UTC');
    assertEquals(current.snapshotEnd, NOW.toISOString());
    assertEquals(current.isCurrentMonth, true);
});

Deno.test('ledger counts only known dates at month/crown edges and excludes unrated rows', async () => {
    const b = bounds();
    const crownEdge = b.crownStart;
    const { reader } = fakeReader({
        entries: [
            row('month-start', VIEWER, b.monthStart),
            row('month-end', VIEWER, b.snapshotEnd),
            row('crown-edge-a', VIEWER, crownEdge, { restaurant_id: 'r-crown' }),
            row('crown-edge-b', VIEWER, crownEdge, { restaurant_id: 'r-crown' }),
            row('crown-edge-c', VIEWER, crownEdge, { restaurant_id: 'r-crown' }),
            row('created-inside', VIEWER, b.monthStart, {
                visited_at: null,
                created_at: '2026-09-10T12:00:00.000Z',
                restaurant_id: 'r-created',
            }),
            row('created-outside', VIEWER, b.monthStart, {
                visited_at: null,
                created_at: b.snapshotEnd,
            }),
            row('unrated', VIEWER, '2026-09-12T00:00:00.000Z', { rating: null as never }),
        ],
    });
    const snapshot = await loadFriendsLedger(reader, VIEWER, b);
    const viewer = snapshot.data.rows.find((ledgerRow) => ledgerRow.is_viewer)!;

    assertEquals(viewer.meals, 1);
    assertEquals(viewer.crowns, 1);
    assertEquals(viewer.new_places, 0);
    assertEquals(viewer.napkins, 2);
});

Deno.test('ledger applies cohort before one union visibility gate for every aggregate', async () => {
    const b = bounds();
    const friendShared = row('friend-shared', FRIEND, '2026-09-08T12:00:00.000Z', {
        restaurant_id: 'r-shared',
    });
    const friendPrivate = row('friend-private', FRIEND, '2026-09-09T12:00:00.000Z', {
        restaurant_id: 'r-private',
    });
    const hiddenPrior = row('hidden-prior', FRIEND, '2026-08-01T12:00:00.000Z', {
        restaurant_id: 'r-shared',
    });
    const hiddenCompetitor = [0, 1, 2, 3].map((index) =>
        row(`hidden-crown-${index}`, FRIEND, `2026-09-1${index}T12:00:00.000Z`, {
            restaurant_id: 'r-crown',
        })
    );
    const viewerCrown = [0, 1, 2].map((index) =>
        row(`viewer-crown-${index}`, VIEWER, `2026-09-0${index + 1}T12:00:00.000Z`, {
            restaurant_id: 'r-crown',
        })
    );
    const strangerRows = [0, 1, 2, 3, 4].map((index) =>
        row(`stranger-${index}`, STRANGER, `2026-09-2${index}T12:00:00.000Z`, {
            restaurant_id: 'r-crown',
        })
    );
    const visibleIds = new Set([
        'friend-shared',
        ...viewerCrown.map((entry) => entry.id),
    ]);
    const fake = fakeReader({
        followees: [FRIEND],
        entries: [
            friendShared,
            friendPrivate,
            hiddenPrior,
            ...hiddenCompetitor,
            ...viewerCrown,
            ...strangerRows,
        ],
        visibleIds,
    });

    const snapshot = await loadFriendsLedger(fake.reader, VIEWER, b);
    const friend = snapshot.data.rows.find((ledgerRow) => ledgerRow.user_id === FRIEND)!;
    const viewer = snapshot.data.rows.find((ledgerRow) => ledgerRow.user_id === VIEWER)!;

    assertEquals(snapshot.data.rows.some((ledgerRow) => ledgerRow.user_id === STRANGER), false);
    assertEquals(friend.meals, 1); // table/companion/Supper-authorized row survives
    assertEquals(friend.new_places, 1); // hidden prior cannot suppress
    assertEquals(viewer.crowns, 1); // hidden competitor cannot win
    assertEquals(friend.crowns, 0);
});

Deno.test('ledger self rows bypass RPC while non-self batches contain only followee ids', async () => {
    const b = bounds();
    const selfOnly = fakeReader({
        entries: [row('self', VIEWER, '2026-09-05T12:00:00.000Z')],
    });
    const selfSnapshot = await loadFriendsLedger(selfOnly.reader, VIEWER, b);
    assertEquals(selfSnapshot.data.rows[0].meals, 1);
    assertEquals(selfSnapshot.data.rows[0].napkins, 2);
    assertEquals(selfOnly.visibilityCalls, []);
    assertEquals(selfSnapshot.metrics.visibility, 0);

    const mixed = fakeReader({
        followees: [FRIEND],
        entries: [
            row('self', VIEWER, '2026-09-05T12:00:00.000Z'),
            row('friend', FRIEND, '2026-09-06T12:00:00.000Z'),
        ],
    });
    const mixedSnapshot = await loadFriendsLedger(mixed.reader, VIEWER, b);
    assertEquals(mixedSnapshot.data.rows.find((item) => item.is_viewer)?.meals, 1);
    assertEquals(new Set(mixed.visibilityCalls.flat()), new Set(['friend']));
});

Deno.test('table ledger refuses non-members with the structured authorization error', async () => {
    const fake = fakeReader({ tableMembership: null });
    const error = await assertRejects(
        () => loadTableLedger(fake.reader, VIEWER, '20000000-0000-0000-0000-000000000001', bounds()),
        LedgerAuthorizationError,
    );
    assertEquals(error.status, 403);
    assertEquals(error.code, 'NOT_A_MEMBER');
    const response = ledgerErrorResponse(error.code, error.message, error.status);
    assertEquals(response.status, 403);
    assertEquals(await response.json(), {
        error: {
            code: 'NOT_A_MEMBER',
            message: 'you are not a current member of this table',
        },
    });
});

Deno.test('table ledger counts table-visible entries, hides solo entries, and omits departed members', async () => {
    const tableId = '20000000-0000-0000-0000-000000000001';
    const visibleShared = row('friend-table-shared', FRIEND, '2026-09-08T12:00:00.000Z', {
        restaurant_id: 'r-shared',
    });
    const privateSolo = row('friend-private-solo', FRIEND, '2026-09-09T12:00:00.000Z', {
        restaurant_id: 'r-private',
    });
    const departed = row('departed', STRANGER, '2026-09-10T12:00:00.000Z', {
        restaurant_id: 'r-departed',
    });
    const fake = fakeReader({
        entries: [visibleShared, privateSolo, departed],
        visibleIds: new Set([visibleShared.id]),
        tableMembership: { table_name: 'Sunday Roast' },
        tableMembers: [
            { member_id: VIEWER, joined_at: '2026-09-02T00:00:00.000Z' },
            { member_id: FRIEND, joined_at: '2026-09-01T00:00:00.000Z' },
        ],
    });

    const snapshot = await loadTableLedger(fake.reader, VIEWER, tableId, bounds());
    assertEquals(snapshot.data.scope, {
        kind: 'table',
        table_id: tableId,
        table_name: 'Sunday Roast',
    });
    assertEquals(snapshot.data.rows.find((item) => item.user_id === FRIEND)?.meals, 1);
    assertEquals(snapshot.data.rows.some((item) => item.user_id === STRANGER), false);
    assertEquals(new Set(fake.visibilityCalls.flat()), new Set([
        'friend-table-shared',
        'friend-private-solo',
    ]));
});

Deno.test('two-member table with only viewer entries keeps self rows off the RPC', async () => {
    const fake = fakeReader({
        entries: [row('viewer-table', VIEWER, '2026-09-08T12:00:00.000Z')],
        tableMembership: { table_name: 'The Table' },
        tableMembers: [
            { member_id: VIEWER, joined_at: '2026-09-02T00:00:00.000Z' },
            { member_id: FRIEND, joined_at: '2026-09-01T00:00:00.000Z' },
        ],
    });
    const snapshot = await loadTableLedger(
        fake.reader,
        VIEWER,
        '20000000-0000-0000-0000-000000000001',
        bounds(),
    );
    assertEquals(snapshot.data.rows.find((item) => item.is_viewer)?.napkins, 2);
    assertEquals(snapshot.metrics.visibility, 0);
    assertEquals(fake.visibilityCalls, []);
});

Deno.test('friends ledger response declares its scope', async () => {
    const snapshot = await loadFriendsLedger(fakeReader().reader, VIEWER, bounds());
    assertEquals(snapshot.data.scope, { kind: 'friends' });
});

Deno.test('ledger pagination exhausts a >1000-row lookback and suppresses a false new bonus', async () => {
    const hidden = Array.from({ length: LEDGER_PAGE_SIZE }, (_, index) =>
        row(
            `hidden-${String(index).padStart(4, '0')}`,
            FRIEND,
            '2026-01-01T00:00:00.000Z',
        )
    );
    const visiblePrior = row('visible-prior', FRIEND, '2026-08-01T00:00:00.000Z');
    const monthVisit = row('visible-month', FRIEND, '2026-09-10T00:00:00.000Z');
    const fake = fakeReader({
        followees: [FRIEND],
        entries: [...hidden, visiblePrior, monthVisit],
        visibleIds: new Set(['visible-prior', 'visible-month']),
    });

    const snapshot = await loadFriendsLedger(fake.reader, VIEWER, bounds());
    const friend = snapshot.data.rows.find((item) => item.user_id === FRIEND)!;
    const lookbackVisited = fake.reads.filter((read) =>
        read.category === 'lookback' && read.branch === 'visited'
    );
    assertEquals(friend.meals, 1);
    assertEquals(friend.new_places, 0);
    assertEquals(lookbackVisited.length, 2);
    assertEquals(lookbackVisited[0].after, null);
    assertEquals(lookbackVisited[1].after, {
        date: '2026-01-01T00:00:00.000Z',
        id: 'hidden-0999',
    });
    assertEquals(snapshot.metrics.lookback, 3); // 2 visited pages + 1 short created page
});

Deno.test('ledger 250-followee fixture matches the exact bounded-query formula', async () => {
    const followees = Array.from({ length: 250 }, (_, index) => `friend-${index}`);
    const cohort = [VIEWER, ...followees];
    const entries = [0, 100, 200].map((index) =>
        row(`meal-${index}`, cohort[index], '2026-09-10T00:00:00.000Z', {
            restaurant_id: `restaurant-${index}`,
        })
    );
    const profiles = cohort.map((userId) => ({
        user_id: userId,
        display_name: userId,
        avatar_url: null,
    }));
    const fake = fakeReader({ followees, entries, profiles });
    const snapshot = await loadFriendsLedger(fake.reader, VIEWER, bounds());

    assertEquals(snapshot.metrics, {
        month: 3,
        crown: 3,
        lookback: 6,
        visibility: 1,
        follows: 1,
        profiles: 3,
    });
    assertEquals(fake.profileCalls.map((ids) => ids.length), [100, 100, 51]);
});

Deno.test('ledger newest-500 cap keeps 501 rows, six chunks, bounded lists, stable order', async () => {
    const followees = Array.from({ length: 501 }, (_, index) => `friend-${index}`);
    const included = [VIEWER, ...followees.slice(0, 500)];
    const entries = [0, 100, 200, 300, 400, 500].map((index) =>
        row(`meal-${index}`, included[index], '2026-09-10T00:00:00.000Z', {
            restaurant_id: `restaurant-${index}`,
        })
    );
    entries.push(row('oldest-meal', followees[500], '2026-09-11T00:00:00.000Z'));
    const profiles = [...included, followees[500]].map((userId) => ({
        user_id: userId,
        display_name: userId,
        avatar_url: null,
    }));

    const first = fakeReader({ followees, entries, profiles });
    const second = fakeReader({ followees, entries, profiles });
    const firstSnapshot = await loadFriendsLedger(first.reader, VIEWER, bounds());
    const secondSnapshot = await loadFriendsLedger(second.reader, VIEWER, bounds());

    assertEquals(firstSnapshot.data.rows.length, 501);
    assertEquals(firstSnapshot.data.rows.some((item) => item.user_id === followees[500]), false);
    assertEquals(firstSnapshot.data.rows, secondSnapshot.data.rows);
    assertEquals(firstSnapshot.metrics.month, 6);
    assertEquals(firstSnapshot.metrics.crown, 6);
    assertEquals(firstSnapshot.metrics.lookback, 12);
    assertEquals(firstSnapshot.metrics.follows, 1);
    assertEquals(firstSnapshot.metrics.profiles, 6);
    assert(first.reads.every((read) => read.userIds.length <= 100));
    assert(first.reads.every((read) => (read.restaurantIds?.length ?? 0) <= 100));
    assert(first.profileCalls.every((ids) => ids.length <= 100));
});

Deno.test('rated undated visits earn no period awards and unknown history prevents false first-visit credit', async () => {
    const fake = fakeReader({ entries: [
        row('known', VIEWER, '2026-09-05', { restaurant_id: 'known-place' }),
        row('bare-history', VIEWER, '2026-10-20', {
            restaurant_id: 'known-place', rating: null, visited_at: null,
        }),
        ...['one', 'two', 'three'].map((id) => row(id, VIEWER, '2026-09-08', {
            restaurant_id: 'undated-place', visited_at: null,
        })),
    ] });
    const snapshot = await loadFriendsLedger(fake.reader, VIEWER, bounds());
    const viewer = snapshot.data.rows.find((item) => item.is_viewer)!;
    assertEquals([viewer.meals, viewer.new_places, viewer.crowns], [1, 0, 0]);
});
