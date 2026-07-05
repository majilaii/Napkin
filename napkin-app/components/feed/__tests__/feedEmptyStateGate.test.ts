/**
 * TICKET-101 — feed empty-state tier resolution, pure so it's unit-testable
 * without pulling the component's expo-router import into jest (mirrors
 * trendingRailGate.test.ts).
 *
 * Binary rule: ≥1 candidate → tier 1 (up to 3 cards); else tier 2. No hybrid.
 */
import { resolveEmptyState, MAX_CODINER_CARDS } from '../feedEmptyStateGate';
import type { CoDinerCandidate } from '@/hooks/feed/useCoDiners';

function candidate(n: number): CoDinerCandidate {
    return {
        user_id: `u-${n}`,
        display_name: `Diner ${n}`,
        avatar_url: null,
        meals_together: 10 - n, // pre-sorted desc as the server returns them
    };
}

describe('resolveEmptyState', () => {
    it('MAX_CODINER_CARDS is 3', () => {
        expect(MAX_CODINER_CARDS).toBe(3);
    });

    it('undefined → tier 2 (no candidates loaded)', () => {
        expect(resolveEmptyState(undefined)).toEqual({ tier: 2 });
    });

    it('empty array → tier 2 (true solo user)', () => {
        expect(resolveEmptyState([])).toEqual({ tier: 2 });
    });

    it('1 candidate → tier 1 with 1 card (no "almost tier 2")', () => {
        const res = resolveEmptyState([candidate(1)]);
        expect(res.tier).toBe(1);
        if (res.tier === 1) {
            expect(res.cards).toHaveLength(1);
            expect(res.cards[0].user_id).toBe('u-1');
        }
    });

    it('2 candidates → tier 1 with 2 cards', () => {
        const res = resolveEmptyState([candidate(1), candidate(2)]);
        expect(res.tier).toBe(1);
        if (res.tier === 1) expect(res.cards).toHaveLength(2);
    });

    it('exactly 3 candidates → tier 1 with 3 cards', () => {
        const res = resolveEmptyState([candidate(1), candidate(2), candidate(3)]);
        expect(res.tier).toBe(1);
        if (res.tier === 1) expect(res.cards).toHaveLength(3);
    });

    it('≥4 candidates → tier 1 capped at 3, order preserved', () => {
        const many = Array.from({ length: 7 }, (_, i) => candidate(i + 1));
        const res = resolveEmptyState(many);
        expect(res.tier).toBe(1);
        if (res.tier === 1) {
            expect(res.cards).toHaveLength(3);
            // server ranks; client never re-sorts — first 3 in order
            expect(res.cards.map((c) => c.user_id)).toEqual(['u-1', 'u-2', 'u-3']);
        }
    });
});
