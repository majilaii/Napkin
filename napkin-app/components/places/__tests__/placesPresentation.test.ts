import {
    composeFriendCaptionMeta,
    composeRowMeta,
    composePlacesContentKey,
    decorateAndSortRows,
    deriveDistanceOrigin,
    filterPlacesLayerRows,
    networkRowsToDisplayRows,
    placesCountLabel,
    placesListsContentBranch,
    placesSearchBranch,
    placesViewToggle,
    presentPlacesRating,
    projectPlacesPins,
    resolvePlacesFailurePresentation,
    resolvePlacesListsBranch,
    resolvePlacesProjection,
    restaurantRouteForRow,
    searchRowsToDisplayRows,
    selectNearbyPlaces,
    shouldFetchNextPlacesPage,
} from '../placesPresentation';
import type { SearchResultRow } from '@/hooks/search/useRestaurantSearch';
import type { NetworkMapItem } from '@/hooks/users/useNetworkMapPins';
import { FULL, HALF, PEEK } from '@/components/sheets/snapSheetMath';

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

const networkPin: NetworkMapItem = {
    restaurant_id: 'friend-only',
    name: 'Koya',
    city: 'London',
    cuisine: 'Japanese',
    lat: 51.52,
    lng: -0.12,
    author: { id: 'clara-id', name: 'clara', avatar: 'https://example.com/clara.jpg' },
    entry_id: 'entry-1',
    rating: 4.7,
    note: 'The udon worth crossing town for.',
    has_review: true,
    others_count: 2,
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
        const friends = networkRowsToDisplayRows([networkPin]);

        const all = filterPlacesLayerRows('all', pinned, been, friends);
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
        expect(all.some((row) => row.id === 'friend-only')).toBe(false);
        expect(filterPlacesLayerRows('friends', pinned, been, friends)).toEqual(friends);
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

    it('maps friend rows without a rating tier and forwards the complete network pin face', () => {
        const [row] = networkRowsToDisplayRows([networkPin]);
        expect(row).toMatchObject({
            id: 'friend-only',
            rating: null,
            priceLevel: null,
            isPinned: false,
            friendsBeenCount: 3,
            network: {
                author: networkPin.author,
                entryId: 'entry-1',
                hasReview: true,
                rating: 4.7,
                note: 'The udon worth crossing town for.',
            },
        });
        expect(composeFriendCaptionMeta(row)).toBe('clara · 3 friends been');
        expect(composeRowMeta(row, '1.2 km')).toBe('japanese · 1.2 km · 3 friends been');
        expect(projectPlacesPins([row])[0]).toMatchObject({
            author: networkPin.author,
            entryId: 'entry-1',
            hasReview: true,
            rating: 4.7,
            note: 'The udon worth crossing town for.',
            othersCount: 2,
        });
        expect(restaurantRouteForRow(row)).toEqual({
            pathname: '/restaurant/[id]',
            params: { id: 'friend-only' },
        });
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
        expect(composePlacesContentKey({
            searchMode: false,
            segment: 'places',
            branch: 'guidance-friends',
            query: '',
        })).not.toBe(browse);
    });

    it('keys every lists shelf state and keeps one-character search off the shelf', () => {
        for (const branch of ['loading', 'error', 'empty', 'rows'] as const) {
            expect(composePlacesContentKey({
                searchMode: false,
                segment: 'lists',
                branch: placesListsContentBranch('', branch),
                query: '',
            })).toBe(`browse:lists:${branch}:`);
            expect(composePlacesContentKey({
                searchMode: true,
                segment: 'lists',
                branch: placesListsContentBranch('', branch),
                query: '',
            })).toBe(`search:lists:${branch}:`);
        }
        expect(placesListsContentBranch('k', 'rows')).toBe('minimum');
        expect(composePlacesContentKey({
            searchMode: true,
            segment: 'lists',
            branch: placesListsContentBranch('k', 'rows'),
            query: 'k',
        })).toBe('search:lists:minimum:k');
        expect(placesListsContentBranch('ko', 'rows')).toBe('results');
    });

    it('resolves lists loading, cold failure, intended-empty, and warm rows distinctly', () => {
        const base = {
            myCount: 0,
            savedCount: 0,
            myLoading: false,
            savedLoading: false,
            myError: false,
            savedError: false,
        };
        expect(resolvePlacesListsBranch({ ...base, savedLoading: true })).toBe('loading');
        expect(resolvePlacesListsBranch({ ...base, myError: true })).toBe('error');
        expect(resolvePlacesListsBranch(base)).toBe('empty');
        expect(resolvePlacesListsBranch({ ...base, myCount: 1, myError: true })).toBe('rows');
        expect(resolvePlacesListsBranch({ ...base, savedError: true })).toBe('rows');
    });

    it('flips the map/list label from the settled snap and guards wishlist pagination', () => {
        expect(placesViewToggle(PEEK)).toEqual({
            label: 'list', icon: 'list-outline', target: FULL,
        });
        expect(placesViewToggle(HALF)).toEqual({
            label: 'list', icon: 'list-outline', target: FULL,
        });
        expect(placesViewToggle(FULL)).toEqual({
            label: 'map', icon: 'map-outline', target: PEEK,
        });
        expect(placesCountLabel(40, true)).toBe('40+ places');
        expect(placesCountLabel(81, false)).toBe('81 places');

        const base = {
            searchMode: false,
            activeSegment: 'places' as const,
            layerFilter: 'all' as const,
            hasNextPage: true,
            isFetchingNextPage: false,
        };
        expect(shouldFetchNextPlacesPage(base)).toBe(true);
        expect(shouldFetchNextPlacesPage({ ...base, layerFilter: 'pinned' })).toBe(true);
        expect(shouldFetchNextPlacesPage({ ...base, layerFilter: 'been' })).toBe(false);
        expect(shouldFetchNextPlacesPage({ ...base, layerFilter: 'friends' })).toBe(false);
        expect(shouldFetchNextPlacesPage({ ...base, searchMode: true })).toBe(false);
        expect(shouldFetchNextPlacesPage({ ...base, activeSegment: 'lists' })).toBe(false);
        expect(shouldFetchNextPlacesPage({ ...base, isFetchingNextPage: true })).toBe(false);
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
            networkFailed: false,
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
            networkFailed: false,
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
            networkFailed: false,
        })).toEqual({ kind: 'inline', sources: ['wishlist', 'spots'] });
    });

    it('uses only the network failure source for the friends layer', () => {
        const base = {
            queryActive: false,
            layerFilter: 'friends' as const,
            placesFailed: false,
            persistedFailed: false,
            wishlistFailed: true,
            spotsFailed: true,
            networkFailed: true,
        };
        expect(resolvePlacesFailurePresentation({ ...base, hasCachedRows: false })).toEqual({
            kind: 'broken', sources: ['network'],
        });
        expect(resolvePlacesFailurePresentation({ ...base, hasCachedRows: true })).toEqual({
            kind: 'inline', sources: ['network'],
        });
    });
});
