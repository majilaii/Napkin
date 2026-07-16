/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const friendsFeedQuery = {
    data: { pages: [{ rows: [{ id: 'visible-followed-entry' }] }] },
    isError: true,
};
let mockFocusCallback: (() => void) | undefined;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        StyleSheet: { create: (styles: unknown) => styles },
        View: host('View'),
    };
});
jest.mock('@/constants/theme', () => ({
    Colors: { light: { background: 'paper' } },
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
jest.mock('@/hooks/feed', () => ({ useFriendsFeed: () => friendsFeedQuery }));
jest.mock('expo-router', () => ({
    useFocusEffect: (callback: () => void) => {
        mockFocusCallback = callback;
    },
}));
jest.mock('@/components/feed', () => ({
    FeedHeader: 'FeedHeader',
    FollowingFeed: 'FollowingFeed',
    ForYouFeed: 'ForYouFeed',
}));

import FeedScreen from '../(tabs)/feed';

it('lands and re-lands on For You regardless of followed-feed state', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<FeedScreen />);
    });

    expect(renderer!.root.findAllByType('ForYouFeed')).toHaveLength(1);
    expect(renderer!.root.findAllByType('FollowingFeed')).toHaveLength(0);

    const forYou = renderer!.root.findByType('ForYouFeed');
    const header = forYou.props.ListHeaderComponent;
    expect(header.props.mode).toBe('for-you');

    act(() => header.props.onModeChange('following'));
    expect(renderer!.root.findAllByType('ForYouFeed')).toHaveLength(0);
    expect(renderer!.root.findAllByType('FollowingFeed')).toHaveLength(1);

    act(() => mockFocusCallback?.());
    expect(renderer!.root.findAllByType('ForYouFeed')).toHaveLength(1);
    expect(renderer!.root.findAllByType('FollowingFeed')).toHaveLength(0);

    act(() => renderer!.unmount());
});
