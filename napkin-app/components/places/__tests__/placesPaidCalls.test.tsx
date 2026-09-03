import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { Spacing } from '@/constants/theme';
import { placesScreenState } from '@/hooks/search/placesScreenState';
import { searchCache } from '@/hooks/search/searchCache';
import { queryKeys } from '@/lib/queryKeys';
import PlacesScreen from '@/app/(tabs)/places';

const mockSetParams = jest.fn();
const mockPush = jest.fn();
const mockRequestIfGranted = jest.fn().mockResolvedValue(undefined);
let mockRouteParams: { mode?: string; q?: string } = { mode: 'people' };
const mockWishlistRefetch = jest.fn();
const mockFetchNextPage = jest.fn();
const mockUseMyLists = jest.fn();
let mockCoords: { latitude: number; longitude: number } | null = null;
let mockSpots: unknown[] = [];
let mockFollowing: unknown[] = [];
let mockWishlistState = {
    data: { pages: [] } as { pages: { data?: unknown[] }[] } | undefined,
    isLoading: false,
    isError: false,
    refetch: mockWishlistRefetch,
    fetchNextPage: mockFetchNextPage,
    hasNextPage: false,
    isFetchingNextPage: false,
};

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children as React.ReactNode);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        FlatList: host('FlatList'),
        Image: host('Image'),
        Keyboard: { dismiss: jest.fn() },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        StyleSheet: {
            absoluteFill: { position: 'absolute', inset: 0 },
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => style,
            hairlineWidth: 1,
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
        const data = (props.data as unknown[] | undefined) ?? [];
        return ReactModule.createElement(
            'AnimatedFlatList',
            props,
            ReactModule.createElement(
                ReactModule.Fragment,
                null,
                props.ListHeaderComponent as React.ReactNode,
                data.length === 0
                    ? props.ListEmptyComponent as React.ReactNode
                    : data.map((item, index) => (
                        props.renderItem as (mockArgs: { item: unknown; index: number }) => React.ReactNode
                    )({ item, index })),
                props.ListFooterComponent as React.ReactNode,
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
jest.mock('@/hooks/users/useFollowingList', () => ({
    useFollowingList: (userId: string | null | undefined) => ({
        data: userId ? mockFollowing : [],
        isLoading: false,
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
        PeopleSearchPane: ({ bottomPadding }: { bottomPadding?: number }) => (
            <ReactNative.View
                {...({ testID: 'people-pane-state', bottomPadding } as React.ComponentProps<
                    typeof ReactNative.View
                >)}
            />
        ),
        ListRow: ({ list, meta }: { list: { title: string }; meta?: string }) => (
            <ReactNative.View>
                <ReactNative.Text>{list.title}</ReactNative.Text>
                {meta ? <ReactNative.Text>{meta}</ReactNative.Text> : null}
            </ReactNative.View>
        ),
        RecentSearchesList: ({ queries }: { queries: readonly string[] }) => (
            <ReactNative.Text>{`RECENT ${queries.join(', ')}`}</ReactNative.Text>
        ),
        SearchLocalityBar: Stub,
        SearchModeTabs: ({ mode, onModeChange }: {
            mode: string;
            onModeChange: (mode: 'places' | 'lists' | 'people') => void;
        }) => (
            <ReactNative.View>
                <ReactNative.Text>{`tabs:${mode}`}</ReactNative.Text>
                {(['places', 'lists', 'people'] as const).map((segment) => (
                    <ReactNative.Pressable
                        key={segment}
                        accessibilityLabel={`segment ${segment}`}
                        onPress={() => onModeChange(segment)}
                    />
                ))}
            </ReactNative.View>
        ),
        TierHeader: ({ label }: { label: string }) => (
            <ReactNative.Text>{label.toUpperCase()}</ReactNative.Text>
        ),
    };
});
jest.mock('@/components/places/PlacesListsPane', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native') as typeof import('react-native');
    return {
        PlacesListsPane: ({
            branch,
            myLists,
            savedLists,
            scrollEnabled,
            onScroll,
            onOpenList,
            onNewList,
            bottomPadding,
        }: {
            branch: string;
            myLists: { id: string; title: string }[];
            savedLists: { title: string }[];
            scrollEnabled: boolean;
            onScroll: unknown;
            onOpenList: (id: string) => void;
            onNewList: () => void;
            bottomPadding: number;
        }) => (
            <ReactNative.View {...({
                testID: 'places-lists-pane',
                branch,
                scrollEnabled,
                onScroll,
                bottomPadding,
            } as React.ComponentProps<typeof ReactNative.View>)}>
                <ReactNative.Text>Your lists</ReactNative.Text>
                {myLists.map((list) => (
                    <ReactNative.Pressable
                        key={list.title}
                        accessibilityLabel={`open list ${list.title}`}
                        onPress={() => onOpenList(list.id)}
                    >
                        <ReactNative.Text>{list.title}</ReactNative.Text>
                    </ReactNative.Pressable>
                ))}
                <ReactNative.Pressable accessibilityLabel="new list" onPress={onNewList}>
                    <ReactNative.Text>new list</ReactNative.Text>
                </ReactNative.Pressable>
                {savedLists.length > 0 ? <ReactNative.Text>Saved lists</ReactNative.Text> : null}
            </ReactNative.View>
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
        WishlistMapView: (props: Record<string, unknown>) => (
            <ReactNative.View testID="wishlist-map" {...props} />
        ),
        FilterTabsSheet: (props: Record<string, unknown>) => (
            <ReactNative.View testID="filter-sheet" {...props} />
        ),
        HandoffSheet: (props: Record<string, unknown>) => (
            <ReactNative.View testID="handoff-sheet" {...props} />
        ),
        UnmappedSpotsSheet: (props: Record<string, unknown>) => (
            <ReactNative.View testID="unmapped-sheet" {...props} />
        ),
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
        mockFollowing = [];
        mockWishlistState = {
            data: { pages: [] },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
            fetchNextPage: mockFetchNextPage,
            hasNextPage: false,
            isFetchingNextPage: false,
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

    it('opens mode=lists without q on the your/saved shelf instead of stale results', () => {
        mockRouteParams = { mode: 'lists' };
        placesScreenState.patch('viewer', { query: 'old dinner' });
        mockCallEdgeFn.mockResolvedValue([]);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );

        expect(screen.getByTestId('places-lists-pane').props.branch).toBe('rows');
        expect(screen.getByText('Your lists')).toBeTruthy();
        expect(screen.getByText('Late suppers')).toBeTruthy();
        expect(screen.getByText('new list')).toBeTruthy();
        expect(screen.getByLabelText('find a place, list, or person').props.value).toBe('');
        expect(placesScreenState.get('viewer').query).toBe('');
        expect(mockUseMyLists).toHaveBeenLastCalledWith('viewer');
        fireEvent.press(screen.getByLabelText('open list Late suppers'));
        expect(mockPush).toHaveBeenCalledWith({
            pathname: '/list/[id]',
            params: { id: 'list-1' },
        });
    });

    it('renders retryable broken-empty when the uncached wishlist source fails', () => {
        mockRouteParams = {};
        mockWishlistState = {
            data: undefined,
            isLoading: false,
            isError: true,
            refetch: mockWishlistRefetch,
            fetchNextPage: mockFetchNextPage,
            hasNextPage: false,
            isFetchingNextPage: false,
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

    it('keeps the browse detent and frozen map when opening the lists shelf', () => {
        mockRouteParams = {};
        mockCallEdgeFn.mockResolvedValue([]);
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );
        const frozenItems = screen.getByTestId('wishlist-map').props.items;
        expect(screen.getByTestId('places-snap-sheet').props.unlockedSnap).toBe(0);
        expect(screen.getByTestId('places-view-toggle')).toHaveTextContent('list');

        fireEvent.press(screen.getByLabelText('segment lists'));

        expect(placesScreenState.get('viewer')).toMatchObject({
            activeSegment: 'lists',
            sheetSnap: 0,
        });
        expect(screen.getByTestId('places-snap-sheet').props.unlockedSnap).toBe(0);
        expect(screen.getByTestId('wishlist-map').props.items).toBe(frozenItems);
        expect(screen.getByTestId('places-lists-pane').props).toMatchObject({
            branch: 'rows',
            scrollEnabled: true,
        });
    });

    it('clears the paper content from the measured search-and-chip chrome', () => {
        mockRouteParams = {};
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );

        fireEvent.press(screen.getByLabelText('list places'));
        const measuredHeight = 132;
        fireEvent(screen.getByTestId('places-top-chrome'), 'layout', {
            nativeEvent: { layout: { height: measuredHeight } },
        });

        expect(screen.getByTestId('places-paper-surface').props.style).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    paddingTop: measuredHeight + Spacing.sm,
                    opacity: 1,
                }),
            ]),
        );
    });

    it('clears the Lists and People panes above the list-mode map pill', () => {
        mockRouteParams = {};
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );
        const expectedPadding = 92 + Spacing.hitTarget + Spacing.md;

        fireEvent.press(screen.getByLabelText('list places'));
        fireEvent.press(screen.getByLabelText('segment lists'));
        expect(screen.getByTestId('places-lists-pane').props.bottomPadding).toBe(expectedPadding);

        fireEvent.press(screen.getByLabelText('segment people'));
        expect(screen.getByTestId('people-pane-state').props.bottomPadding).toBe(expectedPadding);
    });

    it('renders the default union and requests network pins only for friends', async () => {
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
            fetchNextPage: mockFetchNextPage,
            hasNextPage: false,
            isFetchingNextPage: false,
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
        expect(screen.getByText('tabs:places')).toBeTruthy();
        expect(screen.getByLabelText('pinned').props.accessibilityState.selected).toBe(false);
        expect(screen.getByLabelText('been').props.accessibilityState.selected).toBe(false);
        expect(screen.getByLabelText('friends').props.accessibilityState.selected).toBe(false);
        expect(mockCallEdgeFn.mock.calls.filter(([, options]) => (
            options?.action === 'saved_mine'
        ))).toHaveLength(0);
        expect(mockCallEdgeFn.mock.calls.filter(([, options]) => (
            options?.action === 'network_map_pins'
        ))).toHaveLength(0);
        expect(screen.queryByText('4.2')).toBeNull();
        act(() => screen.getByTestId('wishlist-map').props.onSelectedChange('pinned-only'));
        expect(screen.queryByText('4.2')).toBeNull();
        expect(screen.queryByText(/google/i)).toBeNull();
        act(() => screen.getByTestId('wishlist-map').props.onSelectedChange(null));

        fireEvent.press(screen.getByLabelText('pinned'));
        expect(screen.getByText('2 places')).toBeTruthy();
        expect(placesScreenState.get('viewer').layerFilter).toBe('pinned');

        fireEvent.press(screen.getByLabelText('pinned'));
        expect(screen.getByText('3 places')).toBeTruthy();
        expect(placesScreenState.get('viewer').layerFilter).toBe('all');

        fireEvent.press(screen.getByLabelText('been'));
        expect(screen.getByText('2 places')).toBeTruthy();
        expect(placesScreenState.get('viewer').layerFilter).toBe('been');
        expect(mockCallEdgeFn.mock.calls.filter(([, options]) => (
            options?.action === 'network_map_pins'
        ))).toHaveLength(0);

        mockCallEdgeFn.mockResolvedValueOnce({
            pins: [{
                restaurant_id: 'friend-only',
                name: 'Koya',
                city: 'London',
                cuisine: 'Japanese',
                lat: 51.52,
                lng: -0.12,
                author: { id: 'clara-id', name: 'clara', avatar: null },
                entry_id: 'entry-1',
                rating: 4.7,
                note: 'The udon worth crossing town for.',
                has_review: true,
                others_count: 2,
            }],
        });
        fireEvent.press(screen.getByLabelText('friends'));
        await waitFor(() => expect(screen.getByText('1 place')).toBeTruthy());
        expect(mockCallEdgeFn.mock.calls.filter(([, options]) => (
            options?.action === 'network_map_pins'
        ))).toHaveLength(1);
        expect(screen.getByTestId('wishlist-map').props.items[0]).toMatchObject({
            id: 'friend-only',
            author: { id: 'clara-id', name: 'clara', avatar: null },
            entryId: 'entry-1',
            hasReview: true,
            rating: 4.7,
            note: 'The udon worth crossing town for.',
        });
        expect(screen.getByText('4.7')).toBeTruthy();
        expect(screen.getByText(' · clara')).toBeTruthy();
        act(() => screen.getByTestId('wishlist-map').props.onSelectedChange('friend-only'));
        expect(screen.getByText('clara · 3 friends been')).toBeTruthy();
        expect(screen.queryByText(/google/)).toBeNull();
        expect(screen.queryByTestId('places-view-toggle')).toBeNull();
        fireEvent.press(screen.getByTestId('places-selected-caption'));
        expect(mockPush).toHaveBeenCalledWith({
            pathname: '/restaurant/[id]',
            params: { id: 'friend-only' },
        });
        fireEvent.press(screen.getByLabelText('friends'));
        expect(screen.getByText('3 places')).toBeTruthy();
        expect(placesScreenState.get('viewer').layerFilter).toBe('all');
    });

    it('paginates the full browse ledger with an honest plus count until exhaustion', () => {
        mockRouteParams = {};
        const firstPage = Array.from({ length: 40 }, (_, index) => ({
            restaurant: {
                id: `pinned-${index}`,
                name: `Pinned ${index}`,
                city: 'London',
                cuisine: 'British',
                lat: 51.5 + index * 0.001,
                lng: -0.1,
                price_level: 2,
                google_rating: 4.2,
            },
        }));
        mockWishlistState = {
            data: { pages: [{ data: firstPage }] },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
            fetchNextPage: mockFetchNextPage,
            hasNextPage: true,
            isFetchingNextPage: false,
        };
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const renderApp = () => (
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>
        );
        const screen = render(renderApp());

        expect(screen.getByText('40+ places')).toBeTruthy();
        fireEvent.press(screen.getByLabelText('list places'));
        expect(screen.queryByTestId('wishlist-map')).toBeNull();
        expect(screen.getByTestId('places-view-toggle')).toHaveTextContent('map');
        expect(screen.getByTestId('places-city-ledger')).toBeTruthy();
        expect(screen.getByText('London')).toBeTruthy();
        expect(screen.getByText('40+ places')).toBeTruthy();
        act(() => screen.getByTestId('places-city-ledger').props.onEndReached());
        expect(mockFetchNextPage).toHaveBeenCalledTimes(1);

        fireEvent.press(screen.getByLabelText('pinned'));
        act(() => screen.getByTestId('places-city-ledger').props.onEndReached());
        expect(mockFetchNextPage).toHaveBeenCalledTimes(2);

        mockWishlistState = {
            ...mockWishlistState,
            data: {
                pages: [
                    { data: firstPage },
                    { data: [{
                        restaurant: {
                            id: 'pinned-40',
                            name: 'Pinned 40',
                            city: 'London',
                            cuisine: 'British',
                            lat: 51.54,
                            lng: -0.1,
                            price_level: 2,
                            google_rating: 4.2,
                        },
                    }] },
                ],
            },
            hasNextPage: false,
        };
        screen.rerender(renderApp());
        expect(screen.getByText('41 places')).toBeTruthy();
        act(() => screen.getByTestId('places-city-ledger').props.onEndReached());
        expect(mockFetchNextPage).toHaveBeenCalledTimes(2);

        fireEvent.press(screen.getByLabelText('map places'));
        expect(screen.getByTestId('wishlist-map')).toBeTruthy();
    });

    it('keeps unmappable honesty layer-scoped and opens the repair sheet', async () => {
        mockRouteParams = {};
        mockWishlistState = {
            data: { pages: [{ data: [{
                id: 'save-1',
                restaurant: {
                    id: 'unmapped-1',
                    name: 'Lost pin',
                    city: 'London',
                    cuisine: 'British',
                    lat: null,
                    lng: null,
                    price_level: 2,
                    google_rating: null,
                },
            }] }] },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
            fetchNextPage: mockFetchNextPage,
            hasNextPage: false,
            isFetchingNextPage: false,
        };
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );

        expect(screen.getByTestId('wishlist-map').props.unmappableCount).toBe(1);
        act(() => screen.getByTestId('wishlist-map').props.onUnmappablePress());
        expect(screen.getByTestId('unmapped-sheet').props.visible).toBe(true);
        expect(screen.getByTestId('unmapped-sheet').props.items).toHaveLength(1);
        expect(screen.getByTestId('unmapped-sheet').props.items[0].id).toBe('save-1');
        fireEvent.press(screen.getByLabelText('pinned'));
        expect(screen.getByTestId('wishlist-map').props.unmappableCount).toBe(1);
        fireEvent.press(screen.getByLabelText('been'));
        expect(screen.getByTestId('wishlist-map').props.unmappableCount).toBe(0);
        mockCallEdgeFn.mockResolvedValueOnce({ pins: [] });
        fireEvent.press(screen.getByLabelText('friends'));
        await waitFor(() => expect(screen.getByText('nothing from friends yet')).toBeTruthy());
        expect(screen.getByTestId('wishlist-map').props.unmappableCount).toBe(0);
        fireEvent(screen.getByLabelText('find a place, list, or person'), 'focus');
        expect(screen.queryByTestId('wishlist-map')).toBeNull();
    });

    it('shares the unfiltered loaded pinned total after a facet narrows the ledger', () => {
        mockRouteParams = {};
        mockWishlistState = {
            data: { pages: [{ data: ['British', 'Japanese'].map((cuisine, index) => ({
                restaurant: {
                    id: `pinned-${index}`,
                    name: `Pinned ${index}`,
                    city: 'London',
                    cuisine,
                    lat: 51.5,
                    lng: -0.1,
                    price_level: 2,
                    google_rating: 4.2,
                },
            })) }] },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
            fetchNextPage: mockFetchNextPage,
            hasNextPage: false,
            isFetchingNextPage: false,
        };
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );
        expect(screen.queryByLabelText('share pinned places')).toBeNull();
        fireEvent.press(screen.getByLabelText('pinned'));
        act(() => screen.getByTestId('filter-sheet').props.cuisine.onSelect('Japanese'));
        expect(screen.getByText('1 place')).toBeTruthy();

        fireEvent.press(screen.getByLabelText('share pinned places'));
        expect(screen.getByTestId('handoff-sheet').props).toMatchObject({
            visible: true,
            pinnedCount: 2,
        });
    });

    it('renders network cold and warm failures with network-only retries', async () => {
        mockRouteParams = {};
        mockCallEdgeFn.mockRejectedValueOnce(new Error('network unavailable'));
        const coldClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const cold = render(
            <QueryClientProvider client={coldClient}>
                <PlacesScreen />
            </QueryClientProvider>,
        );
        fireEvent.press(cold.getByLabelText('friends'));
        await waitFor(() => expect(cold.getByText("couldn't load places")).toBeTruthy());
        mockCallEdgeFn.mockResolvedValueOnce({ pins: [] });
        fireEvent.press(cold.getByText('try again'));
        await waitFor(() => expect(mockCallEdgeFn.mock.calls.filter(([, options]) => (
            options?.action === 'network_map_pins'
        ))).toHaveLength(2));
        cold.unmount();

        placesScreenState.setActiveUser('reset-warm-user');
        placesScreenState.setActiveUser('viewer');
        mockCallEdgeFn.mockResolvedValueOnce({
            pins: [{
                restaurant_id: 'friend-cached',
                name: 'Brawn',
                city: 'London',
                cuisine: 'British',
                lat: 51.53,
                lng: -0.07,
                author: { id: 'clara-id', name: 'clara', avatar: null },
                entry_id: 'entry-cached',
                rating: 4.2,
                note: null,
                has_review: false,
                others_count: 0,
            }],
        });
        const warmClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const warm = render(
            <QueryClientProvider client={warmClient}>
                <PlacesScreen />
            </QueryClientProvider>,
        );
        fireEvent.press(warm.getByLabelText('friends'));
        await waitFor(() => expect(warm.getByText('1 place')).toBeTruthy());
        mockCallEdgeFn.mockRejectedValueOnce(new Error('refresh unavailable'));
        await act(async () => {
            await warmClient.refetchQueries({
                queryKey: queryKeys.users.networkMapPins('viewer'),
            });
        });
        await waitFor(() => expect(warm.getByText("couldn't refresh places")).toBeTruthy());
        mockCallEdgeFn.mockResolvedValueOnce({ pins: [] });
        fireEvent.press(warm.getByLabelText("couldn't refresh places, try again"));
        await waitFor(() => expect(mockCallEdgeFn.mock.calls.filter(([, options]) => (
            options?.action === 'network_map_pins'
        ))).toHaveLength(5));
    });

    it('unmounts the map for search sections and restores the prior camera on back', () => {
        mockRouteParams = {};
        mockCoords = { latitude: 51.5, longitude: -0.1 };
        mockFollowing = [{
            user_id: 'clara-id',
            display_name: 'Clara Bennett',
            avatar_url: 'https://cdn.example/clara.jpg',
            is_following: true,
        }];
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
                            photo_url: 'https://cdn.example/brawn.jpg',
                            photo_source: 'user',
                            price_level: 3,
                            google_rating: 4.6,
                        },
                    }],
                }],
            },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
            fetchNextPage: mockFetchNextPage,
            hasNextPage: false,
            isFetchingNextPage: false,
        };
        searchCache.addRecent('ramen');
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );
        const field = screen.getByLabelText('find a place, list, or person');
        const region = {
            latitude: 51.51,
            longitude: -0.11,
            latitudeDelta: 0.025,
            longitudeDelta: 0.025,
        };
        act(() => screen.getByTestId('wishlist-map').props.onRegionChangeComplete(region));

        fireEvent(field, 'focus');

        expect(screen.queryByTestId('wishlist-map')).toBeNull();
        expect(screen.queryByTestId('places-snap-sheet')).toBeNull();
        expect(screen.getByText('RECENT ramen')).toBeTruthy();
        expect(screen.getByText('NEAR YOU')).toBeTruthy();
        expect(screen.getByText('YOUR LISTS')).toBeTruthy();
        expect(screen.getByText('PEOPLE YOU FOLLOW')).toBeTruthy();
        expect(screen.getByText('Clara')).toBeTruthy();
        expect(screen.getByTestId('places-row-thumbnail-restaurant-1')).toBeTruthy();
        const seen = new WeakSet<object>();
        const takeover = JSON.stringify(screen.toJSON(), (_key, value: unknown) => {
            if (typeof value === 'object' && value !== null) {
                if (seen.has(value)) return undefined;
                seen.add(value);
            }
            return value;
        });
        expect(takeover.indexOf('RECENT ramen')).toBeLessThan(takeover.indexOf('NEAR YOU'));
        expect(takeover.indexOf('NEAR YOU')).toBeLessThan(takeover.indexOf('YOUR LISTS'));
        expect(takeover.indexOf('YOUR LISTS')).toBeLessThan(takeover.indexOf('PEOPLE YOU FOLLOW'));
        expect(screen.queryByLabelText('pinned')).toBeNull();

        fireEvent.changeText(field, 'parisik');
        expect(screen.queryByTestId('places-search-sections')).toBeNull();
        expect(screen.getByTestId('places-paper-results')).toBeTruthy();

        fireEvent.press(screen.getByLabelText('clear search'));
        expect(screen.getByTestId('places-search-sections')).toBeTruthy();

        fireEvent.press(screen.getByLabelText('back to places map'));
        expect(placesScreenState.get('viewer')).toMatchObject({
            query: '',
            sheetSnap: 0,
            layerFilter: 'all',
            previousNonSearchSnap: null,
            viewMode: 'map',
            region,
        });
        expect(screen.getByTestId('wishlist-map').props.initialRegion).toEqual(region);
        expect(screen.getByTestId('places-snap-sheet')).toBeTruthy();
    });

    it('omits the followees rail when the viewer follows nobody', () => {
        mockRouteParams = {};
        mockFollowing = [];
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        const screen = render(
            <QueryClientProvider client={client}>
                <PlacesScreen />
            </QueryClientProvider>,
        );

        fireEvent(screen.getByLabelText('find a place, list, or person'), 'focus');
        expect(screen.queryByText('PEOPLE YOU FOLLOW')).toBeNull();
    });
});
