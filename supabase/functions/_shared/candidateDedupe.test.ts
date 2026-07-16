/**
 * Tests for candidateDedupe.ts — the pure logic around the LLM extraction
 * stage (TICKET-086c). These run in the pre-commit deno pass; the LLM stage
 * itself is covered by scripts/eval/extraction (needs ANTHROPIC_API_KEY).
 *
 * Run with: deno test supabase/functions/_shared/candidateDedupe.test.ts
 */

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    classifyInteractiveCandidate,
    dedupeAndRank,
    mergeExtracted,
    namesOverlap,
    normalizeName,
    scoreDeferredCandidates,
    tokenJaccard,
} from './candidateDedupe.ts';
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

Deno.test('namesOverlap: CJK names (normalize to empty) stay lenient', () => {
    // \w is ASCII-only, so 兰州拉面 normalizes to '' — gating on it would
    // ghost EVERY CJK-named candidate. No signal → trust Places.
    assert(namesOverlap('兰州拉面', 'Lanzhou Lamian Noodle Bar'));
});

Deno.test('normalizeName strips punctuation and diacritics', () => {
    assertEquals(normalizeName("Juliet's  Café"), 'juliet s cafe');
});

// ── TICKET-177: localityConsistent ───────────────────────────────────────────
import { localityConsistent } from './candidateDedupe.ts';

Deno.test('localityConsistent: wrong-town exact-name match is rejected (Cartouche/Kartuli repro)', () => {
    // Extraction said London; Places returned Cartouche in Hertford.
    assertEquals(
        localityConsistent(
            { city: 'London', area: null },
            { city: 'Hertford', formattedAddress: '2 Bull Plain, Hertford SG14 1DT, UK' },
        ),
        false,
    );
});

Deno.test('localityConsistent: matching city passes; area token in address passes', () => {
    assertEquals(
        localityConsistent(
            { city: 'London', area: null },
            { city: 'London', formattedAddress: '20 Lordship Ln, London SE22, UK' },
        ),
        true,
    );
    assertEquals(
        localityConsistent(
            { city: null, area: 'East Dulwich' },
            { city: 'London', formattedAddress: '20 Lordship Ln, East Dulwich, London SE22' },
        ),
        true,
    );
    // ANY extracted locality overlapping is enough (city wrong-ish, area right).
    assertEquals(
        localityConsistent(
            { city: 'Bristol', area: 'East Dulwich' },
            { city: 'London', formattedAddress: 'East Dulwich, London SE22' },
        ),
        true,
    );
});

Deno.test('localityConsistent: lenient when either side has no locality signal', () => {
    assertEquals(localityConsistent({ city: null, area: null }, { city: 'Hertford', formattedAddress: 'x' }), true);
    assertEquals(localityConsistent({ city: 'London', area: null }, { city: null, formattedAddress: null }), true);
    // CJK-only city normalizes to '' → no signal → lenient (mirrors namesOverlap).
    assertEquals(localityConsistent({ city: '東京', area: null }, { city: 'Hertford', formattedAddress: 'x' }), true);
});

Deno.test('localityConsistent: documented outer-borough trade-off — pinned against drift', () => {
    // Extracted city "London" vs an outer-borough postal-town address that omits
    // "London" → false-ghost BY DESIGN (visible + fixable beats silently wrong).
    // If this assertion ever needs flipping, re-read the TICKET-177 trade first.
    assertEquals(
        localityConsistent(
            { city: 'London', area: null },
            { city: 'Croydon', formattedAddress: '12 High St, Croydon CR0 1GT, UK' },
        ),
        false,
    );
});

Deno.test('interactive resolver preserves no-result, name, and locality gate decisions', () => {
    const extracted = { name: 'Kartuli', city: 'London', area: 'East Dulwich' };
    assertEquals(classifyInteractiveCandidate(extracted, null), 'no_result');
    assertEquals(
        classifyInteractiveCandidate(extracted, {
            name: 'Borough Kitchen',
            city: 'London',
            formattedAddress: 'London, UK',
        }),
        'name_reject',
    );
    assertEquals(
        classifyInteractiveCandidate(extracted, {
            name: 'Kartuli',
            city: 'Hertford',
            formattedAddress: '2 Bull Plain, Hertford SG14, UK',
        }),
        'locality_reject',
    );
    assertEquals(
        classifyInteractiveCandidate(extracted, {
            name: 'Kartuli',
            city: 'London',
            formattedAddress: 'East Dulwich, London, UK',
        }),
        'matched',
    );
});

// ── TICKET-195: strict deferred scorer ───────────────────────────────────────

Deno.test('tokenJaccard uses normalized token sets and pins the inclusive 0.85 threshold', () => {
    const common = Array.from({ length: 17 }, (_, index) => `token${index}`);
    const extracted = [...common, 'leftone', 'lefttwo'].join(' ');
    const returned = [...common, 'rightone'].join(' ');
    assertEquals(tokenJaccard(extracted, returned), 0.85);

    const result = scoreDeferredCandidates(
        { name: extracted, city: 'London' },
        [{
            externalId: 'place-threshold',
            name: returned,
            city: 'London',
            formattedAddress: 'London, UK',
        }],
    );
    assertEquals(result.decision, 'matched');
    assertEquals(result.match?.externalId, 'place-threshold');
});

Deno.test('deferred scorer rejects the Kartuli → Cartouche regression by Jaccard', () => {
    const result = scoreDeferredCandidates(
        { name: 'Kartuli', city: 'London' },
        [{
            externalId: 'cartouche-hertford',
            name: 'Cartouche',
            city: 'Hertford',
            formattedAddress: '2 Bull Plain, Hertford SG14, UK',
        }],
    );
    assertEquals(result.decision, 'name_reject');
    assertEquals(result.match, null);
    assert(result.scores[0].nameScore < 0.85);
});

Deno.test('deferred scorer requires an extracted city and a provider city signal', () => {
    const candidate = {
        externalId: 'place-kartuli',
        name: 'Kartuli',
        city: null,
        formattedAddress: null,
    };
    assertEquals(
        scoreDeferredCandidates({ name: 'Kartuli', city: 'London' }, [candidate]).decision,
        'locality_reject',
    );
    assertEquals(
        scoreDeferredCandidates(
            { name: 'Kartuli', city: null },
            [{ ...candidate, city: 'London', formattedAddress: 'London, UK' }],
        ).decision,
        'locality_reject',
    );
});

Deno.test('deferred city check does not confuse a street token for structured locality', () => {
    const result = scoreDeferredCandidates(
        { name: 'Kartuli', city: 'London' },
        [{
            externalId: 'place-hertford',
            name: 'Kartuli',
            city: 'Hertford',
            formattedAddress: '12 London Road, Hertford SG13, UK',
        }],
    );
    assertEquals(result.decision, 'locality_reject');
});

Deno.test('deferred scorer rejects a top-two gap below 0.1 as ambiguous', () => {
    const result = scoreDeferredCandidates(
        { name: 'the blue room london bridge', city: 'London' },
        [
            {
                externalId: 'place-a',
                name: 'The Blue Room London Bridge',
                city: 'London',
                formattedAddress: 'London, UK',
            },
            {
                externalId: 'place-b',
                name: 'The Blue Room London Bridge',
                city: 'London',
                formattedAddress: 'London, UK',
            },
        ],
    );
    assertEquals(result.decision, 'ambiguous');
    assertEquals(result.match, null);
});
