/**
 * statsLine unit tests — TICKET-144 part 1 profile counts line.
 *
 * Pins the load-bearing rules:
 *  - order is meals · following · followers
 *  - singular/plural on meals + follower ("1 meal" / "1 follower"); "following"
 *    is invariant
 *  - a null count is OMITTED (withheld), never rendered as a lying 0
 *  - only follower/following are tappable
 */
import { profileStatSegments } from '../statsLine';

describe('profileStatSegments', () => {
    it('renders the full line in order with plurals', () => {
        expect(profileStatSegments({ meals: 26, following: 6, followers: 3 })).toEqual([
            { key: 'meals', text: '26 meals', tappable: false },
            { key: 'following', text: '6 following', tappable: true },
            { key: 'followers', text: '3 followers', tappable: true },
        ]);
    });

    it('uses singular for exactly one', () => {
        const segs = profileStatSegments({ meals: 1, following: 1, followers: 1 });
        expect(segs.map((s) => s.text)).toEqual(['1 meal', '1 following', '1 follower']);
    });

    it('keeps zero counts (a real 0 is truthful) but shows the plural word', () => {
        const segs = profileStatSegments({ meals: 0, following: 0, followers: 0 });
        expect(segs.map((s) => s.text)).toEqual(['0 meals', '0 following', '0 followers']);
    });

    it('omits a null (withheld) count rather than showing 0', () => {
        expect(profileStatSegments({ meals: null, following: 6, followers: 1 })).toEqual([
            { key: 'following', text: '6 following', tappable: true },
            { key: 'followers', text: '1 follower', tappable: true },
        ]);
    });

    it('omits every null → empty (nothing to render)', () => {
        expect(profileStatSegments({ meals: null, following: null, followers: null })).toEqual([]);
    });

    it('marks only follower/following tappable', () => {
        const segs = profileStatSegments({ meals: 10, following: 2, followers: 4 });
        expect(segs.find((s) => s.key === 'meals')?.tappable).toBe(false);
        expect(segs.find((s) => s.key === 'following')?.tappable).toBe(true);
        expect(segs.find((s) => s.key === 'followers')?.tappable).toBe(true);
    });
});
