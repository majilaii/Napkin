/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof import('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children as React.ReactNode);
    class Value {
        setValue = jest.fn();
    }
    return {
        ActivityIndicator: host('ActivityIndicator'),
        Animated: {
            View: host('AnimatedView'),
            Value,
            add: jest.fn(() => 0),
            parallel: jest.fn(() => ({ start: jest.fn() })),
            spring: jest.fn(() => ({ start: jest.fn() })),
            timing: jest.fn(() => ({ start: jest.fn() })),
        },
        Modal: ({ children, visible }: { children: React.ReactNode; visible?: boolean }) =>
            visible ? ReactModule.createElement(ReactModule.Fragment, null, children) : null,
        PanResponder: { create: jest.fn(() => ({ panHandlers: {} })) },
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        StyleSheet: {
            absoluteFill: { position: 'absolute' },
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
        Text: host('Text'),
        TextInput: host('TextInput'),
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/hooks/users/useUserSearch', () => ({ useUserSearch: jest.fn() }));
jest.mock('@/hooks/users/useRecentCompanions', () => ({ useRecentCompanions: jest.fn() }));

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { useRecentCompanions } from '@/hooks/users/useRecentCompanions';
import { useUserSearch } from '@/hooks/users/useUserSearch';
import { CompanionPickerSheet } from '../CompanionPickerSheet';

const baseProps = {
    visible: true,
    onClose: jest.fn(),
    selectedIds: new Set<string>(),
    onToggle: jest.fn(),
    currentUserId: 'viewer',
    palette: Colors.light,
};

describe('CompanionPickerSheet mutual-only search', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        (useRecentCompanions as jest.Mock).mockReturnValue({
            data: [],
            isLoading: false,
        });
        (useUserSearch as jest.Mock).mockReturnValue({
            data: [],
            isLoading: false,
        });
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
    });

    it('requests mutual search results and labels the field Search friends', () => {
        const screen = render(<CompanionPickerSheet {...baseProps} />);

        expect(screen.getByPlaceholderText('Search friends')).toBeTruthy();
        expect(useUserSearch).toHaveBeenCalledWith('', true, { mutualOnly: true });
    });

    it('hides a non-mutual result and shows the one-line empty copy', () => {
        (useUserSearch as jest.Mock).mockReturnValue({
            data: [{
                user_id: 'stranger',
                display_name: 'Public Stranger',
                avatar_url: null,
                is_mutual: false,
            }],
            isLoading: false,
        });
        const screen = render(<CompanionPickerSheet {...baseProps} />);

        fireEvent.changeText(screen.getByPlaceholderText('Search friends'), 'stranger');
        act(() => jest.advanceTimersByTime(300));

        expect(useUserSearch).toHaveBeenLastCalledWith('stranger', true, { mutualOnly: true });
        expect(screen.queryByText('Public Stranger')).toBeNull();
        expect(screen.getByText('no mutual follows match')).toBeTruthy();
    });
});
