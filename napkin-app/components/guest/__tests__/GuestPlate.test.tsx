/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { GuestPlate } from '../GuestPlate';

const mockPush = jest.fn();

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
    };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

describe('GuestPlate', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it.each([
        ['feed', 'Feed', "friends' meals, once you're in."],
        ['tables', 'Table', 'a private table for your crew.'],
        ['profile', 'Profile', 'your journal, lists and taste.'],
    ] as const)('renders the %s plate with its kicker and one line', (surface, kicker, line) => {
        const screen = render(<GuestPlate surface={surface} />);
        expect(screen.getByText(kicker)).toBeTruthy();
        expect(screen.getByText(line)).toBeTruthy();
    });

    it('routes Sign in to /auth and Create an account to /auth in sign-up mode', () => {
        const screen = render(<GuestPlate surface="feed" />);
        fireEvent.press(screen.getByLabelText('Sign in'));
        expect(mockPush).toHaveBeenCalledWith('/auth');
        fireEvent.press(screen.getByLabelText('Create an account'));
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/auth', params: { mode: 'sign-up' } });
        expect(mockPush).toHaveBeenCalledTimes(2);
    });
});
