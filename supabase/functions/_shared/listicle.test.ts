/**
 * Tests for listicle.ts — detectListMarker.
 * TICKET-063 Step 1.
 *
 * Run with: deno test supabase/functions/_shared/listicle.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { detectListMarker } from './listicle.ts';

// ── isList=false cases ────────────────────────────────────────────────────────

Deno.test('plain caption → not a listicle', () => {
    const result = detectListMarker('We went to Nobu last night — incredible omakase');
    assertEquals(result.isList, false);
    assertEquals(result.count, null);
});

Deno.test('empty string → not a listicle', () => {
    const result = detectListMarker('');
    assertEquals(result.isList, false);
    assertEquals(result.count, null);
});

Deno.test('non-string value → not a listicle', () => {
    const result = detectListMarker(null as any);
    assertEquals(result.isList, false);
    assertEquals(result.count, null);
});

Deno.test('"top tier" phrase → does NOT trigger listicle (no digit)', () => {
    const result = detectListMarker('top tier ramen in Shibuya');
    // "top tier" should NOT match because there's no digit after "top"
    assertEquals(result.isList, false);
});

// ── "top N" pattern ───────────────────────────────────────────────────────────

Deno.test('"top 5 restaurants" → isList=true, count=5', () => {
    const result = detectListMarker('top 5 restaurants in Soho');
    assertEquals(result.isList, true);
    assertEquals(result.count, 5);
});

Deno.test('"Top 3 spots" (title-case) → isList=true, count=3', () => {
    const result = detectListMarker('Top 3 spots you must visit this summer');
    assertEquals(result.isList, true);
    assertEquals(result.count, 3);
});

Deno.test('"TOP 10 PLACES" (all-caps) → isList=true, count clamped to 6', () => {
    const result = detectListMarker('TOP 10 PLACES TO EAT');
    assertEquals(result.isList, true);
    assertEquals(result.count, 6);  // clamped at 6
});

Deno.test('"top 1" → isList=true, count=1 (lower bound)', () => {
    const result = detectListMarker('top 1 ramen in Tokyo');
    assertEquals(result.isList, true);
    assertEquals(result.count, 1);
});

Deno.test('"top 50" → isList=true, count clamped to 6', () => {
    const result = detectListMarker('my top 50 list');
    assertEquals(result.isList, true);
    assertEquals(result.count, 6);
});

// ── "N best/spots/places" pattern ─────────────────────────────────────────────

Deno.test('"5 best spots" → isList=true, count=5', () => {
    const result = detectListMarker('5 best spots for brunch in Brooklyn');
    assertEquals(result.isList, true);
    assertEquals(result.count, 5);
});

Deno.test('"3 places" → isList=true, count=3', () => {
    const result = detectListMarker('3 places you need to try in Lisbon');
    assertEquals(result.isList, true);
    assertEquals(result.count, 3);
});

Deno.test('"4 restaurants" → isList=true, count=4', () => {
    const result = detectListMarker('4 restaurants I always recommend to visitors');
    assertEquals(result.isList, true);
    assertEquals(result.count, 4);
});

Deno.test('"2 must try" → isList=true, count=2', () => {
    const result = detectListMarker('2 must try ramen shops in Shinjuku');
    assertEquals(result.isList, true);
    assertEquals(result.count, 2);
});

Deno.test('"6 favourites" → isList=true, count=6', () => {
    const result = detectListMarker('my 6 favourites from this trip');
    assertEquals(result.isList, true);
    assertEquals(result.count, 6);
});

// ── Numbered lines pattern ────────────────────────────────────────────────────

Deno.test('2 numbered lines → isList=true, count=2', () => {
    const text = '1. Nobu\n2. Zuma';
    const result = detectListMarker(text);
    assertEquals(result.isList, true);
    assertEquals(result.count, 2);
});

Deno.test('3 numbered lines → isList=true, count=3', () => {
    const text = '1. Nobu\n2. Zuma\n3. Hakassan';
    const result = detectListMarker(text);
    assertEquals(result.isList, true);
    assertEquals(result.count, 3);
});

Deno.test('7 numbered lines → isList=true, count clamped to 6', () => {
    const lines = [1, 2, 3, 4, 5, 6, 7].map((n) => `${n}. Restaurant ${n}`).join('\n');
    const result = detectListMarker(lines);
    assertEquals(result.isList, true);
    assertEquals(result.count, 6);
});

Deno.test('only 1 numbered line → not a listicle', () => {
    const result = detectListMarker('1. Nobu\nsome other text without a number');
    assertEquals(result.isList, false);
});

Deno.test('numbered lines with ) separator → isList=true', () => {
    const text = '1) Great Wall\n2) Hakka Palace';
    const result = detectListMarker(text);
    assertEquals(result.isList, true);
    assertEquals(result.count, 2);
});

// ── countRaw (TICKET-164) — UNCLAMPED total for the fast-path count gate ───────

Deno.test('countRaw is null when count is null (no marker)', () => {
    const result = detectListMarker('We went to Nobu last night — incredible omakase');
    assertEquals(result.count, null);
    assertEquals(result.countRaw, null);
});

Deno.test('"top 12" → count clamps to 6, countRaw stays 12 (under-gate a 12-spot list)', () => {
    const result = detectListMarker('top 12 restaurants in London');
    assertEquals(result.count, 6);
    assertEquals(result.countRaw, 12);
});

Deno.test('"top 5" → count and countRaw agree below the clamp', () => {
    const result = detectListMarker('top 5 restaurants in Soho');
    assertEquals(result.count, 5);
    assertEquals(result.countRaw, 5);
});

Deno.test('"8 best spots" → countRaw=8 (unclamped), count=6', () => {
    const result = detectListMarker('8 best spots for brunch in Brooklyn');
    assertEquals(result.count, 6);
    assertEquals(result.countRaw, 8);
});

Deno.test('7 numbered lines → count clamps to 6, countRaw=7', () => {
    const lines = [1, 2, 3, 4, 5, 6, 7].map((n) => `${n}. Restaurant ${n}`).join('\n');
    const result = detectListMarker(lines);
    assertEquals(result.count, 6);
    assertEquals(result.countRaw, 7);
});

// ── TICKET-209 Decision D — gapped "N … list-noun" + measure guards ───────────
// Full realistic captions, not fragments: the founder repro is an enumerated
// caption whose digit sits three words away from the list-noun.

Deno.test('repro caption (@topjaw San Sebastián) → isList=true, countRaw=10', () => {
    const result = detectListMarker(
        '10 San Sebastián food spots that I LOVED last weekend: Casa Urola Bar ' +
            'Txepetxa La Cuchara de San Telmo Akerbetlz Bar Sport El Patio de ' +
            'Simona Casa Julián Gabarron Antonio Taberna',
    );
    assertEquals(result.isList, true);
    assertEquals(result.countRaw, 10);
    assertEquals(result.count, 6); // legacy clamp untouched
});

Deno.test('"7 underrated Lisbon restaurants" → countRaw=7 (2-word gap)', () => {
    const result = detectListMarker(
        '7 underrated Lisbon restaurants the tourists always walk straight past',
    );
    assertEquals(result.isList, true);
    assertEquals(result.countRaw, 7);
});

Deno.test('duration caption "3 days in Lisbon: the spots I ate" → null', () => {
    const result = detectListMarker('3 days in Lisbon: the spots I ate my way through');
    assertEquals(result.isList, false);
    assertEquals(result.countRaw, null);
});

Deno.test('duration caption "2 days in Rome — best pasta" → null', () => {
    const result = detectListMarker('2 days in Rome — best pasta of my life honestly');
    assertEquals(result.isList, false);
    assertEquals(result.countRaw, null);
});

Deno.test('"24 hours in NYC: best bites" → null (a duration, not a count)', () => {
    const result = detectListMarker('24 hours in NYC: best bites, no filler');
    assertEquals(result.isList, false);
    assertEquals(result.countRaw, null);
});

Deno.test('"3 days of spots" → null (unit token adjacent to the digit)', () => {
    const result = detectListMarker('3 days of spots in Copenhagen, all walkable');
    assertEquals(result.isList, false);
    assertEquals(result.countRaw, null);
});

Deno.test('currency-prefixed digit "£10 spots in London" → null', () => {
    const result = detectListMarker('£10 spots in London that still feel special');
    assertEquals(result.isList, false);
    assertEquals(result.countRaw, null);
});

Deno.test('mixed caption "24 hours in NYC: 8 spots you need" → countRaw=8 (kept scanning)', () => {
    const result = detectListMarker('24 hours in NYC: 8 spots you need to eat at');
    assertEquals(result.isList, true);
    assertEquals(result.countRaw, 8);
});

Deno.test('mixed caption "12 hours of eating — 7 spots" → countRaw=7 (kept scanning)', () => {
    const result = detectListMarker('12 hours of eating in Paris — 7 spots, one day');
    assertEquals(result.isList, true);
    assertEquals(result.countRaw, 7);
});

Deno.test('measure reject does not null a later valid marker after a price', () => {
    const result = detectListMarker('£20 spots? nah. 5 best places under a tenner');
    assertEquals(result.isList, true);
    assertEquals(result.countRaw, 5);
});
