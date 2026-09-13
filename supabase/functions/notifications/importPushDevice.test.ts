import { assertEquals, assertNotEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { handleImportPushDevice, verifiedTokenSessionId } from './importPushDevice.ts';

const alice = '11111111-2222-4333-8444-555555555555';
const bob = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111';
const base = {
    action: 'register_import_device', expected_owner_id: alice,
    installation_id: '11111111-2222-4333-8444-111111111111',
    installation_secret: 'ab'.repeat(32), expo_push_token: 'ExpoPushToken[device_fixture_12345]',
    registration_revision: 1,
};
function fixture(registered = true) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const filters: Record<string, unknown> = {};
    const deletion = {
        eq(key: string, value: unknown) { filters[key] = value; return deletion; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
    };
    const client = {
        rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); return Promise.resolve({ data: registered, error: null }); },
        from(table: string) { assertEquals(table, 'import_push_devices'); return { delete: () => deletion }; },
    } as unknown as SupabaseClient;
    return { client, calls, filters };
}

Deno.test('push registration requires a captured owner and valid installation before mutation', async () => {
    for (const body of [{ ...base, expected_owner_id: bob }, { ...base, expected_owner_id: undefined }, { ...base, installation_secret: 'weak' }, { ...base, installation_id: 'x' }]) {
        const { client, calls } = fixture();
        assertNotEquals((await handleImportPushDevice(client, alice, sessionId, body)).status, 200);
        assertEquals(calls.length, 0);
    }
});

Deno.test('push registration binds verified owner/session and hashes the install secret', async () => {
    const { client, calls } = fixture();
    const result = await handleImportPushDevice(client, alice, sessionId, { ...base, user_id: bob, session_id: bob });
    assertEquals(result.status, 200);
    assertEquals(calls[0].name, 'fn_register_import_push_device');
    assertEquals(calls[0].args.p_user_id, alice);
    assertEquals(calls[0].args.p_session_id, sessionId);
    assertEquals((calls[0].args.p_secret_hash as string).length, 64);
    assertNotEquals(calls[0].args.p_secret_hash, base.installation_secret);
});

Deno.test('push registration refuses missing sessions, malformed tokens and wrong installation secret', async () => {
    const { client, calls } = fixture(false);
    assertEquals((await handleImportPushDevice(client, alice, null, base)).status, 400);
    assertEquals((await handleImportPushDevice(client, alice, sessionId, { ...base, expo_push_token: 'https://example.com' })).status, 400);
    assertEquals(calls.length, 0);
    assertEquals((await handleImportPushDevice(client, alice, sessionId, base)).status, 403);
});

Deno.test('push unlink requires owner, installation and secret together', async () => {
    const { client, calls } = fixture();
    assertEquals((await handleImportPushDevice(client, alice, sessionId, { ...base, action: 'unregister_import_device' })).status, 200);
    assertEquals(calls[0].name, 'fn_revoke_import_push_device');
    assertEquals(calls[0].args.p_user_id, alice);
    assertEquals(calls[0].args.p_installation_id, base.installation_id);
    assertEquals(typeof calls[0].args.p_secret_hash, 'string');
    assertEquals(calls[0].args.p_registration_revision, 1);
});

Deno.test('verified token session decoder handles malformed input and ignores body-like values', () => {
    assertEquals(verifiedTokenSessionId('not-a-token'), null);
    assertEquals(verifiedTokenSessionId(`header.${btoa(JSON.stringify({ session_id: sessionId }))}.signature`), sessionId);
    assertEquals(verifiedTokenSessionId(`header.${btoa(JSON.stringify({ session_id: 'bad' }))}.signature`), null);
});
