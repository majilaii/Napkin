import { buildListMapPins } from './listMapItems';
import type { ListEntry } from '@/hooks/lists/useList';

function entry(id: string, lat: number | null | undefined, lng: number | null | undefined): ListEntry {
    return {
        id,
        list_id: 'list-1',
        restaurant_id: `restaurant-${id}`,
        note: null,
        position: 0,
        created_at: '2026-07-12T10:00:00.000Z',
        restaurant: {
            id: `restaurant-${id}`,
            name: `Place ${id}`,
            address: null,
            city: 'London',
            country: 'GB',
            photo_url: null,
            cuisine: null,
            google_rating: null,
            price_level: null,
            external_id: null,
            lat,
            lng,
        },
    };
}

describe('buildListMapPins', () => {
    it('drops coordinate-less and non-finite entries', () => {
        const pins = buildListMapPins([
            entry('a', 51.5, -0.12),
            entry('b', null, -0.1),
            entry('c', Number.NaN, -0.2),
            entry('d', 91, -0.2),
            entry('e', 51.5, 181),
        ], false);

        expect(pins).toEqual([
            expect.objectContaining({ id: 'a', latitude: 51.5, longitude: -0.12, rank: null }),
        ]);
    });

    it('preserves authored order when assigning ranks', () => {
        const pins = buildListMapPins([
            entry('second', 51.51, -0.11),
            entry('first', 51.49, -0.13),
        ], true);

        expect(pins.map((pin) => [pin.id, pin.rank])).toEqual([
            ['second', 1],
            ['first', 2],
        ]);
    });
});
