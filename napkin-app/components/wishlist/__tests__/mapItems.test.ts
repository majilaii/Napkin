/**
 * mapItems unit tests — TICKET-131 shared layer mappers.
 *
 * Pins the load-bearing rules:
 *  - logged spots map to olive "been" pins; coord-less spots are dropped
 *    (callers derive unmappable counts from the length delta)
 *  - been pins never carry entryId (they must render the teardrop + the
 *    directions-first peek, NOT the network variant)
 *  - network pins carry entryId/author/hasReview (avatar pin + network peek)
 *  - the cuisine filter trim-matches and applies to any layer; null = pass-through
 */
import { spotsToMapItems, networkPinsToMapItems, filterItemsByCuisine } from '../mapItems';
import type { SpotSummary } from '@/hooks/users/useUserSpots';
import type { NetworkMapItem } from '@/hooks/users/useNetworkMapPins';

function spot(over: Partial<SpotSummary> & { restaurant_id: string }): SpotSummary {
    return {
        name: 'Spot',
        city: 'Tokyo',
        country: 'Japan',
        cuisine: 'Japanese',
        price_level: 2,
        lat: 35.6,
        lng: 139.7,
        photo_url: null,
        visit_count: 1,
        avg_rating: 4,
        last_visited_at: '2026-07-01T00:00:00Z',
        ...over,
    };
}

function pin(over: Partial<NetworkMapItem> & { restaurant_id: string }): NetworkMapItem {
    return {
        name: 'Spot',
        city: 'Lisbon',
        cuisine: 'Portuguese',
        lat: 38.7,
        lng: -9.1,
        author: { id: 'u1', name: 'Clara', avatar: null },
        entry_id: 'e1',
        rating: 4.5,
        note: 'great bread',
        has_review: true,
        others_count: 2,
        ...over,
    };
}

describe('spotsToMapItems', () => {
    it('maps logged spots to olive "been" pins (no entryId)', () => {
        const items = spotsToMapItems([spot({ restaurant_id: 'a' })]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: 'a',
            name: 'Spot',
            city: 'Tokyo',
            cuisine: 'Japanese',
            lat: 35.6,
            lng: 139.7,
            been: true,
        });
        expect(items[0].entryId).toBeUndefined();
    });

    it('drops coord-less spots (callers count them via the length delta)', () => {
        const spots = [
            spot({ restaurant_id: 'a' }),
            spot({ restaurant_id: 'b', lat: null, lng: null }),
            spot({ restaurant_id: 'c', lat: 1.0, lng: null }),
        ];
        const items = spotsToMapItems(spots);
        expect(items.map((i) => i.id)).toEqual(['a']);
        expect(spots.length - items.length).toBe(2); // the unmappable derivation
    });

    it('tolerates null/undefined input', () => {
        expect(spotsToMapItems(null)).toEqual([]);
        expect(spotsToMapItems(undefined)).toEqual([]);
    });
});

describe('networkPinsToMapItems', () => {
    it('maps the network wire shape to avatar-pin items (entryId present)', () => {
        const items = networkPinsToMapItems([pin({ restaurant_id: 'r1' })]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            id: 'r1',
            entryId: 'e1',
            author: { id: 'u1', name: 'Clara', avatar: null },
            rating: 4.5,
            note: 'great bread',
            hasReview: true,
            othersCount: 2,
        });
        expect(items[0].been).toBeUndefined();
    });

    it('tolerates null/undefined input', () => {
        expect(networkPinsToMapItems(null)).toEqual([]);
        expect(networkPinsToMapItems(undefined)).toEqual([]);
    });
});

describe('filterItemsByCuisine', () => {
    const items = [
        ...spotsToMapItems([
            spot({ restaurant_id: 'a', cuisine: 'Japanese' }),
            spot({ restaurant_id: 'b', cuisine: ' Japanese ' }), // trim-matched
            spot({ restaurant_id: 'c', cuisine: 'Italian' }),
            spot({ restaurant_id: 'd', cuisine: null }),
        ]),
        ...networkPinsToMapItems([pin({ restaurant_id: 'e', cuisine: 'Japanese' })]),
    ];

    it('null filter passes everything through (same array semantics)', () => {
        expect(filterItemsByCuisine(items, null)).toHaveLength(5);
    });

    it('trim-matches the active cuisine across layers', () => {
        const filtered = filterItemsByCuisine(items, 'Japanese');
        expect(filtered.map((i) => i.id).sort()).toEqual(['a', 'b', 'e']);
    });

    it('excludes null-cuisine items when a filter is set', () => {
        expect(filterItemsByCuisine(items, 'Italian').map((i) => i.id)).toEqual(['c']);
    });
});
