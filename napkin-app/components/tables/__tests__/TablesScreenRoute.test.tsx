/* eslint-disable import/first -- Jest mocks must be registered before the route module loads. */
const routeParams = { selected: 'table-b', section: 'activity' };
const mockPush = jest.fn();
let mockIsPersonal = false;
const mockUseTableWishlist = jest.fn();
const mockUseTableMapPins = jest.fn();

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        RefreshControl: host('RefreshControl'),
        ScrollView: host('ScrollView'),
        Share: { share: jest.fn(() => Promise.resolve()) },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
            hairlineWidth: 1,
        },
        Text: host('Text'),
        View: host('View'),
    };
});

jest.mock('@react-navigation/native', () => ({
    useRoute: () => ({ params: routeParams }),
}));
jest.mock('expo-router', () => ({
    useFocusEffect: jest.fn(),
    useRouter: () => ({ push: mockPush }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'viewer' } }),
}));
jest.mock('@/constants/flags', () => ({
    FRIEND_TEST: {
        hideAtlas: true,
        hideEmergenceArc: true,
        hideRounds: true,
        hideSuppers: true,
        hideTopFours: true,
    },
}));
jest.mock('@/lib/track', () => ({ track: jest.fn() }));

jest.mock('@/hooks/tables/useTables', () => ({
    useTables: () => ({
        data: [
            { tables: { id: 'table-a', name: 'Table A', owner_id: 'viewer', created_at: '2026-01-01', is_personal: false } },
            { tables: { id: 'table-b', name: 'Table B', owner_id: 'viewer', created_at: '2026-01-01', is_personal: mockIsPersonal } },
        ],
        isLoading: false,
        isError: false,
        refetch: jest.fn(),
    }),
}));
jest.mock('@/hooks/notifications', () => ({ useUnreadCount: () => 0 }));
jest.mock('@/hooks/tables/useCreateInvite', () => ({
    useCreateInvite: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock('@/hooks/tables/useLastSeenAt', () => ({
    useLastSeenAt: () => ({ data: null }),
    useMarkSeen: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/hooks/tables/useTableActivity', () => ({
    useTableActivity: () => ({
        data: undefined,
        isLoading: false,
        isError: false,
        isRefetching: false,
        refetch: jest.fn(),
    }),
    flattenActivity: () => [],
}));
jest.mock('@/hooks/tables/useTableMembers', () => ({ useTableMembers: () => ({ data: [] }) }));
jest.mock('@/hooks/tables/useTableDetail', () => ({ useTableDetail: () => ({ data: null }) }));
jest.mock('@/hooks/tables/useTableTopFour', () => ({ useTableTopFour: () => ({ data: null }) }));
jest.mock('@/hooks/tables/useTableAtlas', () => ({
    useTableAtlas: () => ({ data: null, isLoading: false, isRefetching: false, refetch: jest.fn() }),
}));
// TICKET-238 AC 3b: the Activity pane must mount neither of these. They are
// mocked only so that re-introducing a counted doorway registers as a call.
jest.mock('@/hooks/wishlist/useTableWishlist', () => ({
    useTableWishlist: (...args: unknown[]) => mockUseTableWishlist(...args),
}));
jest.mock('@/hooks/tables/useTableMapPins', () => ({
    useTableMapPins: (...args: unknown[]) => mockUseTableMapPins(...args),
}));

jest.mock('@/components/atlas', () => ({ AtlasCityIndex: () => null }));
jest.mock('@/components/tables', () => {
    const ReactModule = jest.requireActual('react');
    const { Text } = jest.requireMock('react-native');
    const empty = () => null;
    return {
        TableHeader: ({ tableName }: { tableName: string }) =>
            ReactModule.createElement(Text, null, `header ${tableName}`),
        // The segment row and the map doorway are the presentation under test —
        // keep the real components.
        TableSegments: jest.requireActual('@/components/tables/TableSegments').TableSegments,
        OnTheMapRow: jest.requireActual('@/components/tables/OnTheMapRow').OnTheMapRow,
        FoundedHero: empty,
        EmptyChairInvitation: empty,
        TableSwitcherSheet: empty,
        ActiveGatherBanner: empty,
        SubsetCard: empty,
        TickRow: empty,
        WelcomeBanner: empty,
        TableTopFourGrid: empty,
        TableTopFourPlaceholder: empty,
        EditTop4Sheet: empty,
        StartRoundPill: empty,
        AddMemberSheet: empty,
        TableListsBlock: () => ReactModule.createElement(Text, null, 'lists pane'),
        TableLedgerModule: empty,
    };
});

jest.mock('@/components/feed/TableNightCard', () => ({}));
jest.mock('@/components/feed/DateSectionHeader', () => ({}));
jest.mock('@/components/tables/Top4EditedCard', () => ({}));
jest.mock('@/components/feed/SharedSaveCard', () => ({}));
jest.mock('@/components/feed/ShareDigestCard', () => ({}));
jest.mock('@/components/feed/RestaurantFloatCard', () => ({}));
jest.mock('@/components/feed/ListAddLedgerLine', () => ({}));
jest.mock('@/components/journal', () => ({ TableEntryCard: () => null }));
jest.mock('@/components/suppers', () => ({ SupperCard: () => null, SupperNudgeBanner: () => null }));
jest.mock('@/components/gatherings', () => ({ GatheringCard: () => null, UpcomingStrip: () => null }));
jest.mock('@/components/ErrorState', () => ({ ErrorState: () => null }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import TablesScreen from '../../../app/(tabs)/tables';

describe('mounted Tables route arrival', () => {
    beforeEach(() => {
        mockIsPersonal = false;
    });

    it('consumes section=activity once, then keeps later pane switches', () => {
        const screen = render(<TablesScreen />);

        expect(screen.getByText('header Table B')).toBeTruthy();
        expect(screen.queryByText('lists pane')).toBeNull();

        fireEvent.press(screen.getByText('lists'));
        expect(screen.getByText('lists pane')).toBeTruthy();

        fireEvent.press(screen.getByText('activity'));
        expect(screen.queryByText('lists pane')).toBeNull();
    });

    it('offers exactly activity · lists on a social table', () => {
        const screen = render(<TablesScreen />);

        expect(screen.getByText('activity')).toBeTruthy();
        expect(screen.getByText('lists')).toBeTruthy();
        expect(screen.queryByText('wishlist')).toBeNull();
        expect(screen.queryByText('atlas')).toBeNull();
    });

    it('offers activity alone and no map doorway on a personal table', () => {
        mockIsPersonal = true;
        const screen = render(<TablesScreen />);

        expect(screen.getByText('activity')).toBeTruthy();
        expect(screen.queryByText('lists')).toBeNull();
        expect(screen.queryByText('on the map')).toBeNull();
    });

    it('routes the map doorway to the table-scoped Places screen', () => {
        const screen = render(<TablesScreen />);

        fireEvent.press(screen.getByText('on the map'));

        expect(mockPush).toHaveBeenCalledWith({
            pathname: '/places-scope',
            params: { scope: 'table', tableId: 'table-b' },
        });
    });

    it('issues no wishlist or map-pins query on the Activity pane', () => {
        render(<TablesScreen />);

        expect(mockUseTableWishlist).not.toHaveBeenCalled();
        expect(mockUseTableMapPins).not.toHaveBeenCalled();
    });
});
