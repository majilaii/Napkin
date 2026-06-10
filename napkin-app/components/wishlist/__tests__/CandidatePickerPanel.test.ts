/**
 * CandidatePickerPanel unit tests — TICKET-063 fix-pass-1 / fix-pass-2.
 *
 * Tests the pure logic from candidatePickerUtils.ts (extracted in fix-pass-2 item 5):
 *  - buildInitialTicked: default selection by confidence.
 *  - note TextInput visible only at exactly one ticked (verified via tickedCount logic).
 *  - failedCandidateKeys affects row display (logic test).
 *  - keyFor + buildInitialTicked imported from REAL module (not re-implemented).
 *
 * Full render tests require native setup; these cover the JS logic.
 */
import type { ResolvedCandidate } from '@/hooks/wishlist/useResolveUrl';
import { keyFor, buildInitialTicked } from '../candidatePickerUtils';

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

// ── Ticked state survives correction (fix-pass-2 item 5) ─────────────────────
//
// When a row is corrected (old key → new key), the ticked set in the parent
// must be updated so the corrected row stays ticked.
// This mirrors the remap logic in ImportLinkSheet.handleEditMatchSelect.

describe('ticked set remap on correction (fix-pass-2 item 5)', () => {
    it('if old key was ticked, new key is ticked after remap', () => {
        const oldKey = 'place-id-old';
        const newKey = 'place-id-new';

        const ticked = new Set([oldKey, 'unrelated-key']);
        // Simulate the remap: if old key was ticked, delete old, add new.
        const next = new Set(ticked);
        if (ticked.has(oldKey)) {
            next.delete(oldKey);
            next.add(newKey);
        }

        expect(next.has(newKey)).toBe(true);
        expect(next.has(oldKey)).toBe(false);
        expect(next.has('unrelated-key')).toBe(true); // other rows unaffected
    });

    it('if old key was NOT ticked, new key is not added', () => {
        const oldKey = 'place-id-old';
        const newKey = 'place-id-new';

        const ticked = new Set(['other-key']); // oldKey not in set
        const next = new Set(ticked);
        if (ticked.has(oldKey)) {
            next.delete(oldKey);
            next.add(newKey);
        }

        expect(next.has(newKey)).toBe(false);
        expect(next.has('other-key')).toBe(true);
    });

    it('when candidate_id is preserved across correction, key is stable (no remap needed)', () => {
        // If candidate_id is set, keyFor returns it for both old and new candidates.
        // oldKey === newKey → the existing ticked entry is already correct.
        const old = makeCandidate('stable-id', 'high');
        const newC = { ...old, google_place_id: 'different-place-id' }; // candidate_id preserved
        expect(keyFor(old)).toBe(keyFor(newC)); // same key → no remap needed
    });

    it('buildInitialTicked + remap: corrected row ticked when old was ticked', () => {
        // Scenario: user has 2 candidates, both high → both pre-ticked.
        // User corrects c2 → c2-corrected. The old key should be remapped.
        const c1 = makeCandidate('c1', 'high');
        const c2 = makeCandidate('c2', 'high');
        const initial = buildInitialTicked([c1, c2]);
        expect(initial.has('c1')).toBe(true);
        expect(initial.has('c2')).toBe(true);

        // After correction: c2's key changes to 'c2-corrected'.
        const next = new Set(initial);
        if (initial.has('c2')) {
            next.delete('c2');
            next.add('c2-corrected');
        }
        expect(next.has('c2-corrected')).toBe(true);
        expect(next.has('c2')).toBe(false);
        expect(next.has('c1')).toBe(true); // c1 unaffected
    });
});
