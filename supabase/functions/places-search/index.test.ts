/**
 * Tests for places-search edge function
 * 
 * Run with: deno test --allow-env supabase/functions/places-search/
 */

import { assertEquals } from '../_shared/test-utils.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Import from utils.ts (doesn't trigger serve())
import {
    parsePayload,
    clamp,
    firstNumber,
    mapRegularOpeningHours,
    shouldGlobalFallback,
    resolveGlobalFallback,
    WORLD_RECT_BIAS,
} from './utils.ts';

Deno.test('places-search utility functions', async (t) => {

    await t.step('clamp() should return value within bounds', () => {
        assertEquals(clamp(5, 1, 10), 5);   // Within range
        assertEquals(clamp(0, 1, 10), 1);   // Below min
        assertEquals(clamp(15, 1, 10), 10); // Above max
        assertEquals(clamp(1, 1, 10), 1);   // At min
        assertEquals(clamp(10, 1, 10), 10); // At max
    });

    await t.step('firstNumber() should prioritize body over query', () => {
        // Body value takes priority
        assertEquals(firstNumber(42, '100'), 42);

        // Query fallback when no body
        assertEquals(firstNumber(undefined, '100'), 100);

        // Undefined when neither provided
        assertEquals(firstNumber(undefined, null), undefined);
        assertEquals(firstNumber(undefined, undefined), undefined);

        // NaN query returns undefined
        assertEquals(firstNumber(undefined, 'not-a-number'), undefined);
    });

    await t.step('parsePayload() should merge body and query params', async () => {
        const reqWithBody = new Request('http://localhost?latitude=1.0', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'pizza', latitude: 40.7, longitude: -74.0 }),
        });

        const payload = await parsePayload(reqWithBody);
        assertEquals(payload.query, 'pizza');
        assertEquals(payload.latitude, 40.7);  // Body overrides query
        assertEquals(payload.longitude, -74.0);
    });

    await t.step('parsePayload() should use query params when no body', async () => {
        const reqQueryOnly = new Request('http://localhost?query=sushi&latitude=35.6&limit=10', {
            method: 'GET',
        });

        const payload = await parsePayload(reqQueryOnly);
        assertEquals(payload.query, 'sushi');
        assertEquals(payload.latitude, 35.6);
        assertEquals(payload.limit, 10);
    });

    await t.step('parsePayload() carries global_fallback from body and query param', async () => {
        const withBody = await parsePayload(new Request('http://localhost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'kamer', global_fallback: true }),
        }));
        assertEquals(withBody.global_fallback, true);

        const withParam = await parsePayload(
            new Request('http://localhost?query=kamer&global_fallback=true', { method: 'GET' }),
        );
        assertEquals(withParam.global_fallback, true);

        const absent = await parsePayload(
            new Request('http://localhost?query=kamer', { method: 'GET' }),
        );
        assertEquals(absent.global_fallback, undefined);
    });
});

Deno.test('shouldGlobalFallback (TICKET-174)', async (t) => {
    const biased = { query: 'kamer', latitude: 51.5, longitude: -0.1, global_fallback: true };

    await t.step('fires only on opt-in + coords + zero results', () => {
        assertEquals(shouldGlobalFallback(biased, 0), true);
    });

    await t.step('never fires when the biased pass found something', () => {
        assertEquals(shouldGlobalFallback(biased, 1), false);
    });

    await t.step('never fires without opt-in — even biased and empty', () => {
        assertEquals(shouldGlobalFallback({ query: 'kamer', latitude: 51.5, longitude: -0.1 }, 0), false);
    });

    await t.step('never fires without coords — resolve-url import callers send bare {query,limit}', () => {
        assertEquals(shouldGlobalFallback({ query: 'kamer', global_fallback: true }, 0), false);
        assertEquals(shouldGlobalFallback({ query: 'kamer', global_fallback: true, latitude: 51.5 }, 0), false);
    });

    await t.step('world rectangle is an explicit bias (never bias omission → IP bias)', () => {
        assertEquals(WORLD_RECT_BIAS.rectangle.low.latitude < WORLD_RECT_BIAS.rectangle.high.latitude, true);
        assertEquals(WORLD_RECT_BIAS.rectangle.low.longitude, -180);
        assertEquals(WORLD_RECT_BIAS.rectangle.high.longitude, 180);
    });
});

Deno.test('resolveGlobalFallback (TICKET-174 review fixes)', async (t) => {
    // The failure paths log via console.error (matching the fn's idiom); silence
    // the expected noise so the test output reads clean.
    const origError = console.error;
    console.error = () => {};
    try {
        await t.step('FIX 1 — limiter denies → fetch is SKIPPED, first pass returned intact', async () => {
            let fetched = false;
            const firstPass = [{ id: 'near' }];
            const out = await resolveGlobalFallback<{ id: string }>({
                firstPassRows: firstPass,
                consumeRateUnit: async () => false, // limiter denies the second unit
                fetchFallback: async () => {
                    fetched = true;
                    return { ok: true, status: 200, body: { places: [{ id: 'far' }] } };
                },
                mapRows: (body) => body.places,
                timeoutMs: 50,
            });
            assertEquals(out, firstPass); // first pass unchanged
            assertEquals(fetched, false); // no SECOND paid Google call fired
        });

        await t.step('limiter allows + ok fallback → mapped fallback rows replace the empty first pass', async () => {
            const out = await resolveGlobalFallback<{ id: string; fartherAfield?: boolean }>({
                firstPassRows: [],
                consumeRateUnit: async () => true,
                fetchFallback: async () => ({ ok: true, status: 200, body: { places: [{ id: 'far' }] } }),
                mapRows: (body) => body.places.map((p: { id: string }) => ({ ...p, fartherAfield: true })),
                timeoutMs: 50,
            });
            assertEquals(out, [{ id: 'far', fartherAfield: true }]);
        });

        await t.step('non-ok Google fallback → degrade to first pass (no throw)', async () => {
            const firstPass = [{ id: 'near' }];
            const out = await resolveGlobalFallback<{ id: string }>({
                firstPassRows: firstPass,
                consumeRateUnit: async () => true,
                fetchFallback: async () => ({ ok: false, status: 429, body: { error: 'quota' } }),
                mapRows: (body) => body.places,
                timeoutMs: 50,
            });
            assertEquals(out, firstPass);
        });

        await t.step('fallback fetch throws (network) → degrade to first pass (no throw escapes)', async () => {
            const firstPass = [{ id: 'near' }];
            const out = await resolveGlobalFallback<{ id: string }>({
                firstPassRows: firstPass,
                consumeRateUnit: async () => true,
                fetchFallback: async () => { throw new Error('network down'); },
                mapRows: (body) => body.places,
                timeoutMs: 50,
            });
            assertEquals(out, firstPass);
        });

        await t.step('FIX 2 — stalled fallback hits the abort deadline → first pass returned, signal aborted', async () => {
            const firstPass = [{ id: 'near' }];
            let aborted = false;
            const out = await resolveGlobalFallback<{ id: string }>({
                firstPassRows: firstPass,
                consumeRateUnit: async () => true,
                // Never resolves on its own — only the timeout can end it.
                fetchFallback: (signal) => new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        aborted = true;
                        reject(new DOMException('Aborted', 'AbortError'));
                    });
                }),
                mapRows: (body) => body.places,
                timeoutMs: 10, // short deadline so the test doesn't wait 4s
            });
            assertEquals(out, firstPass); // valid empty-or-nearby first pass survives the stall
            assertEquals(aborted, true); // the deadline actually fired
        });
    } finally {
        console.error = origError;
    }
});

Deno.test('mapRegularOpeningHours (TICKET-081)', async (t) => {
    await t.step('maps weekdayDescriptions only — openNow is dropped (stale-when-cached)', () => {
        const result = mapRegularOpeningHours({
            openNow: true,
            weekdayDescriptions: [
                'Monday: 9:00 AM – 11:00 PM',
                'Tuesday: 9:00 AM – 11:00 PM',
            ],
        });
        // openNow is NOT persisted — point-in-time, wrong once cached.
        assertEquals(result, {
            weekdayDescriptions: ['Monday: 9:00 AM – 11:00 PM', 'Tuesday: 9:00 AM – 11:00 PM'],
        });
    });

    await t.step('maps weekdayDescriptions when Places omits openNow', () => {
        const result = mapRegularOpeningHours({
            weekdayDescriptions: ['Monday: Closed'],
        });
        assertEquals(result, { weekdayDescriptions: ['Monday: Closed'] });
    });

    await t.step('returns null for missing / empty / non-object input', () => {
        assertEquals(mapRegularOpeningHours(undefined), null);
        assertEquals(mapRegularOpeningHours(null), null);
        assertEquals(mapRegularOpeningHours('nope'), null);
        assertEquals(mapRegularOpeningHours({}), null);
        assertEquals(mapRegularOpeningHours({ weekdayDescriptions: [] }), null);
    });

    await t.step('filters non-string / blank descriptions; null if none survive', () => {
        const result = mapRegularOpeningHours({
            weekdayDescriptions: ['Monday: 9–5', '', '   ', 42, null],
        });
        assertEquals(result, { weekdayDescriptions: ['Monday: 9–5'] });

        assertEquals(mapRegularOpeningHours({ weekdayDescriptions: ['', 99] }), null);
    });

    await t.step('a non-boolean openNow has no effect (still dropped)', () => {
        const result = mapRegularOpeningHours({
            openNow: 'yes',
            weekdayDescriptions: ['Monday: 9–5'],
        });
        assertEquals(result, { weekdayDescriptions: ['Monday: 9–5'] });
    });
});

Deno.test('places-search request handling', async (t) => {

    await t.step('OPTIONS should return CORS headers', () => {
        const mockCorsHandler = (req: Request) => {
            if (req.method === 'OPTIONS') {
                return new Response('ok', { headers: corsHeaders });
            }
            return new Response('continue');
        };

        const req = new Request('http://localhost', { method: 'OPTIONS' });
        const res = mockCorsHandler(req);

        assertEquals(res.status, 200);
        assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
    });

    await t.step('Missing query should return 400', async () => {
        const mockValidation = async (req: Request) => {
            const payload = await parsePayload(req);
            const query = payload.query?.trim();

            if (!query) {
                return new Response(
                    JSON.stringify({ error: 'Missing query parameter' }),
                    { status: 400, headers: { 'Content-Type': 'application/json' } }
                );
            }
            return new Response(JSON.stringify({ valid: true }));
        };

        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        const res = await mockValidation(req);
        assertEquals(res.status, 400);

        const body = await res.json();
        assertEquals(body.error, 'Missing query parameter');
    });
});
