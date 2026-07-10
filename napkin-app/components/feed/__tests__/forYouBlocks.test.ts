/**
 * TICKET-125 — For You block composition, pure so the "everything empty" answer
 * and block ordering are verified, not eyeballed (mirrors railMode.test.ts).
 *
 * Rule: fixed order public_lists → trending → people; only visible blocks are
 * included; all-false ⇒ [] (⇒ For You empty fallback).
 */
import { visibleForYouBlocks, type ForYouFlags } from '../forYouBlocks';

const NONE: ForYouFlags = {
    hasPublicLists: false,
    railVisible: false,
    hasCoDiners: false,
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
            }),
        ).toEqual(['public_lists', 'trending', 'people']);
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

    it('order is stable regardless of which subset is on (people + public_lists)', () => {
        // Flags supplied "out of order" — output must still be public_lists first.
        expect(types({ ...NONE, hasCoDiners: true, hasPublicLists: true })).toEqual([
            'public_lists',
            'people',
        ]);
    });

    it('trending + public_lists (authored lists lead the feed)', () => {
        expect(types({ ...NONE, railVisible: true, hasPublicLists: true })).toEqual([
            'public_lists',
            'trending',
        ]);
    });

    it('trending + people', () => {
        expect(types({ ...NONE, railVisible: true, hasCoDiners: true })).toEqual([
            'trending',
            'people',
        ]);
    });

    it('every flag combination yields a subset in canonical order', () => {
        const ORDER = ['public_lists', 'trending', 'people'];
        for (let mask = 0; mask < 8; mask++) {
            const flags: ForYouFlags = {
                hasPublicLists: !!(mask & 1),
                railVisible: !!(mask & 2),
                hasCoDiners: !!(mask & 4),
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
            ].filter(Boolean).length;
            expect(out).toHaveLength(trueCount);
        }
    });
});
