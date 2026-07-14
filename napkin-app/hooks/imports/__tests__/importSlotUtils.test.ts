/**
 * deriveImportSlot unit tests (TICKET-185) — the "one import card, ever"
 * precedence: review > working > failed > recent(48h) > null, and the sacred
 * every-state-routes-via-the-hub rule.
 */
import { deriveImportSlot } from '../importSlotUtils';
import type { ActiveImport } from '@/hooks/wishlist/useActiveImports';
import type { RecentImport } from '@/hooks/wishlist/useRecentImports';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

function active(phase: ActiveImport['phase'], spotCount = 0): ActiveImport {
    return { jobId: `j-${phase}-${spotCount}`, phase, spotCount } as unknown as ActiveImport;
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

describe('deriveImportSlot', () => {
    it('is null when nothing is in flight or recent', () => {
        expect(deriveImportSlot([], [], NOW)).toBeNull();
        expect(deriveImportSlot([], undefined, NOW)).toBeNull();
    });

    it('review wins over everything and sums spot counts', () => {
        const slot = deriveImportSlot(
            [active('review', 2), active('review', 3), active('saving', 9)],
            [recent({ created_at: new Date(NOW).toISOString() })],
            NOW,
        );
        expect(slot).toMatchObject({
            kind: 'review',
            count: 5,
            icon: 'sparkles-outline',
            route: '/import-progress',
        });
        expect(slot?.title).toBe('5 spots ready to review');
    });

    it('uses singular review copy for one spot', () => {
        expect(deriveImportSlot([active('review', 1)], [], NOW)?.title).toBe('1 spot ready to review');
    });

    it('working outranks failed + recent', () => {
        const slot = deriveImportSlot(
            [active('reading'), active('failed')],
            [recent({ created_at: new Date(NOW).toISOString() })],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'working', icon: 'sync-outline', count: null });
        expect(slot?.title).toBe('importing…');
    });

    it('working pluralizes the count when more than one', () => {
        expect(deriveImportSlot([active('reading'), active('saving')], [], NOW)?.title).toBe('importing 2…');
    });

    it('failed outranks a recent batch', () => {
        const slot = deriveImportSlot(
            [active('failed')],
            [recent({ created_at: new Date(NOW).toISOString() })],
            NOW,
        );
        expect(slot).toMatchObject({ kind: 'failed', icon: 'alert-circle-outline', count: null });
    });

    it('surfaces a recent batch within 48h when nothing is active', () => {
        const created = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago
        const slot = deriveImportSlot([], [recent({ created_at: created, item_count: 4 })], NOW);
        expect(slot).toMatchObject({ kind: 'recent', count: null, route: '/import-progress' });
        expect(slot?.title).toContain('4 spots');
    });

    it('ignores a recent batch older than 48h', () => {
        const created = new Date(NOW - 49 * 60 * 60 * 1000).toISOString();
        expect(deriveImportSlot([], [recent({ created_at: created })], NOW)).toBeNull();
    });

    it('routes every non-idle state via the imports hub', () => {
        for (const a of [active('review', 1), active('reading'), active('failed')]) {
            expect(deriveImportSlot([a], [], NOW)?.route).toBe('/import-progress');
        }
        const recentSlot = deriveImportSlot([], [recent({ created_at: new Date(NOW).toISOString() })], NOW);
        expect(recentSlot?.route).toBe('/import-progress');
    });
});
