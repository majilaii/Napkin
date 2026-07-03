/**
 * Tests for candidateDedupe.ts — the pure logic around the LLM extraction
 * stage (TICKET-086c). These run in the pre-commit deno pass; the LLM stage
 * itself is covered by scripts/eval/extraction (needs ANTHROPIC_API_KEY).
 *
 * Run with: deno test supabase/functions/_shared/candidateDedupe.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { dedupeAndRank, mergeExtracted, namesOverlap, normalizeName } from './candidateDedupe.ts';
import type { ExtractedCandidate } from './visionExtract.ts';

function cand(over: Partial<ExtractedCandidate>): ExtractedCandidate {
    return {
        name: null,
        city: null,
        city_inferred: false,
        area: null,
        cuisine: null,
        address: null,
        booking_url: null,
        hours: null,
        confidence: 'high',
        google_place_id: null,
        ...over,
    };
}

// ── containment fold: token-boundary, not substring ──────────────────────────

Deno.test('substring accident: "Ria" does NOT fold into "Osteria"', () => {
    const staged = dedupeAndRank(
        [cand({ name: 'Osteria', city: 'London' }), cand({ name: 'Ria', city: 'London' })],
        [],
        12,
    );
    assertEquals(staged.length, 2);
});

Deno.test('token containment: "Berenjak" folds into "Berenjak Soho"', () => {
    const staged = dedupeAndRank(
        [cand({ name: 'Berenjak Soho', city: 'London' }), cand({ name: 'Berenjak', city: 'London' })],
        [],
        12,
    );
    assertEquals(staged.length, 1);
});

Deno.test('containment fold requires compatible cities', () => {
    const staged = dedupeAndRank(
        [cand({ name: 'Berenjak Soho', city: 'London' }), cand({ name: 'Berenjak', city: 'Paris' })],
        [],
        12,
    );
    assertEquals(staged.length, 2);
});

Deno.test('containment fold allows one absent city', () => {
    const staged = dedupeAndRank(
        [cand({ name: 'Prince of Peckham Pub', city: 'London' }), cand({ name: 'Prince of Peckham', city: null })],
        [],
        12,
    );
    assertEquals(staged.length, 1);
});

// ── merge keeps 086b/086c fields ──────────────────────────────────────────────

Deno.test('merge carries area (was silently dropped pre-086c)', () => {
    const merged = mergeExtracted(
        cand({ name: 'Cinder', area: null }),
        cand({ name: 'Cinder', area: 'Belsize Park' }),
    );
    assertEquals(merged.area, 'Belsize Park');
});

Deno.test('warned stance survives any merge direction', () => {
    const a = cand({ name: 'Bob Bob Ricard', stance: 'warned' });
    const b = cand({ name: 'Bob Bob Ricard Soho', stance: 'recommended' });
    assertEquals(mergeExtracted(a, b).stance, 'warned');
    assertEquals(mergeExtracted(b, a).stance, 'warned');
});

Deno.test('warned stance survives dedupeAndRank fold', () => {
    const staged = dedupeAndRank(
        [
            cand({ name: 'Bob Bob Ricard Soho', city: 'London', stance: 'recommended' }),
            cand({ name: 'Bob Bob Ricard', city: 'London', stance: 'warned' }),
        ],
        [],
        12,
    );
    assertEquals(staged.length, 1);
    assertEquals(staged[0].extracted.stance, 'warned');
});

// ── cap + rank ────────────────────────────────────────────────────────────────

Deno.test('cap honored; high confidence ranks above low', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
        cand({ name: `Spot ${i}`, city: 'London', confidence: i % 2 === 0 ? 'high' : 'low' }));
    const staged = dedupeAndRank(many, [], 12);
    assertEquals(staged.length, 12);
    assertEquals(staged[0].extracted.confidence, 'high');
});

// ── namesOverlap (Places similarity gate) ─────────────────────────────────────

Deno.test('namesOverlap: unrelated popular place rejected', () => {
    assert(!namesOverlap('Guinness Market', 'Borough Kitchen'));
    assert(!namesOverlap('Picante', 'Dishoom Covent Garden'));
});

Deno.test('namesOverlap: legit partial matches accepted', () => {
    assert(namesOverlap('Lanzhou Lamian Noodle Bar', 'Lanzhou Lamian'));
    assert(namesOverlap('The Roof Gardens', 'Roof Gardens Kensington'));
    assert(namesOverlap("Juliet's Quality Foods", 'Juliets Quality Foods Tooting'));
});

Deno.test('namesOverlap: generic-token-only names stay lenient', () => {
    // Nothing distinctive to gate on — allow rather than ghost a legit match.
    assert(namesOverlap('The Restaurant', 'Totally Different Name'));
});

Deno.test('normalizeName strips punctuation and diacritics', () => {
    assertEquals(normalizeName("Juliet's  Café"), 'juliet s cafe');
});
