/**
 * plateGlyphFor unit tests (TICKET-191) — the strict three-glyph plate
 * allowlist. Anything outside tiktok / instagram / google_maps must return
 * null (pure-type card), never the banned generic download glyph.
 */
import { plateGlyphFor } from '../importsStripUtils';

describe('plateGlyphFor', () => {
    it('maps tiktok to the tiktok glyph', () => {
        expect(plateGlyphFor({ type: 'tiktok', url: 'https://www.tiktok.com/@a/video/1' })).toBe('logo-tiktok');
        // Persisted tiktok rows may carry no url — type alone is enough.
        expect(plateGlyphFor({ type: 'tiktok' })).toBe('logo-tiktok');
    });

    it('maps an instagram web source (IG-host url) to the instagram glyph', () => {
        expect(plateGlyphFor({ type: 'web', url: 'https://www.instagram.com/reel/DGaQ0R0sbQ0/' })).toBe('logo-instagram');
        expect(plateGlyphFor({ type: 'web', url: 'https://instagram.com/p/abc123/' })).toBe('logo-instagram');
    });

    it('maps google_maps to the map glyph', () => {
        expect(plateGlyphFor({ type: 'google_maps', url: 'https://maps.app.goo.gl/xyz' })).toBe('map-outline');
    });

    it('returns null for every non-allowlisted variant', () => {
        expect(plateGlyphFor({ type: 'web', url: 'https://example.com/best-restaurants' })).toBeNull();
        expect(plateGlyphFor({ type: 'web' })).toBeNull(); // web without a url can't prove IG
        expect(plateGlyphFor({ type: 'video' })).toBeNull();
        expect(plateGlyphFor({ type: 'screenshot' })).toBeNull();
        expect(plateGlyphFor({ type: 'vision' })).toBeNull();
        expect(plateGlyphFor({ type: 'handoff' })).toBeNull();
        expect(plateGlyphFor({ type: 'something-new' })).toBeNull();
        expect(plateGlyphFor({})).toBeNull();
        expect(plateGlyphFor(null)).toBeNull();
        expect(plateGlyphFor(undefined)).toBeNull();
    });
});
