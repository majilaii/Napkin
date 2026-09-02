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
                        const resolveRows = (limit?: number) => {
                            const rows = (rowsByTable[table] ?? [])
                                .filter((row) => !excludedUserId || row.user_id !== excludedUserId)
                                .filter((row) => inValues.length === 0 || inValues.includes(String(row.user_id)))
                                .filter((row) => !notInValues.has(String(row.user_id)))
                                .filter((row) =>
                                    String(row.display_name).toLocaleLowerCase().includes(pattern)
                                );
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
                            order(_column: string, _options: { ascending: boolean }) {
                                return Promise.resolve({
                                    ...resolveRows(),
                                    data: resolveRows().data
                                        .sort((a, b) =>
                                            String(a.display_name).localeCompare(String(b.display_name))
                                        ),
                                });
                            },
                            limit(value: number) {
                                return Promise.resolve(resolveRows(value));
                            },
                        };
                        return builder;
                    },
                };
            },
        },
    };
}

Deno.test('mutual-only search returns the mutual first and backfills flagged strangers', async () => {
    const viewerId = 'viewer';
    const mutualId = 'mutual-last';
    const profiles = [
        ...Array.from({ length: 24 }, (_, index) => ({
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
    ];
    const fake = fakeSearchClient({
        follows: [
            { follower_id: viewerId, following_id: mutualId },
            { follower_id: mutualId, following_id: viewerId },
            { follower_id: viewerId, following_id: 'stranger-0' },
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
    assertEquals(result.slice(1).every((row) => !row.is_mutual), true);
    assertEquals(result.find((row) => row.user_id === 'stranger-0'), {
        user_id: 'stranger-0',
        display_name: 'Match 00',
        avatar_url: null,
        is_following: true,
        follows_caller: false,
        is_mutual: false,
    });
    assertEquals(result.find((row) => row.user_id === 'stranger-1'), {
        user_id: 'stranger-1',
        display_name: 'Match 01',
        avatar_url: null,
        is_following: false,
        follows_caller: true,
        is_mutual: false,
    });
    assertEquals(fake.followReads, 2);
    assertEquals(fake.profileInValues, [[mutualId]]);
});
