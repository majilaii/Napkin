import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

/**
 * Tests for the onboarding name step (`app/onboarding/index.tsx`) — the screen
 * App Store Guideline 4 was cited against on 2026-09-14.
 *
 * Two behaviours are load-bearing and must never regress:
 *   - a provider-supplied name means the step NEVER renders, and
 *   - when no name was provided (every Apple authorization after the first), the
 *     step must not be a precondition: Continue works on an empty field.
 *
 * Lives here, not beside the screen: `scripts/check-route-tree.mjs` fails CI on
 * any test file under `napkin-app/app/` (same reason as photo.test.tsx).
 */
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockPatch = jest.fn();
let mockDraft = { display_name: '', avatar_url: null as string | null, home_city: null };
let mockProvided: string | null | undefined = null;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'),
        ScrollView: host('ScrollView'),
        KeyboardAvoidingView: host('KeyboardAvoidingView'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        TextInput: host('TextInput'),
        ActivityIndicator: host('ActivityIndicator'),
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        StyleSheet: {
            absoluteFillObject: {},
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
    };
});

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace }),
    Stack: { Screen: () => null },
}));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/onboarding/useProvidedDisplayName', () => ({
    useProvidedDisplayName: () => mockProvided,
}));
jest.mock('@/app/onboarding/OnboardingDraftContext', () => ({
    useOnboardingDraft: () => ({ draft: mockDraft, patch: mockPatch }),
}));

import OnboardingNameScreen from '@/app/onboarding/index';

describe('onboarding name step', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockDraft = { display_name: '', avatar_url: null, home_city: null };
        mockProvided = null;
    });

    it('never renders when a provider already supplied the name', () => {
        mockProvided = 'Ada Lovelace';
        const { queryByLabelText } = render(<OnboardingNameScreen />);

        expect(queryByLabelText('Your name')).toBeNull();
        expect(mockPatch).toHaveBeenCalledWith({ display_name: 'Ada Lovelace' });
        expect(mockReplace).toHaveBeenCalledWith('/onboarding/photo');
    });

    it('renders nothing while the provided name is still being read', () => {
        mockProvided = undefined;
        const { queryByLabelText } = render(<OnboardingNameScreen />);

        // No flash of a form we are about to skip past.
        expect(queryByLabelText('Your name')).toBeNull();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    // The path App Review actually exercises: their Apple ID already authorized
    // the app, so Apple returns no name and none can be recovered.
    it('lets the user continue with an empty field — never a precondition', () => {
        const { getByText, getByLabelText } = render(<OnboardingNameScreen />);

        expect(getByLabelText('Your name')).toBeTruthy();
        fireEvent.press(getByText('Continue'));

        expect(mockPatch).toHaveBeenCalledWith({ display_name: '' });
        expect(mockPush).toHaveBeenCalledWith('/onboarding/photo');
    });

    it('offers Maybe later, which DISCARDS anything already typed', () => {
        const { getByText, getByLabelText } = render(<OnboardingNameScreen />);

        fireEvent.changeText(getByLabelText('Your name'), 'Half-typed');
        fireEvent.press(getByText('Maybe later'));

        expect(mockPatch).toHaveBeenCalledWith({ display_name: '' });
        expect(mockPush).toHaveBeenCalledWith('/onboarding/photo');
    });

    it('keeps a typed name on Continue', () => {
        const { getByText, getByLabelText } = render(<OnboardingNameScreen />);

        fireEvent.changeText(getByLabelText('Your name'), '  Grace Hopper  ');
        fireEvent.press(getByText('Continue'));

        expect(mockPatch).toHaveBeenCalledWith({ display_name: 'Grace Hopper' });
    });

    // SetupFrame's `optional` prop is the follows-step COPY switch, not a generic
    // flag: passing it relabels the header "People you know / Optional".
    it('does not wear the people-suggestions header', () => {
        const { queryByText, getByText } = render(<OnboardingNameScreen />);

        expect(queryByText('People you know')).toBeNull();
        expect(getByText('Make yourself at home')).toBeTruthy();
        expect(getByText('1 of 3')).toBeTruthy();
    });
});
