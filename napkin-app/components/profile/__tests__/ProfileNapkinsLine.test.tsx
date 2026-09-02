/* eslint-disable import/first -- Jest mocks must be registered before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
        Text: host('Text'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { ProfileNapkinsLine } from '../ProfileNapkinsLine';

it('renders a quiet monthly doorway and opens the ledger', () => {
    const onPress = jest.fn();
    const screen = render(
        <ProfileNapkinsLine count={12} onPress={onPress} palette={Colors.light} />,
    );
    expect(screen.getByText('12 napkins this month')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('12 napkins this month, open the ledger'));
    expect(onPress).toHaveBeenCalledTimes(1);
});
