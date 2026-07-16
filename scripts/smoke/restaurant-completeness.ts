/**
 * TICKET-195 forward-only production smoke.
 *
 * This suite is deliberately separate from the generic smoke/revert step. A
 * failure freezes and disables completeness for a forward fix; it must never
 * ask the workflow to whole-SHA-revert the additive migration.
 */

const SUPABASE_URL = required('SUPABASE_URL');
const ANON_KEY = required('SUPABASE_ANON_KEY');
const SERVICE_ROLE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');
const CRON_SECRET = required('COMPLETENESS_CRON_SECRET');
const RESTAURANT_ID = required('SMOKE_TEST_RESTAURANT_ID');
const EMAIL = required('SMOKE_TEST_EMAIL');
const PASSWORD = required('SMOKE_TEST_PASSWORD');

function required(name: string): string {
    const value = Deno.env.get(name)?.trim();
    if (!value) throw new Error(`missing env: ${name}`);
    return value;
}

async function jsonFetch(
    path: string,
    init: RequestInit,
): Promise<{ status: number; body: unknown; text: string }> {
    const response = await fetch(`${SUPABASE_URL}${path}`, init);
    const text = await response.text();
    let body: unknown = null;
    try {
        body = JSON.parse(text);
    } catch {
        // The status assertion below reports the raw response.
    }
    return { status: response.status, body, text };
}

function assertStatus(
    name: string,
    actual: { status: number; body: unknown; text: string },
    expected: number,
): void {
    if (actual.status !== expected) {
        throw new Error(`${name}: HTTP ${actual.status}, expected ${expected}: ${actual.text.slice(0, 500)}`);
    }
}

function assertSaveStatus(name: string, body: unknown): void {
    const status = (body as { status?: unknown } | null)?.status;
    if (status !== 'saved' && status !== 'already_pinned') {
        throw new Error(`${name}: unexpected save status ${String(status)}`);
    }
}

const auth = await jsonFetch('/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
assertStatus('smoke sign-in', auth, 200);
const jwt = (auth.body as { access_token?: unknown } | null)?.access_token;
const ownerId = (auth.body as { user?: { id?: unknown } } | null)?.user?.id;
if (typeof jwt !== 'string' || typeof ownerId !== 'string') {
    throw new Error('smoke sign-in returned no access token/user id');
}

const userHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt}`,
    apikey: ANON_KEY,
};
// PostgREST needs bearer auth for legacy service-role JWTs, but rejects opaque
// sb_secret_* keys in Authorization. The Edge drain below always uses apikey.
const serviceAuthorization = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(SERVICE_ROLE_KEY)
    ? { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }
    : {};
const serviceHeaders = {
    'Content-Type': 'application/json',
    apikey: SERVICE_ROLE_KEY,
    ...serviceAuthorization,
};

const legacyEdge = await jsonFetch('/functions/v1/resolve-url', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
        action: 'save_spots',
        import_nonce: '19500000-0000-4000-8000-000000000001',
        spots: [{
            candidate_id: 'smoke-ticket-195-legacy',
            client_nonce: '19500000-0000-4000-8000-000000000002',
            restaurant_id: RESTAURANT_ID,
            external_id: null,
            restaurant_name: null,
            restaurant_city: null,
        }],
        pin_wishlist: true,
        notify_done: false,
        source: { type: 'video', caption: 'ticket-195-smoke' },
    }),
});
assertStatus('legacy save_spots edge contract', legacyEdge, 200);
const edgeStatus = (legacyEdge.body as {
    data?: { results?: Array<{ status?: unknown }> };
} | null)?.data?.results?.[0]?.status;
if (edgeStatus !== 'saved' && edgeStatus !== 'already_pinned') {
    throw new Error(`legacy save_spots edge contract: unexpected status ${String(edgeStatus)}`);
}
console.log('✓ legacy save_spots edge contract');

// Seed immutable server-owned evidence once, then exercise the COMPLETE v2
// resolve-url shape. Fixed UUIDs make repeated deploy smoke idempotent.
const restaurantRead = await jsonFetch(
    `/rest/v1/restaurants?id=eq.${encodeURIComponent(RESTAURANT_ID)}&select=external_id,verification`,
    { method: 'GET', headers: serviceHeaders },
);
assertStatus('v2 fixture restaurant read', restaurantRead, 200);
const restaurantRows = Array.isArray(restaurantRead.body) ? restaurantRead.body : [];
const externalId = (restaurantRows[0] as { external_id?: unknown } | undefined)?.external_id;
if (typeof externalId !== 'string' || externalId.length === 0) {
    throw new Error('v2 fixture restaurant has no external_id');
}

const v2ImportNonce = '19500000-0000-4000-8000-000000000020';
const v2ItemNonce = '19500000-0000-4000-8000-000000000021';
const v2ResolutionId = '19500000-0000-4000-8000-000000000022';
const v2DestinationNonce = '19500000-0000-4000-8000-000000000023';
const resolutionRead = await jsonFetch(
    `/rest/v1/import_resolutions?resolution_id=eq.${v2ResolutionId}&select=resolution_id`,
    { method: 'GET', headers: serviceHeaders },
);
assertStatus('v2 fixture resolution read', resolutionRead, 200);
if (!Array.isArray(resolutionRead.body) || resolutionRead.body.length === 0) {
    const resolutionInsert = await jsonFetch('/rest/v1/import_resolutions', {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
            resolution_id: v2ResolutionId,
            user_id: ownerId,
            import_nonce: v2ImportNonce,
            candidate_evidence: { path: 'prod-smoke', restaurant_id: RESTAURANT_ID },
            decision: 'matched',
            matched_external_id: externalId,
            scores: null,
        }),
    });
    assertStatus('v2 fixture resolution insert', resolutionInsert, 201);
}

const v2Edge = await jsonFetch('/functions/v1/resolve-url', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
        action: 'save_spots',
        import_nonce: v2ImportNonce,
        protocol_version: 2,
        protocol_generation: 'v2',
        expected_destinations: 1,
        destination_intent: [{
            item_nonce: v2ItemNonce,
            destination_nonce: v2DestinationNonce,
            destination_kind: 'wishlist',
            notify_done: false,
        }],
        spots: [{
            candidate_id: 'smoke-ticket-195-v2',
            client_nonce: v2ItemNonce,
            resolution_id: v2ResolutionId,
            restaurant_id: RESTAURANT_ID,
            external_id: externalId,
            restaurant_name: null,
            restaurant_city: null,
        }],
        source: { type: 'video', caption: 'ticket-195-v2-smoke' },
    }),
});
assertStatus('complete v2 save_spots edge contract', v2Edge, 200);
const v2Status = (v2Edge.body as {
    data?: { results?: Array<{ status?: unknown }> };
} | null)?.data?.results?.[0]?.status;
if (v2Status !== 'saved' && v2Status !== 'already_pinned' && v2Status !== 'queued') {
    throw new Error(`complete v2 save_spots edge contract: unexpected status ${String(v2Status)}`);
}
console.log('✓ complete v2 save_spots edge contract');

const partialV2 = await jsonFetch('/functions/v1/resolve-url', {
    method: 'POST',
    headers: userHeaders,
    body: JSON.stringify({
        action: 'save_spots',
        import_nonce: '19500000-0000-4000-8000-000000000003',
        protocol_version: 2,
        spots: [{
            candidate_id: 'smoke-ticket-195-partial-v2',
            client_nonce: '19500000-0000-4000-8000-000000000004',
            restaurant_id: RESTAURANT_ID,
        }],
    }),
});
assertStatus('partial v2 classifier', partialV2, 400);
const partialCode = (partialV2.body as { error?: { code?: unknown } } | null)?.error?.code;
if (partialCode !== 'INVALID_V2_BODY') {
    throw new Error(`partial v2 classifier: unexpected code ${String(partialCode)}`);
}
console.log('✓ partial v2 classifier');

const saveRpcBase = {
    p_user_id: ownerId,
    p_restaurant_id: RESTAURANT_ID,
    p_external_id: null,
    p_restaurant_name: null,
    p_restaurant_city: null,
    p_source: { type: 'video', caption: 'ticket-195-rpc-smoke' },
    p_note: null,
    p_table_id: null,
    p_table_client_nonce: null,
};

const oldOverload = await jsonFetch('/rest/v1/rpc/fn_save_import_spot', {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
        ...saveRpcBase,
        p_import_nonce: '19500000-0000-4000-8000-000000000011',
        p_client_nonce: '19500000-0000-4000-8000-000000000012',
    }),
});
assertStatus('retained fn_save_import_spot signature', oldOverload, 200);
assertSaveStatus('retained fn_save_import_spot signature', oldOverload.body);
console.log('✓ retained fn_save_import_spot signature');

const newOverload = await jsonFetch('/rest/v1/rpc/fn_save_import_spot', {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
        ...saveRpcBase,
        p_import_nonce: '19500000-0000-4000-8000-000000000013',
        p_client_nonce: '19500000-0000-4000-8000-000000000014',
        p_resolution_id: null,
    }),
});
assertStatus('required-resolution fn_save_import_spot overload', newOverload, 200);
assertSaveStatus('required-resolution fn_save_import_spot overload', newOverload.body);
console.log('✓ required-resolution fn_save_import_spot overload');

const drain = await jsonFetch('/functions/v1/restaurant-completeness', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        'x-completeness-cron': CRON_SECRET,
    },
    body: JSON.stringify({ action: 'drain', batch_limit: 1, sweep_limit: 1 }),
});
assertStatus('default-inert completeness drain', drain, 200);
const drainData = (drain.body as {
    data?: {
        enabled?: unknown;
        worker_id?: unknown;
        claimed?: unknown;
        processed?: unknown;
        swept_jobs?: unknown;
    };
} | null)?.data;
if (
    drainData?.enabled !== false ||
    drainData.worker_id !== null ||
    drainData.claimed !== 0 ||
    !Array.isArray(drainData.processed) ||
    drainData.processed.length !== 0 ||
    drainData.swept_jobs !== 0
) {
    throw new Error(
        `default-inert completeness drain: unexpected work ${JSON.stringify(drainData)}`,
    );
}
console.log('✓ default-inert completeness drain');
