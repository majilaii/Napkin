import { evaluateFastPath, isContentGate, type FastPathCandidate } from '../importFastPath';
// The server's caption-count detector — imported directly so the fast-path
// impact of TICKET-209's widened pattern is proven, not assumed.
import { detectListMarker } from '../../../supabase/functions/_shared/listicle';

// A fast-path-ELIGIBLE candidate: resolved to a real Place, high confidence,
// recommended. Every gate test flips exactly one field so the FIRST failure is
// the gate under test (the evaluator short-circuits on the first failure).
function ok(overrides: Partial<FastPathCandidate> = {}): FastPathCandidate {
    return {
        restaurant_id: 'r1',
        restaurant: { external_id: 'ext1' },
        confidence: 'high',
        stance: 'recommended',
        ...overrides,
    };
}

describe('evaluateFastPath — gates in order', () => {
    it('old_server: list_count_raw absent (undefined) → escalate [structural]', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok()],
                listCountRaw: undefined,
                transcriptChars: 200,
            }),
        ).toBe('old_server');
    });

    it('no_candidates: cheap tier returned nothing → escalate', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [],
                listCountRaw: null,
                transcriptChars: 200,
            }),
        ).toBe('no_candidates');
    });

    it('count_short: fewer candidates than the caption advertised (number) → escalate', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok(), ok()], // 2
                listCountRaw: 3, //          advertised 3
                transcriptChars: 200,
            }),
        ).toBe('count_short');
    });

    it('count_short does NOT fire when list_count_raw is null (no marker → gate passes)', () => {
        // Single candidate, no advertised count → the count gate is a no-op and
        // the import passes (proves null ≠ 0-with-teeth). Single because TikTok
        // multi always escalates post-175.
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok()],
                listCountRaw: null,
                transcriptChars: 200,
            }),
        ).toBe('pass');
    });

    it('ghost: a candidate never resolved to a real Place → escalate [content]', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok(), ok({ restaurant_id: null, restaurant: { external_id: null } })],
                listCountRaw: null,
                transcriptChars: 200,
            }),
        ).toBe('ghost');
    });

    it('ghost tolerates a verified restaurant_id even when external_id is null', () => {
        // restaurant_id present (verified DB row) ⇒ resolved, not a ghost.
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok({ restaurant_id: 'r9', restaurant: { external_id: null } })],
                listCountRaw: null,
                transcriptChars: 200,
            }),
        ).toBe('pass');
    });

    it('low_conf: a candidate resolved at low confidence → escalate [content]', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok({ confidence: 'low' })],
                listCountRaw: null,
                transcriptChars: 200,
            }),
        ).toBe('low_conf');
    });

    it('stance: a neutral (comparison / passing mention) candidate → escalate [content]', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok({ stance: 'neutral' })],
                listCountRaw: null,
                transcriptChars: 200,
            }),
        ).toBe('stance');
    });

    it('stance: a warned (anti-recommendation) candidate → escalate (never auto-saves)', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok({ stance: 'warned' })],
                listCountRaw: null,
                transcriptChars: 200,
            }),
        ).toBe('stance');
    });

    it('stance: a missing stance → escalate [content]', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok({ stance: undefined })],
                listCountRaw: null,
                transcriptChars: 200,
            }),
        ).toBe('stance');
    });
});

describe('evaluateFastPath — ASR / ambiguity gate', () => {
    it('TikTok: short transcript (<80) + multi-candidate → no_asr_ambiguous [structural]', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok(), ok()],
                listCountRaw: null,
                transcriptChars: 40,
            }),
        ).toBe('no_asr_ambiguous');
    });

    it('TikTok: short transcript but a SINGLE candidate → pass', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok()],
                listCountRaw: null,
                transcriptChars: 0,
            }),
        ).toBe('pass');
    });

    it('TikTok: multi-candidate ALWAYS escalates — even with a real voiceover (TICKET-175)', () => {
        // Haiku's 'high' confidence does not catch ASR garbles ("Tishun",
        // "Elmersym", "Lockdown Bakery" all rated high in prod, 2026-07-11) —
        // multi-spot TikToks must earn the fused OCR pass.
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok(), ok(), ok()],
                listCountRaw: null,
                transcriptChars: 4000,
            }),
        ).toBe('no_asr_ambiguous');
    });

    it('Instagram: multi-candidate with NO caption list marker → no_asr_ambiguous', () => {
        expect(
            evaluateFastPath({
                provider: 'instagram',
                candidates: [ok(), ok()],
                listCountRaw: null, // no marker (IG has no platform ASR)
                transcriptChars: 0,
            }),
        ).toBe('no_asr_ambiguous');
    });

    it('Instagram: multi-candidate with a FULLY SATISFIED caption marker → pass', () => {
        expect(
            evaluateFastPath({
                provider: 'instagram',
                candidates: [ok(), ok()],
                listCountRaw: 2, // caption advertised 2, we have 2
                transcriptChars: 0,
            }),
        ).toBe('pass');
    });

    it('Instagram: a single candidate → pass (no marker needed)', () => {
        expect(
            evaluateFastPath({
                provider: 'instagram',
                candidates: [ok()],
                listCountRaw: null,
                transcriptChars: 0,
            }),
        ).toBe('pass');
    });
});

describe('evaluateFastPath — all-pass', () => {
    it('TikTok single confident recommended spot, no marker → pass (the Moor Hall case)', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok()],
                listCountRaw: null,
                transcriptChars: 0,
            }),
        ).toBe('pass');
    });

    it('TikTok full listicle: even count-met + voiceover escalates (TICKET-175 — ASR garbles)', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok(), ok(), ok()],
                listCountRaw: 3,
                transcriptChars: 500,
            }),
        ).toBe('no_asr_ambiguous');
    });
});

describe('isContentGate — R3 content vs structural classification', () => {
    it('classifies content-reason gates (feed the no-new-evidence guard)', () => {
        expect(isContentGate('count_short')).toBe(true);
        expect(isContentGate('ghost')).toBe(true);
        expect(isContentGate('low_conf')).toBe(true);
        expect(isContentGate('stance')).toBe(true);
    });

    it('classifies structural / non-content gates as NOT content', () => {
        expect(isContentGate('old_server')).toBe(false);
        expect(isContentGate('no_asr_ambiguous')).toBe(false);
        expect(isContentGate('no_candidates')).toBe(false);
        expect(isContentGate('pass')).toBe(false);
        // The hook's "cheap tier never ran" sentinel is not a content reason either.
        expect(isContentGate('no_cheap_tier')).toBe(false);
        // Nor is a failed cheap-tier call (review-1 Codex-4: it fails OPEN into
        // the ladder and must never review-hold on its own).
        expect(isContentGate('cheap_error')).toBe(false);
    });
});

// ── TICKET-209 fast-path impact ──────────────────────────────────────────────
// detectListMarker now counts captions whose digit sits up to four words from
// the list-noun. Those captions previously produced list_count_raw = null (the
// count gate was a no-op) and could fast-path; they now advertise a real count,
// so a short cheap tier escalates instead. That is the CORRECT direction — the
// cost is one extra ladder run per such import. evaluateFastPath's gates are
// deliberately untouched (TICKET-164/175 remain locked).

describe('evaluateFastPath — newly countable captions (TICKET-209)', () => {
    const REPRO_CAPTION =
        '10 San Sebastián food spots that I LOVED last weekend: Casa Urola Bar ' +
        'Txepetxa La Cuchara de San Telmo Akerbetlz Bar Sport El Patio de Simona ' +
        'Casa Julián Gabarron Antonio Taberna';

    it('the founder repro caption now advertises 10 → a 1-candidate cheap tier escalates', () => {
        const listCountRaw = detectListMarker(REPRO_CAPTION).countRaw;
        expect(listCountRaw).toBe(10);
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok()],
                listCountRaw,
                transcriptChars: 900,
            }),
        ).toBe('count_short');
    });

    it('"7 underrated Lisbon restaurants" on Instagram: short cheap tier escalates', () => {
        const listCountRaw = detectListMarker(
            '7 underrated Lisbon restaurants the tourists always walk past',
        ).countRaw;
        expect(listCountRaw).toBe(7);
        expect(
            evaluateFastPath({
                provider: 'instagram',
                candidates: [ok(), ok(), ok()],
                listCountRaw,
                transcriptChars: 0,
            }),
        ).toBe('count_short');
    });

    it('a duration caption stays uncounted → the count gate remains a no-op', () => {
        const listCountRaw = detectListMarker('24 hours in NYC: best bites, no filler').countRaw;
        expect(listCountRaw).toBeNull();
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok()],
                listCountRaw,
                transcriptChars: 0,
            }),
        ).toBe('pass');
    });

    it('a fully satisfied caption count still passes on Instagram (TICKET-164 gate intact)', () => {
        const listCountRaw = detectListMarker(
            '3 natural wine spots in Bermondsey worth the trek',
        ).countRaw;
        expect(listCountRaw).toBe(3);
        expect(
            evaluateFastPath({
                provider: 'instagram',
                candidates: [ok(), ok(), ok()],
                listCountRaw,
                transcriptChars: 0,
            }),
        ).toBe('pass');
    });
});
