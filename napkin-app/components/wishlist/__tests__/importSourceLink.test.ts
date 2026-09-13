import { importSourceLink } from '../importSourceLink';

describe('importSourceLink', () => {
    it.each([
        ['tiktok', 'https://vm.tiktok.com/example/', 'open TikTok'],
        ['tiktok', 'https://www.tiktok.com/@creator/photo/123', 'open TikTok'],
        ['web', 'https://www.instagram.com/p/123/', 'open Instagram'],
        ['web', 'http://example.com/article', 'open source'],
        ['google_maps', 'https://maps.app.goo.gl/example', 'open Google Maps'],
    ])('opens %s originals with platform copy', (type, url, label) => {
        expect(importSourceLink({ type, url: `  ${url}  ` })).toEqual({ url, label });
    });

    it.each([
        { type: 'tiktok', url: 'javascript:alert(1)' },
        { type: 'tiktok', url: 'https://tiktok.com.evil.example/123' },
        { type: 'tiktok', url: 'https://tiktok.com@evil.example/123' },
        { type: 'web', url: 'https://user:password@example.com' },
        { type: 'web', url: 'http://127.0.0.1/private' },
        { type: 'web', url: 'not a url' },
        { type: 'video', url: 'https://example.com/video.mp4' },
        { type: 'screenshot', url: 'https://example.com/image.jpg' },
    ])('rejects unsafe or non-original source %p', (source) => {
        expect(importSourceLink(source)).toBeNull();
    });
});
