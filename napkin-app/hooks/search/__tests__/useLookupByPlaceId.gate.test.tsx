import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
    projectPlacesPins,
    restaurantRouteForRow,
    searchRowsToDisplayRows,
} from '@/components/places/placesPresentation';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { SearchResultRow } from '../useRestaurantSearch';
import {
    shouldLookupPlaceDetails,
    useLookupByPlaceId,
} from '../useLookupByPlaceId';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

function wrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    };
}

const fullGhost: SearchResultRow = {
    placeId: 'ChIJfull',
    name: 'Full ghost',
    city: 'Paris',
    cuisine: 'Bistro',
    address: '1 Rue Test',
    photoUrl: null,
    photoReference: null,
    photoAttributionHtml: null,
    tier: 'morePlaces',
    lat: 48.86,
    lng: 2.35,
    rating: { tier: 'google', value: 4.6, scale: 5 },
    place: {
        id: 'ChIJfull',
        name: 'Full ghost',
        city: 'Paris',
        cuisine: 'Bistro',
        formattedAddress: '1 Rue Test',
        photoReference: null,
        photoAttributionHtml: null,
        latitude: 48.86,
        longitude: 2.35,
        googleRating: 4.6,
        googleRatingCount: 100,
        priceLevel: 2,
        website: 'https://example.test',
        phone: '+33 1 00 00 00 00',
        google_maps_uri: 'https://maps.google.test/full',
        hours: { weekdayDescriptions: ['Monday: 12:00–22:00'] },
    },
};

describe('useLookupByPlaceId production gate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCallEdgeFn.mockResolvedValue([]);
    });

    it('does not enable Place Details for full row and pin routes', async () => {
        const [row] = searchRowsToDisplayRows([fullGhost]);
        const pinRow = { ...row, searchRow: projectPlacesPins([row])[0].searchRow };
        const routes = [restaurantRouteForRow(row)!, restaurantRouteForRow(pinRow)!];
        const payloads = routes.map((route) => JSON.parse(route.params.placePayload));
        const enabled = routes.map((route, index) => shouldLookupPlaceDetails({
            isGhost: true,
            placeId: route.params.placeId,
            placePayload: payloads[index],
        }));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        renderHook(() => {
            useLookupByPlaceId(routes[0].params.placeId, { enabled: enabled[0] });
            useLookupByPlaceId(routes[1].params.placeId, { enabled: enabled[1] });
        }, { wrapper: wrapper(client) });

        await Promise.resolve();
        expect(mockCallEdgeFn).not.toHaveBeenCalled();
    });

    it('enables one Details lookup for a deferred text-search ghost', async () => {
        const deferredGhost: SearchResultRow = {
            ...fullGhost,
            placeId: 'ChIJdeferred',
            place: {
                ...fullGhost.place!,
                id: 'ChIJdeferred',
                deferred: true,
                googleRating: null,
                website: null,
                phone: null,
                hours: null,
            },
        };
        const [row] = searchRowsToDisplayRows([deferredGhost]);
        const route = restaurantRouteForRow(row)!;
        const payload = JSON.parse(route.params.placePayload);
        const enabled = shouldLookupPlaceDetails({
            isGhost: true,
            placeId: route.params.placeId,
            placePayload: payload,
        });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        expect(enabled).toBe(true);
        renderHook(() => useLookupByPlaceId(route.params.placeId, { enabled }), {
            wrapper: wrapper(client),
        });

        await waitFor(() => expect(mockCallEdgeFn).toHaveBeenCalledTimes(1));
        expect(mockCallEdgeFn).toHaveBeenCalledWith('places-search', {
            body: { place_id: 'ChIJdeferred', persist: false },
        });
    });
});
