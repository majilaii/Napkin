import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { placesScreenState } from '@/hooks/search/placesScreenState';
import { searchCache } from '@/hooks/search/searchCache';
import PlacesScreen from '@/app/(tabs)/places';

const mockSetParams = jest.fn();
const mockPush = jest.fn();
const mockRequestIfGranted = jest.fn().mockResolvedValue(undefined);
let mockRouteParams: { mode?: string; q?: string } = { mode: 'people' };
const mockWishlistRefetch = jest.fn();
const mockUseMyLists = jest.fn();
let mockCoords: { latitude: number; longitude: number } | null = null;
let mockSpots: unknown[] = [];
let mockWishlistState = {
    data: { pages: [] } as { pages: { data?: unknown[] }[] } | undefined,
    isLoading: false,
    isError: false,
    refetch: mockWishlistRefetch,
};

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children as React.ReactNode);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        FlatList: host('FlatList'),
        Keyboard: { dismiss: jest.fn() },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
        StyleSheet: {
            absoluteFill: { position: 'absolute', inset: 0 },
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => style,
        },
        Text: host('Text'),
        TextInput: host('TextInput'),
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
        View: host('View'),
    };
});
jest.mock('react-native-reanimated', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const MockFlatList = ReactModule.forwardRef((props: Record<string, unknown>, ref) => {
        ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }));
        return ReactModule.createElement(
            'AnimatedFlatList',
            props,
            ReactModule.createElement(
                ReactModule.Fragment,
                null,
                props.ListHeaderComponent as React.ReactNode,
                props.children as React.ReactNode,
            ),
        );
    });
    return { __esModule: true, default: { FlatList: MockFlatList } };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('expo-router', () => ({
    useLocalSearchParams: () => mockRouteParams,
    useRouter: () => ({ setParams: mockSetParams, push: mockPush }),
}));
jest.mock('expo-linear-gradient', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native') as typeof import('react-native');
    return {
        LinearGradient: ({ children, ...props }: { children?: React.ReactNode }) => (
            <ReactNative.View {...props}>{children}</ReactNative.View>
        ),
    };
});
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'viewer' } }),
}));
jest.mock('@/hooks/useNearbyLocation', () => ({
    useNearbyLocation: () => ({
        coords: mockCoords,
        permissionStatus: mockCoords ? 'granted' : 'denied',
        settled: true,
        status: 'denied',
        request: jest.fn().mockResolvedValue(undefined),
        requestIfGranted: mockRequestIfGranted,
    }),
}));
jest.mock('@/hooks/search/useSearchLocality', () => ({
    useSearchLocality: () => ({
        locality: 'auto',
        setAuto: jest.fn(),
        setCity: jest.fn(),
    }),
}));
jest.mock('@/hooks/users', () => ({
    useUserProfile: () => ({
        data: { data: { profile: { home_city: null } } },
        isSuccess: true,
    }),
}));
jest.mock('@/hooks/users/useUserSpots', () => ({
    useUserSpots: () => ({
        data: mockSpots,
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
    }),
}));
jest.mock('@/hooks/lists/useMyLists', () => ({
    useMyLists: (userId: string | null | undefined) => {
        mockUseMyLists(userId);
        return {
            data: [{
                id: 'list-1',
                owner_id: 'viewer',
                title: 'Late suppers',
                description: null,
                ranked: false,
                privacy: 'private',
                emoji: null,
                entry_count: 3,
                cover_photo_url: null,
                created_at: '2026-09-02T00:00:00Z',
                updated_at: '2026-09-02T00:00:00Z',
            }],
        };
    },
}));
jest.mock('@/hooks/wishlist/useMyWishlist', () => ({
    useMyWishlist: () => mockWishlistState,
}));
jest.mock('@/components/search', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native') as typeof import('react-native');
    const Stub = () => <ReactNative.View />;
    return {
        ListsSearchPane: ({ query }: { query: string }) => (
            <ReactNative.Text testID="lists-pane-state">
                {query.trim().length < 2 ? 'guidance' : `results:${query}`}
            </ReactNative.Text>
        ),
        PeopleSearchPane: Stub,
        ListRow: ({ list }: { list: { title: string } }) => (
            <ReactNative.Text>{list.title}</ReactNative.Text>
        ),
        RecentSearchesList: ({ queries }: { queries: readonly string[] }) => (
            <ReactNative.Text>{`RECENT ${queries.join(', ')}`}</ReactNative.Text>
        ),
        SearchLocalityBar: Stub,
        SearchModeTabs: Stub,
        TierHeader: ({ label }: { label: string }) => (
            <ReactNative.Text>{label.toUpperCase()}</ReactNative.Text>
        ),
    };
});
jest.mock('@/components/sheets/SnapSheet', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native') as typeof import('react-native');
    return {
        SnapSheet: ({ renderHeader, renderContent, ...props }: {
            renderHeader?: () => React.ReactNode;
            renderContent: (adapter: { scrollEnabled: boolean; onScroll: jest.Mock }) => React.ReactNode;
        } & Record<string, unknown>) => (
            <ReactNative.View testID="places-snap-sheet" {...props}>
                {renderHeader?.()}
                {renderContent({ scrollEnabled: true, onScroll: jest.fn() })}
            </ReactNative.View>
        ),
    };
});
// TICKET-230: the clip doorway's live hooks (App-Group polling, list_imports,
// completeness) are out of scope for the paid-call gate — pin a resting tray.
jest.mock('@/hooks/imports/useClipTray', () => ({
    useClipTray: () => ({
        pill: { kind: 'resting' },
        rows: [],
        hasOlder: false,
        isEmpty: true,
    }),
}));

jest.mock('@/components/wishlist', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native') as typeof import('react-native');
    return {
        WishlistMapView: () => <ReactNative.View />,
        FilterTabsSheet: () => <ReactNative.View />,
        ImportLinkSheet: () => <ReactNative.View />,
        ClipTray: () => <ReactNative.View />,
    };
});

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('Places People-segment paid-call gate', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockRouteParams = { mode: 'people' };
        mockCoords = null;
        mockSpots = [];
        mockWishlistState = {
            data: { pages: [] },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
        };
        placesScreenState.setActiveUser('reset-user');
        placesScreenState.setActiveUser('viewer');
        searchCache.setActiveUser('reset-user');
        searchCache.setActiveUser('viewer');
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('makes exactly zero places-search and restaurant-history search calls while typing', () => {
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );

        fireEvent.changeText(
            screen.getByLabelText('find a place, list, or person'),
            'parisik',
        );
        act(() => jest.advanceTimersByTime(300));

        const placesCalls = mockCallEdgeFn.mock.calls.filter(([name]) => name === 'places-search');
        const persistedSearchCalls = mockCallEdgeFn.mock.calls.filter(([name, options]) => (
            name === 'restaurant-history' && options?.action === 'search'
        ));
        expect(placesCalls).toHaveLength(0);
        expect(persistedSearchCalls).toHaveLength(0);
        expect(mockCallEdgeFn).toHaveBeenCalledTimes(0);
        expect(mockUseMyLists).toHaveBeenLastCalledWith(null);
    });

    it('opens mode=lists without q on guidance instead of stale saved results', () => {
        mockRouteParams = { mode: 'lists' };
        placesScreenState.patch('viewer', { query: 'old dinner' });
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );

        expect(screen.getByTestId('lists-pane-state')).toHaveTextContent('guidance');
        expect(screen.getByLabelText('find a place, list, or person').props.value).toBe('');
        expect(placesScreenState.get('viewer').query).toBe('');
    });

    it('renders retryable broken-empty when the uncached wishlist source fails', () => {
        mockRouteParams = {};
        mockWishlistState = {
            data: undefined,
            isLoading: false,
            isError: true,
            refetch: mockWishlistRefetch,
        };
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );

        expect(screen.getByText("couldn't load places")).toBeTruthy();
        expect(mockUseMyLists).toHaveBeenLastCalledWith(null);
        fireEvent.press(screen.getByText('try again'));
        expect(mockWishlistRefetch).toHaveBeenCalledTimes(1);
    });

    it('renders the default union count and lets each layer filter release or switch', () => {
        mockRouteParams = {};
        mockWishlistState = {
            data: {
                pages: [{
                    data: ['shared', 'pinned-only'].map((id) => ({
                        restaurant: {
                            id,
                            name: id,
                            city: 'London',
                            cuisine: 'British',
                            lat: 51.5,
                            lng: -0.1,
                            price_level: 2,
                            google_rating: 4.2,
                        },
                    })),
                }],
            },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
        };
        mockSpots = ['shared', 'been-only'].map((id) => ({
            restaurant_id: id,
            name: id,
            city: 'London',
            cuisine: 'British',
            lat: 51.5,
            lng: -0.1,
            price_level: 2,
            avg_rating: 4.5,
        }));
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );

        expect(screen.getByText('3 places')).toBeTruthy();
        expect(screen.getByLabelText('pinned').props.accessibilityState.selected).toBe(false);
        expect(screen.getByLabelText('been').props.accessibilityState.selected).toBe(false);

        fireEvent.press(screen.getByLabelText('pinned'));
        expect(screen.getByText('2 places')).toBeTruthy();
        expect(placesScreenState.get('viewer').layerFilter).toBe('pinned');

        fireEvent.press(screen.getByLabelText('pinned'));
        expect(screen.getByText('3 places')).toBeTruthy();
        expect(placesScreenState.get('viewer').layerFilter).toBe('all');

        fireEvent.press(screen.getByLabelText('been'));
        expect(screen.getByText('2 places')).toBeTruthy();
        expect(placesScreenState.get('viewer').layerFilter).toBe('been');
    });

    it('focuses into full search sections, swaps to results, clears, and restores peek', () => {
        mockRouteParams = {};
        mockCoords = { latitude: 51.5, longitude: -0.1 };
        mockWishlistState = {
            data: {
                pages: [{
                    data: [{
                        restaurant: {
                            id: 'restaurant-1',
                            name: 'Brawn',
                            city: 'London',
                            cuisine: 'British',
                            lat: 51.53,
                            lng: -0.07,
                            price_level: 3,
                            google_rating: 4.6,
                        },
                    }],
                }],
            },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
        };
        searchCache.addRecent('ramen');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );
        const field = screen.getByLabelText('find a place, list, or person');

        fireEvent(field, 'focus');

        expect(screen.getByTestId('places-snap-sheet').props).toMatchObject({
            locked: true,
            contentKey: 'search:places:sections:',
        });
        expect(screen.getByText('RECENT ramen')).toBeTruthy();
        expect(screen.getByText('NEAR YOU')).toBeTruthy();
        expect(screen.getByText('YOUR LISTS')).toBeTruthy();
        expect(screen.queryByLabelText('pinned')).toBeNull();

        fireEvent.changeText(field, 'parisik');
        expect(screen.queryByTestId('places-search-sections')).toBeNull();
        expect(screen.getByTestId('places-snap-sheet').props.contentKey)
            .toBe('search:places:results:');

        fireEvent.press(screen.getByLabelText('clear search'));
        expect(screen.getByTestId('places-search-sections')).toBeTruthy();
        expect(screen.getByTestId('places-snap-sheet').props.contentKey)
            .toBe('search:places:sections:');

        fireEvent.press(screen.getByLabelText('back to places map'));
        expect(placesScreenState.get('viewer')).toMatchObject({
            query: '',
            sheetSnap: 0,
            layerFilter: 'all',
            previousNonSearchSnap: null,
        });
        expect(screen.getByTestId('places-snap-sheet').props.locked).toBe(false);
    });
});
