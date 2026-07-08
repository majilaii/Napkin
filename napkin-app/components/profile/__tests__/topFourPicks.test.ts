/**
 * TICKET-144 pt2 — the write-path consent contract. The client may send ONLY
 * position · restaurant_id · hero_entry_photo_id; preview-only fields (name,
 * hero_photo_url) must never leave the client. Publish = send the photo id;
 * un-publish = send null.
 */
import { toProfileTopFourPicks } from '../topFourPicks';

describe('toProfileTopFourPicks — consent contract', () => {
    it('positions filled slots 1..n in order', () => {
        const picks = toProfileTopFourPicks([
            { restaurant_id: 'a', hero_entry_photo_id: null },
            { restaurant_id: 'b', hero_entry_photo_id: null },
            { restaurant_id: 'c', hero_entry_photo_id: null },
        ]);
        expect(picks.map((p) => p.position)).toEqual([1, 2, 3]);
        expect(picks.map((p) => p.restaurant_id)).toEqual(['a', 'b', 'c']);
    });

    it('sends the hero id when a slot has one (publish), null when it does not (un-publish)', () => {
        const picks = toProfileTopFourPicks([
            { restaurant_id: 'a', hero_entry_photo_id: 'photo-1' },
            { restaurant_id: 'b', hero_entry_photo_id: null },
        ]);
        expect(picks[0].hero_entry_photo_id).toBe('photo-1');
        expect(picks[1].hero_entry_photo_id).toBeNull();
    });

    it('never leaks preview-only fields — each pick has EXACTLY the 3 allowed keys', () => {
        // Deliberately hand a slot that also carries name / hero_photo_url; the
        // builder must drop them (they are consent-irrelevant to the server).
        const picks = toProfileTopFourPicks([
            { restaurant_id: 'a', hero_entry_photo_id: 'photo-1', name: 'Dorian', hero_photo_url: 'https://cdn/x.jpg' } as never,
        ]);
        expect(Object.keys(picks[0]).sort()).toEqual(['hero_entry_photo_id', 'position', 'restaurant_id']);
    });

    it('empty slots → empty payload (clears the override / reverts to auto-derive)', () => {
        expect(toProfileTopFourPicks([])).toEqual([]);
    });
});
