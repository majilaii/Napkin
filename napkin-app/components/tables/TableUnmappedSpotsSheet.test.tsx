import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPersistPlace = jest.fn(async (id: string) => id);
const mockRepoint = jest.fn(async () => undefined);
const mockRemoveSave = jest.fn(async () => undefined);
const mockAlert = jest.fn();
const mockUseRepoint = jest.fn(
    (_userId?: string | null, _jobId?: string | null, _tableId?: string | null) => ({
        mutateAsync: mockRepoint,
        isPending: false,
    }),
);

jest.mock('react-native', () => ({
    Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
    Modal: 'Modal',
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    StyleSheet: { create: (styles: unknown) => styles },
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
jest.mock('@/hooks/wishlist/useRepointWishlistItem', () => ({
    useRepointWishlistItem: (
        userId?: string | null,
        jobId?: string | null,
        tableId?: string | null,
    ) => mockUseRepoint(userId, jobId, tableId),
}));
jest.mock('@/hooks/wishlist/useWishlistRemove', () => ({
    useWishlistRemove: () => ({ mutateAsync: mockRemoveSave, isPending: false }),
}));
jest.mock('@/components/wishlist/PlacePickerModal', () => ({
    PlacePickerModal: 'PlacePickerModal',
}));

// Mocks must be installed before importing the component.
// eslint-disable-next-line import/first
import { Colors } from '@/constants/theme';
// eslint-disable-next-line import/first
import { TableUnmappedSpotsSheet, type UnmappableRow } from './TableUnmappedSpotsSheet';

const owned: UnmappableRow = {
    restaurantId: 'restaurant-owned',
    name: 'Kono',
    city: 'New York',
    saverLabel: 'Clara',
    viewerItemId: '11111111-1111-4111-8111-111111111111',
};

const readOnly: UnmappableRow = {
    restaurantId: 'restaurant-other',
    name: 'Mangal II',
    city: 'London',
    saverLabel: 'Mateo +1',
    viewerItemId: null,
};

function renderedText(renderer: any): string {
    return renderer.root
        .findAllByType('Text')
        .flatMap((node: any) => node.props.children)
        .filter((child: unknown) => typeof child === 'string')
        .join(' ');
}

describe('TableUnmappedSpotsSheet', () => {
    beforeEach(() => {
        mockPersistPlace.mockClear();
        mockRepoint.mockClear();
        mockUseRepoint.mockClear();
        mockRemoveSave.mockClear();
        mockAlert.mockClear();
    });

    it('attributes every saver but exposes repair only for the viewer item id', async () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <TableUnmappedSpotsSheet
                    visible
                    onClose={jest.fn()}
                    rows={[owned, readOnly]}
                    tableId="table-1"
                    userId="viewer-1"
                    palette={Colors.light}
                />,
            );
        });

        expect(mockUseRepoint).toHaveBeenCalledWith('viewer-1', null, 'table-1');
        expect(renderedText(renderer)).toContain('New York · saved by Clara');
        expect(renderedText(renderer)).toContain('London · saved by Mateo +1');

        // The owned row exposes BOTH actions; the read-only row exposes neither.
        const actions = renderer.root.findAllByProps({ accessibilityRole: 'button' });
        expect(actions.map((n: any) => n.props.accessibilityLabel)).toEqual([
            'fix Kono',
            'remove Kono from your wishlist',
        ]);

        const repairRows = actions.filter((n: any) =>
            n.props.accessibilityLabel.startsWith('fix '),
        );
        act(() => repairRows[0].props.onPress());
        const picker = renderer.root.findByType('PlacePickerModal');
        expect(picker.props.visible).toBe(true);
        expect(picker.props.initialQuery).toBe('Kono');

        await act(async () => {
            await picker.props.onSelect({
                id: '22222222-2222-4222-8222-222222222222',
                name: 'Kono',
            });
        });
        expect(mockPersistPlace).not.toHaveBeenCalled();
        expect(mockRepoint).toHaveBeenCalledWith({
            item_id: owned.viewerItemId,
            restaurant_id: '22222222-2222-4222-8222-222222222222',
        });

        act(() => renderer.unmount());
    });

    it('auto-closes after the final repaired row disappears', () => {
        const onClose = jest.fn();
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <TableUnmappedSpotsSheet
                    visible
                    onClose={onClose}
                    rows={[owned]}
                    tableId="table-1"
                    userId="viewer-1"
                    palette={Colors.light}
                />,
            );
        });
        act(() => {
            renderer.update(
                <TableUnmappedSpotsSheet
                    visible
                    onClose={onClose}
                    rows={[]}
                    tableId="table-1"
                    userId="viewer-1"
                    palette={Colors.light}
                />,
            );
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        act(() => renderer.unmount());
    });

    it('drops an open repair target synchronously when the viewer scope changes', async () => {
        const onClose = jest.fn();
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <TableUnmappedSpotsSheet
                    visible
                    onClose={onClose}
                    rows={[owned]}
                    tableId="table-1"
                    userId="viewer-1"
                    palette={Colors.light}
                />,
            );
        });

        act(() => {
            renderer.root.findByProps({ accessibilityLabel: 'fix Kono' }).props.onPress();
        });
        expect(renderer.root.findByType('PlacePickerModal').props.visible).toBe(true);

        act(() => {
            renderer.update(
                <TableUnmappedSpotsSheet
                    visible
                    onClose={onClose}
                    rows={[]}
                    tableId="table-1"
                    userId="viewer-2"
                    palette={Colors.light}
                />,
            );
        });

        const switchedPicker = renderer.root.findByType('PlacePickerModal');
        expect(switchedPicker.props.visible).toBe(false);
        expect(switchedPicker.props.initialQuery).toBe('');
        await act(async () => {
            await switchedPicker.props.onSelect({
                id: '33333333-3333-4333-8333-333333333333',
                name: 'Other place',
            });
        });
        expect(mockRepoint).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);

        act(() => renderer.unmount());
    });

    it('removes an unfixable save only after confirmation, keyed on the restaurant', async () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <TableUnmappedSpotsSheet
                    visible
                    onClose={jest.fn()}
                    rows={[owned, readOnly]}
                    tableId="table-1"
                    userId="viewer-1"
                    palette={Colors.light}
                />,
            );
        });

        const removeButton = renderer.root
            .findAllByProps({ accessibilityRole: 'button' })
            .find((n: any) => n.props.accessibilityLabel.startsWith('remove '));

        act(() => removeButton.props.onPress());

        // Destructive, so it must ask first — never remove on the bare tap.
        expect(mockRemoveSave).not.toHaveBeenCalled();
        expect(mockAlert).toHaveBeenCalledTimes(1);
        const [title, , buttons] = mockAlert.mock.calls[0] as [string, string, any[]];
        expect(title).toBe('remove Kono?');

        const confirm = buttons.find((b) => b.style === 'destructive');
        await act(async () => confirm.onPress());

        // Keyed on restaurantId — that is what the wishlist remove contract takes.
        expect(mockRemoveSave).toHaveBeenCalledWith('restaurant-owned');

        act(() => renderer.unmount());
    });
});
