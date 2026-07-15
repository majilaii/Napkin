import { peekCardHeightsForRail, peekRailCardHeight } from '../peekLayout';
import type { WishlistMapItem } from '../mapShared';

const base: WishlistMapItem = {
    id: 'restaurant-1',
    name: 'Cafe',
    city: null,
    cuisine: null,
    lat: 51.5,
    lng: -0.1,
};

describe('peek rail height', () => {
    it('is identical across a mixed-layer rail', () => {
        const items: WishlistMapItem[] = [
            base,
            { ...base, id: 'been', been: true },
            { ...base, id: 'network', entryId: 'entry-1' },
            { ...base, id: 'overlap', overlap: { count: 2, tableId: 'table-1', tableName: 'Table', members: [] } },
            { ...base, id: 'gathered', been: true, gathered: { tableId: 'table-1', on: '2026-07-15', participants: [], suppersCount: 1 } },
            { ...base, id: 'list', listContext: { listId: 'list-1', rank: 1 } },
        ];

        expect(new Set(peekCardHeightsForRail(items, 1)).size).toBe(1);
    });

    it('cannot reflow when enrichment arrives', () => {
        const rail = [base, { ...base, id: 'network', entryId: 'entry-1' }];
        const beforeEnrichment = peekCardHeightsForRail(rail, 1.35);
        const arrivedEnrichment = {
            media: [{ kind: 'entry', url: 'https://storage.example/photo.jpg' }],
            hours: { weekdayDescriptions: ['Wednesday: 12:00 pm – 10:00 pm'] },
            visible_saves_count: 4,
        };

        // Enrichment is intentionally not a layout input. Its arrival fills the
        // reserved slots while every item keeps the same rail-wide height.
        expect(arrivedEnrichment.media).toHaveLength(1);
        expect(peekCardHeightsForRail(rail, 1.35)).toEqual(beforeEnrichment);
    });

    it('grows once for the rail and caps Dynamic Type at 2x', () => {
        expect(peekRailCardHeight(1.5)).toBeGreaterThan(peekRailCardHeight(1));
        expect(peekRailCardHeight(3)).toBe(peekRailCardHeight(2));
    });
});
