import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import {
    OnboardingGateBoundary,
    shouldBlockOnboardingGate,
} from './OnboardingGateBoundary';

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'),
        Text: host('Text'),
        ActivityIndicator: host('ActivityIndicator'),
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
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));

describe('OnboardingGateBoundary', () => {
    it('renders an opaque blocker instead of signed-in app content while unresolved', () => {
        const view = render(
            <OnboardingGateBoundary blocked>
                <Text testID="signed-in-app-content">Private app content</Text>
            </OnboardingGateBoundary>,
        );

        expect(view.getByTestId('onboarding-gate-blocker')).toBeTruthy();
        expect(view.queryByTestId('signed-in-app-content')).toBeNull();
    });

    it('releases content only after a real null-or-timestamp resolution', () => {
        expect(shouldBlockOnboardingGate(false, true, undefined, '(tabs)')).toBe(true);
        expect(shouldBlockOnboardingGate(false, true, null, '(tabs)')).toBe(false);
        expect(shouldBlockOnboardingGate(false, true, '2026-07-16T00:00:00Z', '(tabs)')).toBe(false);
        expect(shouldBlockOnboardingGate(false, false, undefined, 'auth')).toBe(false);
    });

    it('keeps cold restored routes opaque until auth restoration resolves', () => {
        expect(shouldBlockOnboardingGate(true, false, undefined, '(tabs)')).toBe(true);
        expect(shouldBlockOnboardingGate(false, false, undefined, '(tabs)')).toBe(false);
    });

    it('does not interrupt the password-recovery form after its auth event', () => {
        expect(shouldBlockOnboardingGate(true, true, undefined, 'reset-password')).toBe(false);
    });
});
