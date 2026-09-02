import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ListRow } from '@/components/search/ListRow';
import type { MyList } from '@/hooks/lists/useMyLists';
import type { SavedList } from '@/hooks/lists/useSavedLists';
import { PlacesListsPane } from '../PlacesListsPane';

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) => (
        ReactModule.createElement(name, props, props.children as React.ReactNode)
    );
    const flatten = (style: unknown): Record<string, unknown> => {
        if (!Array.isArray(style)) return (style ?? {}) as Record<string, unknown>;
        return Object.assign({}, ...style.map(flatten));
    };
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
        StyleSheet: { create: (styles: unknown) => styles, flatten },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-reanimated', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactNative = require('react-native') as typeof import('react-native');
    const MockFlatList = (props: Record<string, unknown>) => {
        const data = props.data as unknown[];
        const renderItem = props.renderItem as jest.Mock;
        return ReactModule.createElement(
            ReactNative.View,
            props,
            props.ListHeaderComponent as React.ReactNode,
            data.length > 0
                ? data.map((item, index) => renderItem({ item, index }))
                : props.ListEmptyComponent as React.ReactNode,
            props.ListFooterComponent as React.ReactNode,
        );
    };
    return { __esModule: true, default: { FlatList: MockFlatList } };
});

const mine: MyList = {
    id: 'mine-1',
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
};

const saved: SavedList = {
    id: 'saved-1',
    owner_id: 'clara-id',
    title: 'Clara in Paris',
    description: null,
    ranked: false,
    privacy: 'public',
    emoji: null,
    created_at: '2026-09-02T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
    saved_at: '2026-09-02T00:00:00Z',
    entry_count: 4,
    save_count: 2,
    cover_photo_url: null,
    owner_display_name: 'Clara',
    owner_avatar_url: null,
    owner_username: 'clara',
};

const baseProps = {
    branch: 'rows' as const,
    myLists: [mine],
    savedLists: [saved],
    myError: false,
    savedError: false,
    scrollEnabled: false,
    onScroll: jest.fn() as never,
    onOpenList: jest.fn(),
    onNewList: jest.fn(),
    onRetryMyLists: jest.fn(),
    onRetrySavedLists: jest.fn(),
    bottomPadding: 92,
};

describe('PlacesListsPane', () => {
    it('renders the ordered shelf with owner meta and forwards the sheet handoff props', () => {
        const screen = render(<PlacesListsPane {...baseProps} />);
        expect(screen.getByText('Your lists')).toBeTruthy();
        expect(screen.getByText('Late suppers')).toBeTruthy();
        expect(screen.getByText('new list')).toBeTruthy();
        expect(screen.getByText('Saved lists')).toBeTruthy();
        expect(screen.getByText('Clara in Paris')).toBeTruthy();
        expect(screen.getByText('4 spots · by Clara')).toBeTruthy();
        expect(screen.getByTestId('places-lists-pane').props).toMatchObject({
            scrollEnabled: false,
            onScroll: baseProps.onScroll,
            scrollEventThrottle: 16,
        });

        fireEvent.press(screen.getByLabelText('new list'));
        fireEvent.press(screen.getByLabelText('Clara in Paris'));
        expect(baseProps.onNewList).toHaveBeenCalledTimes(1);
        expect(baseProps.onOpenList).toHaveBeenCalledWith('saved-1');
    });

    it('renders intended-empty with the creation row and cold failure with retry', () => {
        const empty = render(
            <PlacesListsPane
                {...baseProps}
                branch="empty"
                myLists={[]}
                savedLists={[]}
            />,
        );
        expect(empty.getByText('no lists yet')).toBeTruthy();
        expect(empty.getByLabelText('new list')).toBeTruthy();

        const failed = render(
            <PlacesListsPane
                {...baseProps}
                branch="error"
                myLists={[]}
                savedLists={[]}
            />,
        );
        fireEvent.press(failed.getByText('try again'));
        expect(baseProps.onRetryMyLists).toHaveBeenCalledTimes(1);

        const warmSavedFailure = render(
            <PlacesListsPane {...baseProps} savedLists={[]} savedError />,
        );
        fireEvent.press(warmSavedFailure.getByLabelText("couldn't refresh, try again"));
        expect(baseProps.onRetrySavedLists).toHaveBeenCalledTimes(1);

        const warmMineFailure = render(
            <PlacesListsPane {...baseProps} myError />,
        );
        fireEvent.press(warmMineFailure.getByLabelText("couldn't refresh, try again"));
        expect(baseProps.onRetryMyLists).toHaveBeenCalledTimes(2);
    });

    it('keeps ListRow upright at 16 with 13pt override metadata', () => {
        const screen = render(
            <ListRow list={mine} meta="3 spots · by Clara" onPress={jest.fn()} />,
        );
        expect(StyleSheet.flatten(screen.getByText('Late suppers').props.style)).toMatchObject({
            fontFamily: 'Newsreader_500Medium',
            fontSize: 16,
        });
        expect(StyleSheet.flatten(screen.getByText('3 spots · by Clara').props.style)).toMatchObject({
            fontFamily: 'Manrope_500Medium',
            fontSize: 13,
        });
    });
});
