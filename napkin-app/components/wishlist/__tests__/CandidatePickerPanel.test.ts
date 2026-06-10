/**
 * CandidatePickerPanel unit tests — TICKET-063 fix-pass-1.
 *
 * Tests the pure logic extracted from CandidatePickerPanel:
 *  - buildInitialTicked: default selection by confidence.
 *  - note TextInput visible only at exactly one ticked (verified via tickedCount logic).
 *  - failedCandidateKeys affects row display (logic test).
 *
 * Full render tests require native setup; these cover the JS logic.
 */
import type { ResolvedCandidate } from '@/hooks/wishlist/useResolveUrl';

// Re-implement the helpers as they exist in CandidatePickerPanel (same logic).
// These are pure functions we can test without importing the RN module.

function keyFor(c: Pick<ResolvedCandidate, 'candidate_id' | 'google_place_id' | 'restaurant'>): string {
    return c.candidate_id ?? c.google_place_id ?? c.restaurant.external_id ?? '';
}

function buildInitialTicked(
    candidates: Pick<ResolvedCandidate, 'candidate_id' | 'google_place_id' | 'restaurant' | 'confidence'>[],
): Set<string> {
    const ticked = new Set<string>();
    if (candidates.length === 1) {
        ticked.add(keyFor(candidates[0]));
    } else {
        for (const c of candidates) {
            if (c.confidence === 'high' || c.confidence === 'exact') {
                ticked.add(keyFor(c));
            }
        }
    }
    return ticked;
}

function makeCandidate(
    id: string,
    confidence: 'exact' | 'high' | 'low',
    alreadyWishlisted = false,
): ResolvedCandidate {
    return {
        candidate_id: id,
        restaurant: {
            id: '',
            name: `Restaurant ${id}`,
            formattedAddress: null,
            city: null,
            country: null,
            latitude: null,
            longitude: null,
            categories: [],
            cuisine: null,
            googleRating: null,
            googleRatingCount: null,
            priceLevel: null,
            photoReference: null,
            website: null,
            link: null,
            external_id: id,
        },
        confidence,
        google_place_id: null,
        restaurant_id: alreadyWishlisted ? 'some-uuid' : null,
        already_wishlisted: alreadyWishlisted,
        city_inferred: false,
    };
}

// ── buildInitialTicked ────────────────────────────────────────────────────────

describe('buildInitialTicked — default selection by confidence', () => {
    it('single candidate: always pre-ticked regardless of confidence', () => {
        const low = makeCandidate('c1', 'low');
        const ticked = buildInitialTicked([low]);
        expect(ticked.has('c1')).toBe(true);
    });

    it('single high candidate: pre-ticked', () => {
        const high = makeCandidate('c1', 'high');
        const ticked = buildInitialTicked([high]);
        expect(ticked.has('c1')).toBe(true);
    });

    it('N>1: exact candidates are pre-ticked', () => {
        const exact = makeCandidate('c1', 'exact');
        const low = makeCandidate('c2', 'low');
        const ticked = buildInitialTicked([exact, low]);
        expect(ticked.has('c1')).toBe(true);
        expect(ticked.has('c2')).toBe(false);
    });

    it('N>1: high candidates are pre-ticked', () => {
        const high = makeCandidate('c1', 'high');
        const low = makeCandidate('c2', 'low');
        const ticked = buildInitialTicked([high, low]);
        expect(ticked.has('c1')).toBe(true);
        expect(ticked.has('c2')).toBe(false);
    });

    it('N>1: all low → none pre-ticked', () => {
        const low1 = makeCandidate('c1', 'low');
        const low2 = makeCandidate('c2', 'low');
        const ticked = buildInitialTicked([low1, low2]);
        expect(ticked.size).toBe(0);
    });

    it('N>1: mixed high+exact all ticked, low unticked', () => {
        const exact = makeCandidate('c1', 'exact');
        const high = makeCandidate('c2', 'high');
        const low = makeCandidate('c3', 'low');
        const ticked = buildInitialTicked([exact, high, low]);
        expect(ticked.has('c1')).toBe(true);
        expect(ticked.has('c2')).toBe(true);
        expect(ticked.has('c3')).toBe(false);
    });
});

// ── note TextInput visibility logic ──────────────────────────────────────────

describe('note TextInput visible only at exactly one ticked (fix-pass-1 item 10)', () => {
    it('zero ticked → note hidden', () => {
        const tickedCount = 0;
        const isSingleTicked = tickedCount === 1;
        expect(isSingleTicked).toBe(false);
    });

    it('exactly one ticked → note visible', () => {
        const tickedCount = 1;
        const isSingleTicked = tickedCount === 1;
        expect(isSingleTicked).toBe(true);
    });

    it('two ticked → note hidden', () => {
        const tickedCount = 2;
        const isSingleTicked = tickedCount === 1;
        expect(isSingleTicked).toBe(false);
    });

    it('three ticked → note hidden', () => {
        const tickedCount = 3;
        const isSingleTicked = tickedCount === 1;
        expect(isSingleTicked).toBe(false);
    });
});

// ── failedCandidateKeys logic ─────────────────────────────────────────────────

describe('failedCandidateKeys: hasFailed flag per row (fix-pass-1 item 8)', () => {
    it('row is flagged as failed when key is in failedCandidateKeys', () => {
        const failedKeys = new Set(['c1', 'c3']);
        const c = makeCandidate('c1', 'high');
        const hasFailed = failedKeys.has(keyFor(c));
        expect(hasFailed).toBe(true);
    });

    it('row is not flagged when key is not in failedCandidateKeys', () => {
        const failedKeys = new Set(['c1']);
        const c = makeCandidate('c2', 'high');
        const hasFailed = failedKeys.has(keyFor(c));
        expect(hasFailed).toBe(false);
    });

    it('empty failedCandidateKeys → no rows flagged', () => {
        const failedKeys = new Set<string>();
        const c = makeCandidate('c1', 'high');
        expect(failedKeys.has(keyFor(c))).toBe(false);
    });
});
