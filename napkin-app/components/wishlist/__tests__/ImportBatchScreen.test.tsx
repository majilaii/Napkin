/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PERSISTED_ID = 'ac02ff3b-d13c-4604-81a1-24ea64aebaf5';
const ITEM_ID = '11111111-1111-4111-8111-111111111111';
const mockPersistPlace = jest.fn(async (_placeId: string): Promise<string> => PERSISTED_ID);
const mockRepoint = jest.fn(async (_input: { item_id: string; restaurant_id: string }) => undefined);
const mockAddSpot = jest.fn(async (_input: { restaurant_id: string }) => undefined);
const mockToast = jest.fn();

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const FlatList = ({
        data,
        renderItem,
        ListHeaderComponent,
        ListEmptyComponent,
        ...props
    }: {
        data: unknown[];
        renderItem: (info: { item: unknown; index: number }) => React.ReactNode;
        ListHeaderComponent?: React.ReactNode;
        ListEmptyComponent?: React.ReactNode;
    }) => ReactModule.createElement(
        'FlatList',
        props,
        ListHeaderComponent,
        ...(data.length > 0
            ? data.map((item, index) => renderItem({ item, index }))
            : [ListEmptyComponent]),
    );
    FlatList.displayName = 'FlatList';

    return {
        ActivityIndicator: 'ActivityIndicator',
        FlatList,
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: 'Pressable',
        StyleSheet: { create: (styles: unknown) => styles },
        Text: 'Text',
        View: 'View',
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-router', () => ({
    Stack: { Screen: 'Stack.Screen' },
    useLocalSearchParams: () => ({ jobId: 'job-1' }),
    useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'user-1' } }),
}));
jest.mock('@/providers/ToastProvider', () => ({
    useToast: () => ({ show: mockToast }),
}));
jest.mock('@/hooks/search/usePersistPlace', () => ({
    usePersistPlace: () => ({ mutateAsync: mockPersistPlace, isPending: false }),
}));
jest.mock('@/hooks/wishlist/useImportBatch', () => ({
    useImportBatch: () => ({
        isLoading: false,
        data: {
            job: {
                job_id: 'job-1',
                source: null,
                status: 'resolved',
                created_at: '2026-09-04T08:00:00.000Z',
            },
            items: [{
                id: ITEM_ID,
                note: null,
                created_at: '2026-09-04T08:00:00.000Z',
                restaurant: {
                    id: '22222222-2222-4222-8222-222222222222',
                    name: 'Wrong place',
                    address: null,
                    city: 'Lezo',
                    country: null,
                    photo_url: null,
                    cuisine: null,
                    google_rating: null,
                    price_level: null,
                    external_id: null,
                    lat: null,
                    lng: null,
                },
            }],
        },
    }),
}));
jest.mock('@/hooks/wishlist/useWishlistRemove', () => ({
    useWishlistRemove: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/hooks/wishlist/useRepointWishlistItem', () => ({
    useRepointWishlistItem: () => ({ mutateAsync: mockRepoint, isPending: false }),
}));
jest.mock('@/hooks/wishlist/useAddSpotToBatch', () => ({
    useAddSpotToBatch: () => ({ mutateAsync: mockAddSpot, isPending: false }),
}));
jest.mock('@/components/lists', () => ({ AddToListSheet: 'AddToListSheet' }));
jest.mock('@/components/wishlist/PlacePickerModal', () => ({
    PlacePickerModal: 'PlacePickerModal',
}));
jest.mock('@/components/wishlist/importSourceLabel', () => ({
    importSourceLabel: () => 'clip',
    relativeTime: () => 'now',
    spotCountLabel: () => '1 spot',
}));
jest.mock('@/lib/queryKeys', () => ({
    queryKeys: {
        importJobs: { detail: jest.fn(), all: jest.fn() },
    },
}));

import ImportBatchScreen from '../../../app/imports/[jobId]';

function renderScreen() {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<ImportBatchScreen />);
    });
    return renderer;
}

function openFixPicker(renderer: any) {
    act(() => {
        renderer.root.findByProps({ accessibilityLabel: 'fix Wrong place' }).props.onPress();
    });
    return renderer.root.findByType('PlacePickerModal');
}

describe('/imports/[jobId] place persistence', () => {
    beforeEach(() => {
        mockPersistPlace.mockReset().mockResolvedValue(PERSISTED_ID);
        mockRepoint.mockReset().mockResolvedValue(undefined);
        mockAddSpot.mockReset().mockResolvedValue(undefined);
        mockToast.mockReset();
    });

    it('persists a provider result before repointing with the Napkin UUID', async () => {
        const renderer = renderScreen();
        const picker = openFixPicker(renderer);

        await act(async () => {
            await picker.props.onSelect({
                id: 'ChIJ-text-search-result',
                external_id: 'ChIJ36BeYBimUQ0RV_g7-UnGGi0',
                name: 'Asador Patxikuenea Erretegia',
                city: 'Lezo',
                cuisine: null,
            });
        });

        expect(mockPersistPlace).toHaveBeenCalledWith('ChIJ36BeYBimUQ0RV_g7-UnGGi0');
        expect(mockRepoint).toHaveBeenCalledWith({
            item_id: ITEM_ID,
            restaurant_id: PERSISTED_ID,
        });
        expect(mockPersistPlace.mock.invocationCallOrder[0]).toBeLessThan(
            mockRepoint.mock.invocationCallOrder[0],
        );
        expect(renderer.root.findByType('PlacePickerModal').props.visible).toBe(false);
        act(() => renderer.unmount());
    });

    it('uses an existing Napkin UUID without persisting its external id', async () => {
        const renderer = renderScreen();
        const picker = openFixPicker(renderer);

        await act(async () => {
            await picker.props.onSelect({
                id: PERSISTED_ID,
                external_id: 'ChIJ36BeYBimUQ0RV_g7-UnGGi0',
                name: 'Asador Patxikuenea Erretegia',
                city: 'Lezo',
                cuisine: null,
            });
        });

        expect(mockPersistPlace).not.toHaveBeenCalled();
        expect(mockRepoint).toHaveBeenCalledWith({
            item_id: ITEM_ID,
            restaurant_id: PERSISTED_ID,
        });
        act(() => renderer.unmount());
    });

    it('persists a provider result before adding the spot to the batch', async () => {
        const renderer = renderScreen();
        act(() => {
            renderer.root.findByProps({ accessibilityLabel: 'add a missing spot' }).props.onPress();
        });
        const picker = renderer.root.findByType('PlacePickerModal');

        await act(async () => {
            await picker.props.onSelect({
                id: 'ChIJ-add-result',
                external_id: null,
                name: 'Added place',
                city: 'London',
                cuisine: null,
            });
        });

        expect(mockPersistPlace).toHaveBeenCalledWith('ChIJ-add-result');
        expect(mockAddSpot).toHaveBeenCalledWith({ restaurant_id: PERSISTED_ID });
        expect(mockPersistPlace.mock.invocationCallOrder[0]).toBeLessThan(
            mockAddSpot.mock.invocationCallOrder[0],
        );
        act(() => renderer.unmount());
    });

    it('keeps the picker open and surfaces the existing toast when persistence fails', async () => {
        mockPersistPlace.mockRejectedValueOnce(new Error('Places unavailable'));
        const renderer = renderScreen();
        const picker = openFixPicker(renderer);

        await act(async () => {
            await picker.props.onSelect({
                id: 'ChIJ-unavailable',
                name: 'Unavailable place',
                city: null,
                cuisine: null,
            });
        });

        expect(mockRepoint).not.toHaveBeenCalled();
        expect(mockToast).toHaveBeenCalledWith("couldn't fix — try again");
        expect(renderer.root.findByType('PlacePickerModal').props.visible).toBe(true);
        act(() => renderer.unmount());
    });
});
