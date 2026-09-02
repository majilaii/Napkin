import {
    composeRowMeta,
    decorateAndSortRows,
    deriveDistanceOrigin,
    presentPlacesRating,
    projectPlacesPins,
    restaurantRouteForRow,
    resolvePlacesProjection,
    searchRowsToDisplayRows,
} from '../placesPresentation';
import type { SearchResultRow } from '@/hooks/search/useRestaurantSearch';

const ghost: SearchResultRow = {
    placeId: 'ChIJparisik',
    name: 'Parisik',
    city: 'Paris',
    cuisine: 'Bistro',
    address: 'Paris',
    photoUrl: null,
    photoReference: null,
    photoAttributionHtml: null,
    tier: 'morePlaces',
    lat: 48.86,
    lng: 2.35,
    rating: { tier: 'google', value: 4.6, scale: 5 },
    place: {
        id: 'ChIJparisik',
        name: 'Parisik',
        city: 'Paris',
        cuisine: 'Bistro',
        photoReference: null,
        photoAttributionHtml: null,
        formattedAddress: 'Paris',
        latitude: 48.86,
        longitude: 2.35,
        googleRating: 4.6,
        priceLevel: 2,
    },
};

describe('Places projection', () => {
    it('commits pins only in Places, never from disabled Lists or People', () => {
        const frozen = ['place:a'];
        expect(resolvePlacesProjection('places', ['place:b'], frozen)).toEqual({
            rendered: ['place:b'],
            nextFrozen: ['place:b'],
        });
        for (const segment of ['lists', 'people'] as const) {
            expect(resolvePlacesProjection(segment, [], frozen)).toEqual({
                rendered: frozen,
                nextFrozen: frozen,
            });
        }
    });

    it('labels Google ratings as muted and reserves amber for Napkin tiers', () => {
        expect(presentPlacesRating({ tier: 'google', value: 4.6, scale: 5 })).toEqual({
            value: '4.6',
            suffix: ' · google',
            tone: 'muted',
        });
        expect(presentPlacesRating({ tier: 'friends', value: 3.3, scale: 5 }).tone).toBe('amber');
        expect(presentPlacesRating(null)).toEqual({
            value: null,
            suffix: 'not yet rated',
            tone: 'faint',
        });
    });

    it('uses synthetic place ids and keeps the full sanitized Place on ghost pins', () => {
        const [row] = searchRowsToDisplayRows([ghost]);
        const [pin] = projectPlacesPins([row]);
        expect(pin.id).toBe('place:ChIJparisik');
        expect(pin.searchRow?.place).toEqual(ghost.place);
    });

    it('row and pin navigation carry a payload that suppresses Place Details lookup', () => {
        const [row] = searchRowsToDisplayRows([ghost]);
        const routeFromRow = restaurantRouteForRow(row)!;
        const routeFromPin = restaurantRouteForRow({ ...row, searchRow: projectPlacesPins([row])[0].searchRow })!;
        for (const route of [routeFromRow, routeFromPin]) {
            const payload = JSON.parse(route.params.placePayload);
            // Mirrors the existing restaurant-page lookup gate without touching
            // that in-flight screen: full payloads have coords + a defined
            // googleRating, so useLookupByPlaceId stays disabled.
            const payloadIsThin = payload.latitude == null || payload.googleRating === undefined;
            const lookupEnabled = !!route.params.placeId && payloadIsThin;
            expect(lookupEnabled).toBe(false);
        }
    });

    it('suppresses distance and preserves server order outside auto locality', () => {
        const london = { latitude: 51.5, longitude: -0.1 };
        expect(deriveDistanceOrigin({ city: 'Paris' }, london)).toBeNull();
        expect(deriveDistanceOrigin('auto', null)).toBeNull();
        const rows = searchRowsToDisplayRows([
            ghost,
            { ...ghost, placeId: 'second', name: 'Second', lat: 48.85, lng: 2.34 },
        ]);
        expect(decorateAndSortRows(rows, null).map(({ row }) => row.name)).toEqual([
            'Parisik',
            'Second',
        ]);
        expect(decorateAndSortRows(rows, null).every((row) => row.distanceLabel == null)).toBe(true);
    });

    it('composes only present metadata tokens', () => {
        const [row] = searchRowsToDisplayRows([{ ...ghost, friendsBeenCount: 2, isPinned: true }]);
        expect(composeRowMeta(row, '0.3 mi')).toBe('bistro · 0.3 mi · 2 friends been · pinned');
    });
});
