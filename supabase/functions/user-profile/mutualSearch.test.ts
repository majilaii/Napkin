import { assertEquals } from '../_shared/test-utils.ts';
import { searchProfilesWithMutualBackfill } from './mutualSearch.ts';

type Row = Record<string, unknown>;

function fakeSearchClient(rowsByTable: Record<string, Row[]>) {
    const profileInValues: string[][] = [];
    let followReads = 0;

    return {
        profileInValues,
        get followReads() {
            return followReads;
        },
        client: {
            from(table: string) {
                return {
                    select(_columns: string) {
                        let pattern = '';
                        let inValues: string[] = [];
                        let excludedUserId: string | null = null;
                        const notInValues = new Set<string>();
                        const orders: Array<{ column: string; ascending: boolean }> = [];
                        const resolveRows = (limit?: number) => {
                            const rows = (rowsByTable[table] ?? [])
                                .filter((row) => !excludedUserId || row.user_id !== excludedUserId)
                                .filter((row) => inValues.length === 0 || inValues.includes(String(row.user_id)))
                                .filter((row) => !notInValues.has(String(row.user_id)))
                                .filter((row) =>
                                    String(row.display_name).toLocaleLowerCase().includes(pattern)
                                )
                                .sort((a, b) => {
                                    for (const order of orders) {
                                        const comparison = String(a[order.column] ?? '')
                                            .localeCompare(String(b[order.column] ?? ''));
                                        if (comparison !== 0) {
                                            return order.ascending ? comparison : -comparison;
                                        }
                                    }
                                    return 0;
                                });
                            return {
                                data: limit === undefined ? rows : rows.slice(0, limit),
                                error: null,
                            };
                        };
                        const builder = {
                            eq(column: string, value: string) {
                                followReads += 1;
                                return Promise.resolve({
                                    data: (rowsByTable[table] ?? []).filter((row) => row[column] === value),
                                    error: null,
                                });
                            },
                            ilike(_column: string, value: string) {
                                pattern = value.replaceAll('%', '').toLocaleLowerCase();
                                return builder;
                            },
                            neq(_column: string, value: string) {
                                excludedUserId = value;
                                return builder;
                            },
                            in(_column: string, values: string[]) {
                                inValues = [...values];
                                profileInValues.push(inValues);
                                return builder;
                            },
                            not(_column: string, operator: string, value: string) {
                                if (operator !== 'in') throw new Error(`unexpected operator ${operator}`);
                                value.slice(1, -1).split(',').filter(Boolean).forEach((id) => {
                                    notInValues.add(id);
                                });
                                return builder;
                            },
                            order(column: string, options: { ascending: boolean }) {
                                orders.push({ column, ascending: options.ascending });
                                return builder;
                            },
                            limit(value: number) {
                                return Promise.resolve(resolveRows(value));
                            },
                            then<TResult1 = ReturnType<typeof resolveRows>, TResult2 = never>(
                                onfulfilled?: ((value: ReturnType<typeof resolveRows>) => TResult1 | PromiseLike<TResult1>) | null,
                                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
                            ) {
                                return Promise.resolve(resolveRows()).then(onfulfilled, onrejected);
                            },
                        };
                        return builder;
                    },
                };
            },
        },
    };
}

Deno.test('mutual-only search prioritizes followed non-mutuals before stranger backfill', async () => {
    const viewerId = 'viewer';
    const mutualId = 'mutual-last';
    const profiles = [
        ...Array.from({ length: 30 }, (_, index) => ({
            user_id: `stranger-${index}`,
            display_name: `Match ${String(index).padStart(2, '0')}`,
            avatar_url: null,
            created_at: '2026-01-01T00:00:00Z',
        })),
        {
            user_id: mutualId,
            display_name: 'Match ZZ Mutual',
            avatar_url: 'mutual.jpg',
            created_at: '2026-01-01T00:00:00Z',
        },
        {
            user_id: 'followed-last',
            display_name: 'Match ZZZ Followed',
            avatar_url: null,
            created_at: '2026-01-01T00:00:00Z',
        },
    ];
    const fake = fakeSearchClient({
        follows: [
            { follower_id: viewerId, following_id: mutualId },
            { follower_id: mutualId, following_id: viewerId },
            { follower_id: viewerId, following_id: 'followed-last' },
            { follower_id: 'stranger-1', following_id: viewerId },
        ],
        profiles,
    });

    const result = await searchProfilesWithMutualBackfill(fake.client, viewerId, '%Match%', 20);

    assertEquals(result.length, 20);
    assertEquals(result[0], {
        user_id: mutualId,
        display_name: 'Match ZZ Mutual',
        avatar_url: 'mutual.jpg',
        is_following: true,
        follows_caller: true,
        is_mutual: true,
    });
    assertEquals(result[1], {
        user_id: 'followed-last',
        display_name: 'Match ZZZ Followed',
        avatar_url: null,
        is_following: true,
        follows_caller: false,
        is_mutual: false,
    });
    assertEquals(result.slice(2).every((row) => !row.is_mutual && !row.is_following), true);
    assertEquals(result.find((row) => row.user_id === 'stranger-1'), {
        user_id: 'stranger-1',
        display_name: 'Match 01',
        avatar_url: null,
        is_following: false,
        follows_caller: true,
        is_mutual: false,
    });
    assertEquals(fake.followReads, 2);
    assertEquals(fake.profileInValues, [[mutualId], ['followed-last']]);
});
