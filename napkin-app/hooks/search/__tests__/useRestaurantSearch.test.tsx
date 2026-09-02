import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { useNearbyLocation } from '@/hooks/useNearbyLocation';
import { searchCache } from '../searchCache';
import { toCoordsBucket, useRestaurantSearch } from '../useRestaurantSearch';

const mockGetPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockLastKnown = jest.fn();
const mockCurrent = jest.fn();

jest.mock('expo-location', () => ({
    Accuracy: { Balanced: 3 },
    getForegroundPermissionsAsync: (...args: unknown[]) => mockGetPermissions(...args),
    requestForegroundPermissionsAsync: (...args: unknown[]) => mockRequestPermissions(...args),
    getLastKnownPositionAsync: (...args: unknown[]) => mockLastKnown(...args),
    getCurrentPositionAsync: (...args: unknown[]) => mockCurrent(...args),
    watchPositionAsync: jest.fn(),
}));

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

function wrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
}

const EMPTY_PERSISTED = { visitedByMyTables: [], onNapkin: [] };

beforeEach(() => {
    jest.clearAllMocks();
    searchCache.clear();
    searchCache.setActiveUser('user-1');
    mockGetPermissions.mockResolvedValue({ status: 'undetermined' });
    mockRequestPermissions.mockResolvedValue({ status: 'granted' });
    mockLastKnown.mockResolvedValue({ coords: { latitude: 51.5, longitude: -0.1 } });
    mockCurrent.mockResolvedValue(null);
    mockCallEdgeFn.mockImplementation(async (name) =>
        name === 'places-search' ? [] : EMPTY_PERSISTED
    );
});

describe('useRestaurantSearch cache and location lifecycle', () => {
    it('enabled=false suppresses both restaurant requests and re-enables them on switch', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result, rerender } = renderHook(
            ({ enabled }: { enabled: boolean }) =>
                useRestaurantSearch('Parisik', 'user-1', { enabled }),
            { initialProps: { enabled: false }, wrapper: wrapper(queryClient) },
        );
        await act(async () => {});
        act(() => result.current.refetch());
        expect(mockCallEdgeFn).not.toHaveBeenCalled();

        rerender({ enabled: true });
        await waitFor(() => expect(mockCallEdgeFn).toHaveBeenCalledTimes(2));
        expect(mockCallEdgeFn.mock.calls.map(([name]) => name).sort()).toEqual([
            'places-search',
            'restaurant-history',
        ]);
    });

    it('a caller that omits enabled behaves as before', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        renderHook(() => useRestaurantSearch('Parisik', 'user-1'), {
            wrapper: wrapper(queryClient),
        });
        await waitFor(() => expect(mockCallEdgeFn).toHaveBeenCalledTimes(2));
    });

    it('propagates a persisted-source error and its dedicated retry', async () => {
        mockCallEdgeFn.mockImplementation(async (name) => {
            if (name === 'restaurant-history') throw new Error('persisted unavailable');
            return [];
        });
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result } = renderHook(
            () => useRestaurantSearch('Parisik', 'user-1'),
            { wrapper: wrapper(queryClient) },
        );

        await waitFor(
            () => expect(result.current.isPersistedError).toBe(true),
            { timeout: 3500 },
        );
        expect(result.current.persistedError?.message).toBe('persisted unavailable');

        const beforeRetry = mockCallEdgeFn.mock.calls.filter(
            ([name]) => name === 'restaurant-history',
        ).length;
        act(() => result.current.refetchPersisted());
        await waitFor(() => expect(
            mockCallEdgeFn.mock.calls.filter(([name]) => name === 'restaurant-history').length,
        ).toBeGreaterThan(beforeRetry));
    });

    it('keeps warm rows visible when a source refetch fails', async () => {
        const place = {
            id: 'ChIJwarm',
            name: 'Warm row',
            city: 'London',
            cuisine: 'Bistro',
            photoReference: null,
            photoAttributionHtml: null,
            formattedAddress: 'London',
            latitude: 51.5,
            longitude: -0.1,
            googleRating: 4.2,
        };
        mockCallEdgeFn.mockImplementation(async (name) => (
            name === 'places-search' ? [place] : EMPTY_PERSISTED
        ));
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const { result } = renderHook(
            () => useRestaurantSearch('Warm', 'user-1'),
            { wrapper: wrapper(queryClient) },
        );
        await waitFor(() => expect(result.current.results.morePlaces).toHaveLength(1));

        mockCallEdgeFn.mockImplementation(async (name) => {
            if (name === 'places-search') throw new Error('places unavailable');
            return EMPTY_PERSISTED;
        });
        act(() => result.current.refetchPlaces());

        await waitFor(
            () => expect(result.current.isPlacesError).toBe(true),
            { timeout: 3500 },
        );
        expect(result.current.results.morePlaces.map((row) => row.name)).toEqual(['Warm row']);
    });

    it('waits through granted-with-coordinates-pending and sends one biased Places query', async () => {
        let resolvePosition!: (value: {
            coords: { latitude: number; longitude: number };
        }) => void;
        mockGetPermissions.mockResolvedValue({ status: 'granted' });
        mockLastKnown.mockReturnValue(new Promise((resolve) => {
            resolvePosition = resolve;
        }));
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const { result } = renderHook(
            () => useRestaurantSearch('Parisik', 'user-1', { grantedLocationBias: true }),
            { wrapper: wrapper(queryClient) },
        );

        await waitFor(() => expect(result.current.permissionStatus).toBe('granted'));
        expect(
            mockCallEdgeFn.mock.calls.filter(([name]) => name === 'places-search'),
        ).toHaveLength(0);

        await act(async () => {
            resolvePosition({ coords: { latitude: 51.5, longitude: -0.1 } });
        });

        await waitFor(() => {
            const placesCalls = mockCallEdgeFn.mock.calls.filter(
                ([name]) => name === 'places-search',
            );
            expect(placesCalls).toHaveLength(1);
            expect(placesCalls[0][1]).toMatchObject({
                body: {
                    query: 'Parisik',
                    lat: 51.5,
                    lng: -0.1,
                    global_fallback: true,
                },
            });
        });
    });

    it('keeps a transient permission-read failure unresolved so a later mount can retry', async () => {
        mockGetPermissions.mockRejectedValueOnce(new Error('permission service unavailable'));
        const first = renderHook(() => useNearbyLocation());
        await act(async () => {
            await first.result.current.requestIfGranted();
        });
        expect(first.result.current.permissionStatus).toBeNull();
        expect(first.result.current.settled).toBe(true);
        first.unmount();

        mockGetPermissions.mockResolvedValueOnce({ status: 'undetermined' });
        const second = renderHook(() => useNearbyLocation());
        await act(async () => {
            await second.result.current.requestIfGranted();
        });
        expect(second.result.current.permissionStatus).toBe('undetermined');
        expect(second.result.current.settled).toBe(true);
    });

    it('re-fetches both sources after leaving and re-entering an all-empty query', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const { rerender } = renderHook<ReturnType<typeof useRestaurantSearch>, { query: string }>(
            ({ query }) => useRestaurantSearch(query, 'user-1', { grantedLocationBias: true }),
            { initialProps: { query: 'missing' }, wrapper: wrapper(queryClient) },
        );

        await waitFor(() => expect(mockCallEdgeFn).toHaveBeenCalledTimes(2));
        rerender({ query: '' });
        await act(async () => {});
        rerender({ query: 'missing' });
        await waitFor(() => expect(mockCallEdgeFn).toHaveBeenCalledTimes(4));
    });

    it('grant updates coords, request bucket, and fallback opt-in without remount', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const { result } = renderHook(() => {
            const search = useRestaurantSearch('Parisik', 'user-1', {
                grantedLocationBias: true,
            });
            return {
                search,
                bucket: toCoordsBucket(search.coords),
            };
        }, { wrapper: wrapper(queryClient) });

        await waitFor(() => expect(result.current.search.permissionStatus).toBe('undetermined'));
        expect(result.current.bucket).toBeNull();

        await act(async () => {
            await result.current.search.requestLocation();
        });

        await waitFor(() => expect(result.current.bucket).toBe('51.5,-0.1'));
        expect(result.current.search.permissionStatus).toBe('granted');
        await waitFor(() => {
            const placesCalls = mockCallEdgeFn.mock.calls.filter(([name]) => name === 'places-search');
            expect(placesCalls).toHaveLength(2);
            expect(placesCalls[1][1]).toMatchObject({
                body: {
                    query: 'Parisik',
                    lat: 51.5,
                    lng: -0.1,
                    global_fallback: true,
                },
            });
        });
    });

    it('hydrates nearby coords in city mode without adding them to the Places request', async () => {
        mockGetPermissions.mockResolvedValue({ status: 'granted' });
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const { result } = renderHook(
            () => useRestaurantSearch('Parisik', 'user-1', {
                grantedLocationBias: true,
                locality: { city: 'Paris' },
            }),
            { wrapper: wrapper(queryClient) },
        );

        await waitFor(() => {
            const placesCalls = mockCallEdgeFn.mock.calls.filter(
                ([name]) => name === 'places-search',
            );
            expect(placesCalls).toHaveLength(1);
            expect(placesCalls[0][1]).toEqual({
                body: { query: 'Parisik', limit: 15, city: 'Paris' },
            });
        });
        await waitFor(() => expect(result.current.coords).toEqual({
            latitude: 51.5,
            longitude: -0.1,
        }));
        expect(mockGetPermissions).toHaveBeenCalledTimes(1);
        expect(mockRequestPermissions).not.toHaveBeenCalled();
    });
});
