/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
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
            hairlineWidth: 1,
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { shouldShowHistoryDoorway, YourHistoryDoorway } from './YourHistoryDoorway';

describe('YourHistoryDoorway', () => {
    it('gates on both a persisted id and at least one self log', () => {
        expect(shouldShowHistoryDoorway(0, 'restaurant')).toBe(false);
        expect(shouldShowHistoryDoorway(1, null)).toBe(false);
        expect(shouldShowHistoryDoorway(1, 'restaurant')).toBe(true);
    });

    it('pluralises and exposes the doorway as one accessible button', () => {
        const onPress = jest.fn();
        const screen = render(
            <YourHistoryDoorway
                restaurantName="Kiln"
                visitCount={1}
                onPress={onPress}
                palette={Colors.light}
            />,
        );
        fireEvent.press(screen.getByLabelText('your history, 1 visit'));
        expect(onPress).toHaveBeenCalledTimes(1);
        expect(screen.getByText("you've been here · 1 visit")).toBeTruthy();
    });
});
