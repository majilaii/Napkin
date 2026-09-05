import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { viewerHasBeen } from './viewerHasBeen.ts';

function client(rows: Record<string, any[]>, failTable?: string) {
    return { from(table: string) {
        let data = rows[table] ?? [];
        const value = (row: any, path: string) => path.split('.').reduce((v, key) => v?.[key], row);
        const query: any = {
            select: () => query,
            eq: (key: string, expected: unknown) => { data = data.filter((row) => value(row, key) === expected); return query; },
            in: (key: string, expected: unknown[]) => { data = data.filter((row) => expected.includes(value(row, key))); return query; },
            limit: (n: number) => { data = data.slice(0, n); return query; },
            maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: table === failTable }),
            then: (resolve: (v: unknown) => void) => resolve({ data, error: table === failTable }),
        };
        return query;
    } };
}

Deno.test('been combines preserved manual intent with remaining owned visits', async () => {
    const scope = { user_id: 'viewer', restaurant_id: 'restaurant' };
    assertEquals(await viewerHasBeen(client({ user_restaurant_status: [{ ...scope, been: true }] }), 'viewer', 'restaurant'), true);
    assertEquals(await viewerHasBeen(client({ entries: [{ ...scope, visited_at: null, rating: null }] }), 'viewer', 'restaurant'), true);
    assertEquals(await viewerHasBeen(client({ entries: [{ ...scope, user_id: 'other' }] }), 'viewer', 'restaurant'), false);
    assertEquals(await viewerHasBeen(client({}), 'viewer', 'restaurant'), false);
    assertEquals(await viewerHasBeen(client({}), 'viewer', null), false);
});

Deno.test('only completed matching legacy attendance counts; one failed read does not hide another valid source', async () => {
    const attendance = { user_id: 'viewer', table_nights: { restaurant_id: 'restaurant', kind: 'live', status: 'revealed' } };
    assertEquals(await viewerHasBeen(client({ table_night_participants: [attendance] }, 'user_restaurant_status'), 'viewer', 'restaurant'), true);
    for (const status of ['rating', 'voting', 'cancelled']) {
        assertEquals(await viewerHasBeen(client({ table_night_participants: [{ ...attendance, table_nights: { ...attendance.table_nights, status } }] }), 'viewer', 'restaurant'), false);
    }
});
