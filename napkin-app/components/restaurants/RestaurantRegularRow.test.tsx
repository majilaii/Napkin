/* eslint-disable import/first -- Jest mocks must be registered before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
        Text: host('Text'),
        View: host('View'),
        Pressable: host('Pressable'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/components/feed/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('./RestaurantPageV3', () => {
    const ReactModule = jest.requireActual('react');
    return {
        SectionHeading: ({ label }: { label: string }) => ReactModule.createElement('Text', null, label),
    };
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { RestaurantRegularRow, regularStandingCopy } from './RestaurantRegularRow';

describe('RestaurantRegularRow', () => {
    it('renders a followee crown independently when the viewer has zero visits', () => {
        const onPress = jest.fn();
        const screen = render(
            <RestaurantRegularRow
                detail={{
                    user_id: 'friend',
                    display_name: 'Clara',
                    avatar_url: null,
                    visits: 4,
                    is_viewer: false,
                    runner_up: { display_name: 'Thomas', gap: 1 },
                }}
                onPress={onPress}
                palette={Colors.light}
            />,
        );

        expect(screen.getByText('THE REGULAR')).toBeTruthy();
        expect(screen.getByText('Clara')).toBeTruthy();
        expect(screen.getByText('4 visits · Thomas is 1 behind')).toBeTruthy();
        fireEvent.press(screen.getByLabelText('Clara is the regular here · Thomas is 1 behind'));
        expect(onPress).toHaveBeenCalledWith('friend');
    });

    it('hides on a null detail and keeps the viewer crown inert', () => {
        const hidden = render(<RestaurantRegularRow detail={null} palette={Colors.light} />);
        expect(hidden.toJSON()).toBeNull();

        const onPress = jest.fn();
        const viewer = render(
            <RestaurantRegularRow
                detail={{
                    user_id: 'viewer',
                    display_name: 'Jacky',
                    avatar_url: null,
                    visits: 3,
                    is_viewer: true,
                    runner_up: null,
                }}
                onPress={onPress}
                palette={Colors.light}
            />,
        );
        expect(viewer.getByText('you')).toBeTruthy();
        expect(viewer.getByText('3 visits')).toBeTruthy();
        expect(viewer.queryByRole('button')).toBeNull();
    });

    it('never reads "0 behind" to a screen reader on a tie', () => {
        const screen = render(
            <RestaurantRegularRow
                detail={{
                    user_id: 'friend',
                    display_name: 'Clara',
                    avatar_url: null,
                    visits: 2,
                    is_viewer: false,
                    runner_up: { display_name: 'Jacky', gap: 0 },
                }}
                palette={Colors.light}
            />,
        );
        expect(screen.getByLabelText('Clara is the regular here · tied with Jacky')).toBeTruthy();
        expect(screen.getByText('2 visits · tied with Jacky')).toBeTruthy();
    });

    it('phrases a tie and a single visit', () => {
        expect(regularStandingCopy({
            user_id: 'a', display_name: 'A', avatar_url: null, visits: 2, is_viewer: false,
            runner_up: { display_name: 'B', gap: 0 },
        })).toBe('2 visits · tied with B');
        expect(regularStandingCopy({
            user_id: 'a', display_name: 'A', avatar_url: null, visits: 1, is_viewer: false, runner_up: null,
        })).toBe('1 visit');
    });
});
