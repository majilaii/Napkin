/**
 * TICKET-125 → TICKET-189 — For You block composition, pure so the "everything
 * empty" answer and block ordering are verified, not eyeballed.
 *
 * Rule: fixed order on_socials → public_lists → people; only visible blocks
 * are included; all-false ⇒ [] (⇒ the §6 whole-surface branch in ForYouFeed).
 * Trending is GONE from the roster (§5).
 */
import { visibleForYouBlocks, type ForYouFlags } from '../forYouBlocks';

const NONE: ForYouFlags = {
    hasSocials: false,
    hasPublicLists: false,
    hasPeople: false,
};

function types(flags: ForYouFlags): string[] {
    return visibleForYouBlocks(flags).map((b) => b._type);
}

describe('visibleForYouBlocks', () => {
    it('all-false ⇒ [] (drives the §6 spinner/retry/invite branch)', () => {
        expect(visibleForYouBlocks(NONE)).toEqual([]);
    });

    it('all-true ⇒ every block in fixed order', () => {
        expect(
            types({
                hasSocials: true,
                hasPublicLists: true,
                hasPeople: true,
            }),
        ).toEqual(['on_socials', 'public_lists', 'people']);
    });

    it('socials only', () => {
        expect(types({ ...NONE, hasSocials: true })).toEqual(['on_socials']);
    });

    it('public lists only', () => {
        expect(types({ ...NONE, hasPublicLists: true })).toEqual(['public_lists']);
    });

    it('people only', () => {
        expect(types({ ...NONE, hasPeople: true })).toEqual(['people']);
    });

    it('order is stable regardless of which subset is on (people + socials)', () => {
        expect(types({ ...NONE, hasPeople: true, hasSocials: true })).toEqual([
            'on_socials',
            'people',
        ]);
    });

    it('socials leads lists (community momentum before authored curation)', () => {
        expect(types({ ...NONE, hasSocials: true, hasPublicLists: true })).toEqual([
            'on_socials',
            'public_lists',
        ]);
    });

    it('lists + people', () => {
        expect(types({ ...NONE, hasPublicLists: true, hasPeople: true })).toEqual([
            'public_lists',
            'people',
        ]);
    });

    it('trending never appears in the roster (§5 — merged into socials)', () => {
        for (let mask = 0; mask < 8; mask++) {
            const out = types({
                hasSocials: !!(mask & 1),
                hasPublicLists: !!(mask & 2),
                hasPeople: !!(mask & 4),
            });
            expect(out).not.toContain('trending');
        }
    });

    it('every flag combination yields a subset in canonical order', () => {
        const ORDER = ['on_socials', 'public_lists', 'people'];
        for (let mask = 0; mask < 8; mask++) {
            const flags: ForYouFlags = {
                hasSocials: !!(mask & 1),
                hasPublicLists: !!(mask & 2),
                hasPeople: !!(mask & 4),
            };
            const out = types(flags);
            // Result is always a subsequence of the canonical order.
            const indices = out.map((t) => ORDER.indexOf(t));
            const sorted = [...indices].sort((a, b) => a - b);
            expect(indices).toEqual(sorted);
            // And has exactly as many entries as true flags.
            const trueCount = [
                flags.hasSocials,
                flags.hasPublicLists,
                flags.hasPeople,
            ].filter(Boolean).length;
            expect(out).toHaveLength(trueCount);
        }
    });
});
