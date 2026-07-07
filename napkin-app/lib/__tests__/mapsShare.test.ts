import { isMapsShareUrl } from '../mapsShare';

describe('isMapsShareUrl', () => {
    it('matches every maps share-link family the server treats as google_maps', () => {
        expect(isMapsShareUrl('https://maps.app.goo.gl/yMEXGo9h9PAqKQfZ6')).toBe(true);
        expect(isMapsShareUrl('https://goo.gl/maps/AbC123')).toBe(true);
        expect(isMapsShareUrl('https://maps.google.com/?q=dishoom')).toBe(true);
        expect(isMapsShareUrl('https://www.google.com/maps/place/Dishoom/@51.5,-0.1,17z')).toBe(true);
        expect(isMapsShareUrl('https://google.com/maps/placelists/list/abc')).toBe(true);
    });

    it('is host-anchored — no substring false positives', () => {
        expect(isMapsShareUrl('https://notgoogle.company/maps/best-nyc')).toBe(false);
        expect(isMapsShareUrl('https://example.com/r?next=https://maps.google.com/x')).toBe(false);
        expect(isMapsShareUrl('https://www.google.com/search?q=maps')).toBe(false);
        expect(isMapsShareUrl('https://shakeshack.com/')).toBe(false);
    });

    it('degrades on junk input', () => {
        expect(isMapsShareUrl('not a url')).toBe(false);
        expect(isMapsShareUrl(null)).toBe(false);
        expect(isMapsShareUrl(undefined)).toBe(false);
    });
});
