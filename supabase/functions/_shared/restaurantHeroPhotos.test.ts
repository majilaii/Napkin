/**
 * restaurantHeroPhotos.test.ts — TICKET-187 deferred hero-photo acquisition.
 *
 * Tests acquireAndMirrorHeroPhotos (_shared/restaurant.ts) with a capturing mock
 * supabase client + a stubbed globalThis.fetch. No live DB, no live Google.
 *
 * Verification-plan coverage:
 *   - ghost save (verification != 'verified') → ZERO rate tokens + ZERO Google calls
 *   - already-mirrored / terminal / no-external-id rows skipped BEFORE any token
 *   - photo_fetch bucket fail-closed: denied OR rpc-error → zero Google calls
 *   - photoless place → terminal photo_source='none' (CAS on photo_url IS NULL)
 *   - transient Details failure (404/500/network) → NO write (NULL, retryable)
 *   - success → photos-only field mask, DB-derived external_id, reference-derived
 *     Storage key <id>/<sha1(photoName)>.jpg, atomic four-column exact-URL CAS
 *   - input ids deduplicated → one token per distinct row
 *   - buildPhotoAttributionHtml synthesis + escaping (places-search contract)
 *
 * Run with: deno test --allow-env supabase/functions/_shared/restaurantHeroPhotos.test.ts
 */
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { acquireAndMirrorHeroPhotos, buildPhotoAttributionHtml } from './restaurant.ts';

const USER_ID = 'aabbccdd-0000-4000-8000-000000000001';

async function sha1Hex(s: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Capturing mock supabase client ────────────────────────────────────────────

interface Captured {
    rpc: Array<{ name: string; args: Record<string, unknown> }>;
    updates: Array<{
        table: string;
        payload: Record<string, unknown>;
        eq: Record<string, unknown>;
        isNull: string[];
    }>;
    uploads: Array<{ bucket: string; path: string; contentType?: string }>;
}

function makeMockSupabase(opts: {
    rows: Array<Record<string, unknown>>;
    rateAllowed?: boolean | 'rpc-error';
    /** Returned Supabase error on the initial restaurants read. */
    readError?: unknown;
    /** The initial restaurants read REJECTS (unexpected throw inside the job). */
    readRejects?: boolean;
}) {
    const calls: Captured = { rpc: [], updates: [], uploads: [] };
    const client = {
        from: (table: string) => ({
            select: (_cols: string) => ({
                in: (_col: string, _ids: string[]) =>
                    opts.readRejects
                        ? Promise.reject(new Error('restaurants read blew up'))
                        : Promise.resolve(
                            opts.readError
                                ? { data: null, error: opts.readError }
                                : { data: opts.rows, error: null },
                        ),
            }),
            update: (payload: Record<string, unknown>) => ({
                eq: (col: string, val: unknown) => ({
                    is: (isCol: string, _isVal: unknown) => {
                        calls.updates.push({ table, payload, eq: { [col]: val }, isNull: [isCol] });
                        return Promise.resolve({ data: null, error: null });
                    },
                }),
            }),
        }),
        rpc: (name: string, args: Record<string, unknown>) => {
            calls.rpc.push({ name, args });
            if (opts.rateAllowed === 'rpc-error') {
                return Promise.resolve({ data: null, error: { message: 'db blip' } });
            }
            return Promise.resolve({
                data: [{ allowed: opts.rateAllowed !== false, retry_after_seconds: 0 }],
                error: null,
            });
        },
        storage: {
            from: (bucket: string) => ({
                upload: (path: string, _bytes: ArrayBuffer, o?: { contentType?: string }) => {
                    calls.uploads.push({ bucket, path, contentType: o?.contentType });
                    return Promise.resolve({ error: null });
                },
                getPublicUrl: (path: string) => ({
                    data: { publicUrl: `https://sb.example/storage/v1/object/public/${bucket}/${path}` },
                }),
            }),
        },
    };
    return { client, calls };
}

// ── fetch stub ────────────────────────────────────────────────────────────────

interface SeenFetch {
    url: string;
    fieldMask: string | null;
    body: string | null;
}

function stubFetch(handler: (url: string) => Response) {
    const original = globalThis.fetch;
    const seen: SeenFetch[] = [];
    globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
        const url = typeof input === 'string'
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        seen.push({
            url,
            fieldMask: headers.get('X-Goog-FieldMask'),
            body: typeof init?.body === 'string' ? init.body : null,
        });
        return Promise.resolve(handler(url));
    }) as typeof fetch;
    return { seen, restore: () => { globalThis.fetch = original; } };
}

// ── reportError observation (TICKET-187 review fix) ──────────────────────────
// reportError (_shared/report.ts) activates on the SENTRY_DSN env and emits a
// fire-and-forget fetch to the DSN host — the only observable spy point without
// injection. Steps that assert reporting set TEST_DSN and count sentry-bound
// requests through the same fetch stub; steps that assert exact Google-call
// counts leave SENTRY_DSN unset (reportError no-ops).

const TEST_DSN = 'https://pubkey@sentry.example/42';

/** Sentry-bound requests made by reportError (host from TEST_DSN). */
function sentryCalls(seen: SeenFetch[]): SeenFetch[] {
    return seen.filter((s) => s.url.includes('sentry.example'));
}

function detailsBody(photoName: string | null, displayName: string | null, uri: string | null) {
    if (!photoName) return {};
    return {
        photos: [{
            name: photoName,
            authorAttributions: displayName ? [{ displayName, uri: uri ?? undefined }] : [],
        }],
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test('acquireAndMirrorHeroPhotos (TICKET-187)', async (t) => {
    Deno.env.set('GOOGLE_PLACES_API_KEY', 'test-key');
    Deno.env.delete('PHOTO_FETCH_MAX_PER_DAY');

    await t.step('ghost row (unverified) → ZERO rate tokens + ZERO Google calls', async () => {
        const { client, calls } = makeMockSupabase({
            rows: [{
                id: 'r-ghost', external_id: `ghost_${USER_ID}_nonce1`,
                photo_url: null, photo_source: null, verification: 'unverified',
            }],
        });
        const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r-ghost'], USER_ID);
        } finally {
            fetchStub.restore();
        }
        assertEquals(calls.rpc.length, 0, 'ghost must be filtered BEFORE any rate token');
        assertEquals(fetchStub.seen.length, 0, 'ghost must never reach Google');
        assertEquals(calls.updates.length, 0, 'ghost row must not be touched');
    });

    await t.step('mirrored / terminal / no-external-id rows skipped pre-token', async () => {
        const { client, calls } = makeMockSupabase({
            rows: [
                { id: 'r-mirrored', external_id: 'ChIJ-a', photo_url: 'https://x/p.jpg', photo_source: 'places', verification: 'verified' },
                { id: 'r-terminal', external_id: 'ChIJ-b', photo_url: null, photo_source: 'none', verification: 'verified' },
                { id: 'r-no-ext', external_id: null, photo_url: null, photo_source: null, verification: 'verified' },
            ],
        });
        const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r-mirrored', 'r-terminal', 'r-no-ext'], USER_ID);
        } finally {
            fetchStub.restore();
        }
        assertEquals(calls.rpc.length, 0, 'repeat imports must be free — no tokens for skip rows');
        assertEquals(fetchStub.seen.length, 0);
        assertEquals(calls.updates.length, 0);
    });

    await t.step('rate bucket denied → fail-closed, zero Google calls, row untouched', async () => {
        const { client, calls } = makeMockSupabase({
            rows: [{ id: 'r1', external_id: 'ChIJ-real', photo_url: null, photo_source: null, verification: 'verified' }],
            rateAllowed: false,
        });
        const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
        } finally {
            fetchStub.restore();
        }
        assertEquals(calls.rpc.length, 1);
        assertEquals(calls.rpc[0].name, 'check_and_increment_rate_limit');
        assertEquals(calls.rpc[0].args.p_bucket_key, 'photo_fetch');
        assertEquals(calls.rpc[0].args.p_user_id, USER_ID);
        assertEquals(fetchStub.seen.length, 0, 'denied budget must spend nothing');
        assertEquals(calls.updates.length, 0, 'row stays NULL (retryable via backfill)');
    });

    await t.step('rate RPC error → fail-closed (a DB blip must not uncork spend)', async () => {
        const { client, calls } = makeMockSupabase({
            rows: [{ id: 'r1', external_id: 'ChIJ-real', photo_url: null, photo_source: null, verification: 'verified' }],
            rateAllowed: 'rpc-error',
        });
        const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
        } finally {
            fetchStub.restore();
        }
        assertEquals(fetchStub.seen.length, 0);
        assertEquals(calls.updates.length, 0);
    });

    await t.step("photoless place → TERMINAL photo_source='none' (CAS on photo_url IS NULL)", async () => {
        const { client, calls } = makeMockSupabase({
            rows: [{ id: 'r1', external_id: 'ChIJ-photoless', photo_url: null, photo_source: null, verification: 'verified' }],
        });
        const fetchStub = stubFetch(() =>
            new Response(JSON.stringify(detailsBody(null, null, null)), { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
        } finally {
            fetchStub.restore();
        }
        assertEquals(fetchStub.seen.length, 1, 'exactly one Details call, no media fetch');
        assertEquals(calls.updates.length, 1);
        assertEquals(calls.updates[0].payload, { photo_source: 'none' });
        assertEquals(calls.updates[0].eq, { id: 'r1' });
        assertEquals(calls.updates[0].isNull, ['photo_url'], 'terminal stamp must be CAS-guarded');
    });

    await t.step('empty attribution (photo but no author) → terminal none, no media fetch', async () => {
        const { client, calls } = makeMockSupabase({
            rows: [{ id: 'r1', external_id: 'ChIJ-noattr', photo_url: null, photo_source: null, verification: 'verified' }],
        });
        const fetchStub = stubFetch(() =>
            new Response(JSON.stringify(detailsBody('places/ChIJ-noattr/photos/p1', null, null)), { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
        } finally {
            fetchStub.restore();
        }
        assertEquals(fetchStub.seen.length, 1, 'no paid media fetch without attribution');
        assertEquals(calls.updates.length, 1);
        assertEquals(calls.updates[0].payload, { photo_source: 'none' });
    });

    await t.step('transient Details failure (404 stale id / 500) → NO write, row stays NULL', async () => {
        for (const status of [404, 500]) {
            const { client, calls } = makeMockSupabase({
                rows: [{ id: 'r1', external_id: 'ChIJ-stale', photo_url: null, photo_source: null, verification: 'verified' }],
            });
            const fetchStub = stubFetch(() => new Response('not found', { status }));
            try {
                await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
            } finally {
                fetchStub.restore();
            }
            assertEquals(calls.updates.length, 0,
                `HTTP ${status} must leave photo_source NULL — retryable by the backfill sweep`);
        }
    });

    await t.step('success → field mask, DB-derived id, sha1 key, four-column exact-URL CAS', async () => {
        const externalId = 'ChIJ-success';
        const photoName = 'places/ChIJ-success/photos/photoref-XYZ';
        const { client, calls } = makeMockSupabase({
            rows: [{ id: 'r1', external_id: externalId, photo_url: null, photo_source: null, verification: 'verified' }],
        });
        const fetchStub = stubFetch((url) => {
            if (url.includes('/media?')) {
                return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), {
                    status: 200,
                    headers: { 'content-type': 'image/jpeg' },
                });
            }
            return new Response(
                JSON.stringify(detailsBody(photoName, 'Ana Photographer', 'https://maps.google.com/u/ana')),
                { status: 200 },
            );
        });
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
        } finally {
            fetchStub.restore();
        }

        // Details call: DB-derived external_id + photos-only Essentials field mask.
        const detailsCall = fetchStub.seen[0];
        assertStringIncludes(detailsCall.url, `https://places.googleapis.com/v1/places/${externalId}`);
        assertEquals(detailsCall.fieldMask, 'photos.name,photos.authorAttributions',
            'MUST be the photos-only mask — never the full PLACE_FIELDS');

        // Media fetch uses the photo resource name from Details.
        assertStringIncludes(fetchStub.seen[1].url, `${photoName}/media?`);

        // Reference-derived Storage key: <id>/<sha1(photoName)>.jpg.
        const expectedKey = `r1/${await sha1Hex(photoName)}.jpg`;
        assertEquals(calls.uploads.length, 1);
        assertEquals(calls.uploads[0].bucket, 'restaurant-photos');
        assertEquals(calls.uploads[0].path, expectedKey);

        // Atomic four-column CAS with THAT exact object URL, guarded on photo_url IS NULL.
        assertEquals(calls.updates.length, 1);
        const u = calls.updates[0];
        assertEquals(u.payload.photo_url,
            `https://sb.example/storage/v1/object/public/restaurant-photos/${expectedKey}`);
        assertEquals(u.payload.photo_reference, photoName);
        assertEquals(u.payload.photo_source, 'places');
        assertEquals(
            u.payload.places_photo_attribution_html,
            '<a href="https://maps.google.com/u/ana">Ana Photographer</a>',
        );
        assertEquals(u.isNull, ['photo_url'], 'exact-URL CAS must guard on photo_url IS NULL');
    });

    await t.step('duplicate input ids → deduplicated (single row processed, single token)', async () => {
        const { client, calls } = makeMockSupabase({
            rows: [{ id: 'r1', external_id: 'ChIJ-dup', photo_url: null, photo_source: null, verification: 'verified' }],
        });
        const fetchStub = stubFetch(() =>
            new Response(JSON.stringify(detailsBody(null, null, null)), { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1', 'r1', 'r1'], USER_ID);
        } finally {
            fetchStub.restore();
        }
        // The mock returns ONE row for the deduped .in() read → one token, one Details.
        assertEquals(calls.rpc.length, 1);
        assertEquals(fetchStub.seen.length, 1);
    });

    await t.step('missing GOOGLE_PLACES_API_KEY → no tokens, no calls (transient)', async () => {
        Deno.env.delete('GOOGLE_PLACES_API_KEY');
        const { client, calls } = makeMockSupabase({
            rows: [{ id: 'r1', external_id: 'ChIJ-real', photo_url: null, photo_source: null, verification: 'verified' }],
        });
        const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
        } finally {
            fetchStub.restore();
            Deno.env.set('GOOGLE_PLACES_API_KEY', 'test-key');
        }
        assertEquals(calls.rpc.length, 0);
        assertEquals(fetchStub.seen.length, 0);
        assertEquals(calls.updates.length, 0);
    });

    // ── TICKET-187 review fix: deferred-job failures must reach reportError ──
    // (monitoring doctrine: a fleet-wide deferred-photo failure must never
    // surface only as missing photos.)

    await t.step('unexpected throw inside the job → EXACTLY ONE reportError, wrapper resolves', async () => {
        Deno.env.set('SENTRY_DSN', TEST_DSN);
        const { client } = makeMockSupabase({ rows: [], readRejects: true });
        const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
        try {
            // Must RESOLVE — the job never throws into the isolate/waitUntil.
            await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
        } finally {
            fetchStub.restore();
            Deno.env.delete('SENTRY_DSN');
        }
        const reports = sentryCalls(fetchStub.seen);
        assertEquals(reports.length, 1, 'exactly one reportError emission');
        // Context contract: { fn: 'resolve-url', action: 'photo-mirror', extra.user_id }.
        const event = JSON.parse(reports[0].body ?? '{}');
        assertEquals(event.tags?.fn, 'resolve-url');
        assertEquals(event.tags?.action, 'photo-mirror');
        assertEquals(event.extra?.user_id, USER_ID);
    });

    await t.step('restaurants read returns a DB error → reported once, job stops, no Google calls', async () => {
        Deno.env.set('SENTRY_DSN', TEST_DSN);
        const { client, calls } = makeMockSupabase({
            rows: [],
            readError: { message: 'connection refused', code: '08006' },
        });
        const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1', 'r2'], USER_ID);
        } finally {
            fetchStub.restore();
            Deno.env.delete('SENTRY_DSN');
        }
        const reports = sentryCalls(fetchStub.seen);
        assertEquals(reports.length, 1, 'returned Supabase read error must be reported');
        assertEquals(fetchStub.seen.length - reports.length, 0, 'no Google calls after a dead read');
        assertEquals(calls.rpc.length, 0, 'no tokens after a dead read');
        assertEquals(calls.updates.length, 0);
    });

    await t.step('rate-limit RPC error → reported once, still fail-closed (zero Google spend)', async () => {
        Deno.env.set('SENTRY_DSN', TEST_DSN);
        const { client, calls } = makeMockSupabase({
            rows: [{ id: 'r1', external_id: 'ChIJ-real', photo_url: null, photo_source: null, verification: 'verified' }],
            rateAllowed: 'rpc-error',
        });
        const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
        try {
            await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
        } finally {
            fetchStub.restore();
            Deno.env.delete('SENTRY_DSN');
        }
        const reports = sentryCalls(fetchStub.seen);
        assertEquals(reports.length, 1, 'a rate-RPC DB blip silently starves photo work — must be reported');
        const event = JSON.parse(reports[0].body ?? '{}');
        assertEquals(event.extra?.restaurant_id, 'r1');
        assertEquals(fetchStub.seen.length - reports.length, 0, 'fail-closed: still zero Google calls');
        assertEquals(calls.updates.length, 0);
    });

    await t.step('DESIGNED transient states (Details 404/5xx, budget denial) are NOT reported', async () => {
        Deno.env.set('SENTRY_DSN', TEST_DSN);
        try {
            // Details 404 + 500 → transient NULL, non-reported.
            for (const status of [404, 500]) {
                const { client } = makeMockSupabase({
                    rows: [{ id: 'r1', external_id: 'ChIJ-stale', photo_url: null, photo_source: null, verification: 'verified' }],
                });
                const fetchStub = stubFetch(() => new Response('nope', { status }));
                try {
                    await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
                } finally {
                    fetchStub.restore();
                }
                assertEquals(sentryCalls(fetchStub.seen).length, 0,
                    `Details ${status} is a designed retry state — never reported`);
            }
            // Budget exhausted (allowed=false, no error) → designed, non-reported.
            const { client } = makeMockSupabase({
                rows: [{ id: 'r1', external_id: 'ChIJ-real', photo_url: null, photo_source: null, verification: 'verified' }],
                rateAllowed: false,
            });
            const fetchStub = stubFetch(() => new Response('{}', { status: 200 }));
            try {
                await acquireAndMirrorHeroPhotos(client, ['r1'], USER_ID);
            } finally {
                fetchStub.restore();
            }
            assertEquals(sentryCalls(fetchStub.seen).length, 0,
                'budget denial is the designed state — never reported');
        } finally {
            Deno.env.delete('SENTRY_DSN');
        }
    });
});

// ── buildPhotoAttributionHtml — places-search sanitizePlace contract ──────────

Deno.test('buildPhotoAttributionHtml (TICKET-187)', async (t) => {
    await t.step('displayName + uri → escaped anchor', () => {
        assertEquals(
            buildPhotoAttributionHtml(detailsBody('p', 'Ana', 'https://g.co/ana')),
            '<a href="https://g.co/ana">Ana</a>',
        );
    });

    await t.step('displayName only → escaped text, no anchor', () => {
        assertEquals(buildPhotoAttributionHtml(detailsBody('p', 'Ana', null)), 'Ana');
    });

    await t.step('escapes HTML in both fields (escape-on-write contract)', () => {
        const html = buildPhotoAttributionHtml({
            photos: [{
                name: 'p',
                authorAttributions: [{ displayName: 'A<b>&"c\'', uri: 'https://g.co/?a=1&b="x"' }],
            }],
        });
        assertEquals(html, '<a href="https://g.co/?a=1&amp;b=&quot;x&quot;">A&lt;b&gt;&amp;&quot;c&#39;</a>');
    });

    await t.step('missing/empty/whitespace displayName → null (→ none sentinel)', () => {
        assertEquals(buildPhotoAttributionHtml(detailsBody('p', null, null)), null);
        assertEquals(buildPhotoAttributionHtml({ photos: [{ name: 'p', authorAttributions: [{ displayName: '   ' }] }] }), null);
        assertEquals(buildPhotoAttributionHtml({}), null);
        assertEquals(buildPhotoAttributionHtml(null), null);
    });

    await t.step('version-skewed non-string fields degrade to null, never throw', () => {
        assertEquals(
            buildPhotoAttributionHtml({ photos: [{ name: 'p', authorAttributions: [{ displayName: 42, uri: {} }] }] }),
            null,
        );
    });
});
