import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { emitSelfImportDone } from './emitSelfImportDone.ts';
import { importNotificationId } from '../_shared/notify.ts';

const alice = '11111111-2222-4333-8444-555555555555';
const bob = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function fixture(error: { message: string } | null = null, throws = false) {
    const rows: unknown[] = [];
    const client = { from(table: string) {
        assertEquals(table, 'notifications');
        return { insert(row: unknown) { rows.push(row); if (throws) throw new Error('offline'); return Promise.resolve({ error }); } };
    } } as unknown as SupabaseClient;
    return { client, rows };
}
const notice = { kind: 'import_done', subject_meta: { job_id: 'job-a', count: 11, outcome: 'review' } };

Deno.test('import notice rejects an account switch before any inbox write', async () => {
    const { client, rows } = fixture();
    const result = await emitSelfImportDone(client, bob, { ...notice, expected_owner_id: alice });
    assertEquals(result.status, 403);
    assertEquals(rows.length, 0);
});

Deno.test('import notice owner is optional for installed clients, strict when present', async () => {
    for (const invalid of [null, '', 12, 'not-a-uuid']) {
        const { client, rows } = fixture();
        assertEquals((await emitSelfImportDone(client, alice, { ...notice, expected_owner_id: invalid })).status, 400);
        assertEquals(rows.length, 0);
    }
    for (const expected of [undefined, alice]) {
        const { client, rows } = fixture();
        assertEquals((await emitSelfImportDone(client, alice, { ...notice, expected_owner_id: expected, user_id: bob })).status, 200);
        assertEquals(rows, [{ id: await importNotificationId(alice, 'job-a', 'review'), user_id: alice, kind: 'import_done', actor_user_id: null, subject_meta: { job_id: 'job-a', count: 11, outcome: 'review' } }]);
    }
});

Deno.test('import notice replay and concurrent delivery create one inbox row per owner, job and outcome', async () => {
    const rows = new Map<string, unknown>();
    const client = { from() { return { insert(row: { id: string }) {
        if (rows.has(row.id)) return Promise.resolve({ error: { code: '23505', message: 'duplicate primary key' } });
        rows.set(row.id, row);
        return Promise.resolve({ error: null });
    } }; } } as unknown as SupabaseClient;
    // The first response can be lost after commit; the next request must still
    // acknowledge success without adding another row, including concurrent drains.
    await emitSelfImportDone(client, alice, notice);
    const replay = await Promise.all(Array.from({ length: 4 }, () => emitSelfImportDone(client, alice, notice)));
    assertEquals(replay.map(result => result.status), [200, 200, 200, 200]);
    assertEquals(rows.size, 1);
    await emitSelfImportDone(client, bob, notice);
    await emitSelfImportDone(client, alice, { ...notice, subject_meta: { ...notice.subject_meta, outcome: 'failed' } });
    await emitSelfImportDone(client, alice, { ...notice, subject_meta: { ...notice.subject_meta, job_id: 'job-b' } });
    assertEquals(rows.size, 4);
});

Deno.test('import notice without a job retains compatibility and does not mask unrelated duplicate errors', async () => {
    const rows: Record<string, unknown>[] = [];
    const client = { from() { return { insert(row: Record<string, unknown>) {
        rows.push(row);
        return Promise.resolve({ error: { code: '23505', message: 'other conflict' } });
    } }; } } as unknown as SupabaseClient;
    const result = await emitSelfImportDone(client, alice, { ...notice, subject_meta: { outcome: 'review' } });
    assertEquals(result.status, 503);
    assertEquals('id' in rows[0], false);
});

Deno.test('import notice cannot forge a social notice or a saved result', async () => {
    for (const body of [{ ...notice, kind: 'friend_logged' }, { ...notice, subject_meta: { outcome: 'saved' } }]) {
        const { client, rows } = fixture();
        assertEquals((await emitSelfImportDone(client, alice, body)).status, 400);
        assertEquals(rows.length, 0);
    }
});

Deno.test('import notice reports delivery failure instead of acknowledging a missing row', async () => {
    const previous = Deno.env.get('SENTRY_DSN');
    Deno.env.set('SENTRY_DSN', '');
    try {
        for (const { client, rows } of [fixture({ message: 'unavailable' }), fixture(null, true)]) {
            assertEquals((await emitSelfImportDone(client, alice, notice)).status, 503);
            assertEquals(rows.length, 1);
        }
    } finally {
        if (previous === undefined) Deno.env.delete('SENTRY_DSN'); else Deno.env.set('SENTRY_DSN', previous);
    }
});
