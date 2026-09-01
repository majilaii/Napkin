import {
    buildElsewhereParts,
    deriveLedgerStats,
    formatLedgerMeta,
    selfLogTarget,
} from './restaurantHistoryLedger';
import type { MyList } from '@/hooks/lists/useMyLists';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';

const row = (overrides: Partial<SelfLogRow> = {}): SelfLogRow => ({
    id: 'entry:a',
    entry_id: 'a',
    table_night_id: null,
    source: 'solo',
    rating: 4,
    note: 'full note',
    visited_at: '2026-04-16T12:00:00.000Z',
    companions: [],
    photos: [],
    ...overrides,
});

describe('restaurant history ledger', () => {
    it('averages rated rows only and takes first/last from timestamps, not input order', () => {
        const rows = [
            row({ id: 'new', rating: 5, visited_at: '2026-04-16T12:00:00.000Z' }),
            row({ id: 'unrated', rating: null, visited_at: '2025-08-20T12:00:00.000Z' }),
            row({ id: 'old', rating: 3, visited_at: '2025-03-12T12:00:00.000Z' }),
        ];
        const stats = deriveLedgerStats(rows);

        expect(stats.average).toBe(4);
        expect(stats.rows.map((item) => item.id)).toEqual(['new', 'unrated', 'old']);
        expect(formatLedgerMeta(rows)).toBe('3 visits · first 12 mar 2025 · last 16 apr 2026');
    });

    it('returns an em dash average state when nothing is rated', () => {
        expect(deriveLedgerStats([row({ rating: null })]).average).toBeNull();
    });

    it('composes ELSEWHERE and omits it when every source is empty', () => {
        const lists = [
            { id: 'one', title: 'Tokyo 2026' },
            { id: 'two', title: 'Dinner shortlist' },
        ] as MyList[];
        expect(buildElsewhereParts({
            wishlisted: true,
            lists,
            containingListIds: ['one', 'two'],
            selfClipCount: 1,
        })).toEqual([
            { kind: 'text', label: 'pinned', prefix: '' },
            { kind: 'text', label: 'in', prefix: ' · ' },
            { kind: 'list', label: 'Tokyo 2026', id: 'one', prefix: ' ' },
            { kind: 'list', label: 'Dinner shortlist', id: 'two', prefix: ', ' },
            { kind: 'text', label: '1 clip', prefix: ' · ' },
        ]);
        expect(buildElsewhereParts({
            wishlisted: false,
            lists,
            containingListIds: [],
            selfClipCount: 0,
        })).toEqual([]);
    });

    it('routes supper, solo, and live rows without a dead tap', () => {
        expect(selfLogTarget(row({ table_night_id: 'night' }))).toEqual({
            pathname: '/table-night-detail',
            params: { nightId: 'night' },
        });
        expect(selfLogTarget(row({ entry_id: 'entry' }))).toEqual({
            pathname: '/entry-detail',
            params: { entryId: 'entry' },
        });
        expect(selfLogTarget(row({ entry_id: null, table_night_id: null }))).toBeNull();
    });
});
