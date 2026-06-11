/**
 * listsSectionUtils unit tests — TICKET-074 YOUR LISTS section.
 *
 * Tests buildListsSectionRows imported from the REAL module (not re-implemented):
 *  - row mapping: id / name / metaLabel (singular-aware) / spotCount
 *  - share eligibility gates on verified_count (fix-pass: the snapshot freezes
 *    verified spots only — an all-unverified list must not offer share, it
 *    would 400 EMPTY_LIST)
 *  - null/undefined input safety
 */
import { buildListsSectionRows } from '../listsSectionUtils';
import type { MyList } from '@/hooks/lists/useMyLists';

function makeList(overrides: Partial<MyList>): MyList {
    return {
        id: 'aabbccdd-0000-4000-8000-000000000001',
        owner_id: 'aabbccdd-0000-4000-8000-00000000000f',
        title: 'Tokyo trip',
        description: null,
        ranked: false,
        privacy: 'public',
        entry_count: 3,
        verified_count: 3,
        cover_photo_url: null,
        created_at: '2026-06-01T00:00:00Z',
        updated_at: '2026-06-11T00:00:00Z',
        ...overrides,
    };
}

describe('buildListsSectionRows', () => {
    it('maps id, name, meta, and spot count', () => {
        const rows = buildListsSectionRows([makeList({})]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({
            id: 'aabbccdd-0000-4000-8000-000000000001',
            name: 'Tokyo trip',
            metaLabel: '3 spots',
            spotCount: 3,
            canShare: true,
        });
    });

    it('singularizes "1 spot"', () => {
        const rows = buildListsSectionRows([makeList({ entry_count: 1, verified_count: 1 })]);
        expect(rows[0].metaLabel).toBe('1 spot');
    });

    it('pluralizes "0 spots" and hides share for empty lists', () => {
        const rows = buildListsSectionRows([makeList({ entry_count: 0, verified_count: 0 })]);
        expect(rows[0].metaLabel).toBe('0 spots');
        expect(rows[0].canShare).toBe(false);
    });

    it('hides share for an all-unverified list (snapshot would be empty)', () => {
        const rows = buildListsSectionRows([makeList({ entry_count: 3, verified_count: 0 })]);
        expect(rows[0].metaLabel).toBe('3 spots');
        expect(rows[0].canShare).toBe(false);
        expect(rows[0].spotCount).toBe(0);
    });

    it('partially verified list: share shown, murmur count = verified only', () => {
        const rows = buildListsSectionRows([makeList({ entry_count: 3, verified_count: 2 })]);
        expect(rows[0].canShare).toBe(true);
        expect(rows[0].spotCount).toBe(2);
        // The visible meta still reflects the full list size.
        expect(rows[0].metaLabel).toBe('3 spots');
    });

    it('treats absent verified_count (pre-fix server) as 0 — share hidden', () => {
        const list = makeList({ entry_count: 3 });
        delete (list as Partial<MyList>).verified_count;
        const rows = buildListsSectionRows([list]);
        expect(rows[0].canShare).toBe(false);
        expect(rows[0].spotCount).toBe(0);
    });

    it('preserves server (MRU) order', () => {
        const rows = buildListsSectionRows([
            makeList({ id: 'b', title: 'date spots' }),
            makeList({ id: 'a', title: 'Tokyo trip' }),
        ]);
        expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    });

    it('returns [] for undefined and null input', () => {
        expect(buildListsSectionRows(undefined)).toEqual([]);
        expect(buildListsSectionRows(null)).toEqual([]);
    });
});
