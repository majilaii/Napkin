import React from 'react';
import { render } from '@testing-library/react-native';

import { ListsSearchPane } from '../ListsSearchPane';
import { PeopleSearchPane } from '../PeopleSearchPane';

const mockPush = jest.fn();
const mockUseSearchPublicLists = jest.fn();
const mockUseUserSearch = jest.fn();

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children as React.ReactNode);
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Keyboard: { dismiss: jest.fn() },
        Linking: { openURL: jest.fn() },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => style,
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-reanimated', () => {
    // Host components preserve the adapter props without depending on the
    // native Animated implementation in Jest.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const MockFlatList = (props: Record<string, unknown>) => ReactModule.createElement('AnimatedFlatList', props);
    return { __esModule: true, default: { FlatList: MockFlatList } };
});
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'viewer' } }),
}));
jest.mock('@/hooks/lists/useSearchPublicLists', () => ({
    useSearchPublicLists: (...args: unknown[]) => mockUseSearchPublicLists(...args),
    flattenPublicLists: () => [{
        id: 'list-1',
        owner_id: 'owner-1',
        title: 'Late supper',
        description: null,
        ranked: false,
        emoji: null,
        entry_count: 2,
        updated_at: '2026-09-02T00:00:00Z',
        owner_display_name: 'Maya',
        owner_avatar_url: null,
        owner_username: 'maya',
    }],
}));
jest.mock('@/hooks/users/useUserSearch', () => ({
    useUserSearch: (...args: unknown[]) => mockUseUserSearch(...args),
}));
jest.mock('@/hooks/users/useFollowingList', () => ({
    useFollowingList: () => ({ data: [] }),
}));
jest.mock('@/hooks/feed/useCoDiners', () => ({
    useCoDiners: () => ({ data: [] }),
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearchPublicLists.mockReturnValue({
        data: {},
        isLoading: false,
        isFetching: false,
        hasNextPage: false,
        fetchNextPage: jest.fn(),
        isFetchingNextPage: false,
    });
    mockUseUserSearch.mockReturnValue({
        data: [{
            user_id: 'person-1',
            display_name: 'Clara',
            avatar_url: null,
            is_following: false,
        }],
        isLoading: false,
    });
});

describe('search pane native-list handoff', () => {
    it('forwards the sheet scroll gate and offset handler to Lists', () => {
        const onScroll = jest.fn();
        const screen = render(
            <ListsSearchPane
                query="late"
                debouncedQuery="late"
                scrollEnabled={false}
                onScroll={onScroll as never}
            />,
        );

        expect(screen.root.findByProps({ testID: 'lists-search-results' }).props).toMatchObject({
            scrollEnabled: false,
            onScroll,
            scrollEventThrottle: 16,
        });
    });

    it('forwards the sheet scroll gate and offset handler to People', () => {
        const onScroll = jest.fn();
        const screen = render(
            <PeopleSearchPane
                query="clara"
                debouncedQuery="clara"
                scrollEnabled={false}
                onScroll={onScroll as never}
            />,
        );

        expect(screen.root.findByProps({ testID: 'people-search-results' }).props).toMatchObject({
            scrollEnabled: false,
            onScroll,
            scrollEventThrottle: 16,
        });
    });
});
