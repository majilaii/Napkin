import {
    composeRowMeta,
    composePlacesContentKey,
    decorateAndSortRows,
    deriveDistanceOrigin,
    filterPlacesLayerRows,
    placesSearchBranch,
    presentPlacesRating,
    projectPlacesPins,
    resolvePlacesFailurePresentation,
    resolvePlacesProjection,
    searchRowsToDisplayRows,
    selectNearbyPlaces,
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
    it('dedupes the all layer by restaurant id and gives overlaps the been glyph', () => {
        const pinned = searchRowsToDisplayRows([
            { ...ghost, id: 'shared', isPinned: true },
            { ...ghost, id: 'pinned-only', name: 'Pinned only', isPinned: true },
        ]);
        const been = searchRowsToDisplayRows([
            { ...ghost, id: 'shared', rating: { tier: 'you', value: 4.5, scale: 5 } },
            { ...ghost, id: 'been-only', name: 'Been only' },
        ]).map((row) => ({ ...row, been: true }));

        const all = filterPlacesLayerRows('all', pinned, been);
        expect(all.map((row) => row.id)).toEqual(['shared', 'pinned-only', 'been-only']);
        expect(all).toHaveLength(3);
        expect(projectPlacesPins(all).find((pin) => pin.id === 'shared')?.been).toBe(true);
        expect(all.find((row) => row.id === 'shared')).toMatchObject({
            isPinned: true,
            been: true,
            rating: { tier: 'you', value: 4.5, scale: 5 },
        });
        expect(filterPlacesLayerRows('pinned', pinned, been)).toHaveLength(2);
        expect(filterPlacesLayerRows('been', pinned, been)).toHaveLength(2);
    });

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
        expect(resolvePlacesProjection('places', ['place:b'], frozen, true)).toEqual({
            rendered: frozen,
            nextFrozen: frozen,
        });
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

    it('selects the nearest six only with an auto-locality distance origin', () => {
        const origin = { latitude: 51.5, longitude: -0.1 };
        const rows = Array.from({ length: 8 }, (_, index) => ({
            ...searchRowsToDisplayRows([ghost])[0],
            id: `row-${index}`,
            name: `Row ${index}`,
            lat: 51.5 + ((7 - index) * 0.01),
            lng: -0.1,
        }));

        expect(selectNearbyPlaces(rows, origin)).toHaveLength(6);
        expect(selectNearbyPlaces(rows, origin)[0].row.id).toBe('row-7');
        expect(selectNearbyPlaces(rows, null)).toEqual([]);
        expect(selectNearbyPlaces(rows, deriveDistanceOrigin({ city: 'Paris' }, origin))).toEqual([]);
    });

    it('moves focused-empty to results and back with a fresh content identity each time', () => {
        const sections = composePlacesContentKey({
            searchMode: true,
            segment: 'places',
            branch: placesSearchBranch(''),
            query: '',
        });
        const results = composePlacesContentKey({
            searchMode: true,
            segment: 'places',
            branch: placesSearchBranch('parisik'),
            query: 'parisik',
        });
        const cleared = composePlacesContentKey({
            searchMode: true,
            segment: 'places',
            branch: placesSearchBranch(''),
            query: '',
        });
        const browse = composePlacesContentKey({
            searchMode: false,
            segment: 'places',
            branch: 'guidance',
            query: '',
        });

        expect(sections).toBe('search:places:sections:');
        expect(results).toBe('search:places:results:parisik');
        expect(results).not.toBe(sections);
        expect(cleared).not.toBe(results);
        expect(browse).not.toBe(cleared);
    });

    it('composes only present metadata tokens', () => {
        const [row] = searchRowsToDisplayRows([{ ...ghost, friendsBeenCount: 2, isPinned: true }]);
        expect(composeRowMeta(row, '0.3 mi')).toBe('bistro · 0.3 mi · 2 friends been · pinned');
    });

    it('treats an uncached wishlist failure as broken-empty and a warm failure inline', () => {
        const base = {
            queryActive: false,
            layerFilter: 'pinned' as const,
            placesFailed: false,
            persistedFailed: false,
            wishlistFailed: true,
            spotsFailed: false,
        };
        expect(resolvePlacesFailurePresentation({ ...base, hasCachedRows: false })).toEqual({
            kind: 'broken',
            sources: ['wishlist'],
        });
        expect(resolvePlacesFailurePresentation({ ...base, hasCachedRows: true })).toEqual({
            kind: 'inline',
            sources: ['wishlist'],
        });
    });

    it('never presents a persisted-source failure as successful empty metadata', () => {
        expect(resolvePlacesFailurePresentation({
            queryActive: true,
            layerFilter: 'pinned',
            hasCachedRows: false,
            placesFailed: false,
            persistedFailed: true,
            wishlistFailed: false,
            spotsFailed: false,
        })).toEqual({ kind: 'broken', sources: ['persisted'] });
    });

    it('checks both local sources for the all layer', () => {
        expect(resolvePlacesFailurePresentation({
            queryActive: false,
            layerFilter: 'all',
            hasCachedRows: true,
            placesFailed: false,
            persistedFailed: false,
            wishlistFailed: true,
            spotsFailed: true,
        })).toEqual({ kind: 'inline', sources: ['wishlist', 'spots'] });
    });
});
