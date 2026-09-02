import React from 'react';
import { act, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { WishlistMapView, type WishlistMapItem } from '../WishlistMapView';

const mockFitToCoordinates = jest.fn();
const mockAnimateToRegion = jest.fn();

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children as React.ReactNode);
    return {
        Alert: { alert: jest.fn() },
        Animated: {
            View: host('AnimatedView'),
            Value: jest.fn(),
            parallel: jest.fn(() => ({ start: jest.fn() })),
            spring: jest.fn(() => ({ start: jest.fn() })),
            timing: jest.fn(() => ({ start: jest.fn() })),
        },
        Dimensions: { get: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }) },
        FlatList: host('FlatList'),
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        StyleSheet: {
            absoluteFill: { position: 'absolute', inset: 0 },
            absoluteFillObject: { position: 'absolute', inset: 0 },
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => style,
            hairlineWidth: 1,
        },
        Text: host('Text'),
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
        View: host('View'),
    };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-haptics', () => ({ selectionAsync: jest.fn() }));
jest.mock('react-native-maps', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const MockMapView = ReactModule.forwardRef((props: { children?: React.ReactNode }, ref) => {
        ReactModule.useImperativeHandle(ref, () => ({
            fitToCoordinates: mockFitToCoordinates,
            animateToRegion: mockAnimateToRegion,
            animateCamera: jest.fn(),
            getMapBoundaries: jest.fn(),
        }));
        return ReactModule.createElement('MapView', { testID: 'map-view' }, props.children);
    });
    return {
        __esModule: true,
        default: MockMapView,
        Marker: ({ children }: { children?: React.ReactNode }) => ReactModule.createElement('Marker', null, children),
        UrlTile: () => ReactModule.createElement('UrlTile'),
        PROVIDER_GOOGLE: 'google',
        PROVIDER_DEFAULT: null,
    };
});
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'viewer' } }),
}));
jest.mock('@/hooks/wishlist/useMyWishlist', () => ({
    useMyWishlist: () => ({ data: undefined }),
}));
jest.mock('@/hooks/wishlist/useIsWishlisted', () => ({
    useIsWishlisted: () => ({ data: false }),
}));
jest.mock('@/hooks/wishlist/useWishlistAdd', () => ({
    useWishlistAdd: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/hooks/wishlist/useWishlistRemove', () => ({
    useWishlistRemove: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/hooks/restaurants/usePeekCard', () => ({
    peekCardContextForItem: () => null,
    peekCardContextToken: () => null,
    usePeekCard: () => ({ data: null }),
}));
jest.mock('@/components/lists/AddToListSheet', () => ({ AddToListSheet: () => null }));
jest.mock('@/components/map/MapPeekCard', () => ({ MapPeekCard: () => null }));
jest.mock('@/lib/maptiler', () => ({
    tileUrlTemplate: () => '',
    MAPTILER_ATTRIBUTION: '',
    MAP_TILE_MODE: 'apple',
}));

const ITEMS: WishlistMapItem[] = [
    { id: 'a', name: 'A', city: 'London', cuisine: null, lat: 51.50, lng: -0.11 },
    { id: 'b', name: 'B', city: 'London', cuisine: null, lat: 51.52, lng: -0.09 },
];

describe('WishlistMapView collection framing', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('still frames when a parent re-renders with a new inline selection callback', () => {
        const baseProps = {
            items: ITEMS,
            unmappableCount: 0,
            userCoords: null,
            locationStatus: 'denied' as const,
            onRequestLocation: jest.fn(),
            onOpenRestaurant: jest.fn(),
            collectionScopeKey: 'places:paris',
            bottomInset: 250,
            palette: Colors.light,
        };
        const screen = render(
            <WishlistMapView {...baseProps} onSelectedChange={() => {}} />,
        );

        screen.rerender(
            <WishlistMapView {...baseProps} onSelectedChange={() => {}} />,
        );
        act(() => jest.advanceTimersByTime(260));

        expect(mockFitToCoordinates).toHaveBeenCalledTimes(1);
        expect(mockFitToCoordinates).toHaveBeenCalledWith(
            ITEMS.map((item) => ({ latitude: item.lat, longitude: item.lng })),
            expect.objectContaining({ animated: true }),
        );
    });
});
