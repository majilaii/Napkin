import type { ListEntry } from '@/hooks/lists/useList';
import {
    countUnmappableListEntries,
    isCityScaleCollection,
    listCollectionFrameKey,
    listEntriesToWishlistMapItems,
    routeParamValue,
    shouldReturnToListOrigin,
} from '../listMapScope';

function entry(
    id: string,
    overrides: Partial<ListEntry['restaurant']> = {},
    note: string | null = null,
): ListEntry {
    return {
        id: `entry-${id}`,
        list_id: 'list-1',
        restaurant_id: `restaurant-${id}`,
        note,
        position: 0,
        created_at: '2026-07-13T12:00:00.000Z',
        restaurant: {
            id: `restaurant-${id}`,
            name: `Place ${id}`,
            address: null,
            city: 'London',
            country: 'GB',
            photo_url: null,
            cuisine: 'Bakery',
            google_rating: null,
            price_level: 2,
            external_id: null,
            lat: 51.5,
            lng: -0.12,
            ...overrides,
        },
    };
}

const OPTIONS = {
    emoji: '🥐',
    ranked: true,
    city: null,
    cuisine: null,
    price: null,
} as const;

describe('routeParamValue', () => {
    it('normalizes scalar and repeated Expo Router params', () => {
        expect(routeParamValue('  list-1  ')).toBe('list-1');
        expect(routeParamValue(['  restaurant-1  ', 'ignored'])).toBe('restaurant-1');
    });

    it('rejects absent and blank params', () => {
        expect(routeParamValue(undefined)).toBeNull();
        expect(routeParamValue([])).toBeNull();
        expect(routeParamValue('   ')).toBeNull();
        expect(routeParamValue(['   ', 'not-used'])).toBeNull();
    });
});

describe('isCityScaleCollection', () => {
    it('fits city-scale points but rejects inter-city and global spans', () => {
        expect(isCityScaleCollection([
            { lat: 51.48, lng: -0.22 },
            { lat: 51.58, lng: 0.08 },
        ])).toBe(true);
        expect(isCityScaleCollection([
            { lat: 51.51, lng: -0.12 },
            { lat: 52.37, lng: 4.9 },
        ])).toBe(false);
        expect(isCityScaleCollection([
            { lat: 51.51, lng: -0.12 },
            { lat: 40.71, lng: -74.0 },
        ])).toBe(false);
    });
});

describe('listCollectionFrameKey', () => {
    it('changes when filters change membership without reacting to item order', () => {
        const londonAndParis = [{ id: 'london' }, { id: 'paris' }];
        const reordered = [{ id: 'paris' }, { id: 'london' }];
        const parisOnly = [{ id: 'paris' }];

        expect(listCollectionFrameKey('list:list-1', londonAndParis))
            .toBe(listCollectionFrameKey('list:list-1', reordered));
        expect(listCollectionFrameKey('list:list-1', parisOnly))
            .not.toBe(listCollectionFrameKey('list:list-1', londonAndParis));
        expect(listCollectionFrameKey(null, londonAndParis)).toBeNull();
    });
});

describe('shouldReturnToListOrigin', () => {
    it('returns only to the exact List that opened Map', () => {
        expect(shouldReturnToListOrigin('1', 'list-1', 'list-1')).toBe(true);
        expect(shouldReturnToListOrigin('1', 'list-1', 'list-2')).toBe(false);
        expect(shouldReturnToListOrigin(null, 'list-1', 'list-1')).toBe(false);
    });
});

describe('listEntriesToWishlistMapItems', () => {
    it('preserves authored order and carries List context into map cards', () => {
        const items = listEntriesToWishlistMapItems([
            entry('first', {}, 'Start with the cardamom bun'),
            entry('second', { price_level: 3 }),
        ], OPTIONS);

        expect(items.map((item) => item.id)).toEqual([
            'restaurant-first',
            'restaurant-second',
        ]);
        expect(items[0]).toMatchObject({
            emoji: '🥐',
            note: 'Start with the cardamom bun',
            priceLevel: 2,
            listContext: { listId: 'list-1', rank: 1 },
        });
        expect(items[1]).toMatchObject({
            priceLevel: 3,
            listContext: { listId: 'list-1', rank: 2 },
        });
    });

    it('keeps authored ranks stable when an earlier entry cannot be mapped', () => {
        const items = listEntriesToWishlistMapItems([
            entry('unmapped', { lat: null, lng: null }),
            entry('mapped'),
        ], OPTIONS);

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: 'restaurant-mapped',
            listContext: { rank: 2 },
        });
    });

    it('omits rank context for an unranked List', () => {
        const items = listEntriesToWishlistMapItems(
            [entry('newest'), entry('older')],
            { ...OPTIONS, ranked: false },
        );

        expect(items.map((item) => item.listContext?.rank)).toEqual([null, null]);
    });

    it('drops non-finite and out-of-range coordinates while retaining zero-zero', () => {
        const items = listEntriesToWishlistMapItems([
            entry('null-lat', { lat: null }),
            entry('nan', { lat: Number.NaN }),
            entry('infinity', { lng: Number.POSITIVE_INFINITY }),
            entry('latitude-high', { lat: 90.0001 }),
            entry('latitude-low', { lat: -90.0001 }),
            entry('longitude-high', { lng: 180.0001 }),
            entry('longitude-low', { lng: -180.0001 }),
            entry('origin', { lat: 0, lng: 0 }),
        ], OPTIONS);

        expect(items.map((item) => item.id)).toEqual(['restaurant-origin']);
        expect(items[0]).toMatchObject({ lat: 0, lng: 0 });
    });

    it('applies city, cuisine, and price filters without reordering matches', () => {
        const entries = [
            entry('first-match', { city: ' London ', cuisine: ' Bakery ', price_level: 2 }),
            entry('wrong-city', { city: 'Paris', cuisine: 'Bakery', price_level: 2 }),
            entry('wrong-cuisine', { city: 'London', cuisine: 'Cafe', price_level: 2 }),
            entry('wrong-price', { city: 'London', cuisine: 'Bakery', price_level: 3 }),
            entry('second-match', { city: 'London', cuisine: 'Bakery', price_level: 2 }),
        ];

        const items = listEntriesToWishlistMapItems(entries, {
            ...OPTIONS,
            city: 'London',
            cuisine: 'Bakery',
            price: '2',
        });

        expect(items.map((item) => item.id)).toEqual([
            'restaurant-first-match',
            'restaurant-second-match',
        ]);
        expect(entries.map((item) => item.restaurant_id)).toEqual([
            'restaurant-first-match',
            'restaurant-wrong-city',
            'restaurant-wrong-cuisine',
            'restaurant-wrong-price',
            'restaurant-second-match',
        ]);
    });
});

describe('countUnmappableListEntries', () => {
    it('counts only filter-matching entries whose coordinates are unusable', () => {
        const entries = [
            entry('mapped'),
            entry('missing', { lat: null, lng: null }),
            entry('non-finite', { lat: Number.NaN }),
            entry('out-of-range', { lng: 181 }),
            entry('filtered-out', { city: 'Paris', lat: null, lng: null }),
        ];

        expect(countUnmappableListEntries(entries, {
            city: 'London',
            cuisine: null,
            price: null,
        })).toBe(3);
    });
});
