import { assertEquals } from '../_shared/test-utils.ts';
import {
    filterMutualCompanionIds,
    type CompanionGateClient,
} from '../_shared/companions.ts';

type FollowRow = { follower_id: string; following_id: string };
type BlockRow = { blocker_id: string; blocked_id: string };

interface RecordedQuery {
    table: string;
    eqColumn: string;
    eqValue: string;
    inColumn: string;
    inValues: string[];
}

function fakeCompanionGate(rows: { follows?: FollowRow[]; blocked_users?: BlockRow[] }) {
    const queries: RecordedQuery[] = [];
    const client = {
        from(table: string) {
            return {
                select(_columns: string) {
                    let eqColumn = '';
                    let eqValue = '';
                    const builder = {
                        eq(column: string, value: string) {
                            eqColumn = column;
                            eqValue = value;
                            return builder;
                        },
                        in(column: string, values: string[]) {
                            queries.push({
                                table,
                                eqColumn,
                                eqValue,
                                inColumn: column,
                                inValues: [...values],
                            });
                            const source = table === 'follows'
                                ? (rows.follows ?? [])
                                : (rows.blocked_users ?? []);
                            return Promise.resolve({
                                data: source.filter((row) =>
                                    (row as unknown as Record<string, string>)[eqColumn] === eqValue &&
                                    values.includes((row as unknown as Record<string, string>)[column])
                                ),
                                error: null,
                            });
                        },
                    };
                    return builder;
                },
            };
        },
    } as unknown as CompanionGateClient;
    return { client, queries };
}

function rejectingFollowsGate(): CompanionGateClient {
    return {
        from(table: string) {
            return {
                select(_columns: string) {
                    const builder = {
                        eq(_column: string, _value: string) {
                            return builder;
                        },
                        in(_column: string, _values: string[]) {
                            return table === 'follows'
                                ? Promise.reject(new Error('follows unavailable'))
                                : Promise.resolve({ data: [], error: null });
                        },
                    };
                    return builder;
                },
            };
        },
    } as unknown as CompanionGateClient;
}

async function assertFollowsFailureRejects(): Promise<void> {
    let thrown: unknown;
    try {
        await filterMutualCompanionIds(rejectingFollowsGate(), AUTHOR, [MUTUAL]);
    } catch (error) {
        thrown = error;
    }
    assertEquals((thrown as Error | undefined)?.message, 'follows unavailable');
}

const AUTHOR = 'author';
const MUTUAL = 'mutual';
const AUTHOR_FOLLOWS_ONLY = 'author-follows-only';
const FOLLOWS_AUTHOR_ONLY = 'follows-author-only';
const STRANGER = 'stranger';
const BLOCKED_BY_AUTHOR = 'blocked-by-author';
const BLOCKED_AUTHOR = 'blocked-author';

const matrixRows = {
    follows: [
        { follower_id: AUTHOR, following_id: MUTUAL },
        { follower_id: MUTUAL, following_id: AUTHOR },
        { follower_id: AUTHOR, following_id: AUTHOR_FOLLOWS_ONLY },
        { follower_id: FOLLOWS_AUTHOR_ONLY, following_id: AUTHOR },
        { follower_id: AUTHOR, following_id: BLOCKED_BY_AUTHOR },
        { follower_id: BLOCKED_BY_AUTHOR, following_id: AUTHOR },
        { follower_id: AUTHOR, following_id: BLOCKED_AUTHOR },
        { follower_id: BLOCKED_AUTHOR, following_id: AUTHOR },
    ],
    blocked_users: [
        { blocker_id: AUTHOR, blocked_id: BLOCKED_BY_AUTHOR },
        { blocker_id: BLOCKED_AUTHOR, blocked_id: AUTHOR },
    ],
};

const matrixIds = [
    MUTUAL,
    AUTHOR_FOLLOWS_ONLY,
    FOLLOWS_AUTHOR_ONLY,
    STRANGER,
    AUTHOR,
    BLOCKED_BY_AUTHOR,
    BLOCKED_AUTHOR,
];

function sanitizeCreateIds(ids: string[], participantIds: string[]): string[] {
    return [...new Set(ids.filter((id) => id && id !== AUTHOR && !participantIds.includes(id)))];
}

function sanitizeUpdateIds(ids: string[]): string[] {
    return [...new Set(ids.filter((id) => id && id !== AUTHOR))];
}

Deno.test('create companions: only mutual, unblocked candidates survive the matrix', async () => {
    const { client } = fakeCompanionGate(matrixRows);
    const result = await filterMutualCompanionIds(
        client,
        AUTHOR,
        sanitizeCreateIds(matrixIds, []),
    );

    assertEquals(result, [MUTUAL]);
});

Deno.test('update-companions: only mutual, unblocked candidates survive the matrix', async () => {
    const { client } = fakeCompanionGate(matrixRows);
    const result = await filterMutualCompanionIds(
        client,
        AUTHOR,
        sanitizeUpdateIds(matrixIds),
    );

    assertEquals(result, [MUTUAL]);
});

Deno.test('solo create companion gate exposes follows read failures to its non-fatal caller', async () => {
    await assertFollowsFailureRejects();
});

Deno.test('supper create companion gate exposes follows read failures to its non-fatal caller', async () => {
    await assertFollowsFailureRejects();
});

Deno.test('companion gate chunks 150 candidates into two IN queries per direction', async () => {
    const ids = Array.from({ length: 150 }, (_, index) => `candidate-${index}`);
    const follows = ids.flatMap((id) => [
        { follower_id: AUTHOR, following_id: id },
        { follower_id: id, following_id: AUTHOR },
    ]);
    const { client, queries } = fakeCompanionGate({ follows });

    assertEquals(await filterMutualCompanionIds(client, AUTHOR, ids), ids);

    for (const [table, eqColumn, inColumn] of [
        ['follows', 'follower_id', 'following_id'],
        ['follows', 'following_id', 'follower_id'],
        ['blocked_users', 'blocker_id', 'blocked_id'],
        ['blocked_users', 'blocked_id', 'blocker_id'],
    ]) {
        const directionQueries = queries.filter((query) =>
            query.table === table &&
            query.eqColumn === eqColumn &&
            query.inColumn === inColumn
        );
        assertEquals(directionQueries.length, 2);
        assertEquals(directionQueries.every((query) => query.inValues.length <= 100), true);
    }
});
