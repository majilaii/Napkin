/**
 * Tests for the initialUrl logic in ImportLinkSheet.
 *
 * Full render tests for ImportLinkSheet require a native-capable environment
 * (react-native's Modal, Animated, etc.) that is not available in the node
 * Jest environment. These tests cover the underlying URL-validation logic that
 * the initialUrl effect relies on — ensuring the same validateUrl() call used
 * by the paste step is the one that gates the deep-link path.
 */
import { validateUrl } from '@/lib/urlValidation';

describe('validateUrl — the gate for ImportLinkSheet initialUrl', () => {
    // Valid URLs that should jump straight to 'loading'.
    it.each([
        'https://www.eater.com/nyc',
        'http://nytimes.com/dining',
        'https://tiktok.com/@user/video/123',
        'https://maps.google.com/?q=restaurant',
    ])('accepts valid http(s) URL: %s', (url) => {
        expect(validateUrl(url).ok).toBe(true);
    });

    // Invalid URLs that should route to 'error' panel, never reach the resolver.
    it.each([
        '',
        'not-a-url',
        'ftp://example.com',
        'napkin://import?url=bad',
        '   ',
    ])('rejects non-http(s) or malformed: %s', (url) => {
        expect(validateUrl(url.trim()).ok).toBe(false);
    });

    it('rejects oversized strings (> 2048 chars)', () => {
        // Max length is 2048. Build a URL that is exactly 2049 chars.
        const longUrl = 'https://example.com/' + 'a'.repeat(2029); // 20 + 2029 = 2049
        expect(longUrl.length).toBe(2049);
        expect(validateUrl(longUrl).ok).toBe(false);
    });
});
