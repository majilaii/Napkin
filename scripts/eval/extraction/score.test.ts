/**
 * score.test.ts — TICKET-209: the eval harness's scoring rules + fixture schema.
 *
 * The live eval is ANTHROPIC_API_KEY-gated (paid). These tests cover the parts
 * that must be right BEFORE anyone spends money on a run: the fail_on_extras
 * plumbing, the context mapping, and that every checked-in fixture parses.
 *
 * Run with: deno test --allow-read scripts/eval/extraction/score.test.ts
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { ExtractedCandidate } from '../../../supabase/functions/_shared/visionExtract.ts';
import { type Fixture, scoreFixture, toExtractionContext } from './score.ts';

function candidate(name: string, stance?: ExtractedCandidate['stance']): ExtractedCandidate {
    return {
        name,
        city: 'San Sebastián',
        city_inferred: false,
        area: null,
        stance,
        cuisine: null,
        address: null,
        booking_url: null,
        hours: null,
        confidence: 'high',
        google_place_id: null,
    };
}

const BASE: Fixture = {
    name: 'unit',
    source_url: 'x',
    fused_text: '[caption]\n3 spots: A, B, C',
    cap: 3,
    expected: [{ name: 'Casa Urola' }, { name: 'Bar Txepetxa' }],
    min_recall: 1,
};

Deno.test('scoreFixture: full recall, no extras → pass', () => {
    const score = scoreFixture(BASE, [candidate('Casa Urola'), candidate('Bar Txepetxa')]);
    assertEquals(score.pass, true);
    assertEquals(score.recall, 1);
    assertEquals(score.extras.length, 0);
});

Deno.test('scoreFixture: an unpredicted extra PASSES without fail_on_extras (the old hole)', () => {
    const score = scoreFixture(BASE, [
        candidate('Casa Urola'),
        candidate('Bar Txepetxa'),
        candidate('Ganbara'), // hallucinated, not in `forbidden`
    ]);
    assertEquals(score.extras.map((e) => e.name), ['Ganbara']);
    assertEquals(score.violations.length, 0);
    assertEquals(score.pass, true);
});

Deno.test('scoreFixture: fail_on_extras turns the SAME extra into a violation', () => {
    const score = scoreFixture({ ...BASE, fail_on_extras: true }, [
        candidate('Casa Urola'),
        candidate('Bar Txepetxa'),
        candidate('Ganbara'),
    ]);
    assertEquals(score.violations.length, 1);
    assertEquals(score.violations[0].includes('Ganbara'), true);
    assertEquals(score.violations[0].includes('fail_on_extras'), true);
    assertEquals(score.pass, false);
});

Deno.test('scoreFixture: fail_on_extras never punishes expected/optional/forbidden names', () => {
    const fixture: Fixture = {
        ...BASE,
        fail_on_extras: true,
        optional: [{ name: 'Padella' }],
        forbidden: [{ name: 'Ganbara', why: 'signage', allow_if_warned: true }],
    };
    const score = scoreFixture(fixture, [
        candidate('Casa Urola'),
        candidate('Bar Txepetxa'),
        candidate('Padella'),
        candidate('Ganbara', 'warned'),
    ]);
    assertEquals(score.extras.length, 0);
    assertEquals(score.violations, []);
    assertEquals(score.pass, true);
});

Deno.test('scoreFixture: a named forbidden hit still fails without fail_on_extras', () => {
    const score = scoreFixture(
        { ...BASE, forbidden: [{ name: 'Ganbara', why: 'storefront signage' }] },
        [candidate('Casa Urola'), candidate('Bar Txepetxa'), candidate('Ganbara')],
    );
    assertEquals(score.pass, false);
    assertEquals(score.violations.length, 1);
});

Deno.test('scoreFixture: recall below min_recall fails even with zero violations', () => {
    const score = scoreFixture(BASE, [candidate('Casa Urola')]);
    assertEquals(score.recall, 0.5);
    assertEquals(score.violations, []);
    assertEquals(score.pass, false);
});

Deno.test('toExtractionContext: fixture wire shape → the extractor union', () => {
    assertEquals(toExtractionContext(undefined), undefined);
    assertEquals(
        toExtractionContext({ source_kind: 'video', has_video_text: false, caption_cap: 5 }),
        { sourceKind: 'video', hasVideoText: false, captionCap: 5 },
    );
    assertEquals(
        toExtractionContext({ source_kind: 'video' }),
        { sourceKind: 'video', hasVideoText: true, captionCap: null },
    );
    assertEquals(
        toExtractionContext({ source_kind: 'photo', slide_count: 4 }),
        { sourceKind: 'photo', slideCount: 4 },
    );
});

Deno.test('every checked-in fixture parses and satisfies the schema', async () => {
    const dir = new URL('./fixtures/', import.meta.url);
    const names: string[] = [];
    for await (const entry of Deno.readDir(dir)) {
        if (!entry.isFile || !entry.name.endsWith('.json')) continue;
        const fixture = JSON.parse(
            await Deno.readTextFile(new URL(entry.name, dir)),
        ) as Fixture;
        assertEquals(typeof fixture.name, 'string');
        assertEquals(typeof fixture.fused_text, 'string');
        assertEquals(Number.isInteger(fixture.cap) && fixture.cap > 0, true);
        assertEquals(Array.isArray(fixture.expected), true);
        assertEquals(fixture.min_recall >= 0 && fixture.min_recall <= 1, true);
        // The context, when present, must map cleanly (never silently dropped).
        if (fixture.context) assertEquals(!!toExtractionContext(fixture.context), true);
        // Scoring a fixture against its own expected names must pass — a typo in
        // `expected` (or a min_recall above what the list can reach) is caught
        // here rather than after a paid run.
        const selfScore = scoreFixture(
            fixture,
            fixture.expected.map((e) => candidate(e.name)),
        );
        assertEquals(selfScore.pass, true);
        names.push(fixture.name);
    }
    // TICKET-209 landed both regression fixtures.
    assertEquals(names.includes('topjaw-san-sebastian-caption'), true);
    assertEquals(names.includes('instagram-caption-only'), true);
});
