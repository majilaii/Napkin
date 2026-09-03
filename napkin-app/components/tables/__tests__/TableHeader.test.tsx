/* eslint-disable import/first -- Jest mocks must be registered before the component loads. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/components/feed/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('@/components/notifications', () => ({ NotifBell: 'NotifBell' }));

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { TableHeader } from '../TableHeader';

function renderHeader(props: Partial<React.ComponentProps<typeof TableHeader>> = {}) {
    return render(
        <TableHeader
            tableName="the regulars"
            memberCount={4}
            memberNames={['Clara', 'Thomas', 'Julian', 'Maya']}
            onSwitcherPress={jest.fn()}
            palette={Colors.light}
            {...props}
        />,
    );
}

describe('TableHeader masthead', () => {
    it('sets the table name upright, with no kicker and no map chip', () => {
        const screen = renderHeader();

        const name = screen.getByText('the regulars');
        const style = StyleSheet.flatten(name.props.style) as Record<string, unknown>;
        expect(style.fontFamily).toBe('Newsreader_600SemiBold');
        expect(style.fontSize).toBe(28);
        expect(style.lineHeight).toBe(34);

        expect(screen.queryByText('TABLE')).toBeNull();
        expect(screen.queryByText('map')).toBeNull();
    });

    it('shows the invite chip only when an invite handler is supplied', () => {
        expect(renderHeader().queryByText('invite')).toBeNull();
        expect(renderHeader({ onInvitePress: jest.fn() }).getByText('invite')).toBeTruthy();
    });
});
