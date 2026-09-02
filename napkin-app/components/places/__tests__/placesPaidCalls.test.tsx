import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { placesScreenState } from '@/hooks/search/placesScreenState';
import PlacesScreen from '@/app/(tabs)/places';

const mockSetParams = jest.fn();
const mockPush = jest.fn();
const mockRequestIfGranted = jest.fn().mockResolvedValue(undefined);
let mockRouteParams: { mode?: string; q?: string } = { mode: 'people' };
const mockWishlistRefetch = jest.fn();
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
        return ReactModule.createElement('AnimatedFlatList', props, props.children as React.ReactNode);
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
        coords: null,
        permissionStatus: 'denied',
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
        data: [],
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
    }),
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
        RecentSearchesList: Stub,
        SearchLocalityBar: Stub,
        SearchModeTabs: Stub,
    };
});
jest.mock('@/components/sheets/SnapSheet', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    return {
        SnapSheet: ({ renderHeader, renderContent }: {
            renderHeader?: () => React.ReactNode;
            renderContent: (adapter: { scrollEnabled: boolean; onScroll: jest.Mock }) => React.ReactNode;
        }) => (
            <ReactModule.Fragment>
                {renderHeader?.()}
                {renderContent({ scrollEnabled: true, onScroll: jest.fn() })}
            </ReactModule.Fragment>
        ),
    };
});
jest.mock('@/components/wishlist', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native') as typeof import('react-native');
    return {
        WishlistMapView: () => <ReactNative.View />,
        FilterTabsSheet: () => <ReactNative.View />,
        ImportLinkSheet: () => <ReactNative.View />,
    };
});

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('Places People-segment paid-call gate', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
        mockRouteParams = { mode: 'people' };
        mockWishlistState = {
            data: { pages: [] },
            isLoading: false,
            isError: false,
            refetch: mockWishlistRefetch,
        };
        placesScreenState.setActiveUser('reset-user');
        placesScreenState.setActiveUser('viewer');
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
        fireEvent.press(screen.getByText('try again'));
        expect(mockWishlistRefetch).toHaveBeenCalledTimes(1);
    });
});
