/**
 * Tests for places-search edge function
 * 
 * Run with: deno test --allow-env supabase/functions/places-search/
 */

import { assertEquals } from '../_shared/test-utils.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
    mapRegularOpeningHours,
    parsePlaceAttestation,
} from '../_shared/completeness.ts';

// Import from utils.ts (doesn't trigger serve())
import {
    buildTextSearchPlan,
    parsePayload,
    clamp,
    expectedSearchOwnerDecision,
    firstNumber,
    projectionToPlace,
    resolveGlobalFallback,
    shouldGlobalFallback,
    WORLD_RECT_BIAS,
} from './utils.ts';
import { CompletenessProvider } from '../_shared/completenessProvider.ts';

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


    await t.step('parsePayload() carries structured locality and fallback opt-in', async () => {
        const req = new Request('http://localhost', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: 'Parisik',
                city: 'Paris',
                area: 'Le Marais',
                global_fallback: true,
            }),
        });
        const payload = await parsePayload(req);
        assertEquals(payload.city, 'Paris');
        assertEquals(payload.area, 'Le Marais');
        assertEquals(payload.global_fallback, true);
    });

    await t.step('expected owner fence is optional but strict when present', () => {
        const owner = '19500000-0000-4000-8000-000000000001';
        const other = '19500000-0000-4000-8000-000000000002';
        assertEquals(expectedSearchOwnerDecision(undefined, owner), 'allow');
        assertEquals(expectedSearchOwnerDecision(owner, owner), 'allow');
        assertEquals(expectedSearchOwnerDecision(other, owner), 'mismatch');
        assertEquals(expectedSearchOwnerDecision(null, owner), 'invalid');
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
function paidProvider(capture: (init?: RequestInit) => void) {
  return new CompletenessProvider({
    rpc: async () => ({ data: true, error: null }),
  }, {
    googleApiKey: "google-key",
    fetchImpl: async (_input, init) => {
      capture(init);
      return Response.json({ places: [] });
    },
  });
}

Deno.test("structured city beats coordinates and home_city in the Google request", async () => {
  const raw = {
    query: "Parisik",
    city: "Paris",
    area: "Le Marais",
    lat: 51.5,
    lng: -0.1,
  };
  const payload = await parsePayload(
    new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(raw),
    }),
  );
  const plan = buildTextSearchPlan(payload, raw, "London");
  let outbound: Record<string, unknown> = {};
  const provider = paidProvider((init) => {
    outbound = JSON.parse(String(init?.body));
  });
  await provider.searchText(
    "owner",
    {
      name: payload.query!,
      city: plan.city,
      area: plan.area,
    },
    undefined,
    plan.coordinateBias
      ? { bias: { circle: { ...plan.coordinateBias, radius: 50000 } } }
      : undefined,
  );

  assertEquals(plan.needsHomeCity, false);
  assertEquals(outbound.textQuery, "Parisik, Le Marais, Paris");
  assertEquals(outbound.locationBias, undefined);
  assertEquals(String(outbound.textQuery).includes("London"), false);
});

Deno.test("legacy and current coordinate requests construct the same Google bias and do not fallback", async () => {
  const requestBody = async (raw: Record<string, unknown>) => {
    const payload = await parsePayload(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(raw),
      }),
    );
    const plan = buildTextSearchPlan(payload, raw, "London");
    let outbound: Record<string, unknown> = {};
    const provider = paidProvider((init) => {
      outbound = JSON.parse(String(init?.body));
    });
    await provider.searchText(
      "owner",
      {
        name: payload.query!,
        city: plan.city,
      },
      undefined,
      plan.coordinateBias
        ? { bias: { circle: { ...plan.coordinateBias, radius: 50000 } } }
        : undefined,
    );
    assertEquals(shouldGlobalFallback(payload, plan.coordinateBias, 0), false);
    return outbound;
  };

  const current = await requestBody({ query: "Kamer", lat: 51.5, lng: -0.1 });
  const legacy = await requestBody({
    query: "Kamer",
    latitude: 51.5,
    longitude: -0.1,
  });
  assertEquals(legacy, current);
  assertEquals(current.locationBias, {
    circle: {
      center: { latitude: 51.5, longitude: -0.1 },
      radius: 50000,
    },
  });
});

Deno.test("provider rectangle bias and abort signal reach the Google request", async () => {
  const controller = new AbortController();
  let outbound: RequestInit | undefined;
  const provider = paidProvider((init) => {
    outbound = init;
  });
  await provider.searchText("owner", { name: "Kamer", city: "" }, undefined, {
    bias: WORLD_RECT_BIAS,
    signal: controller.signal,
  });
  const body = JSON.parse(String(outbound?.body));
  assertEquals(body.locationBias, {
    rectangle: {
      low: { latitude: -85, longitude: -180 },
      high: { latitude: 85, longitude: 180 },
    },
  });
  assertEquals(outbound?.signal, controller.signal);
});

Deno.test('provider keeps the additive legacy coordinate seam at 50 km with no signal', async () => {
    let outbound: RequestInit | undefined;
    const provider = paidProvider((init) => {
        outbound = init;
    });
    await provider.searchText(
        'owner',
        { name: 'Kamer', city: '' },
        undefined,
        { lat: 51.5, lng: -0.1 },
    );
    const body = JSON.parse(String(outbound?.body));
    assertEquals(body.locationBias, {
        circle: {
            center: { latitude: 51.5, longitude: -0.1 },
            radius: 50000,
        },
    });
    assertEquals(outbound?.signal, undefined);
});

Deno.test("resolveGlobalFallback degrades safely and tags only successful fallback rows", async (t) => {
  await t.step("limiter denied skips fetch", async () => {
    let fetched = false;
    const rows = await resolveGlobalFallback({
      firstPassRows: [] as Array<{ id: string }>,
      consumeRateUnit: async () => false,
      fetchFallback: async () => {
        fetched = true;
        return { ok: true, rows: [{ id: "far" }] };
      },
    });
    assertEquals(rows, []);
    assertEquals(fetched, false);
  });

  await t.step("ok replaces the empty first pass", async () => {
    const rows = await resolveGlobalFallback({
      firstPassRows: [] as Array<{ id: string; fartherAfield?: boolean }>,
      consumeRateUnit: async () => true,
      fetchFallback: async () => ({
        ok: true,
        rows: [{ id: "far", fartherAfield: true }],
      }),
    });
    assertEquals(rows, [{ id: "far", fartherAfield: true }]);
  });

  await t.step("non-ok keeps the first pass", async () => {
    const first = [{ id: "first" }];
    assertEquals(
      await resolveGlobalFallback({
        firstPassRows: first,
        consumeRateUnit: async () => true,
        fetchFallback: async () => ({ ok: false, rows: [{ id: "far" }] }),
      }),
      first,
    );
  });

  await t.step("throw keeps the first pass", async () => {
    const first = [{ id: "first" }];
    assertEquals(
      await resolveGlobalFallback({
        firstPassRows: first,
        consumeRateUnit: async () => true,
        fetchFallback: async () => {
          throw new Error("network");
        },
      }),
      first,
    );
  });

  await t.step("stall is aborted at the deadline", async () => {
    const first = [{ id: "first" }];
    const rows = await resolveGlobalFallback({
      firstPassRows: first,
      consumeRateUnit: async () => true,
      fetchFallback: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")));
        }),
      timeoutMs: 5,
    });
    assertEquals(rows, first);
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

Deno.test('projectionToPlace exposes attested product metadata', () => {
    const projection = parsePlaceAttestation('ChIJ-ramen', {
        displayName: { text: 'Ramen Moto' },
        location: { latitude: 51.51, longitude: -0.12 },
        addressComponents: [
            { longText: 'London', types: ['locality'] },
            { longText: 'United Kingdom', types: ['country'] },
        ],
        rating: 4.7,
        userRatingCount: 842,
        priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
        types: ['ramen_restaurant', 'restaurant'],
        primaryType: 'ramen_restaurant',
        websiteUri: 'https://ramen-moto.example',
        nationalPhoneNumber: '+44 20 7000 0000',
        googleMapsUri: 'https://maps.google.test/ramen-moto',
        regularOpeningHours: {
            weekdayDescriptions: ['Monday: 12:00 PM – 10:00 PM'],
        },
    })!;

    const place = projectionToPlace(projection);
    assertEquals(place.googleRating, 4.7);
    assertEquals(place.googleRatingCount, 842);
    assertEquals(place.priceLevel, 1);
    assertEquals(place.categories, ['ramen_restaurant', 'restaurant']);
    assertEquals(place.cuisine, 'Ramen');
    assertEquals(place.website, 'https://ramen-moto.example');
    assertEquals(place.phone, '+44 20 7000 0000');
    assertEquals(place.link, 'https://maps.google.test/ramen-moto');
    assertEquals(place.google_maps_uri, place.link);
    assertEquals(place.hours, {
        weekdayDescriptions: ['Monday: 12:00 PM – 10:00 PM'],
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
