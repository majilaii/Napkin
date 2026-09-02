import type { ExhaustedCompletenessItem } from '@/hooks/imports/useCompletenessRetries';
import type { ActiveImport, ActiveLargeImport } from '@/hooks/wishlist/useActiveImports';
import type { RecentImport } from '@/hooks/wishlist/useRecentImports';
import { buildClipLedger, deriveClipPill } from '../clipTrayUtils';

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);

function active(phase: ActiveImport['phase'], jobId = `job-${phase}`): ActiveImport {
    return {
        jobId,
        phase,
        spotCount: 0,
        manifest: {
            jobId,
            kind: 'video',
            importNonce: `nonce-${jobId}`,
            createdAt: NOW,
            attempts: 0,
            status: phase === 'failed' ? 'failed' : 'pending',
            mode: phase === 'review' ? 'review' : 'auto',
            destinations: {
                wishlist: true,
                listIds: [],
                newListTitles: [],
                tableId: null,
                tableIds: [],
            },
        },
    };
}

function largeJob(phase: ActiveLargeImport['phase'], jobId = `large-${phase}`): ActiveImport {
    const large: ActiveLargeImport = {
        phase,
        cursor: 4,
        listCount: 12,
        title: 'a dozen places',
        imported: phase === 'done' ? 10 : 0,
        queued: 0,
        needsLook: phase === 'done' ? 2 : 0,
    };
    const item = active(
        phase === 'kickoff' ? 'kickoff' : phase === 'done' ? 'review' : 'saving',
        jobId,
    );
    return { ...item, spotCount: large.listCount, large };
}

function recent(over: Partial<RecentImport> = {}): RecentImport {
    return {
        job_id: 'landed-1',
        source: { type: 'tiktok', url: 'https://www.tiktok.com/@napkin/video/1' },
        status: 'done',
        created_at: new Date(NOW - 4 * 60 * 60 * 1000).toISOString(),
        item_count: 4,
        preview_names: ['Kono', 'Buvette'],
        ...over,
    };
}

function exhausted(jobId: string, id: string): ExhaustedCompletenessItem {
    return {
        id,
        job_id: jobId,
        item_nonce: `item-${id}`,
        import_nonce: `import-${id}`,
        restaurant_id: null,
        restaurant_name: null,
        restaurant_city: null,
        last_error: 'no match',
        created_at: new Date(NOW).toISOString(),
    };
}

describe('deriveClipPill', () => {
    it('rests when there is no active work or unresolved item', () => {
        expect(deriveClipPill([], [])).toEqual({ kind: 'resting' });
    });

    it('clips for a reading manifest', () => {
        expect(deriveClipPill([active('reading')], [])).toEqual({ kind: 'clipping' });
    });

    it('clips for a running large job through its top-level saving phase', () => {
        expect(deriveClipPill([largeJob('running')], [])).toEqual({ kind: 'clipping' });
    });

    it('does not treat a done large job as clipping', () => {
        expect(deriveClipPill([largeJob('done')], [])).toEqual({ kind: 'resting' });
    });

    it('counts unresolved items exactly when nothing is clipping', () => {
        expect(deriveClipPill([], [exhausted('a', '1'), exhausted('b', '2')])).toEqual({
            kind: 'needsLook',
            count: 2,
        });
    });

    it('gives clipping precedence over unresolved items', () => {
        expect(deriveClipPill([active('saving')], [exhausted('a', '1')])).toEqual({
            kind: 'clipping',
        });
    });

    it('keeps kickoff and failed manifests quiet', () => {
        expect(deriveClipPill([active('kickoff'), active('failed')], [])).toEqual({
            kind: 'resting',
        });
    });
});

describe('buildClipLedger', () => {
    it('maps landed title and source · relative time · spot count metadata', () => {
        const { rows } = buildClipLedger({ active: [], recent: [recent()], exhausted: [] }, NOW);
        expect(rows[0]).toMatchObject({
            key: 'landed-1',
            kind: 'landed',
            title: 'Kono, Buvette +2',
            meta: 'from TikTok · 4h ago · 4 spots',
            route: '/imports/landed-1',
        });
    });

    it('groups needs-look item counts by job_id', () => {
        const batches = [
            recent({ job_id: 'a' }),
            recent({ job_id: 'b', created_at: new Date(NOW - 5 * 60 * 60 * 1000).toISOString() }),
        ];
        const { rows } = buildClipLedger({
            active: [],
            recent: batches,
            exhausted: [exhausted('a', '1'), exhausted('a', '2')],
        }, NOW);
        expect(rows[0]).toMatchObject({ key: 'a', needsLook: 2, dot: 'amber' });
        expect(rows[1]).toMatchObject({ key: 'b', needsLook: 0, dot: 'ghost' });
    });

    it('puts clipping first and carries honest large-job progress', () => {
        const { rows } = buildClipLedger({
            active: [largeJob('running')],
            recent: [recent()],
            exhausted: [],
        }, NOW);
        expect(rows[0]).toMatchObject({
            key: 'large-running',
            kind: 'clipping',
            dot: 'terracotta',
            progress: { cursor: 4, total: 12 },
        });
        expect(rows[1].kind).toBe('landed');
    });

    it('maps review, kickoff, digest, failed, and reading routes', () => {
        const { rows } = buildClipLedger({
            active: [
                active('reading', 'reading'),
                active('review', 'review'),
                largeJob('kickoff', 'kickoff'),
                largeJob('done', 'digest'),
                active('failed', 'failed'),
            ],
            recent: [],
            exhausted: [],
        }, NOW);
        expect(rows.find((row) => row.key === 'reading')?.route).toBeNull();
        expect(rows.find((row) => row.key === 'review')?.route).toBe('/import-review?jobId=review');
        expect(rows.find((row) => row.key === 'kickoff')?.route).toBe('/import-kickoff?jobId=kickoff');
        expect(rows.find((row) => row.key === 'digest')?.route).toBe('/import-digest?jobId=digest');
        expect(rows.find((row) => row.key === 'failed')?.route).toBe('/import-progress');
    });

    it('caps the tray at five rows and reports older content', () => {
        const batches = Array.from({ length: 7 }, (_, index) => recent({
            job_id: `job-${index}`,
            created_at: new Date(NOW - index * 60_000).toISOString(),
        }));
        expect(buildClipLedger({ active: [], recent: batches, exhausted: [] }, NOW)).toMatchObject({
            rows: expect.any(Array),
            hasOlder: true,
        });
        expect(buildClipLedger({ active: [], recent: batches, exhausted: [] }, NOW).rows).toHaveLength(5);
        expect(buildClipLedger({ active: [], recent: batches.slice(0, 3), exhausted: [] }, NOW).hasOlder).toBe(false);
    });

    it('keeps the older escape when a needs-look item has no visible chip', () => {
        // Exhausted item whose batch is NOT in recent (e.g. 11+ imports): the pill
        // would count it, but no rendered row carries its chip. Review P2-1: the
        // "older ·" escape must stay so it is never a dead-end.
        const { rows, hasOlder } = buildClipLedger({
            active: [],
            recent: [recent({ job_id: 'visible' })],
            exhausted: [exhausted('offscreen-job', 'x1')],
        }, NOW);
        expect(rows).toHaveLength(1);
        expect(rows[0].needsLook).toBe(0);
        expect(hasOlder).toBe(true);
    });

    it('labels a large-list clip with a neutral phrase, not "reading the video"', () => {
        const { rows } = buildClipLedger({
            active: [largeJob('running', 'maps-list')],
            recent: [],
            exhausted: [],
        }, NOW);
        const row = rows.find((r) => r.key === 'maps-list');
        expect(row?.meta).toBe('gathering the list…');
    });

    it('drives the empty state only when there are no rows', () => {
        expect(buildClipLedger({ active: [], recent: [], exhausted: [] }, NOW)).toEqual({
            rows: [],
            hasOlder: false,
        });
    });
});
