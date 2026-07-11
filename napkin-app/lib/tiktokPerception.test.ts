/**
 * tiktokPerception URL-shape tests (TICKET-175). The photo-mode detector runs
 * on the RESOLVED page URL — this exact assumption silently killed photo-list
 * imports once (they died as "couldn't find spots" with zero prod trace), so
 * the pure mapping gets pinned here.
 */
import { isTikTokPhotoUrl, isTikTokUrl } from './tiktokPerception';

describe('isTikTokPhotoUrl', () => {
    it('true for resolved photo-mode permalinks', () => {
        expect(isTikTokPhotoUrl('https://www.tiktok.com/@user/photo/7412345678901234567')).toBe(true);
        expect(isTikTokPhotoUrl('https://www.tiktok.com/@user/photo/74123?_r=1&_t=abc')).toBe(true);
    });

    it('false for video permalinks and share links', () => {
        expect(isTikTokPhotoUrl('https://www.tiktok.com/@topjaw/video/7634953283194326294')).toBe(false);
        expect(isTikTokPhotoUrl('https://vm.tiktok.com/ZNRoJxFpH/')).toBe(false);
    });

    it('false for null/undefined/empty (Response.url can be empty on odd stacks)', () => {
        expect(isTikTokPhotoUrl(null)).toBe(false);
        expect(isTikTokPhotoUrl(undefined)).toBe(false);
        expect(isTikTokPhotoUrl('')).toBe(false);
    });
});

describe('isTikTokUrl', () => {
    it('matches any tiktok.com url incl. photo posts and vm share links', () => {
        expect(isTikTokUrl('https://vm.tiktok.com/ZNRoJxFpH/')).toBe(true);
        expect(isTikTokUrl('https://www.tiktok.com/@user/photo/741')).toBe(true);
        expect(isTikTokUrl('https://instagram.com/reel/x')).toBe(false);
    });
});
