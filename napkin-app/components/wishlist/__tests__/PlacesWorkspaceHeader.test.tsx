import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this app.
import TestRenderer, { act } from 'react-test-renderer';
import { PlacesWorkspaceHeader } from '../PlacesWorkspaceHeader';
import { Colors } from '@/constants/theme';

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require('react');
    const mk = (name: string) => {
        const Component = (props: any) => React.createElement(name, props, props.children);
        Component.displayName = name;
        return Component;
    };
    return {
        Platform: { OS: 'ios', select: (options: any) => options.ios },
        StyleSheet: { create: (styles: any) => styles },
        Pressable: mk('Pressable'),
        Text: mk('Text'),
        View: mk('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Ionicons: (props: any) => require('react').createElement('Icon', props),
}));

function renderHeader(over: Partial<React.ComponentProps<typeof PlacesWorkspaceHeader>> = {}) {
    const callbacks = {
        onSelectView: jest.fn(),
        onOpenFilters: jest.fn(),
        onToggleLists: jest.fn(),
        onImport: jest.fn(),
    };
    let root: any;
    act(() => {
        root = TestRenderer.create(
            <PlacesWorkspaceHeader
                topInset={0}
                viewMode="map"
                section="places"
                listsCount={2}
                filtersActive={false}
                palette={Colors.light}
                {...callbacks}
                {...over}
            />,
        );
    });
    return { root, callbacks };
}

function button(root: any, label: string) {
    return root.root.findAll(
        (node: any) =>
            node.props.accessibilityRole === 'button' &&
            node.props.accessibilityLabel === label,
    )[0];
}

it('keeps Map/List, filters, lists, and Import directly reachable', () => {
    const { root, callbacks } = renderHeader();

    expect(button(root, 'map view').props.accessibilityState.selected).toBe(true);
    expect(button(root, 'list view').props.accessibilityState.selected).toBe(false);

    act(() => button(root, 'list view').props.onPress());
    act(() => button(root, 'filters').props.onPress());
    act(() => button(root, 'show lists').props.onPress());
    act(() => button(root, 'import places').props.onPress());

    expect(callbacks.onSelectView).toHaveBeenCalledWith('list');
    expect(callbacks.onOpenFilters).toHaveBeenCalledTimes(1);
    expect(callbacks.onToggleLists).toHaveBeenCalledTimes(1);
    expect(callbacks.onImport).toHaveBeenCalledTimes(1);
});

it('replaces the irrelevant Filter action with a Saved return action inside Lists', () => {
    const { root, callbacks } = renderHeader({ viewMode: 'list', section: 'lists' });

    expect(root.root.findAll((node: any) => node.props.accessibilityLabel === 'filters')).toHaveLength(0);
    expect(button(root, 'show saved places').props.accessibilityState.selected).toBe(true);

    act(() => button(root, 'show saved places').props.onPress());
    expect(callbacks.onToggleLists).toHaveBeenCalledTimes(1);
});
