import { evaluateFastPath, isContentGate, type FastPathCandidate } from '../importFastPath';

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
        // 2 candidates, no advertised count, real voiceover → the count gate is a
        // no-op and the import passes (proves null ≠ 0-with-teeth).
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok(), ok()],
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

    it('TikTok: a real voiceover (>=80 chars) carries a multi-candidate → pass', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok(), ok(), ok()],
                listCountRaw: null,
                transcriptChars: 80,
            }),
        ).toBe('pass');
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

    it('TikTok full listicle: count met + real voiceover + all resolved high/recommended → pass', () => {
        expect(
            evaluateFastPath({
                provider: 'tiktok',
                candidates: [ok(), ok(), ok()],
                listCountRaw: 3,
                transcriptChars: 500,
            }),
        ).toBe('pass');
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
    });
});
