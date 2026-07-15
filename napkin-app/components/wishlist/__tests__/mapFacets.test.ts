/**
 * mapFacets unit tests — TICKET-143 table-map filter chip + list ledger.
 *
 * Pins the load-bearing rules:
 *  - facets are frequency-ranked (ties → alpha); price ascending; only present
 *    values appear
 *  - filterMapItems: cuisine/price/city each pass-through on null, AND together
 *  - sortGatheredRecent: most-recent gathered first, undated sinks to the end
 */
import {
    cuisineFacets,
    priceFacets,
    cityFacets,
    filterMapItems,
    sortGatheredRecent,
} from '../mapFacets';
import type { WishlistMapItem } from '../WishlistMapView';

function item(partial: Partial<WishlistMapItem>): WishlistMapItem {
    return {
        id: partial.id ?? Math.random().toString(36),
        name: partial.name ?? 'Spot',
        city: partial.city ?? null,
        cuisine: partial.cuisine ?? null,
        lat: partial.lat ?? 0,
        lng: partial.lng ?? 0,
        ...partial,
    };
}

const set: WishlistMapItem[] = [
    item({ id: 'a', cuisine: 'Italian', priceLevel: 2, city: 'London' }),
    item({ id: 'b', cuisine: 'Italian', priceLevel: 3, city: 'London' }),
    item({ id: 'c', cuisine: 'Thai', priceLevel: 2, city: 'Lisbon' }),
    item({ id: 'd', cuisine: 'Thai', priceLevel: null, city: 'London' }),
    item({ id: 'e', cuisine: null, priceLevel: 1, city: null }),
];

describe('cuisineFacets', () => {
    it('frequency-ranks and drops the null cuisine', () => {
        expect(cuisineFacets(set)).toEqual([
            { value: 'Italian', count: 2 },
            { value: 'Thai', count: 2 },
        ]);
        // ties broken alphabetically: Italian before Thai
    });
});

describe('priceFacets', () => {
    it('lists present tiers ascending, ignoring null/0', () => {
        expect(priceFacets(set)).toEqual([
            { value: 1, count: 1 },
            { value: 2, count: 2 },
            { value: 3, count: 1 },
        ]);
    });
});

describe('cityFacets', () => {
    it('frequency-ranks cities and drops null', () => {
        expect(cityFacets(set)).toEqual([
            { value: 'London', count: 3 },
            { value: 'Lisbon', count: 1 },
        ]);
    });
});

describe('filterMapItems', () => {
    it('passes everything through when all filters are null', () => {
        expect(filterMapItems(set, {})).toHaveLength(5);
        expect(filterMapItems(set, { cuisine: null, price: null, city: null })).toHaveLength(5);
    });

    it('filters by cuisine', () => {
        expect(filterMapItems(set, { cuisine: 'Thai' }).map((i) => i.id)).toEqual(['c', 'd']);
    });

    it('filters by price tier (string value)', () => {
        expect(filterMapItems(set, { price: '2' }).map((i) => i.id)).toEqual(['a', 'c']);
    });

    it('filters by city', () => {
        expect(filterMapItems(set, { city: 'London' }).map((i) => i.id)).toEqual(['a', 'b', 'd']);
    });

    it('applies cuisine + price + city together', () => {
        expect(filterMapItems(set, { cuisine: 'Italian', price: '2', city: 'London' }).map((i) => i.id)).toEqual([
            'a',
        ]);
    });
});

describe('sortGatheredRecent', () => {
    it('orders by gathered date, most recent first; undated sinks last', () => {
        const gathered = (id: string, on: string | null): WishlistMapItem =>
            item({
                id,
                been: true,
                gathered: on
                    ? { tableId: 'table-1', on, participants: [], suppersCount: 1 }
                    : (null as WishlistMapItem['gathered']),
            });
        const rows = [
            gathered('old', '2026-01-01'),
            gathered('new', '2026-07-01'),
            gathered('mid', '2026-04-01'),
            gathered('none', null),
        ];
        expect(sortGatheredRecent(rows).map((r) => r.id)).toEqual(['new', 'mid', 'old', 'none']);
    });

    it('does not mutate the input', () => {
        const rows = [
            item({ id: 'x', gathered: { tableId: 'table-1', on: '2026-01-01', participants: [], suppersCount: 1 } }),
            item({ id: 'y', gathered: { tableId: 'table-1', on: '2026-02-01', participants: [], suppersCount: 1 } }),
        ];
        const before = rows.map((r) => r.id);
        sortGatheredRecent(rows);
        expect(rows.map((r) => r.id)).toEqual(before);
    });
});
