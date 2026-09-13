import { assertEquals } from '../_shared/test-utils.ts';
import { handleVisitAction, validateVisitPatch, visitRestaurantInput } from './visits.ts';

const user = '11111111-1111-4111-8111-111111111111';
const entry = '22222222-2222-4222-8222-222222222222';
const restaurant = '33333333-3333-4333-8333-333333333333';
const nonce = '44444444-4444-4444-8444-444444444444';
const failDb = { rpc() { throw new Error('Unexpected write'); } };

Deno.test('visit actions validate IDs and refuse client fields outside the patch before writing', async () => {
    for (const body of [
        { action: 'record_visit', restaurant_id: restaurant },
        { action: 'record_visit', restaurant_id: 'ChIexternal', client_nonce: nonce },
        { action: 'record_visit', restaurant_id: restaurant, restaurant: {}, client_nonce: nonce },
        { action: 'save_visit', entry_id: entry, patch: { user_id: user } },
        { action: 'save_visit', entry_id: entry, patch: { table_id: restaurant } },
        { action: 'save_visit', entry_id: entry, patch: { visibility: 'friends' } },
        { action: 'save_visit', entry_id: entry, patch: { rating: 4.7 } },
        { action: 'save_visit', entry_id: entry, patch: { rating: 0 } },
        { action: 'save_visit', entry_id: entry, patch: { content: 'x'.repeat(10001) } },
        { action: 'save_visit', entry_id: entry, patch: { visited_at: '2026-02-30T00:00:00Z' } },
        { action: 'save_visit', entry_id: entry, patch: { visited_at: '2099-01-01T00:00:00Z' } },
        { action: 'save_visit', entry_id: entry, patch: { photo_urls: ['file:///private/photo.jpg'] } },
        { action: 'save_visit', entry_id: entry, patch: { photo_urls: Array(11).fill('https://image.test/a') } },
        { action: 'save_visit', entry_id: entry, patch: { photo_urls: ['https://image.test/a', 'https://image.test/a'] } },
        { action: 'save_visit', entry_id: entry, patch: { liked: null } },
        { action: 'save_visit', entry_id: entry, patch: { liked: 'true' } },
        { action: 'save_visit', entry_id: entry, patch: { vibe_rating: 4.7 } },
        { action: 'save_visit', entry_id: entry, patch: { flavor_rating: 0 } },
        { action: 'save_visit', entry_id: entry, patch: { service_rating: 6 } },
        { action: 'save_visit', entry_id: entry, patch: { value_rating: '4' } },
        { action: 'save_visit', entry_id: entry, patch: { companion_ids: null } },
        { action: 'save_visit', entry_id: entry, patch: { companion_ids: ['not-a-user'] } },
        { action: 'save_visit', entry_id: entry, patch: { companion_ids: [user, user] } },
        { action: 'save_visit', entry_id: entry, patch: { table_ids: Array.from({ length: 11 }, (_, i) => `${String(i).padStart(8, '0')}-0000-4000-8000-000000000001`) } },
        { action: 'undo_visit', entry_id: 'invalid' },
    ]) {
        assertEquals((await handleVisitAction(failDb, user, body))?.status, 400, JSON.stringify(body));
    }
});

Deno.test('full review forwards all supported fields atomically, preserving nulls and empty desired sets', async () => {
    const calls: unknown[] = [];
    const patch = { rating: 4.5, content: '  A memorable lunch  ', visited_at: null,
        liked: true, vibe_rating: 3.5, flavor_rating: 5, service_rating: null, value_rating: 4,
        table_ids: [restaurant], companion_ids: [nonce], photo_urls: [] };
    const saved = { id: entry, created_at: '2026-09-05T00:00:00Z',
        ...patch, content: 'A memorable lunch' };
    const db = { rpc(name: string, args: unknown) { calls.push([name, args]); return { data: saved, error: null }; } };
    const response = await handleVisitAction(db, user, { action: 'save_visit', entry_id: entry, patch });
    assertEquals(await response!.json(), { data: { entry: saved } });
    assertEquals(calls, [['fn_save_visit', { p_user_id: user, p_entry_id: entry,
        p_patch: { ...patch, content: 'A memorable lunch' } }]]);
    assertEquals(validateVisitPatch({ liked: false, companion_ids: [], table_ids: [], vibe_rating: null }),
        { liked: false, companion_ids: [], table_ids: [], vibe_rating: null });
});

Deno.test('date-only and null patches preserve omissions and east-UTC today', () => {
    assertEquals(validateVisitPatch({ visited_at: null }), { visited_at: null });
    assertEquals(validateVisitPatch({ rating: 4.5, content: '  ' }), { rating: 4.5, content: null });
    assertEquals(validateVisitPatch({ visited_at: '2026-09-06T00:00:00+14:00' }, new Date('2026-09-05T12:00:00Z')),
        { visited_at: '2026-09-06T00:00:00+14:00' });
});

Deno.test('record and uncertain retry forward the same nonce and return authoritative enriched dedup', async () => {
    const calls: unknown[] = [];
    const row = { id: entry, restaurant_id: restaurant, created_at: '2026-09-05T00:00:00Z', visited_at: null,
        rating: 4.5, content: 'Saved later', is_bare: false, photos: [], was_dedup: true };
    const db = { rpc(name: string, args: unknown) { calls.push([name, args]); return { data: row, error: null }; } };
    const body = { action: 'record_visit', restaurant_id: restaurant, client_nonce: nonce,
        liked: true, visited_at: '2026-01-01T00:00:00Z', participant_ids: [entry] };
    for (let i = 0; i < 2; i++) {
        const response = await handleVisitAction(db, user, body);
        assertEquals(await response!.json(), { data: { entry: row } });
    }
    assertEquals(calls, Array(2).fill(['fn_record_visit', {
        p_user_id: user, p_restaurant_id: restaurant, p_client_nonce: nonce,
    }]));
});

Deno.test('save and undo use authenticated user plus explicit selected entry ID only', async () => {
    const calls: unknown[] = [];
    const db = { rpc(name: string, args: unknown) { calls.push([name, args]); return { data: { id: entry }, error: null }; } };
    await handleVisitAction(db, user, { action: 'save_visit', entry_id: entry, user_id: restaurant, patch: { visited_at: null } });
    await handleVisitAction(db, user, { action: 'undo_visit', entry_id: entry });
    assertEquals(calls, [
        ['fn_save_visit', { p_user_id: user, p_entry_id: entry, p_patch: { visited_at: null } }],
        ['fn_undo_visit', { p_user_id: user, p_entry_id: entry }],
    ]);
});

Deno.test('restaurant input whitelist removes verification, ownership and raw image writes', () => {
    const input = visitRestaurantInput({ external_id: 'ChIx', name: ' Spot ', verification: 'verified',
        createdBy: user, photo_url: 'https://wrong.test', photoReference: 'untrusted',
        latitude: 900, location: { locality: 'Paris' }, types: ['cafe', 3] });
    assertEquals(input.name, 'Spot');
    assertEquals(input.location?.locality, 'Paris');
    assertEquals(input.latitude, undefined);
    assertEquals(input.types, ['cafe']);
    assertEquals('createdBy' in input, false);
    assertEquals('verification' in input, false);
    assertEquals('photoReference' in input, false);
});

Deno.test('existing ghost resolves before any upsert and uses the canonical ID', async () => {
    const calls: unknown[] = [];
    const db = {
        from() { return { select() { return { eq() { return { maybeSingle() { return { data: { id: entry }, error: null }; } }; } }; } }; },
        rpc(name: string, args: unknown) {
            calls.push([name, args]);
            return { data: name === 'fn_resolve_canonical' ? restaurant : { id: entry }, error: null };
        },
    };
    await handleVisitAction(db, user, { action: 'record_visit', restaurant: { external_id: 'ChIx', name: 'Old name' }, client_nonce: nonce },
        () => { throw new Error('Existing restaurants must not be overwritten'); });
    assertEquals(calls, [
        ['fn_resolve_canonical', { p_id: entry }],
        ['fn_record_visit', { p_user_id: user, p_restaurant_id: restaurant, p_client_nonce: nonce }],
    ]);
});

Deno.test('ownership, stale undo and moderation refusals have recoverable typed responses', async () => {
    for (const [message, status] of [['NOT_OWNER', 403], ['TABLE_NOT_AUTHORIZED', 403], ['COMPANION_NOT_AUTHORIZED', 403], ['VISIT_UNDO_REFUSED', 409],
        ['VISIT_NONCE_MISMATCH', 409], ['approved_image_required', 409], ['image_object_not_bindable', 409]] as const) {
        const db = { rpc() { return { data: null, error: { message, code: 'P0001' } }; } };
        const response = await handleVisitAction(db, user, { action: 'undo_visit', entry_id: entry });
        assertEquals(response!.status, status);
        assertEquals((await response!.json()).error.code, message.toUpperCase());
    }
    assertEquals(await handleVisitAction(failDb, user, { action: 'create' }), null);
});
