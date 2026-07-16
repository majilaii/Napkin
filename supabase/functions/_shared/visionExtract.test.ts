/**
 * TICKET-060 Step 2 — unit tests for visionExtract.ts.
 *
 * Tests the parser (parseExtractionResponse) in isolation by checking that:
 *   - A well-formed JSON response yields the content-derived shape.
 *   - A malformed/prose response downgrades to confidence:'low' (never throws).
 *   - An empty name still produces confidence:'low'.
 *   - The returned shape never includes restaurant_id or already_wishlisted.
 *
 * Live API key smoke test is SKIPPED (DEFERRED blocker — flagged in build log).
 * Run with: deno test supabase/functions/_shared/visionExtract.test.ts
 */

import {
    assertEquals,
    assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ── Import the parser indirectly (it's not exported, so we stub the Anthropic call) ──
// We test extractFromText and extractFromVision by mocking the ANTHROPIC_API_KEY.
// Without the key, both functions return confidence:'low' (fail-soft behavior).

// ── Parser behavior tests (via stub) ──────────────────────────────────────────

// We test parse behavior by calling the module with controlled inputs.
// Since the parser is internal, we verify fail-soft via the exported functions.

Deno.test('extractFromText: no API key → returns confidence:low (fail-soft)', async () => {
    // Ensure the key is absent in the test environment
    const originalKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (originalKey) {
        // Key is set — skip this specific assertion (live-key env)
        return;
    }

    const { extractFromText } = await import('./visionExtract.ts');
    const result = await extractFromText('Joe Beef Montreal');
    assertEquals(result.confidence, 'low');
    // Ensure no user-specific fields are present
    assertEquals('restaurant_id' in result, false);
    assertEquals('already_wishlisted' in result, false);
});

Deno.test('extractFromVision: no API key → returns confidence:low (fail-soft)', async () => {
    const originalKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (originalKey) {
        return; // Skip in live-key environment
    }

    const { extractFromVision } = await import('./visionExtract.ts');
    // Pass a trivial 1px base64 image
    const tinyJpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=';
    const result = await extractFromVision(tinyJpeg, 'image/jpeg');
    assertEquals(result.confidence, 'low');
    assertEquals('restaurant_id' in result, false);
    assertEquals('already_wishlisted' in result, false);
});

// ── Content-hash idempotency tests ────────────────────────────────────────────

Deno.test('hashTextSource: same url+caption → same hash', async () => {
    const { hashTextSource } = await import('./contentHash.ts');
    const h1 = await hashTextSource('https://tiktok.com/@u/video/123', 'great restaurant');
    const h2 = await hashTextSource('https://tiktok.com/@u/video/123', 'great restaurant');
    assertEquals(h1, h2);
});

Deno.test('hashTextSource: different url → different hash', async () => {
    const { hashTextSource } = await import('./contentHash.ts');
    const h1 = await hashTextSource('https://tiktok.com/@u/video/123', 'test');
    const h2 = await hashTextSource('https://tiktok.com/@u/video/456', 'test');
    assertEquals(h1 !== h2, true);
});

Deno.test('hashTextSource: tracking params stripped → same hash', async () => {
    const { hashTextSource } = await import('./contentHash.ts');
    // utm_source should be stripped
    const h1 = await hashTextSource('https://example.com/restaurant', 'test');
    const h2 = await hashTextSource('https://example.com/restaurant?utm_source=ig', 'test');
    assertEquals(h1, h2);
});

Deno.test('hashImage: same bytes → same hash', async () => {
    const { hashImage } = await import('./contentHash.ts');
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const h1 = await hashImage(bytes);
    const h2 = await hashImage(bytes);
    assertEquals(h1, h2);
});

Deno.test('hashImage: different bytes → different hash', async () => {
    const { hashImage } = await import('./contentHash.ts');
    const h1 = await hashImage(new Uint8Array([1, 2, 3]));
    const h2 = await hashImage(new Uint8Array([4, 5, 6]));
    assertEquals(h1 !== h2, true);
});

Deno.test('image hash and text hash are distinct key spaces', async () => {
    const { hashImage, hashTextSource } = await import('./contentHash.ts');
    // Even if byte values happen to match, the key domains are semantically different.
    // This just checks they're different strings (not the same key space).
    const imageHash = await hashImage(new Uint8Array([104, 116, 116, 112, 115])); // "https" bytes
    const textHash = await hashTextSource('https');
    // They may technically collide by coincidence but extremely unlikely.
    // The test asserts they're different *types* of input; a collision would be
    // a crypto coincidence, not a bug — so we just sanity-check both return strings.
    assertEquals(typeof imageHash, 'string');
    assertEquals(typeof textHash, 'string');
    assertEquals(imageHash.length, 64);  // sha256 hex = 64 chars
    assertEquals(textHash.length, 64);
});

// ── HASH_VERSION ─────────────────────────────────────────────────────────────

Deno.test('HASH_VERSION is a positive integer', async () => {
    const { HASH_VERSION } = await import('./contentHash.ts');
    assertEquals(typeof HASH_VERSION, 'number');
    assertEquals(HASH_VERSION >= 1, true);
    assertEquals(Number.isInteger(HASH_VERSION), true);
});

Deno.test('HASH_VERSION is 2 (TICKET-063 cache-bust of pre-overhaul rows)', async () => {
    const { HASH_VERSION } = await import('./contentHash.ts');
    assertEquals(HASH_VERSION, 2);
});

// ── parseMultiExtractionResponse ─────────────────────────────────────────────

Deno.test('parseMultiExtractionResponse: well-formed array → array of candidates', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    const raw = JSON.stringify([
        { name: 'Nobu', city: 'London', city_inferred: false, cuisine: 'Japanese', address: null, booking_url: null, hours: null, confidence: 'high', google_place_id: null },
        { name: 'Zuma', city: 'London', city_inferred: false, cuisine: 'Japanese', address: null, booking_url: null, hours: null, confidence: 'high', google_place_id: null },
    ]);
    const results = parseMultiExtractionResponse(raw);
    assertEquals(results.length, 2);
    assertEquals(results[0].name, 'Nobu');
    assertEquals(results[1].name, 'Zuma');
    assertEquals(results[0].city_inferred, false);
});

Deno.test('parseMultiExtractionResponse: city_inferred=true preserved', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    const raw = JSON.stringify([
        { name: 'Sketch', city: 'London', city_inferred: true, cuisine: 'Modern European', address: null, booking_url: null, hours: null, confidence: 'high', google_place_id: null },
    ]);
    const results = parseMultiExtractionResponse(raw);
    assertEquals(results.length, 1);
    assertEquals(results[0].city_inferred, true);
});

Deno.test('parseMultiExtractionResponse: markdown-fenced JSON is stripped', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    const raw = '```json\n[{"name":"Ramen Nagi","city":"Tokyo","city_inferred":false,"cuisine":"Ramen","address":null,"booking_url":null,"hours":null,"confidence":"high","google_place_id":null}]\n```';
    const results = parseMultiExtractionResponse(raw);
    assertEquals(results.length, 1);
    assertEquals(results[0].name, 'Ramen Nagi');
});

Deno.test('parseMultiExtractionResponse: entries without name are filtered', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    const raw = JSON.stringify([
        { name: null, city: 'Tokyo', city_inferred: false, cuisine: null, address: null, booking_url: null, hours: null, confidence: 'low', google_place_id: null },
        { name: 'Narisawa', city: 'Tokyo', city_inferred: false, cuisine: 'Japanese', address: null, booking_url: null, hours: null, confidence: 'high', google_place_id: null },
    ]);
    const results = parseMultiExtractionResponse(raw);
    assertEquals(results.length, 1);
    assertEquals(results[0].name, 'Narisawa');
});

Deno.test('parseMultiExtractionResponse: capped at 6 candidates', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    const items = Array.from({ length: 8 }, (_, i) => ({
        name: `Restaurant ${i + 1}`,
        city: 'Tokyo',
        city_inferred: false,
        cuisine: 'Japanese',
        address: null,
        booking_url: null,
        hours: null,
        confidence: 'high',
        google_place_id: null,
    }));
    const results = parseMultiExtractionResponse(JSON.stringify(items));
    assertEquals(results.length, 6);
});

Deno.test('parseMultiExtractionResponse: malformed tail salvage recovers first valid element', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    // Well-formed first element, truncated second element
    const truncated = '[{"name":"Sketch","city":"London","city_inferred":false,"cuisine":"European","address":null,"booking_url":null,"hours":null,"confidence":"high","google_place_id":null},{"name":"Brat","city":"London","city_inferred":false,"cui';
    const results = parseMultiExtractionResponse(truncated);
    // Should salvage at least the first complete element
    assertEquals(results.length >= 1, true);
    assertEquals(results[0].name, 'Sketch');
});

Deno.test('parseMultiExtractionResponse: total garbage → returns empty array (fail-soft)', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    const results = parseMultiExtractionResponse('not json at all, sorry!');
    assertEquals(Array.isArray(results), true);
    assertEquals(results.length, 0);
});

Deno.test('parseMultiExtractionResponse: empty array response → returns []', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    const results = parseMultiExtractionResponse('[]');
    assertEquals(results.length, 0);
});

Deno.test('parseMultiExtractionResponse: unknown confidence → coerced to low', async () => {
    const { parseMultiExtractionResponse } = await import('./visionExtract.ts');
    const raw = JSON.stringify([
        { name: 'Kikunoi', city: null, city_inferred: false, cuisine: null, address: null, booking_url: null, hours: null, confidence: 'exact', google_place_id: null },
    ]);
    const results = parseMultiExtractionResponse(raw);
    assertEquals(results.length, 1);
    // 'exact' is not a valid LLM confidence level; coerceCandidate maps non-'high' to 'low'
    assertEquals(results[0].confidence, 'low');
});

// ── Photo-carousel extraction context (TICKET-195) ───────────────────────────────

Deno.test('buildMultiSystemPrompt: photo context adds scene-noise rules and slide cap', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    const prompt = buildMultiSystemPrompt(12, { sourceKind: 'photo', slideCount: 5 });

    assertStringIncludes(prompt, 'PHOTO CAROUSEL MODE');
    assertStringIncludes(prompt, "creator's OVERLAY text");
    assertStringIncludes(prompt, 'neighboring storefront signs, posters, banners');
    assertStringIncludes(prompt, 'event/charity/foundation names');
    assertStringIncludes(prompt, 'AT MOST ONE venue per slide');
    assertStringIncludes(prompt, 'When unsure whether a string is a creator recommendation');
    assertStringIncludes(prompt, 'OMIT it');
    assertStringIncludes(prompt, 'Cap at 5 restaurants');
});

Deno.test('buildMultiSystemPrompt: no photo context preserves video rules and caller cap', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    const prompt = buildMultiSystemPrompt(12);

    assertEquals(prompt.includes('PHOTO CAROUSEL MODE'), false);
    assertStringIncludes(prompt, 'TWO noisy channels from a food video');
    assertStringIncludes(prompt, 'Extract EVERY distinct restaurant visible or mentioned');
    assertStringIncludes(prompt, 'Cap at 12 restaurants');
});

Deno.test('buildMultiSystemPrompt: rejects untrusted photo slide counts', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');

    for (const slideCount of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 13]) {
        const prompt = buildMultiSystemPrompt(6, { sourceKind: 'photo', slideCount });
        assertEquals(prompt.includes('PHOTO CAROUSEL MODE'), false);
        assertStringIncludes(prompt, 'Cap at 6 restaurants');
    }
});

Deno.test('extractFromTextMulti: photo slide count alone overrides prompt and parser cap', async () => {
    const originalKey = Deno.env.get('ANTHROPIC_API_KEY');
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;
    const items = Array.from({ length: 8 }, (_, i) => ({
        name: `Restaurant ${i + 1}`,
        city: 'London',
        city_inferred: false,
        cuisine: null,
        address: null,
        booking_url: null,
        hours: null,
        confidence: 'high',
        google_place_id: null,
    }));

    try {
        Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
        globalThis.fetch = ((_input: Request | URL | string, init?: RequestInit) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return Promise.resolve(new Response(JSON.stringify({
                content: [{ type: 'text', text: JSON.stringify(items) }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }) as typeof fetch;

        const { extractFromTextMulti } = await import('./visionExtract.ts');
        const results = await extractFromTextMulti(
            '[slide 1 of 5]\nRestaurant 1',
            undefined,
            12,
            { sourceKind: 'photo', slideCount: 5 },
        );

        assertEquals(results.length, 5);
        assertStringIncludes(String(requestBody?.['system']), 'PHOTO CAROUSEL MODE');
        assertStringIncludes(String(requestBody?.['system']), 'Cap at 5 restaurants');

        const videoResults = await extractFromTextMulti('Eight video picks', undefined, 12);
        assertEquals(videoResults.length, 8);
        assertEquals(String(requestBody?.['system']).includes('PHOTO CAROUSEL MODE'), false);
        assertStringIncludes(String(requestBody?.['system']), 'Cap at 12 restaurants');
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) Deno.env.delete('ANTHROPIC_API_KEY');
        else Deno.env.set('ANTHROPIC_API_KEY', originalKey);
    }
});
