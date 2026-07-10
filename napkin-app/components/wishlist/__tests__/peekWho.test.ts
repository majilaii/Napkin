/**
 * peekWho unit tests — TICKET-140 peek who-row contract.
 *
 * Pins the load-bearing rules:
 *  - a followee log (entryId) → network variant; name + tap target = author;
 *    "+N others" pluralizes and only appears when othersCount > 0
 *  - a single-member save (overlap.count === 1) → saved-by variant; name + tap
 *    target = that member (the row reads "saved by «Name»")
 *  - 2+ members (overlap.count >= 2) → flat "N of you saved this", no tap target
 *  - missing ids degrade to a non-tappable row (tapUserId: null), never crash
 */
import { describePeekWho, networkOthersSuffix } from '../peekWho';

describe('networkOthersSuffix', () => {
    it('is empty for 0 / negative / undefined', () => {
        expect(networkOthersSuffix(0)).toBe('');
        expect(networkOthersSuffix(-1)).toBe('');
        // @ts-expect-error — guard against undefined callers
        expect(networkOthersSuffix(undefined)).toBe('');
    });

    it('uses the singular for exactly one other', () => {
        expect(networkOthersSuffix(1)).toBe('  +1 other');
    });

    it('uses the plural for two or more', () => {
        expect(networkOthersSuffix(2)).toBe('  +2 others');
        expect(networkOthersSuffix(9)).toBe('  +9 others');
    });
});

describe('describePeekWho — network (followee log)', () => {
    it('reports the author name + tap target, no others suffix', () => {
        expect(
            describePeekWho({ entryId: 'e1', author: { id: 'u1', name: 'Jacky' } }),
        ).toEqual({ variant: 'network', name: 'Jacky', othersSuffix: '', tapUserId: 'u1' });
    });

    it('adds a pluralized others suffix', () => {
        expect(
            describePeekWho({
                entryId: 'e1',
                author: { id: 'u1', name: 'Jacky' },
                othersCount: 3,
            }),
        ).toEqual({ variant: 'network', name: 'Jacky', othersSuffix: '  +3 others', tapUserId: 'u1' });
    });

    it('falls back to "Someone" and a null tap target when the author is missing', () => {
        expect(describePeekWho({ entryId: 'e1' })).toEqual({
            variant: 'network',
            name: 'Someone',
            othersSuffix: '',
            tapUserId: null,
        });
    });
});

describe('describePeekWho — overlap (table saves)', () => {
    it('reads "saved by «Name»" with a tap target for a single-member save', () => {
        expect(
            describePeekWho({
                overlap: {
                    count: 1,
                    members: [{ user_id: 'u2', display_name: 'Clara' }],
                },
            }),
        ).toEqual({ variant: 'saved-by', name: 'Clara', tapUserId: 'u2' });
    });

    it('is a flat "N of you saved this" (no tap) for 2+ members', () => {
        expect(
            describePeekWho({
                overlap: {
                    count: 3,
                    members: [
                        { user_id: 'a', display_name: 'A' },
                        { user_id: 'b', display_name: 'B' },
                    ],
                },
            }),
        ).toEqual({ variant: 'overlap-many', label: '3 of you saved this' });
    });

    it('degrades a single save with no member to Someone / null tap', () => {
        expect(describePeekWho({ overlap: { count: 1, members: [] } })).toEqual({
            variant: 'saved-by',
            name: 'Someone',
            tapUserId: null,
        });
    });
});

describe('describePeekWho — none', () => {
    it('is the none variant for a plain been/mine item (no entryId/overlap)', () => {
        expect(describePeekWho({})).toEqual({ variant: 'none' });
    });

    it('prefers the network variant when both entryId and overlap somehow coexist', () => {
        const who = describePeekWho({
            entryId: 'e1',
            author: { id: 'u1', name: 'Jacky' },
            overlap: { count: 2, members: [] },
        });
        expect(who.variant).toBe('network');
    });
});
