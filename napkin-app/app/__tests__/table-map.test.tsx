import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mockWishlistMapView = jest.fn((props: any) =>
    React.createElement('WishlistMapView', props),
);
const mockFilterTabsSheet = jest.fn((props: any) =>
    React.createElement('FilterTabsSheet', props),
);
const mockWishlistListsSheet = jest.fn((props: any) =>
    React.createElement('WishlistListsSheet', props),
);
const mockTableWishlistRow = jest.fn((props: any) =>
    React.createElement('TableWishlistRow', props),
);
const mockTableUnmappedSpotsSheet = jest.fn((props: any) =>
    React.createElement('TableUnmappedSpotsSheet', props),
);
const mockGatherSheet = jest.fn((props: any) =>
    React.createElement('GatherSheet', props),
);
let mockViewerId = 'viewer-id';

const mockUseList = jest.fn((listId: string | null | undefined) => ({
    data: listId === 'list-unranked'
        ? { data: mockSelectedListDetail, isNotFound: false }
        : undefined,
}));

const mockTableWishlistRows: any[] = [
    {
        restaurant: {
            id: 'aggregate-mapped-italian',
            name: 'Mapped Italian',
            city: 'London',
            cuisine: 'Italian',
            price_level: 2,
            lat: 51.50,
            lng: -0.10,
        },
        count: 2,
        members: [{ user_id: 'clara', display_name: 'Clara', avatar_url: null }],
        viewer_item_id: null,
    },
    {
        restaurant: {
            id: 'aggregate-unmapped-italian',
            name: 'Unmapped Italian',
            city: 'London',
            cuisine: 'Italian',
            price_level: 2,
            lat: null,
            lng: null,
        },
        count: 1,
        members: [{ user_id: 'viewer-id', display_name: 'Jacky', avatar_url: null }],
        viewer_item_id: 'viewer-save-id',
    },
    {
        restaurant: {
            id: 'aggregate-unmapped-japanese',
            name: 'Unmapped Japanese',
            city: 'Tokyo',
            cuisine: 'Japanese',
            price_level: 4,
            lat: null,
            lng: null,
        },
        count: 2,
        members: [
            { user_id: 'clara', display_name: 'Clara', avatar_url: null },
            { user_id: 'noah', display_name: 'Noah', avatar_url: null },
        ],
        viewer_item_id: null,
    },
    {
        restaurant: {
            id: 'aggregate-mapped-french',
            name: 'Mapped French',
            city: 'Paris',
            cuisine: 'French',
            price_level: 3,
            lat: 48.86,
            lng: 2.35,
        },
        count: 1,
        members: [{ user_id: 'noah', display_name: 'Noah', avatar_url: null }],
        viewer_item_id: null,
    },
];

const mockSelectedListEntries: any[] = [
    {
        id: 'entry-first',
        list_id: 'list-unranked',
        restaurant_id: 'list-first',
        note: null,
        position: 0,
        created_at: '2026-07-01T00:00:00Z',
        restaurant: {
            id: 'list-first',
            name: 'List First',
            city: 'Bangkok',
            cuisine: 'Thai',
            price_level: 3,
            lat: 13.75,
            lng: 100.50,
        },
    },
    {
        id: 'entry-hidden-middle',
        list_id: 'list-unranked',
        restaurant_id: 'list-hidden-middle',
        note: null,
        position: 1,
        created_at: '2026-07-02T00:00:00Z',
        restaurant: {
            id: 'list-hidden-middle',
            name: 'List Hidden Middle',
            city: 'Bangkok',
            cuisine: 'Thai',
            price_level: 3,
            lat: null,
            lng: null,
        },
    },
    {
        id: 'entry-last',
        list_id: 'list-unranked',
        restaurant_id: 'list-last',
        note: null,
        position: 2,
        created_at: '2026-07-03T00:00:00Z',
        restaurant: {
            id: 'list-last',
            name: 'List Last',
            city: 'Bangkok',
            cuisine: 'Thai',
            price_level: 3,
            lat: 13.74,
            lng: 100.52,
        },
    },
];

const mockSelectedListDetail: any = {
    list: {
        id: 'list-unranked',
        owner_id: 'viewer-id',
        title: 'Weekend Picks',
        description: null,
        ranked: false,
        privacy: 'private',
        emoji: '🍜',
        table_id: 'table-1',
        created_at: '2026-07-01T00:00:00Z',
        updated_at: '2026-07-03T00:00:00Z',
    },
    entries: mockSelectedListEntries,
    owner_profile: {
        display_name: 'Jacky',
        avatar_url: null,
        username: 'jacky',
        account_privacy: 'private',
    },
    save_count: 0,
    viewer_has_saved: false,
    can_save: false,
};

const mockUseTableWishlist = jest.fn((_userId?: string, _tableId?: string) => ({
    data: mockTableWishlistRows,
}));
const mockUseTableMapPins = jest.fn((_tableId?: string, _options?: { enabled?: boolean }) => ({
    data: [{
        table_id: 'table-1',
        restaurant_id: 'been-restaurant',
        name: 'Been Restaurant',
        city: 'London',
        cuisine: 'British',
        lat: 51.51,
        lng: -0.11,
        supper_id: 'supper-1',
        gathered_on: '2026-07-10T00:00:00Z',
        participants: [],
        suppers_count: 1,
    }],
}));

jest.mock('react-native', () => ({
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    Modal: 'Modal',
    ScrollView: 'ScrollView',
    StyleSheet: { hairlineWidth: 1, create: (styles: unknown) => styles },
}));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-router', () => ({
    Stack: { Screen: 'StackScreen' },
    useLocalSearchParams: () => ({ tableId: 'table-1' }),
    useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: mockViewerId } }),
}));
jest.mock('@/hooks/tables/useTables', () => ({
    useTables: () => ({ data: [{ tables: { id: 'table-1', name: 'Sunday Table' } }] }),
}));
jest.mock('@/hooks/wishlist/useTableWishlist', () => ({
    useTableWishlist: (userId?: string, tableId?: string) =>
        mockUseTableWishlist(userId, tableId),
}));
jest.mock('@/hooks/tables/useTableMapPins', () => ({
    useTableMapPins: (tableId?: string, options?: { enabled?: boolean }) =>
        mockUseTableMapPins(tableId, options),
}));
jest.mock('@/hooks/useNearbyLocation', () => ({
    useNearbyLocation: () => ({
        coords: null,
        status: 'idle',
        request: jest.fn(),
    }),
}));
jest.mock('@/hooks/lists/useMyLists', () => ({
    useMyLists: (userId?: string) => ({
        data: userId === 'viewer-id' ? [
            {
                id: 'list-unranked',
                owner_id: 'viewer-id',
                title: 'Weekend Picks',
                description: null,
                ranked: false,
                privacy: 'private',
                emoji: '🍜',
                table_id: 'table-1',
                entry_count: 3,
                cover_photo_url: null,
                created_at: '2026-07-01T00:00:00Z',
                updated_at: '2026-07-03T00:00:00Z',
            },
            {
                id: 'personal-list',
                owner_id: 'viewer-id',
                title: 'Personal',
                description: null,
                ranked: false,
                privacy: 'private',
                emoji: null,
                table_id: null,
                entry_count: 1,
                cover_photo_url: null,
                created_at: '2026-07-01T00:00:00Z',
                updated_at: '2026-07-03T00:00:00Z',
            },
        ] : [],
    }),
}));
jest.mock('@/hooks/lists/useList', () => ({
    useList: (listId: string | null | undefined) => mockUseList(listId),
}));
jest.mock('@/components/wishlist/WishlistMapView', () => ({
    WishlistMapView: (props: any) => mockWishlistMapView(props),
}));
jest.mock('@/components/wishlist', () => ({
    FilterTabsSheet: (props: any) => mockFilterTabsSheet(props),
    TableWishlistRow: (props: any) => mockTableWishlistRow(props),
    WishlistListsSheet: (props: any) => mockWishlistListsSheet(props),
}));
jest.mock('@/components/tables/TableUnmappedSpotsSheet', () => ({
    TableUnmappedSpotsSheet: (props: any) => mockTableUnmappedSpotsSheet(props),
}));
jest.mock('@/components/gatherings', () => ({
    GatherSheet: (props: any) => mockGatherSheet(props),
}));

// Mocks must be installed before importing the screen.
// eslint-disable-next-line import/first
import TableMapScreen from '../table-map';

function latestProps(mockFn: jest.Mock): any {
    return mockFn.mock.calls[mockFn.mock.calls.length - 1][0];
}

function renderScreen(): any {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<TableMapScreen />);
    });
    return renderer;
}

function modalText(modal: any): string {
    return modal
        .findAllByType('Text')
        .flatMap((node: any) => node.props.children)
        .filter((child: unknown) => typeof child === 'string')
        .join(' ');
}

describe('/table-map parity', () => {
    beforeEach(() => {
        mockViewerId = 'viewer-id';
        mockWishlistMapView.mockClear();
        mockFilterTabsSheet.mockClear();
        mockWishlistListsSheet.mockClear();
        mockTableWishlistRow.mockClear();
        mockTableUnmappedSpotsSheet.mockClear();
        mockGatherSheet.mockClear();
        mockUseList.mockClear();
        mockUseTableWishlist.mockClear();
        mockUseTableMapPins.mockClear();
    });

    it('filters aggregate source rows before deriving pins, murmur, and repair-sheet rows', () => {
        const renderer = renderScreen();

        let filterProps = latestProps(mockFilterTabsSheet);
        expect(filterProps.cuisine.options).toContainEqual({
            value: 'Japanese',
            label: 'Japanese',
            count: 1,
        });

        act(() => {
            filterProps.cuisine.onSelect('Italian');
        });

        const mapProps = latestProps(mockWishlistMapView);
        const sheetProps = latestProps(mockTableUnmappedSpotsSheet);
        filterProps = latestProps(mockFilterTabsSheet);

        expect(mapProps.items.map((item: any) => item.id)).toEqual([
            'aggregate-mapped-italian',
        ]);
        expect(mapProps.unmappableCount).toBe(1);
        expect(mapProps.onUnmappablePress).toEqual(expect.any(Function));
        expect(sheetProps.rows).toEqual([{
            restaurantId: 'aggregate-unmapped-italian',
            name: 'Unmapped Italian',
            city: 'London',
            saverLabel: 'Jacky',
            viewerItemId: 'viewer-save-id',
        }]);
        expect(sheetProps.rows).toHaveLength(mapProps.unmappableCount);
        // Facets stay source-derived after filtering, so a cuisine represented
        // only by a coordinate-less row remains available.
        expect(filterProps.cuisine.options).toContainEqual({
            value: 'Japanese',
            label: 'Japanese',
            count: 1,
        });

        act(() => {
            mapProps.onUnmappablePress();
        });
        expect(latestProps(mockTableUnmappedSpotsSheet).visible).toBe(true);

        act(() => renderer.unmount());
    });

    it('scopes an unranked table List, resets all facets, targets its ledger, and clears it for Been', () => {
        const renderer = renderScreen();

        expect(latestProps(mockWishlistMapView).unmappableCount).toBe(2);

        const aggregateFilterProps = latestProps(mockFilterTabsSheet);
        act(() => {
            aggregateFilterProps.cuisine.onSelect('Italian');
            aggregateFilterProps.price.onSelect('2');
            aggregateFilterProps.area.onSelect('London');
        });
        expect(latestProps(mockFilterTabsSheet).cuisine.selected).toBe('Italian');
        expect(latestProps(mockFilterTabsSheet).price.selected).toBe('2');
        expect(latestProps(mockFilterTabsSheet).area.selected).toBe('London');

        const listsProps = latestProps(mockWishlistListsSheet);
        expect(listsProps.myLists.map((list: any) => list.id)).toEqual(['list-unranked']);
        act(() => {
            listsProps.onSelect('list-unranked');
        });

        const scopedFilterProps = latestProps(mockFilterTabsSheet);
        expect(scopedFilterProps.cuisine.selected).toBeNull();
        expect(scopedFilterProps.price.selected).toBeNull();
        expect(scopedFilterProps.area.selected).toBeNull();

        let mapProps = latestProps(mockWishlistMapView);
        expect(mapProps.items.map((item: any) => item.id)).toEqual([
            'list-first',
            'list-last',
        ]);
        expect(mapProps.items.map((item: any) => item.listContext.rank)).toEqual([null, null]);
        expect(mapProps.preserveItemOrder).toBe(true);
        expect(mapProps.collectionScopeKey).toBe('list:list-unranked');
        expect(mapProps.unmappableCount).toBe(1);
        expect(mapProps.unmappableLabel).toBe('1 place in this List isn’t on the map');
        expect(mapProps.onUnmappablePress).toBeUndefined();
        expect(mapProps.listChip).toMatchObject({
            label: '🍜 Weekend Picks',
            selected: true,
        });
        expect(mockUseList).toHaveBeenLastCalledWith('list-unranked');

        act(() => {
            mapProps.onSwitchToList();
        });
        const listModal = renderer.root.findAllByType('Modal')
            .find((node: any) => node.props.visible === true);
        expect(listModal).toBeDefined();
        expect(modalText(listModal)).toContain('Weekend Picks');
        expect(
            listModal
                .findAllByType('Pressable')
                .map((node: any) => node.props.accessibilityLabel)
                .filter((label: unknown) => typeof label === 'string' && label.startsWith('Open ')),
        ).toEqual([
            'Open List First',
            'Open List Hidden Middle',
            'Open List Last',
        ]);

        mapProps = latestProps(mockWishlistMapView);
        act(() => {
            mapProps.sources.onChange('been');
        });
        const beenProps = latestProps(mockWishlistMapView);
        expect(beenProps.sources.value).toBe('been');
        expect(beenProps.items.map((item: any) => item.id)).toEqual(['been-restaurant']);
        expect(beenProps.unmappableCount).toBe(0);
        expect(beenProps.listChip).toBeUndefined();
        expect(beenProps.preserveItemOrder).toBe(false);
        expect(beenProps.collectionScopeKey).toBeNull();
        expect(mockUseList).toHaveBeenLastCalledWith(null);

        act(() => {
            beenProps.sources.onChange('saved');
        });
        expect(latestProps(mockWishlistMapView).listChip).toMatchObject({
            label: 'Lists',
            selected: false,
        });

        act(() => renderer.unmount());
    });

    it('drops cached private List detail synchronously when the viewer changes', () => {
        const renderer = renderScreen();

        act(() => {
            latestProps(mockWishlistListsSheet).onSelect('list-unranked');
        });
        expect(latestProps(mockWishlistMapView).items.map((item: any) => item.id)).toEqual([
            'list-first',
            'list-last',
        ]);
        expect(mockUseList).toHaveBeenLastCalledWith('list-unranked');

        mockViewerId = 'viewer-b';
        act(() => {
            renderer.update(<TableMapScreen />);
        });

        const switchedProps = latestProps(mockWishlistMapView);
        expect(mockUseTableWishlist).toHaveBeenLastCalledWith('viewer-b', 'table-1');
        expect(mockUseList).toHaveBeenLastCalledWith(null);
        expect(switchedProps.items.map((item: any) => item.id)).toEqual([
            'aggregate-mapped-italian',
            'aggregate-mapped-french',
        ]);
        expect(switchedProps.listChip).toMatchObject({ label: 'Lists', selected: false });
        expect(switchedProps.preserveItemOrder).toBe(false);
        expect(switchedProps.collectionScopeKey).toBeNull();

        act(() => renderer.unmount());
    });
});
