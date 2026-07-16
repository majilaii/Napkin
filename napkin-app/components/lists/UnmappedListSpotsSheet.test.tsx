import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPersistPlace = jest.fn(async (_externalId: string) => 'replacement-restaurant-id');
const mockRepair = jest.fn(async () => ({
    restaurant_id: 'replacement-restaurant-id',
    entry_id: 'entry-1',
}));

jest.mock('react-native', () => ({
    Modal: 'Modal',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: {
        absoluteFillObject: {},
        create: (styles: unknown) => styles,
        hairlineWidth: 1,
    },
    Text: 'Text',
    TouchableWithoutFeedback: 'TouchableWithoutFeedback',
    View: 'View',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/hooks/search/usePersistPlace', () => ({
    usePersistPlace: () => ({ mutateAsync: mockPersistPlace, isPending: false }),
}));
jest.mock('@/hooks/lists/useRepairListGhost', () => ({
    useRepairListGhost: () => ({ mutateAsync: mockRepair, isPending: false }),
}));
jest.mock('@/components/wishlist/PlacePickerModal', () => ({
    PlacePickerModal: 'PlacePickerModal',
}));

// Mocks must be installed before importing the component.
// eslint-disable-next-line import/first
import { Colors } from '@/constants/theme';
// eslint-disable-next-line import/first
import type { ListEntry } from '@/hooks/lists/useList';
// eslint-disable-next-line import/first
import { UnmappedListSpotsSheet } from './UnmappedListSpotsSheet';

const entry: ListEntry = {
    id: 'entry-1',
    list_id: 'list-1',
    restaurant_id: 'ghost-restaurant-id',
    note: null,
    position: 1024,
    created_at: '2026-07-16T12:00:00.000Z',
    restaurant: {
        id: 'ghost-restaurant-id',
        name: 'Kartuli',
        address: null,
        city: 'London',
        country: null,
        photo_url: null,
        cuisine: null,
        google_rating: null,
        price_level: null,
        external_id: 'ghost_owner_nonce',
        completeness_version: 7,
        verification: 'unverified',
    },
};

describe('UnmappedListSpotsSheet', () => {
    beforeEach(() => {
        mockPersistPlace.mockClear();
        mockRepair.mockClear();
    });

    it('server-attests and persists a fresh Place result before repairing the ghost', async () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <UnmappedListSpotsSheet
                    visible
                    onClose={jest.fn()}
                    listId="list-1"
                    entries={[entry]}
                    palette={Colors.light}
                />,
            );
        });

        act(() => {
            renderer.root.findByProps({ accessibilityLabel: 'repair Kartuli' }).props.onPress();
        });
        const picker = renderer.root.findByType('PlacePickerModal');
        await act(async () => {
            await picker.props.onSelect({
                id: 'ChIJ-fresh-provider-result',
                external_id: null,
                name: 'Kartuli',
                city: 'London',
                cuisine: 'Georgian',
            });
        });

        expect(mockPersistPlace).toHaveBeenCalledWith('ChIJ-fresh-provider-result');
        expect(mockRepair).toHaveBeenCalledWith({
            entry_id: 'entry-1',
            list_id: 'list-1',
            replacement_external_id: 'ChIJ-fresh-provider-result',
            expected_version: 7,
        });
        expect(mockPersistPlace.mock.invocationCallOrder[0]).toBeLessThan(
            mockRepair.mock.invocationCallOrder[0],
        );

        act(() => renderer.unmount());
    });

    it('does not call repair when server attestation/persistence fails', async () => {
        mockPersistPlace.mockRejectedValueOnce(new Error('provider unavailable'));
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <UnmappedListSpotsSheet
                    visible
                    onClose={jest.fn()}
                    listId="list-1"
                    entries={[entry]}
                    palette={Colors.light}
                />,
            );
        });
        act(() => {
            renderer.root.findByProps({ accessibilityLabel: 'repair Kartuli' }).props.onPress();
        });
        const picker = renderer.root.findByType('PlacePickerModal');
        await act(async () => {
            await picker.props.onSelect({
                id: 'ChIJ-unattested',
                name: 'Kartuli',
                city: 'London',
                cuisine: null,
            });
        });

        expect(mockRepair).not.toHaveBeenCalled();
        expect(renderer.root.findByType('PlacePickerModal').props.errorText).toBe(
            "couldn't repair that spot — try again",
        );
        act(() => renderer.unmount());
    });
});
