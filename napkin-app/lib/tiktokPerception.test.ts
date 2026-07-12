/**
 * tiktokPerception URL-shape tests (TICKET-175). The photo-mode detector runs
 * on the RESOLVED page URL — this exact assumption silently killed photo-list
 * imports once (they died as "couldn't find spots" with zero prod trace), so
 * the pure mapping gets pinned here.
 */
import { extractSlideUrls, isTikTokPhotoUrl, isTikTokUrl } from './tiktokPerception';

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

describe('extractSlideUrls', () => {
    // Shape mirrors the real blob: imagePost.images[].imageURL.urlList[0]. The
    // extraction was verified against the founder-repro photo list (9 slides,
    // 6 name-bearing) before build — this pins the pure mapping.
    const slide = (url: string) => ({ imageURL: { urlList: [url] } });

    it('pulls the first urlList entry from each image, in order', () => {
        const item = {
            imagePost: {
                images: [slide('https://cdn/a.jpg'), slide('https://cdn/b.jpg')],
            },
        };
        expect(extractSlideUrls(item)).toEqual(['https://cdn/a.jpg', 'https://cdn/b.jpg']);
    });

    it('takes only the FIRST url per image (urlList carries mirrors)', () => {
        const item = {
            imagePost: {
                images: [{ imageURL: { urlList: ['https://cdn/a.jpg', 'https://mirror/a.jpg'] } }],
            },
        };
        expect(extractSlideUrls(item)).toEqual(['https://cdn/a.jpg']);
    });

    it('caps at 12 slides even when the list is longer', () => {
        const item = {
            imagePost: {
                images: Array.from({ length: 30 }, (_, i) => slide(`https://cdn/${i}.jpg`)),
            },
        };
        const urls = extractSlideUrls(item);
        expect(urls).toHaveLength(12);
        expect(urls[0]).toBe('https://cdn/0.jpg');
        expect(urls[11]).toBe('https://cdn/11.jpg');
    });

    it('drops non-http and shape-missing entries without throwing', () => {
        const item = {
            imagePost: {
                images: [
                    slide('https://cdn/ok.jpg'),
                    { imageURL: { urlList: ['data:image/png;base64,zzz'] } }, // non-http
                    { imageURL: {} }, // no urlList
                    {}, // no imageURL
                    null, // no image
                ],
            },
        };
        expect(extractSlideUrls(item)).toEqual(['https://cdn/ok.jpg']);
    });

    it('returns [] for a missing/blank/non-photo itemStruct (degrade, never throw)', () => {
        expect(extractSlideUrls(null)).toEqual([]);
        expect(extractSlideUrls(undefined)).toEqual([]);
        expect(extractSlideUrls({})).toEqual([]);
        expect(extractSlideUrls({ imagePost: {} })).toEqual([]);
        expect(extractSlideUrls({ imagePost: { images: 'nope' } })).toEqual([]);
    });
});
