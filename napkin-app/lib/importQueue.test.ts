/**
 * importQueue readAll round-trip tests (TICKET-180).
 *
 * The load-bearing correctness point of the ticket: readAll rebuilds each manifest
 * field-by-field from untrusted JSON, so any field NOT parsed there is silently
 * dropped the instant a setter (`setImportMode` at review-confirm) rewrites the file
 * from a re-read manifest — exactly the listCount / largeJob trap. These tests pin
 * that the three new fields (sourceThumbUrl / sourceHandle / stage) survive both a
 * fresh parse AND a setter rewrite.
 *
 * The native App-Group file ops are mocked with an in-memory Map so readAll /
 * writeManifest actually persist (the real module throws off-device → readAll → []).
 */
jest.mock('@/modules/media-extract', () => {
    const store = new Map<string, string>();
    return {
        listImportManifests: () => Array.from(store.values()),
        writeImportManifest: (jobId: string, json: string) => {
            store.set(jobId, json);
            return true;
        },
        removeImportManifest: (jobId: string) => {
            store.delete(jobId);
            return true;
        },
        setSharedDefault: () => true,
        __store: store,
    };
});

import * as mediaExtract from '@/modules/media-extract';
import {
    getImport,
    setImportMode,
    setImportSource,
    setImportSpots,
    setImportStage,
    setImportDestinations,
    effectivePinWishlist,
    type ImportManifest,
} from './importQueue';

const store = (mediaExtract as unknown as { __store: Map<string, string> }).__store;

function seedManifest(partial: Partial<ImportManifest> & { jobId: string }): void {
    const base: ImportManifest = {
        kind: 'url',
        url: 'https://www.tiktok.com/@topjaw/video/1',
        importNonce: 'nonce-1',
        createdAt: 1,
        attempts: 0,
        status: 'pending',
        mode: 'review',
        destinations: { wishlist: true, listIds: [], newListTitles: [], tableId: null, tableIds: [] },
        ...partial,
    };
    store.set(base.jobId, JSON.stringify(base));
}

beforeEach(() => store.clear());

describe('readAll round-trips the TICKET-180 source/stage fields', () => {
    it('setImportSource + setImportStage persist through a setImportMode rewrite (the trap)', () => {
        seedManifest({ jobId: 'job-1', mode: 'review' });

        setImportSource('job-1', { thumbUrl: 'https://cdn/cover.jpg', handle: 'topjaw' });
        setImportStage('job-1', 'saving');

        const afterWrite = getImport('job-1');
        expect(afterWrite?.sourceThumbUrl).toBe('https://cdn/cover.jpg');
        expect(afterWrite?.sourceHandle).toBe('topjaw');
        expect(afterWrite?.stage).toBe('saving');

        // THE TRAP: setImportMode('auto') reads via readAll, spreads {...m}, rewrites.
        // If readAll dropped the fields, this review-confirm flip wipes them.
        setImportMode('job-1', 'auto');

        const afterFlip = getImport('job-1');
        expect(afterFlip?.mode).toBe('auto');
        expect(afterFlip?.sourceThumbUrl).toBe('https://cdn/cover.jpg');
        expect(afterFlip?.sourceHandle).toBe('topjaw');
        expect(afterFlip?.stage).toBe('saving');
    });

    it('parses source/stage back from raw manifest JSON', () => {
        seedManifest({
            jobId: 'job-2',
            sourceThumbUrl: 'https://cdn/x.jpg',
            sourceHandle: 'sethlui',
            stage: 'downloading video',
        });
        const m = getImport('job-2');
        expect(m?.sourceThumbUrl).toBe('https://cdn/x.jpg');
        expect(m?.sourceHandle).toBe('sethlui');
        expect(m?.stage).toBe('downloading video');
    });

    it('defaults thumb/handle to null and stage to undefined when absent; survives setImportSpots', () => {
        seedManifest({ jobId: 'job-3' });
        const m = getImport('job-3');
        expect(m?.sourceThumbUrl).toBeNull();
        expect(m?.sourceHandle).toBeNull();
        expect(m?.stage).toBeUndefined();

        // A stage written, then a spots checkpoint (another {...m} rewrite) keeps it.
        setImportStage('job-3', 'matching spots');
        setImportSpots('job-3', []);
        expect(getImport('job-3')?.stage).toBe('matching spots');
    });

    it('a null-handle source checkpoint round-trips (tiktok clip with no @handle)', () => {
        seedManifest({ jobId: 'job-4' });
        setImportSource('job-4', { thumbUrl: 'https://cdn/y.jpg', handle: null });
        const m = getImport('job-4');
        expect(m?.sourceThumbUrl).toBe('https://cdn/y.jpg');
        expect(m?.sourceHandle).toBeNull();
    });
});

describe('TICKET-181 — pinWishlist survives the review-confirm rewrite (the wipe trap)', () => {
    it('setImportDestinations({pinWishlist:false}) persists through setImportMode("auto")', () => {
        seedManifest({ jobId: 'pw-1', mode: 'review' });

        // Editor turns the wishlist chip OFF for a list-only save.
        setImportDestinations('pw-1', { pinWishlist: false });
        expect(getImport('pw-1')?.pinWishlist).toBe(false);

        // THE TRAP: the drain-release flips mode → auto (readAll → {...m} → write). If
        // readAll dropped pinWishlist, a re-drain would pin the wishlist anyway.
        setImportMode('pw-1', 'auto');
        const after = getImport('pw-1');
        expect(after?.mode).toBe('auto');
        expect(after?.pinWishlist).toBe(false);
        // The save reads this exact expression — false, so pin_wishlist:false ships.
        expect(effectivePinWishlist(after!)).toBe(false);
    });

    it('absent pinWishlist defaults the effective flag to true (base destination)', () => {
        seedManifest({ jobId: 'pw-2' });
        const m = getImport('pw-2');
        expect(m?.pinWishlist).toBeUndefined();
        expect(effectivePinWishlist(m!)).toBe(true);
        // effectivePinWishlist is pure — a bare shape resolves the same way.
        expect(effectivePinWishlist({})).toBe(true);
        expect(effectivePinWishlist({ pinWishlist: true })).toBe(true);
        expect(effectivePinWishlist({ pinWishlist: false })).toBe(false);
    });

    it('a pinWishlist:false written into raw JSON parses back (not coerced to true)', () => {
        seedManifest({ jobId: 'pw-3', pinWishlist: false });
        expect(getImport('pw-3')?.pinWishlist).toBe(false);
    });
});

describe('TICKET-181 — destination edits persist; tables pass through untouched', () => {
    it('setImportDestinations rewrites listIds/newListTitles and survives a mode flip', () => {
        seedManifest({ jobId: 'de-1', mode: 'review' });

        setImportDestinations('de-1', {
            listIds: ['list-a', 'list-b'],
            newListTitles: ['weekend spots'],
            pinWishlist: true,
        });

        const edited = getImport('de-1');
        expect(edited?.destinations.listIds).toEqual(['list-a', 'list-b']);
        expect(edited?.destinations.newListTitles).toEqual(['weekend spots']);

        // A re-drain after crash flips mode; the EDITED destinations must survive.
        setImportMode('de-1', 'auto');
        const redrained = getImport('de-1');
        expect(redrained?.destinations.listIds).toEqual(['list-a', 'list-b']);
        expect(redrained?.destinations.newListTitles).toEqual(['weekend spots']);
    });

    it('table destinations are NOT dropped when the editor rewrites lists', () => {
        seedManifest({
            jobId: 'de-2',
            mode: 'review',
            destinations: {
                wishlist: true,
                listIds: [],
                newListTitles: [],
                tableId: 'tbl-1',
                tableIds: ['tbl-1', 'tbl-2'],
            },
        });

        // The editor only ever touches lists + pinWishlist.
        setImportDestinations('de-2', { listIds: ['list-x'], pinWishlist: false });

        const m = getImport('de-2');
        expect(m?.destinations.listIds).toEqual(['list-x']);
        expect(m?.destinations.tableIds).toEqual(['tbl-1', 'tbl-2']);
        expect(m?.destinations.tableId).toBe('tbl-1');
        expect(m?.pinWishlist).toBe(false);
    });

    it('a partial edit (lists only) leaves pinWishlist untouched', () => {
        seedManifest({ jobId: 'de-3', pinWishlist: false });
        setImportDestinations('de-3', { listIds: ['only-lists'] });
        const m = getImport('de-3');
        expect(m?.destinations.listIds).toEqual(['only-lists']);
        expect(m?.pinWishlist).toBe(false); // not clobbered by an unspecified key
    });
});
