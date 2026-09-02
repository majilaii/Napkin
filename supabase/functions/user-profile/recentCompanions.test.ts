import { assertEquals } from '../_shared/test-utils.ts';
import { fetchRecentCompanions } from './recentCompanions.ts';

type Row = Record<string, unknown>;

function fakeClient(rowsByTable: Record<string, Row[]>) {
    const queries: Array<{ table: string; inColumn?: string; inValues?: string[] }> = [];
    return {
        queries,
        client: {
            from(table: string) {
                return {
                    select(_columns: string) {
                        const equals = new Map<string, unknown>();
                        const filtered = (inColumn?: string, inValues?: string[]) =>
                            (rowsByTable[table] ?? []).filter((row) =>
                                Array.from(equals.entries()).every(([column, value]) =>
                                    row[column] === value
                                ) &&
                                (!inColumn || inValues?.includes(String(row[inColumn])))
                            );
                        const builder = {
                            eq(column: string, value: unknown) {
                                equals.set(column, value);
                                return builder;
                            },
                            limit(limit: number) {
                                queries.push({ table });
                                return Promise.resolve({
                                    data: filtered().slice(0, limit),
                                    error: null,
                                });
                            },
                            in(column: string, values: string[]) {
                                queries.push({ table, inColumn: column, inValues: [...values] });
                                return Promise.resolve({
                                    data: filtered(column, values),
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

Deno.test('recent_companions action loader returns only currently mutual, unblocked users', async () => {
    const viewer = 'viewer';
    const mutual = 'mutual';
    const oneWay = 'one-way';
    const blocked = 'blocked';
    const { client, queries } = fakeClient({
        entries: [
            { id: 'entry-1', user_id: viewer },
            { id: 'entry-2', user_id: viewer },
        ],
        entry_companions: [
            { entry_id: 'entry-1', user_id: oneWay },
            { entry_id: 'entry-2', user_id: oneWay },
            { entry_id: 'entry-1', user_id: mutual },
            { entry_id: 'entry-2', user_id: mutual },
            { entry_id: 'entry-1', user_id: blocked },
        ],
        follows: [
            { follower_id: viewer, following_id: oneWay },
            { follower_id: viewer, following_id: mutual },
            { follower_id: mutual, following_id: viewer },
            { follower_id: viewer, following_id: blocked },
            { follower_id: blocked, following_id: viewer },
        ],
        blocked_users: [
            { blocker_id: blocked, blocked_id: viewer },
        ],
        profiles: [
            { user_id: oneWay, display_name: 'One Way', avatar_url: null },
            { user_id: mutual, display_name: 'Mutual', avatar_url: 'mutual.jpg' },
            { user_id: blocked, display_name: 'Blocked', avatar_url: null },
        ],
    });

    assertEquals(await fetchRecentCompanions(client, viewer), [{
        user_id: mutual,
        display_name: 'Mutual',
        avatar_url: 'mutual.jpg',
    }]);

    const profileQuery = queries.find((query) => query.table === 'profiles');
    assertEquals(profileQuery?.inValues, [mutual]);
});
