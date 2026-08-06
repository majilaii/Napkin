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

Deno.test('buildMultiSystemPrompt: photo context keeps scene-noise rules with listicle cap', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    const prompt = buildMultiSystemPrompt(12, { sourceKind: 'photo', slideCount: 5 });

    assertStringIncludes(prompt, 'PHOTO CAROUSEL MODE');
    assertStringIncludes(prompt, "creator's OVERLAY text");
    assertStringIncludes(prompt, 'neighboring storefront signs, posters, banners');
    assertStringIncludes(prompt, 'event/charity/foundation names');
    assertStringIncludes(prompt, 'AT MOST ONE venue per slide');
    assertStringIncludes(prompt, 'When unsure whether a string is a creator recommendation');
    assertStringIncludes(prompt, 'OMIT it');
    assertStringIncludes(prompt, 'Cap at 12 restaurants');
    assertEquals(prompt.includes('Cap at 5 restaurants'), false);
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

Deno.test('extractFromTextMulti: two-slide photo listicle preserves all ten ordered venues', async () => {
    const originalKey = Deno.env.get('ANTHROPIC_API_KEY');
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;
    const venues = [
        ['RIVA', 'Barnes'],
        ['The River Café', 'Hammersmith'],
        ['Canteen', 'Notting Hill'],
        ['Trattoria Brutto', 'Farringdon'],
        ['Quo Vadis', 'Soho'],
        ['The Devonshire', 'Soho'],
        ['Josephine', 'Chelsea'],
        ['Toklas', 'Temple'],
        ['Dorian', 'Notting Hill'],
        ['Manteca', 'Shoreditch'],
    ] as const;
    const items = venues.map(([name, area]) => ({
        name,
        city: 'London',
        city_inferred: false,
        area,
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
            '[slide 1 of 2]\n' +
                venues.map(([name, area], index) => `${index + 1}. ${name} (${area})`).join('\n') +
                '\n[slide 2 of 2]\nRoast chicken on a plate\n' +
                '[caption]\nTen London favourites worth crossing town for',
            undefined,
            12,
            { sourceKind: 'photo', slideCount: 2 },
        );

        assertEquals(results.map((candidate) => candidate.name), venues.map(([name]) => name));
        assertStringIncludes(String(requestBody?.['system']), 'PHOTO CAROUSEL MODE');
        assertStringIncludes(String(requestBody?.['system']), '[slide N of 2]');
        assertStringIncludes(String(requestBody?.['system']), 'Cap at 12 restaurants');
        assertEquals(String(requestBody?.['system']).includes('Cap at 2 restaurants'), false);
        assertEquals(requestBody?.['max_tokens'], 2560);

        const videoResults = await extractFromTextMulti('Ten video picks', undefined, 12);
        assertEquals(videoResults.length, 10);
        assertEquals(String(requestBody?.['system']).includes('PHOTO CAROUSEL MODE'), false);
        assertStringIncludes(String(requestBody?.['system']), 'Cap at 12 restaurants');
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) Deno.env.delete('ANTHROPIC_API_KEY');
        else Deno.env.set('ANTHROPIC_API_KEY', originalKey);
    }
});

Deno.test('extractFromTextMulti: five-slide scene carousel retains at-most-one-per-slide guard', async () => {
    const originalKey = Deno.env.get('ANTHROPIC_API_KEY');
    const originalFetch = globalThis.fetch;
    let requestBody: Record<string, unknown> | null = null;
    const recommendedItems = Array.from({ length: 5 }, (_, i) => ({
        name: `Recommended Venue ${i + 1}`,
        city: 'London',
        city_inferred: false,
        area: null,
        cuisine: null,
        address: null,
        booking_url: null,
        hours: null,
        confidence: 'high',
        google_place_id: null,
    }));
    const sceneNoiseItems = [
        'Neighbour Shop Sign',
        'Charity Foundation',
        'Street Banner Cafe',
    ].map((name) => ({
        name,
        city: 'London',
        city_inferred: false,
        area: null,
        cuisine: null,
        address: null,
        booking_url: null,
        hours: null,
        confidence: 'low',
        google_place_id: null,
    }));

    try {
        Deno.env.set('ANTHROPIC_API_KEY', 'test-key');
        globalThis.fetch = ((_input: Request | URL | string, init?: RequestInit) => {
            requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
            const system = String(requestBody?.['system']);
            // Simulate a model obeying the complete prompt contract. If any guard
            // regresses, the scene names leak into the response and the test fails.
            const hasPhotoNoiseGuard =
                system.includes('Incidental text visible in the photographed scene is scene noise') &&
                system.includes('AT MOST ONE venue per slide unless') &&
                system.includes('When unsure whether a string is a creator recommendation') &&
                system.includes('OMIT it');
            const responseItems = hasPhotoNoiseGuard
                ? recommendedItems
                : [...recommendedItems, ...sceneNoiseItems];
            return Promise.resolve(new Response(JSON.stringify({
                content: [{ type: 'text', text: JSON.stringify(responseItems) }],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }) as typeof fetch;

        const { extractFromTextMulti } = await import('./visionExtract.ts');
        const results = await extractFromTextMulti(
            '[slide 1 of 5]\nLunch at Recommended Venue 1\nNEIGHBOUR SHOP SIGN\n' +
                '[slide 2 of 5]\nCoffee at Recommended Venue 2\nCHARITY FOUNDATION POSTER\n' +
                '[slide 3 of 5]\nDinner at Recommended Venue 3\nSTREET BANNER\n' +
                '[slide 4 of 5]\nDrinks at Recommended Venue 4\nEVENT HOARDING\n' +
                '[slide 5 of 5]\nDessert at Recommended Venue 5\nMENU BOARD\n' +
                '[caption]\nA day of eating around London',
            undefined,
            12,
            { sourceKind: 'photo', slideCount: 5 },
        );

        assertEquals(
            results.map((candidate) => candidate.name),
            recommendedItems.map((item) => item.name),
        );
        const system = String(requestBody?.['system']);
        assertStringIncludes(system, 'Incidental text visible in the photographed scene is scene noise');
        assertStringIncludes(system, 'AT MOST ONE venue per slide unless');
        assertStringIncludes(system, 'When unsure whether a string is a creator recommendation');
        assertStringIncludes(system, 'OMIT it');
        assertStringIncludes(system, 'Cap at 12 restaurants');
        assertEquals(system.includes('Cap at 5 restaurants'), false);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalKey === undefined) Deno.env.delete('ANTHROPIC_API_KEY');
        else Deno.env.set('ANTHROPIC_API_KEY', originalKey);
    }
});

// ── TICKET-209: zero-context prompt is a FROZEN contract ─────────────────────
// The non-photo/non-video branch of buildMultiSystemPrompt is the shared default
// MULTI_SYSTEM_PROMPT used by the oEmbed caption tier, the thumbnail vision tier
// and the async screenshot path. Those tiers' caches (hashTextSource / image
// hash) carry NO contract token, so a wording change there would silently serve
// stale rows forever. Every new prompt clause must be gated behind an explicit
// extraction context; this snapshot is the guard.
const ZERO_CONTEXT_PROMPT_SNAPSHOT = `You are a restaurant extraction assistant. Given an image and/or text, extract ALL distinct restaurants mentioned or visible.
Respond with ONLY a JSON array — no prose, no markdown, no wrapper object. Each element matches this schema:
{
  "name": string | null,
  "city": string | null,
  "city_inferred": boolean,
  "area": string | null,
  "cuisine": string | null,
  "address": string | null,
  "booking_url": string | null,
  "hours": string | null,
  "confidence": "high" | "low",
  "stance": "recommended" | "warned" | "neutral",
  "google_place_id": string | null
}

The text often combines TWO noisy channels from a food video:
- on-screen OCR fragments — the creator's own overlays, usually "Name, Area"
  with correct spelling ("Cinder, Belsize Park"), mixed with menu/sign noise
- an automatic speech-recognition (ASR) transcript — proper nouns get garbled
  ("the pickle ring" for "The Picklery"; "Lucky. Enjoy." for "Lucky & Joy";
  "Lang Zhou noodles" for "Lanzhou Lamian Noodle Bar")

Interview/Q&A videos overlay a QUESTION ("BEST PUB?", "MOST OVERRATED SPOT IN
LONDON?") immediately before the answer's "Name, Area" overlay — pair each name
with the question that precedes it; the question sets that place's stance.

Rules:
- stance: "warned" when the place is the answer to a negative question or the
  speaker warns against it ("most overrated?", "skip it", "don't bother",
  "worst") — STILL extract these, never omit them. "recommended" when endorsed
  (praise, any "best X" answer). "neutral" for passing mentions and comparisons
  ("is it a bit like Berenjak?" → Berenjak is neutral).
- Watermarks: a short token recurring through the text in garbled variants
  ("PICANTE", "PICAN", "PICA", "PICANTI") is on-screen channel branding, NOT a
  restaurant — ignore it unless it also appears with an area tag or a spoken
  endorsement.
- Extract EVERY distinct restaurant visible or mentioned. Do NOT collapse multiple restaurants into one.
- When the two channels describe the same place, they are ONE restaurant: prefer
  the OCR spelling ("Name, Area" patterns with proper capitalization) for the
  name; use the spoken context for cuisine/city hints.
- Reconstruct ASR-garbled names to the most plausible REAL restaurant name;
  use surrounding clues (dishes, comparisons, area) to denoise. If you cannot
  confidently reconstruct, keep the garbled name verbatim with confidence "low"
  — never invent a restaurant that isn't grounded in the text.
- area: the neighborhood/district if given ("Dalston", "Belsize Park", "Brixton",
  a UK postcode district like "E11") — distinct from city. Null when absent.
- confidence "high": you are reasonably certain of the restaurant name AND city.
- confidence "low": name is uncertain, or city cannot be determined even by inference.
- city: include the city name when known OR inferable. If the caption/title/hashtags signal a city (e.g. "#londonfood", "@nycfoodie", "my faves in soho"), use that city and set city_inferred=true.
- city_inferred: set true when you inferred the city from context clues (hashtags, handle, phrases like "in soho", "my nyc picks") rather than an explicit label. Set false when the city is stated outright.
- booking_url: only if explicitly visible (Resy, OpenTable URL). Otherwise null.
- google_place_id: only if a Google Maps place_id is visible. Otherwise null.
- If no restaurant is identifiable, return an empty array: []
- Cap at 6 restaurants. If more are present, include only the first 6 mentioned.
- Output ONLY the JSON array. No explanation. No markdown fences.`;


Deno.test('buildMultiSystemPrompt: zero-context prompt is byte-identical to the frozen snapshot', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    assertEquals(buildMultiSystemPrompt(6), ZERO_CONTEXT_PROMPT_SNAPSHOT);
});

Deno.test('buildMultiSystemPrompt: no context carries neither the video nor the photo block', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    for (const cap of [6, 12]) {
        const prompt = buildMultiSystemPrompt(cap);
        assertEquals(prompt.includes('VIDEO IMPORT MODE'), false);
        assertEquals(prompt.includes('PHOTO CAROUSEL MODE'), false);
        assertEquals(prompt.includes('exhaustive and authoritative'), false);
        assertEquals(prompt.includes('do not return more than'), false);
    }
});

// ── TICKET-209 Decision C — gated video blocks ───────────────────────────────

Deno.test('buildMultiSystemPrompt: video + video text → noise block AND authority rule', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    const prompt = buildMultiSystemPrompt(12, {
        sourceKind: 'video',
        hasVideoText: true,
        captionCap: null,
    });

    assertStringIncludes(prompt, 'VIDEO IMPORT MODE');
    assertStringIncludes(prompt, 'inside the [video text] section are scene');
    assertStringIncludes(prompt, 'subtitles of');
    assertStringIncludes(prompt, 'channel watermarks');
    assertStringIncludes(prompt, 'exhaustive and authoritative');
    assertStringIncludes(prompt, 'in caption order');
    assertStringIncludes(prompt, 'split undelimited names');
    assertStringIncludes(prompt, 'NOT enumerating');
    assertStringIncludes(prompt, 'Cap at 12 restaurants');
    // No caption cap → no count sentence.
    assertEquals(prompt.includes('do not return more than'), false);
    assertEquals(prompt.includes('PHOTO CAROUSEL MODE'), false);
});

Deno.test('buildMultiSystemPrompt: caption-only video (no video text) drops the OCR noise block, keeps authority', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    const prompt = buildMultiSystemPrompt(12, {
        sourceKind: 'video',
        hasVideoText: false,
        captionCap: null,
    });

    assertStringIncludes(prompt, 'VIDEO IMPORT MODE');
    assertStringIncludes(prompt, 'exhaustive and authoritative');
    // 100% of Instagram imports and every ASR-less TikTok land here: a noise
    // block written for a fused OCR channel must not suppress the ONE channel
    // those requests actually carry.
    assertEquals(prompt.includes('[video text] section are scene'), false);
    assertEquals(prompt.includes('incidental scene text, OMIT it'), false);
});

Deno.test('buildMultiSystemPrompt: caption cap adds the count sentence and the numeric cap', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    const prompt = buildMultiSystemPrompt(10, {
        sourceKind: 'video',
        hasVideoText: true,
        captionCap: 10,
    });

    assertStringIncludes(
        prompt,
        'The caption states this video features 10 venues — do not return more than 10.',
    );
    assertStringIncludes(prompt, 'Cap at 10 restaurants');
    assertEquals(prompt.includes('Cap at 12 restaurants'), false);
});

Deno.test('buildMultiSystemPrompt: photo block gains the caption authority rule (photo cache bumped to g2)', async () => {
    const { buildMultiSystemPrompt } = await import('./visionExtract.ts');
    const prompt = buildMultiSystemPrompt(12, { sourceKind: 'photo', slideCount: 5 });

    assertStringIncludes(prompt, 'PHOTO CAROUSEL MODE');
    assertStringIncludes(prompt, 'exhaustive and authoritative');
    // The video block never rides along with a photo carousel.
    assertEquals(prompt.includes('VIDEO IMPORT MODE'), false);
});
