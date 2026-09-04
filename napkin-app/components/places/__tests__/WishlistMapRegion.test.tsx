import React from 'react';
import { act, render } from '@testing-library/react-native';
import type { DerivedValue } from 'react-native-reanimated';

import { Colors, Spacing } from '@/constants/theme';
import { WishlistMapView, type WishlistMapItem } from '@/components/wishlist/WishlistMapView';

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
jest.mock('react-native-reanimated', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    return {
        __esModule: true,
        default: { createAnimatedComponent: (component: unknown) => component },
        useAnimatedStyle: (factory: () => unknown) => factory(),
        useSharedValue: (value: unknown) => ReactModule.useRef({ value }).current,
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
        return ReactModule.createElement('MapView', { ...props, testID: 'map-view' }, props.children);
    });
    return {
        __esModule: true,
        default: MockMapView,
        Marker: ({ children }: { children?: React.ReactNode }) =>
            ReactModule.createElement('Marker', null, children),
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

describe('Places map region restoration', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('skips mount framing, reports movement, then frames a later collection', () => {
        const initialRegion = {
            latitude: 48.86,
            longitude: 2.35,
            latitudeDelta: 0.025,
            longitudeDelta: 0.025,
        };
        const onRegionChangeComplete = jest.fn();
        const baseProps = {
            items: ITEMS,
            unmappableCount: 0,
            userCoords: null,
            locationStatus: 'denied' as const,
            onRequestLocation: jest.fn(),
            onOpenRestaurant: jest.fn(),
            collectionScopeKey: 'places:all',
            bottomInset: 250,
            palette: Colors.light,
            initialRegion,
            onRegionChangeComplete,
        };
        const screen = render(<WishlistMapView {...baseProps} />);

        act(() => jest.advanceTimersByTime(300));
        expect(mockFitToCoordinates).not.toHaveBeenCalled();
        expect(mockAnimateToRegion).not.toHaveBeenCalled();
        expect(screen.getByTestId('map-view').props.initialRegion).toEqual(initialRegion);

        const movedRegion = { ...initialRegion, longitude: 2.36 };
        act(() => screen.getByTestId('map-view').props.onRegionChangeComplete(movedRegion));
        expect(onRegionChangeComplete).toHaveBeenCalledWith(movedRegion);

        const nextItems = [
            ...ITEMS,
            { id: 'c', name: 'C', city: 'London', cuisine: null, lat: 51.51, lng: -0.10 },
        ];
        screen.rerender(<WishlistMapView {...baseProps} items={nextItems} />);
        act(() => jest.advanceTimersByTime(260));
        expect(mockFitToCoordinates).toHaveBeenCalledTimes(1);
    });

    it('renders an overlap count in upright type', () => {
        const screen = render(
            <WishlistMapView
                items={[{
                    ...ITEMS[0],
                    overlap: {
                        count: 2,
                        tableId: 'table-a',
                        tableName: 'sunday lunch',
                        members: [],
                    },
                }]}
                unmappableCount={0}
                userCoords={null}
                locationStatus="denied"
                onRequestLocation={jest.fn()}
                onOpenRestaurant={jest.fn()}
                palette={Colors.light}
            />,
        );

        const style = screen.getByText('2').props.style as { fontFamily?: string };
        expect(style.fontFamily).toBe('Manrope_700Bold');
        expect(style.fontFamily).not.toMatch(/Italic/);
    });

    it('keeps native map padding settled while bottom chrome reads the live inset', () => {
        const settledInset = 250;
        const animatedBottomInset = { value: 448 } as DerivedValue<number>;
        const screen = render(
            <WishlistMapView
                items={ITEMS}
                unmappableCount={0}
                userCoords={null}
                locationStatus="denied"
                onRequestLocation={jest.fn()}
                onOpenRestaurant={jest.fn()}
                bottomInset={settledInset}
                animatedBottomInset={animatedBottomInset}
                listChip={{ label: 'Late suppers', onPress: jest.fn() }}
                palette={Colors.light}
            />,
        );

        expect(screen.getByTestId('map-view').props.mapPadding.bottom).toBe(settledInset);
        const locateFab = screen.getByLabelText('center map on my location');
        const locateStyle = locateFab.props.style as Record<string, unknown>[];
        expect(locateFab.props.hitSlop).toBe(8);
        expect(locateStyle[1]).toEqual(expect.objectContaining({
            bottom: Spacing.sm + Spacing.xs,
        }));
        expect(locateStyle[locateStyle.length - 1]).toEqual({
            transform: [{ translateY: -animatedBottomInset.value }],
        });

        const listStyle = screen.getByLabelText('Choose a List').props.style as Record<string, unknown>[];
        expect(listStyle[1]).toEqual(expect.objectContaining({ bottom: 0 }));
        expect(listStyle[listStyle.length - 1]).toEqual({
            transform: [{ translateY: -animatedBottomInset.value }],
        });
    });

    it('keeps the legacy bottom chrome styles when no inset channel is supplied', () => {
        const screen = render(
            <WishlistMapView
                items={ITEMS}
                unmappableCount={0}
                userCoords={null}
                locationStatus="denied"
                onRequestLocation={jest.fn()}
                onOpenRestaurant={jest.fn()}
                listChip={{ label: 'Late suppers', onPress: jest.fn() }}
                palette={Colors.light}
            />,
        );

        expect(screen.getByTestId('map-view').props.mapPadding.bottom).toBe(0);
        const locateStyle = screen.getByLabelText('center map on my location').props.style;
        expect(locateStyle).toHaveLength(3);
        expect(locateStyle).toEqual(expect.arrayContaining([
            expect.objectContaining({ bottom: 92 }),
        ]));
        const listStyle = screen.getByLabelText('Choose a List').props.style;
        expect(listStyle).toHaveLength(3);
        expect(listStyle).toEqual(expect.arrayContaining([
            expect.objectContaining({ bottom: 92 }),
        ]));
    });
});
