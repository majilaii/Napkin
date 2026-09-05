import { assertEquals, assertRejects, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { activityCursor, loadActivityPage, type ActivityRpcRow } from './activity.ts';
import { encodeCursor, decodeCursor } from '../_shared/pagination.ts';

const date = '2026-09-01T12:00:00.123456+00:00';
const uuid = '66900000-0000-0000-0000-000000000001';
Deno.test('activity cursor preserves precision and rejects legacy and malformed values', () => {
    const tuple = { sort_date: date, id: `pin:${uuid}` };
    assertEquals(activityCursor(encodeCursor(tuple)), tuple);
    assertEquals(activityCursor(null), null);
    for (const value of ['', {}, 5, 'bad', encodeCursor({ sort_date: date, id: uuid }),
        encodeCursor({ sort_date: 'yesterday', id: `pin:${uuid}` }),
        encodeCursor({ sort_date: '2026-02-30T12:00:00Z', id: `pin:${uuid}` }),
        encodeCursor({ sort_date: '0000-01-01T12:00:00Z', id: `pin:${uuid}` }),
        encodeCursor({ sort_date: date, id: `pin:${uuid}|OR true` })]) {
        assertThrows(() => activityCursor(value));
    }
});
Deno.test('activity RPC uses verified viewer, limit plus one and flattens every kind', async () => {
    const rows: ActivityRpcRow[] = ['pin', 'list', 'entry'].map((kind) => ({
        kind: kind as ActivityRpcRow['kind'], activity_key: `${kind}:${uuid}`, sort_date: date,
        payload: { id: kind === 'entry' ? uuid : `${kind}:${uuid}`, user_id: uuid },
    }));
    let args: unknown;
    const page = await loadActivityPage((name, params) => {
        args = { name, params }; return Promise.resolve({ data: rows, error: null });
    }, uuid, null, 2);
    assertEquals(args, { name: 'fn_friends_activity', params: {
        p_viewer: uuid, p_cursor_date: null, p_cursor_key: null, p_limit: 3,
    } });
    assertEquals(page.has_more, true);
    assertEquals(page.rows.map((r) => [r.id, r.kind, r.sort_date]),
        [[`pin:${uuid}`, 'pin', date], [`list:${uuid}`, 'list', date]]);
    assertEquals(decodeCursor(page.next_cursor), { sort_date: date, id: `list:${uuid}` });
    const tail = await loadActivityPage(() => Promise.resolve({ data: rows.slice(2), error: null }),
        uuid, activityCursor(page.next_cursor), 2);
    assertEquals(tail.has_more, false);
    assertEquals(tail.next_cursor, null);
    assertEquals(tail.rows[0].id, uuid);
});
Deno.test('activity SQL failure stays an error, not a false empty feed', async () => {
    await assertRejects(() => loadActivityPage(() => Promise.resolve({ data: null, error: new Error('db') }), uuid, null, 30));
});
