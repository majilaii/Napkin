/**
 * deriveImportSlot unit tests (TICKET-185, extended TICKET-191) — the "one
 * import card, ever" precedence:
 *
 *   review > failed > kickoff > digest(needsLook>0) > working > digest(clean) > recent(48h) > null
 *
 * plus the sacred every-state-routes-via-the-hub rule and the accent split
 * (attention strictly before calm).
 */
import { deriveImportSlot } from '../importSlotUtils';
import type { ActiveImport, ActiveLargeImport } from '@/hooks/wishlist/useActiveImports';
import type { RecentImport } from '@/hooks/wishlist/useRecentImports';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

function active(phase: ActiveImport['phase'], spotCount = 0): ActiveImport {
    return { jobId: `j-${phase}-${spotCount}`, phase, spotCount } as unknown as ActiveImport;
}

/**
 * A large Maps-list manifest. The top-level phase mirrors useActiveImports
 * phaseOf(): kickoff → 'kickoff', running → 'saving', done → 'review' — the
 * exact aliasing the derivation must see through via `m.large`.
 */
function largeJob(
    largePhase: ActiveLargeImport['phase'],
    over: Partial<ActiveLargeImport> = {},
): ActiveImport {
    const large: ActiveLargeImport = {
        phase: largePhase,
        cursor: 0,
        listCount: 0,
        title: null,
        imported: 0,
        queued: 0,
        needsLook: 0,
        ...over,
    };
    const phase =
        largePhase === 'kickoff' ? 'kickoff' : largePhase === 'done' ? 'review' : 'saving';
    return {
        jobId: `lg-${largePhase}-${large.listCount}-${large.imported}-${large.needsLook}`,
        phase,
        spotCount: large.listCount,
        large,
    } as unknown as ActiveImport;
}

function recent(over: Partial<RecentImport> & { created_at: string }): RecentImport {
    return {
        job_id: 'r1',
        source: null,
        status: 'done',
        item_count: 3,
        preview_names: [],
        ...over,
    };
}

const recentNow = () => recent({ created_at: new Date(NOW).toISOString() });

describe('deriveImportSlot', () => {
    it('is null when nothing is in flight or recent', () => {
        expect(deriveImportSlot([], [], NOW)).toBeNull();
        expect(deriveImportSlot([], undefined, NOW)).toBeNull();
    });

    it('review wins over everything and sums spot counts', () => {
        const slot = deriveImportSlot(
            [active('review', 2), active('review', 3), active('saving', 9)],
            [recentNow()],
            NOW,
        );
        expect(slot).toMatchObject({
            kind: 'review',
            count: 5,
            accent: 'attention',
            icon: 'sparkles-outline',
            route: '/import-progress',
        });
        expect(slot?.title).toBe('5 spots ready to review');
    });

    it('uses singular review copy for one spot', () => {
        expect(deriveImportSlot([active('review', 1)], [], NOW)?.title).toBe('1 spot ready to review');
    });

    it('review counts only NORMAL batches — a co-present large-done digest is excluded', () => {
        // A large "done" job reports phase 'review' (phaseOf aliasing); without
        // the !m.large exclusion it would inflate the review sum by listCount.
        const slot = deriveImportSlot(
            [largeJob('done', { listCount: 117, imported: 110, needsLook: 4 }), active('review', 2)],
            [],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'review', count: 2, accent: 'attention' });
        expect(slot?.title).toBe('2 spots ready to review');
    });

    it('failed outranks running (attention before calm) + recent', () => {
        const slot = deriveImportSlot([active('reading'), active('failed')], [recentNow()], NOW);
        expect(slot).toMatchObject({
            kind: 'failed',
            accent: 'attention',
            icon: 'alert-circle-outline',
            count: null,
        });
        expect(slot?.title).toBe('an import needs attention');
    });

    it('kickoff is attention-bearing and never reads as importing', () => {
        const slot = deriveImportSlot(
            [largeJob('kickoff', { listCount: 117 })],
            [recentNow()],
            NOW,
        );
        expect(slot).toMatchObject({
            kind: 'kickoff',
            count: null,
            accent: 'attention',
            route: '/import-progress',
        });
        expect(slot?.title).toBe('ready to import');
        expect(slot?.sublabel).toBe('117 places · tap to start');
        expect(slot?.title).not.toContain('importing');
        expect(slot?.sublabel).not.toContain('importing');
    });

    it('digest with rows worth a look is attention-bearing', () => {
        const slot = deriveImportSlot(
            [largeJob('done', { listCount: 117, imported: 110, needsLook: 4 })],
            [],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'digest', count: null, accent: 'attention' });
        expect(slot?.title).toBe('110 imported');
        expect(slot?.sublabel).toBe('4 worth a look');
    });

    it('digest with needsLook outranks a running normal import', () => {
        const slot = deriveImportSlot(
            [largeJob('done', { imported: 20, needsLook: 2 }), active('reading')],
            [],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'digest', accent: 'attention' });
    });

    it('a deferred large digest stays in the completing state', () => {
        const slot = deriveImportSlot(
            [largeJob('done', { imported: 3, queued: 7, needsLook: 0 })],
            [],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'working', accent: 'calm' });
        expect(slot?.title).toBe('7 spots are completing…');
        expect(slot?.sublabel).toBe('3 already imported');
    });

    it('clean digest is calm and shows the imported count as places', () => {
        const slot = deriveImportSlot(
            [largeJob('done', { listCount: 41, imported: 41, needsLook: 0 })],
            [],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'digest', count: null, accent: 'calm' });
        expect(slot?.title).toBe('41 imported');
        expect(slot?.sublabel).toBe('41 places');
    });

    it('clean digest outranks a co-present recent batch', () => {
        const slot = deriveImportSlot(
            [largeJob('done', { imported: 41, needsLook: 0 })],
            [recentNow()],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'digest', accent: 'calm' });
    });

    it('running (normal) is calm with the existing copy', () => {
        const one = deriveImportSlot([active('reading')], [], NOW);
        expect(one).toMatchObject({
            kind: 'working',
            accent: 'calm',
            icon: 'sync-outline',
            count: null,
        });
        expect(one?.title).toBe('importing…');
        expect(deriveImportSlot([active('reading'), active('saving')], [], NOW)?.title).toBe('importing 2…');
    });

    it('running (large) is calm with cursor-of-listCount copy', () => {
        const slot = deriveImportSlot(
            [largeJob('running', { cursor: 41, listCount: 117 })],
            [],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'working', accent: 'calm' });
        expect(slot?.title).toBe('importing 41 of 117…');
    });

    it('mixed normal + large running collapses to the count copy', () => {
        const slot = deriveImportSlot(
            [active('reading'), largeJob('running', { cursor: 41, listCount: 117 })],
            [],
            NOW,
        );
        expect(slot?.title).toBe('importing 2…');
    });

    it('surfaces a recent batch within 48h when nothing is active', () => {
        const created = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago
        const slot = deriveImportSlot([], [recent({ created_at: created, item_count: 4 })], NOW);
        expect(slot).toMatchObject({
            kind: 'recent',
            count: null,
            accent: 'calm',
            route: '/import-progress',
        });
        expect(slot?.title).toContain('4 spots');
    });

    it('ignores a recent batch older than 48h', () => {
        const created = new Date(NOW - 49 * 60 * 60 * 1000).toISOString();
        expect(deriveImportSlot([], [recent({ created_at: created })], NOW)).toBeNull();
    });

    it('walks the full seven-tier ladder in order as tiers peel away', () => {
        const review = active('review', 2);
        const failed = active('failed');
        const kickoff = largeJob('kickoff', { listCount: 30 });
        const digestAttention = largeJob('done', { imported: 20, needsLook: 3 });
        const working = active('saving', 5);
        const digestClean = largeJob('done', { imported: 12, needsLook: 0 });
        const recents = [recentNow()];

        let pool = [review, failed, kickoff, digestAttention, working, digestClean];
        expect(deriveImportSlot(pool, recents, NOW)?.kind).toBe('review');

        pool = pool.filter((m) => m !== review);
        expect(deriveImportSlot(pool, recents, NOW)?.kind).toBe('failed');

        pool = pool.filter((m) => m !== failed);
        expect(deriveImportSlot(pool, recents, NOW)?.kind).toBe('kickoff');

        pool = pool.filter((m) => m !== kickoff);
        // Both done jobs aggregate; needsLook 3 > 0 → attention digest.
        expect(deriveImportSlot(pool, recents, NOW)).toMatchObject({
            kind: 'digest',
            accent: 'attention',
        });

        pool = pool.filter((m) => m !== digestAttention);
        expect(deriveImportSlot(pool, recents, NOW)?.kind).toBe('working');

        pool = pool.filter((m) => m !== working);
        expect(deriveImportSlot(pool, recents, NOW)).toMatchObject({
            kind: 'digest',
            accent: 'calm',
        });

        pool = pool.filter((m) => m !== digestClean);
        expect(deriveImportSlot(pool, recents, NOW)?.kind).toBe('recent');

        expect(deriveImportSlot(pool, [], NOW)).toBeNull();
    });

    it('routes every non-idle state via the imports hub', () => {
        const cases: ActiveImport[] = [
            active('review', 1),
            active('reading'),
            active('failed'),
            largeJob('kickoff', { listCount: 30 }),
            largeJob('running', { cursor: 3, listCount: 30 }),
            largeJob('done', { imported: 30, needsLook: 2 }),
            largeJob('done', { imported: 30, needsLook: 0 }),
        ];
        for (const a of cases) {
            expect(deriveImportSlot([a], [], NOW)?.route).toBe('/import-progress');
        }
        const recentSlot = deriveImportSlot([], [recentNow()], NOW);
        expect(recentSlot?.route).toBe('/import-progress');
    });
});
