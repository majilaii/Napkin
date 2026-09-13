/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Colors } from '@/constants/theme';
import { HomeCityPicker } from '../HomeCityPicker';

const mockChange = jest.fn();
const mockFocus = jest.fn();

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) => ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'), Text: host('Text'),
        Pressable: (props: Record<string, unknown>) => ReactModule.createElement('View', { ...props, onStartShouldSetResponder: () => !props.disabled }, props.children),
        ScrollView: host('ScrollView'), KeyboardAvoidingView: host('KeyboardAvoidingView'),
        Modal: (props: Record<string, unknown>) => props.visible ? ReactModule.createElement('Modal', props, props.children) : null,
        TextInput: ReactModule.forwardRef((props: Record<string, unknown>, ref: unknown) => {
            ReactModule.useImperativeHandle(ref, () => ({ focus: mockFocus }));
            return ReactModule.createElement('TextInput', props);
        }),
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style ?? {},
        },
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function openCity(value = '', disabled = false) {
    const screen = render(<HomeCityPicker value={value} onChange={mockChange} palette={Colors.light} disabled={disabled} />);
    fireEvent.press(screen.getByLabelText(value ? `Home city: ${value}` : 'Choose your home city'));
    return screen;
}

describe('HomeCityPicker', () => {
    let fetchSpy: jest.SpyInstance;
    beforeEach(() => {
        jest.clearAllMocks();
        fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('City search must stay local'));
    });
    afterEach(() => {
        expect(fetchSpy).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it('opens a dedicated search surface and keeps five suggestions reachable', () => {
        const screen = openCity();
        expect(screen.getByLabelText('Search cities').props.value).toBe('');
        fireEvent.changeText(screen.getByLabelText('Search cities'), 'san');
        expect(screen.getByText('5 suggestions')).toBeTruthy();
        for (const city of ['San Antonio, United States', 'San Diego, United States', 'San Francisco, United States', 'San Jose, Costa Rica', 'San Jose, United States']) {
            expect(screen.getByLabelText(city)).toBeTruthy();
        }
        expect(screen.queryByLabelText('San Juan, Puerto Rico')).toBeNull();
        expect(mockChange).not.toHaveBeenCalled();
    });

    it('cancels edits without changing the saved city and restores it on reopen', () => {
        const screen = openCity('Hong Kong');
        fireEvent.changeText(screen.getByLabelText('Search cities'), 'London');
        fireEvent.press(screen.getByLabelText('Cancel city search'));
        expect(mockChange).not.toHaveBeenCalled();
        expect(screen.queryByLabelText('Search cities')).toBeNull();
        fireEvent.press(screen.getByLabelText('Home city: Hong Kong'));
        expect(screen.getByLabelText('Search cities').props.value).toBe('Hong Kong');
    });

    it('commits a suggestion exactly once and closes the search', () => {
        const screen = openCity();
        fireEvent.changeText(screen.getByLabelText('Search cities'), 'hon');
        fireEvent.press(screen.getByLabelText('Hong Kong'));
        expect(mockChange).toHaveBeenCalledTimes(1);
        expect(mockChange).toHaveBeenCalledWith('Hong Kong');
        expect(screen.queryByLabelText('Search cities')).toBeNull();
    });

    it('accepts a city outside the curated list using Done', () => {
        const screen = openCity();
        fireEvent.changeText(screen.getByLabelText('Search cities'), '  West Kirby  ');
        expect(screen.getByText('No suggestions. Tap Done to use this city.')).toBeTruthy();
        expect(mockChange).not.toHaveBeenCalled();
        fireEvent.press(screen.getByLabelText('Use entered city'));
        expect(mockChange).toHaveBeenCalledWith('West Kirby');
        expect(screen.queryByLabelText('Search cities')).toBeNull();
    });

    it('commits entered city through the keyboard Done action', () => {
        const screen = openCity();
        fireEvent.changeText(screen.getByLabelText('Search cities'), '  London  ');
        fireEvent(screen.getByLabelText('Search cities'), 'submitEditing');
        expect(mockChange).toHaveBeenCalledWith('London');
        expect(screen.queryByLabelText('Search cities')).toBeNull();
    });

    it('keeps clearing local until Done, then allows removing the optional city', () => {
        const screen = openCity('Hong Kong');
        fireEvent.press(screen.getByLabelText('Clear city search'));
        expect(screen.getByLabelText('Search cities').props.value).toBe('');
        expect(mockFocus).toHaveBeenCalledTimes(1);
        expect(mockChange).not.toHaveBeenCalled();
        fireEvent.press(screen.getByLabelText('Use entered city'));
        expect(mockChange).toHaveBeenCalledWith('');
        expect(screen.queryByLabelText('Search cities')).toBeNull();
    });

    it('cannot open while setup is pending', () => {
        const screen = openCity('', true);
        expect(screen.getByLabelText('Choose your home city').props.accessibilityState.disabled).toBe(true);
        expect(screen.queryByLabelText('Search cities')).toBeNull();
        expect(mockChange).not.toHaveBeenCalled();
    });
});
