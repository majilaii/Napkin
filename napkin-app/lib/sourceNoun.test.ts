/**
 * sourceNoun unit tests — TICKET-079.
 *
 * Covers the source→noun mapping (loading/empty/picker copy) and the URL-host
 * inference used before the resolver returns a source_type.
 */
import { sourceNoun, nounFromUrl } from './sourceNoun';

// ── sourceNoun(source_type) ───────────────────────────────────────────────────

describe('sourceNoun — by resolved source_type', () => {
    it('tiktok → video', () => {
        expect(sourceNoun('tiktok')).toBe('video');
    });

    it('instagram → post', () => {
        expect(sourceNoun('instagram')).toBe('post');
    });

    it('google_maps → map', () => {
        expect(sourceNoun('google_maps')).toBe('map');
    });

    it('reddit → post', () => {
        expect(sourceNoun('reddit')).toBe('post');
    });

    it('substack → page', () => {
        expect(sourceNoun('substack')).toBe('page');
    });

    it('web → page', () => {
        expect(sourceNoun('web')).toBe('page');
    });

    it('screenshot → screenshot', () => {
        expect(sourceNoun('screenshot')).toBe('screenshot');
    });

    it('vision → screenshot (image path may surface as vision)', () => {
        expect(sourceNoun('vision')).toBe('screenshot');
    });

    it('source_type takes precedence over url', () => {
        // Even with a tiktok url, an explicit google_maps type wins.
        expect(sourceNoun('google_maps', 'https://www.tiktok.com/@x/video/1')).toBe('map');
    });
});

// ── sourceNoun fallback (loading, before resolvedData) ────────────────────────

describe('sourceNoun — unknown type falls back to URL inference', () => {
    it('null type + tiktok url → video', () => {
        expect(sourceNoun(null, 'https://www.tiktok.com/@x/video/1')).toBe('video');
    });

    it('undefined type + maps url → map', () => {
        expect(sourceNoun(undefined, 'https://maps.app.goo.gl/abc')).toBe('map');
    });

    it('null type + reddit url → post', () => {
        expect(sourceNoun(null, 'https://www.reddit.com/r/FoodNYC/comments/abc')).toBe('post');
    });

    it('null type + substack url → page', () => {
        expect(sourceNoun(null, 'https://someone.substack.com/p/best-tacos')).toBe('page');
    });

    it('null type + no url → link', () => {
        expect(sourceNoun(null)).toBe('link');
    });

    it('unrecognized source_type string + no url → link', () => {
        expect(sourceNoun('something-new')).toBe('link');
    });

    it('unrecognized source_type string + url → infers from url', () => {
        expect(sourceNoun('something-new', 'https://www.instagram.com/p/abc')).toBe('post');
    });
});

// ── nounFromUrl ───────────────────────────────────────────────────────────────

describe('nounFromUrl — host inference', () => {
    it('www.tiktok.com → video', () => {
        expect(nounFromUrl('https://www.tiktok.com/@x/video/1')).toBe('video');
    });

    it('vm.tiktok.com short link → video', () => {
        expect(nounFromUrl('https://vm.tiktok.com/ZMabc/')).toBe('video');
    });

    it('maps.app.goo.gl → map', () => {
        expect(nounFromUrl('https://maps.app.goo.gl/abc')).toBe('map');
    });

    it('www.google.com/maps → map', () => {
        expect(nounFromUrl('https://www.google.com/maps/place/Carbone')).toBe('map');
    });

    it('instagram.com → post', () => {
        expect(nounFromUrl('https://www.instagram.com/p/abc')).toBe('post');
    });

    it('reddit.com → post', () => {
        expect(nounFromUrl('https://www.reddit.com/r/FoodNYC/comments/abc')).toBe('post');
    });

    it('old.reddit.com (subdomain) → post', () => {
        expect(nounFromUrl('https://old.reddit.com/r/FoodNYC/comments/abc')).toBe('post');
    });

    it('redd.it short link → post', () => {
        expect(nounFromUrl('https://redd.it/abc')).toBe('post');
    });

    it('substack.com → page', () => {
        expect(nounFromUrl('https://substack.com/inbox')).toBe('page');
    });

    it('custom.substack.com (subdomain) → page', () => {
        expect(nounFromUrl('https://someone.substack.com/p/best-tacos')).toBe('page');
    });

    it('unknown host → link', () => {
        expect(nounFromUrl('https://example.com/blog/restaurants')).toBe('link');
    });

    it('garbage / non-url → link', () => {
        expect(nounFromUrl('not a url')).toBe('link');
    });
});
