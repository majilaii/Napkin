/**
 * Tests for places-search edge function
 * 
 * Run with: deno test --allow-env supabase/functions/places-search/
 */

import { assertEquals } from '../_shared/test-utils.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Import from utils.ts (doesn't trigger serve())
import { parsePayload, clamp, firstNumber, mapRegularOpeningHours } from './utils.ts';

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
