/**
 * TICKET-125 — For You block composition, pure so the "everything empty" answer
 * and block ordering are verified, not eyeballed (mirrors railMode.test.ts).
 *
 * Rule (TICKET-130 Gazette mix order): fixed order trending → public_lists →
 * people → discovery; only visible blocks are included; all-false ⇒ [] (⇒ For
 * You empty fallback).
 */
import { visibleForYouBlocks, type ForYouFlags } from '../forYouBlocks';

const NONE: ForYouFlags = {
    hasPublicLists: false,
    railVisible: false,
    hasCoDiners: false,
    hasDiscovery: false,
};

function types(flags: ForYouFlags): string[] {
    return visibleForYouBlocks(flags).map((b) => b._type);
}

describe('visibleForYouBlocks', () => {
    it('all-false ⇒ [] (drives the For You empty fallback)', () => {
        expect(visibleForYouBlocks(NONE)).toEqual([]);
    });

    it('all-true ⇒ every block in fixed order', () => {
        expect(
            types({
                hasPublicLists: true,
                railVisible: true,
                hasCoDiners: true,
                hasDiscovery: true,
            }),
        ).toEqual(['trending', 'public_lists', 'people', 'discovery']);
    });

    it('public lists only', () => {
        expect(types({ ...NONE, hasPublicLists: true })).toEqual(['public_lists']);
    });

    it('trending only', () => {
        expect(types({ ...NONE, railVisible: true })).toEqual(['trending']);
    });

    it('people only', () => {
        expect(types({ ...NONE, hasCoDiners: true })).toEqual(['people']);
    });

    it('discovery only', () => {
        expect(types({ ...NONE, hasDiscovery: true })).toEqual(['discovery']);
    });

    it('order is stable regardless of which subset is on (people + public_lists)', () => {
        // Flags supplied "out of order" — output must still be public_lists first.
        expect(types({ ...NONE, hasCoDiners: true, hasPublicLists: true })).toEqual([
            'public_lists',
            'people',
        ]);
    });

    it('trending + public_lists (trending leads the Gazette mix)', () => {
        expect(types({ ...NONE, railVisible: true, hasPublicLists: true })).toEqual([
            'trending',
            'public_lists',
        ]);
    });

    it('trending + people (rail owns discovery, so no discovery block)', () => {
        expect(types({ ...NONE, railVisible: true, hasCoDiners: true })).toEqual([
            'trending',
            'people',
        ]);
    });

    it('public_lists + discovery (rail hidden path)', () => {
        expect(types({ ...NONE, hasPublicLists: true, hasDiscovery: true })).toEqual([
            'public_lists',
            'discovery',
        ]);
    });

    it('every flag combination yields a subset in canonical order', () => {
        const ORDER = ['trending', 'public_lists', 'people', 'discovery'];
        for (let mask = 0; mask < 16; mask++) {
            const flags: ForYouFlags = {
                hasPublicLists: !!(mask & 1),
                railVisible: !!(mask & 2),
                hasCoDiners: !!(mask & 4),
                hasDiscovery: !!(mask & 8),
            };
            const out = types(flags);
            // Result is always a subsequence of the canonical order.
            const indices = out.map((t) => ORDER.indexOf(t));
            const sorted = [...indices].sort((a, b) => a - b);
            expect(indices).toEqual(sorted);
            // And has exactly as many entries as true flags.
            const trueCount = [
                flags.hasPublicLists,
                flags.railVisible,
                flags.hasCoDiners,
                flags.hasDiscovery,
            ].filter(Boolean).length;
            expect(out).toHaveLength(trueCount);
        }
    });
});
