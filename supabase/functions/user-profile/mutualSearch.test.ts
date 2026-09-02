import { assertEquals } from '../_shared/test-utils.ts';
import { searchMutualProfiles } from './mutualSearch.ts';

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
                            in(_column: string, values: string[]) {
                                inValues = [...values];
                                profileInValues.push(inValues);
                                return builder;
                            },
                            order(_column: string, _options: { ascending: boolean }) {
                                return Promise.resolve({
                                    data: (rowsByTable[table] ?? [])
                                        .filter((row) => inValues.includes(String(row.user_id)))
                                        .filter((row) =>
                                            String(row.display_name).toLocaleLowerCase().includes(pattern)
                                        )
                                        .sort((a, b) =>
                                            String(a.display_name).localeCompare(String(b.display_name))
                                        ),
                                    error: null,
                                });
                            },
                        };
                        return builder;
                    },
                };
            },
        },
    };
}

Deno.test('mutual-only search returns the sole mutual beyond 20 public name matches', async () => {
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
        ],
        profiles,
    });

    assertEquals(
        await searchMutualProfiles(fake.client, viewerId, '%Match%', 20),
        [profiles[24]],
    );
    assertEquals(fake.followReads, 2);
    assertEquals(fake.profileInValues, [[mutualId]]);
});
