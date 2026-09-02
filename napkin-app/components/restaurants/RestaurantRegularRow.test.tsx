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

import React from 'react';
import { render } from '@testing-library/react-native';
import { View } from 'react-native';

import { Colors } from '@/constants/theme';
import { shouldShowHistoryDoorway } from './YourHistoryDoorway';
import { RestaurantRegularRow } from './RestaurantRegularRow';

describe('RestaurantRegularRow', () => {
    it('renders a followee crown independently when the viewer has zero visits', () => {
        const screen = render(
            <View>
                {shouldShowHistoryDoorway(0, 'restaurant-id') ? <View testID="doorway" /> : null}
                <RestaurantRegularRow
                    detail={{
                        user_id: 'friend',
                        display_name: 'Clara',
                        avatar_url: null,
                        visits: 4,
                        is_viewer: false,
                        runner_up: { display_name: 'Thomas', gap: 1 },
                    }}
                    palette={Colors.light}
                />
            </View>,
        );

        expect(screen.queryByTestId('doorway')).toBeNull();
        expect(screen.getByText('Clara is the regular here · Thomas is 1 behind')).toBeTruthy();
    });

    it('hides on a null detail and uses viewer copy without a runner-up', () => {
        const hidden = render(<RestaurantRegularRow detail={null} palette={Colors.light} />);
        expect(hidden.toJSON()).toBeNull();

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
                palette={Colors.light}
            />,
        );
        expect(viewer.getByText("you're the regular here")).toBeTruthy();
    });
});
