import { collectOrphanedBlobUrls } from '../photoCleanup';

describe('collectOrphanedBlobUrls', () => {
    const slots = [
        { publicUrl: 'https://x/object/public/entry-photos/u/a.jpg' },
        { publicUrl: null }, // still uploading / failed — no blob to delete
        { publicUrl: 'https://x/object/public/entry-photos/u/b.jpg' },
    ];

    test('saved=true → deletes NOTHING (photos now owned by the entry)', () => {
        // The core regression guard: a successful save must not delete blobs.
        expect(collectOrphanedBlobUrls(slots, true)).toEqual([]);
    });

    test('saved=false → deletes only slots that actually uploaded a blob', () => {
        expect(collectOrphanedBlobUrls(slots, false)).toEqual([
            'https://x/object/public/entry-photos/u/a.jpg',
            'https://x/object/public/entry-photos/u/b.jpg',
        ]);
    });

    test('abandoned with no uploaded blobs → empty', () => {
        expect(collectOrphanedBlobUrls([{ publicUrl: null }], false)).toEqual([]);
    });

    test('empty photo list → empty regardless of saved flag', () => {
        expect(collectOrphanedBlobUrls([], false)).toEqual([]);
        expect(collectOrphanedBlobUrls([], true)).toEqual([]);
    });

    test('saved=true short-circuits even when blobs are present', () => {
        const allUploaded = [
            { publicUrl: 'https://x/object/public/entry-photos/u/c.jpg' },
        ];
        expect(collectOrphanedBlobUrls(allUploaded, true)).toEqual([]);
    });
});
