import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { dispatchImportPushes, enqueueImportReadyPush, importReadyPushMessage } from './importPush.ts';

const alice = '11111111-2222-4333-8444-555555555555';
const bob = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const row = {
    id: 'delivery-1', user_id: alice, job_id: 'job-1', installation_id: 'install-1',
    ready_count: 2, expo_push_token: 'ExpoPushToken[fixture_token_123]',
    sent_token: null as string | null, ticket_id: null as string | null,
    attempts: 1, created_at: new Date().toISOString(),
};
type QueryEvent = { table: string; op: string; value?: unknown; filters: Record<string, unknown> };
type Device = { installation_id: string; user_id: string; expo_push_token: string; session_id: string };
function fixture(options: {
    rows?: typeof row[]; status?: string; deviceOwner?: string; token?: string;
    jobInstallationId?: string | null; devices?: Device[];
} = {}) {
    const events: QueryEvent[] = [];
    const job = {
        id: row.job_id, user_id: alice, status: options.status ?? 'ready', response: { candidates: [{}, {}] },
        installation_id: options.jobInstallationId === undefined ? row.installation_id : options.jobInstallationId,
    };
    const device = {
        installation_id: row.installation_id, user_id: options.deviceOwner ?? alice,
        expo_push_token: options.token ?? row.expo_push_token, session_id: 'session-1',
    };
    const client = {
        rpc() { return Promise.resolve({ data: options.rows ?? [{ ...row }], error: null }); },
        from(table: string) {
            const event: QueryEvent = { table, op: 'select', filters: {} };
            const q = {
                select() { return q; },
                eq(key: string, value: unknown) { event.filters[key] = value; return q; },
                in(key: string, value: unknown) { event.filters[key] = value; return q; },
                not(key: string, _operation: string, value: unknown) { event.filters[`not:${key}`] = value; return q; },
                update(value: unknown) { event.op = 'update'; event.value = value; return q; },
                delete() { event.op = 'delete'; return q; },
                upsert(value: unknown) { event.op = 'upsert'; event.value = value; return q; },
                insert(value: unknown) { event.op = 'insert'; event.value = value; return q; },
                maybeSingle() { events.push(event); return Promise.resolve({ data: job, error: null }); },
                then(resolve: (result: unknown) => unknown) {
                    events.push(event);
                    const source = table === 'background_import_jobs' ? [job] : table === 'import_push_devices' ? options.devices ?? [device] : null;
                    const data = source?.filter(item => Object.entries(event.filters).every(([key, value]) => {
                        if (key.startsWith('not:')) return (item as Record<string, unknown>)[key.slice(4)] !== value;
                        const actual = (item as Record<string, unknown>)[key];
                        return Array.isArray(value) ? value.includes(actual) : actual === value;
                    })) ?? null;
                    return Promise.resolve({ data, error: null }).then(resolve);
                },
            };
            return q;
        },
    } as unknown as SupabaseClient;
    return { client, events };
}
function fakeFetch(result: unknown, status = 200) {
    const calls: { url: string; body: unknown }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(init?.body as string) });
        return new Response(JSON.stringify(result), { status });
    }) as typeof fetch;
    return { fetcher, calls };
}
function checkpoints(events: QueryEvent[]) {
    return events.filter(e => e.table === 'import_push_deliveries' && e.op === 'update');
}

Deno.test('import push contains only generic copy and an owner-bound review route', () => {
    const message = importReadyPushMessage(row);
    assertEquals(message.title, 'Your import is ready');
    assertEquals(message.data.owner_id, alice);
    assertEquals(message.data.ready_count, 2);
    assert(message.data.url.includes(`owner=${alice}`));
    assertEquals(message.collapseId, 'import:job-1');
    assertEquals(Object.keys(message.data).sort(), ['job_id','kind','owner_id','ready_count','url']);
});

Deno.test('only a real ready job can enqueue a push and caller count is capped', async () => {
    const no = fixture({ status: 'processing' });
    assertEquals(await enqueueImportReadyPush(no.client, { userId: alice, jobId: row.job_id, readyCount: 99 }), 0);
    assert(!no.events.some(e => e.op === 'upsert'));
    const yes = fixture();
    assertEquals(await enqueueImportReadyPush(yes.client, { userId: alice, jobId: row.job_id, readyCount: 99 }), 1);
    const insert = yes.events.find(e => e.op === 'upsert')!;
    assertEquals((insert.value as { ready_count: number }[])[0].ready_count, 2);
    assertEquals(yes.events[0].filters.user_id, alice);
});

Deno.test('completion pushes target only the import origin, even with multiple signed-in devices', async () => {
    const devices = [
        { installation_id: row.installation_id, user_id: alice, expo_push_token: row.expo_push_token, session_id: 'session-1' },
        { installation_id: 'install-2', user_id: alice, expo_push_token: 'ExpoPushToken[other_device]', session_id: 'session-2' },
    ];
    const { client, events } = fixture({ devices });
    assertEquals(await enqueueImportReadyPush(client, { userId: alice, jobId: row.job_id, readyCount: 2 }), 1);
    const delivery = events.find(e => e.table === 'import_push_deliveries' && e.op === 'upsert');
    assertEquals(delivery?.value, [{ installation_id: row.installation_id, user_id: alice, job_id: row.job_id, ready_count: 2 }]);

    const reassigned = fixture({ deviceOwner: bob });
    assertEquals(await enqueueImportReadyPush(reassigned.client, { userId: alice, jobId: row.job_id, readyCount: 2 }), 0);
    assert(!reassigned.events.some(e => e.table === 'import_push_deliveries'));
});

Deno.test('imports without a known origin still emit an inbox notice but never fan out a push', async () => {
    const { client, events } = fixture({ jobInstallationId: null });
    assertEquals(await enqueueImportReadyPush(client, { userId: alice, jobId: row.job_id, readyCount: 2 }), 0);
    assert(events.some(e => e.table === 'notifications' && e.op === 'insert'));
    assert(!events.some(e => e.table === 'import_push_devices' || e.table === 'import_push_deliveries'));
});

Deno.test('sending records Expo tickets and defers provider receipts for fifteen minutes', async () => {
    const { client, events } = fixture();
    const { fetcher, calls } = fakeFetch({ data: [{ status: 'ok', id: 'ticket-1' }] });
    const before = Date.now();
    assertEquals(await dispatchImportPushes(client, { fetcher }), { claimed: 1, ticketed: 1, receipts: 0 });
    assertEquals(calls.length, 1);
    const change = checkpoints(events)[0];
    assertEquals(change.filters.attempts, 1);
    const values = change.value as { status: string; ticket_id: string; next_attempt_at: string };
    assertEquals(values.status, 'ticketed');
    assertEquals(values.ticket_id, 'ticket-1');
    assert(Date.parse(values.next_attempt_at) >= before + 15 * 60 * 1000);
});

Deno.test('owner reassignment and acknowledged jobs cancel unsent notices before network calls', async () => {
    for (const options of [{ deviceOwner: bob }, { status: 'acknowledged' }]) {
        const { client, events } = fixture(options);
        const { fetcher, calls } = fakeFetch({});
        await dispatchImportPushes(client, { fetcher });
        assertEquals(calls.length, 0);
        assertEquals((checkpoints(events)[0].value as { status: string }).status, 'cancelled');
    }
});

Deno.test('the final send check cancels stale deliveries for a different or unknown installation', async () => {
    for (const jobInstallationId of ['install-2', null]) {
        const { client, events } = fixture({ jobInstallationId });
        const { fetcher, calls } = fakeFetch({});
        await dispatchImportPushes(client, { fetcher });
        assertEquals(calls.length, 0);
        assertEquals((checkpoints(events)[0].value as { status: string }).status, 'cancelled');
    }
});

Deno.test('receipt success is checked even after job acknowledgement without resending', async () => {
    const { client, events } = fixture({ status: 'acknowledged', rows: [{ ...row, ticket_id: 'ticket-1', sent_token: row.expo_push_token }] });
    const { fetcher, calls } = fakeFetch({ data: { 'ticket-1': { status: 'ok' } } });
    assertEquals(await dispatchImportPushes(client, { fetcher }), { claimed: 1, ticketed: 0, receipts: 1 });
    assert(calls[0].url.endsWith('/getReceipts'));
    assertEquals((checkpoints(events)[0].value as { status: string }).status, 'delivered');
});

Deno.test('DeviceNotRegistered invalidates only the token in the receipt, preserving later rotations', async () => {
    const { client, events } = fixture({ rows: [{ ...row, ticket_id: 'ticket-1', sent_token: 'ExpoPushToken[previous_token]' }] });
    const { fetcher } = fakeFetch({ data: { 'ticket-1': { status: 'error', details: { error: 'DeviceNotRegistered' } } } });
    await dispatchImportPushes(client, { fetcher });
    const deletion = events.find(e => e.table === 'import_push_devices' && e.op === 'update')!;
    assertEquals(deletion.filters.expo_push_token, 'ExpoPushToken[previous_token]');
    assertEquals(deletion.filters.user_id, alice);
});

Deno.test('provider HTTP throttling retries with backoff; missing receipts never resend the push', async () => {
    const send = fixture();
    await dispatchImportPushes(send.client, { fetcher: fakeFetch({}, 429).fetcher });
    assertEquals((checkpoints(send.events)[0].value as { status: string }).status, 'pending');
    const receipt = fixture({ rows: [{ ...row, ticket_id: 'ticket-1' }] });
    const network = fakeFetch({ data: {} });
    await dispatchImportPushes(receipt.client, { fetcher: network.fetcher });
    assertEquals(network.calls.length, 1);
    assert(network.calls[0].url.endsWith('/getReceipts'));
    assertEquals((checkpoints(receipt.events)[0].value as { status: string }).status, 'ticketed');
});
