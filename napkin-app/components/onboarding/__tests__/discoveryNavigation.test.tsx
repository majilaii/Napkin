/* eslint-disable import/first -- mock native surfaces before importing routes. */
import React from 'react';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockCanGoBack = jest.fn();
const mockEnableGuide = jest.fn();
const mockDismissTip = jest.fn();
const mockUseDiscoveryGuide = jest.fn();
let mockUserId: string | null = 'guide-viewer';
let mockParams: { intro?: string; preview?: string; topic?: string } = {};

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, { ...(name === 'Pressable' ? { accessible: true } : {}), ...props }, props.children);
    return {
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
        },
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: mockCanGoBack }),
    useLocalSearchParams: () => mockParams,
    Stack: { Screen: () => null },
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: mockUserId ? { id: mockUserId } : null }),
}));
jest.mock('@/lib/discoveryGuide', () => ({
    enableDiscoveryGuide: (...args: unknown[]) => mockEnableGuide(...args),
    dismissDiscoveryTip: (...args: unknown[]) => mockDismissTip(...args),
}));
jest.mock('@/hooks/onboarding/useDiscoveryGuide', () => ({
    useDiscoveryGuide: (...args: unknown[]) => mockUseDiscoveryGuide(...args),
}));
jest.mock('@/components/onboarding/GuideIllustration', () => ({ GuideIllustration: () => null }));

import { fireEvent, render } from '@testing-library/react-native';
import WelcomeScreen from '@/app/welcome';
import { Colors } from '@/constants/theme';
import { DiscoveryTip } from '../DiscoveryTip';
import { TableIntroduction } from '../TableIntroduction';

const PINNED_PLACES = '/(tabs)/places?view=list&layer=pinned';

beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 'guide-viewer';
    mockParams = {};
    mockCanGoBack.mockReturnValue(true);
    mockEnableGuide.mockResolvedValue(undefined);
    mockDismissTip.mockResolvedValue(undefined);
    mockUseDiscoveryGuide.mockReturnValue({ enabled: true, ready: true, dismissed: [] });
});

describe('first-run introduction navigation', () => {
    it('teaches journal, pins and Tables in order, supports back, then opens the first-place destination', () => {
        mockParams = { intro: '1' };
        const screen = render(<WelcomeScreen />);
        expect(screen.getByText('A journal of good meals.')).toBeTruthy();
        expect(screen.getByRole('progressbar').props.accessibilityValue).toEqual({ min: 1, max: 3, now: 1 });
        expect(screen.queryByLabelText('Back')).toBeNull();

        fireEvent.press(screen.getByText('Continue'));
        expect(screen.getByText('Keep your next good find.')).toBeTruthy();
        expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(2);
        fireEvent.press(screen.getByLabelText('Back'));
        expect(screen.getByText('A journal of good meals.')).toBeTruthy();
        fireEvent.press(screen.getByText('Continue'));
        fireEvent.press(screen.getByText('Continue'));
        expect(screen.getByText('A Table for your people.')).toBeTruthy();
        expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(3);
        expect(screen.queryByText('Continue')).toBeNull();
        expect(mockReplace).not.toHaveBeenCalled();

        fireEvent.press(screen.getByText('Find my first place'));
        expect(mockReplace).toHaveBeenCalledWith(PINNED_PLACES);
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockBack).not.toHaveBeenCalled();
    });

    it.each([0, 1, 2])('can skip after %i forward steps without opening an action screen', (steps) => {
        mockParams = { intro: '1' };
        const screen = render(<WelcomeScreen />);
        for (let i = 0; i < steps; i++) fireEvent.press(screen.getByText('Continue'));
        fireEvent.press(screen.getByLabelText('Skip introduction'));
        expect(mockReplace).toHaveBeenCalledWith(PINNED_PLACES);
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockBack).not.toHaveBeenCalled();
    });

    it('offers Tables as an optional terminal destination without creating a group', () => {
        mockParams = { intro: '1' };
        const screen = render(<WelcomeScreen />);
        fireEvent.press(screen.getByText('Continue'));
        fireEvent.press(screen.getByText('Continue'));
        fireEvent.press(screen.getByText('Explore Tables'));
        expect(mockReplace).toHaveBeenCalledWith('/(tabs)/tables');
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('allows the replay close control to return to its parent route', () => {
        const screen = render(<WelcomeScreen />);
        fireEvent.press(screen.getByLabelText('Close guide'));
        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('enables guide tips for the actual signed-in introduction viewer only', () => {
        mockParams = { intro: '1' };
        mockUserId = 'new-current-viewer';
        const screen = render(<WelcomeScreen />);
        expect(mockEnableGuide).toHaveBeenCalledTimes(1);
        expect(mockEnableGuide).toHaveBeenCalledWith('new-current-viewer');
        fireEvent.press(screen.getByText('Continue'));
        expect(mockEnableGuide).toHaveBeenCalledTimes(1);
    });

    it('does not enable tips when there is no signed-in identity', () => {
        mockParams = { intro: '1' };
        mockUserId = null;
        render(<WelcomeScreen />);
        expect(mockEnableGuide).not.toHaveBeenCalled();
    });

    it.each([{ preview: '1' }, { intro: '1', preview: '1' }])('keeps preview read-only with params %j', (params) => {
        mockParams = params;
        const screen = render(<WelcomeScreen />);
        expect(screen.getByText('A journal of good meals.')).toBeTruthy();
        fireEvent.press(screen.getByText('Continue'));
        fireEvent.press(screen.getByLabelText('Skip introduction'));
        expect(mockEnableGuide).not.toHaveBeenCalled();
        expect(mockDismissTip).not.toHaveBeenCalled();
        expect(mockReplace).toHaveBeenCalledWith(PINNED_PLACES);
    });
});

describe('replayable guide navigation', () => {
    it('opens its chapter index without enabling first-run tips and returns one level up', () => {
        const screen = render(<WelcomeScreen />);
        expect(screen.getByText('Make yourself at home.')).toBeTruthy();
        expect(screen.queryByRole('progressbar')).toBeNull();
        fireEvent.press(screen.getByText('Back to Napkin'));
        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(mockReplace).not.toHaveBeenCalled();
        expect(mockEnableGuide).not.toHaveBeenCalled();
    });

    it('returns a topic replay to the guide index before leaving the route', () => {
        mockParams = { topic: 'tables' };
        const screen = render(<WelcomeScreen />);
        expect(screen.getByText('A Table for your people.')).toBeTruthy();
        fireEvent.press(screen.getByLabelText('Back'));
        expect(screen.getByText('Make yourself at home.')).toBeTruthy();
        expect(mockBack).not.toHaveBeenCalled();
        fireEvent.press(screen.getByRole('button', { name: 'Your next meal' }));
        expect(screen.getByText('Keep your next good find.')).toBeTruthy();
        expect(mockEnableGuide).not.toHaveBeenCalled();
    });

    it.each([
        ['journal', 'Find a place', '/(tabs)/places'],
        ['places', 'Open Places', PINNED_PLACES],
        ['tables', 'Explore Tables', '/(tabs)/tables'],
        ['lists', 'Open lists', '/lists'],
        ['friends', 'Find people', '/(tabs)/places?mode=people'],
    ])('pushes the real destination for %s while retaining guide back navigation', (topic, action, route) => {
        mockParams = { topic };
        const screen = render(<WelcomeScreen />);
        fireEvent.press(screen.getByText(action));
        expect(mockPush).toHaveBeenCalledWith(route);
        expect(mockReplace).not.toHaveBeenCalled();
        expect(mockEnableGuide).not.toHaveBeenCalled();
    });

    it('falls back safely for an invalid topic and a cold deep link without back history', () => {
        mockParams = { topic: 'nonexistent-chapter' };
        mockCanGoBack.mockReturnValue(false);
        const screen = render(<WelcomeScreen />);
        expect(screen.getByText('Make yourself at home.')).toBeTruthy();
        fireEvent.press(screen.getByText('Back to Napkin'));
        expect(mockReplace).toHaveBeenCalledWith(PINNED_PLACES);
        expect(mockEnableGuide).not.toHaveBeenCalled();
    });

    it('opens account visibility from the journal privacy explanation without changing it', () => {
        mockParams = { topic: 'journal' };
        const screen = render(<WelcomeScreen />);
        fireEvent.press(screen.getByText('Manage account visibility'));
        expect(mockPush).toHaveBeenCalledWith('/settings/privacy');
        expect(mockEnableGuide).not.toHaveBeenCalled();
        expect(mockDismissTip).not.toHaveBeenCalled();
    });
});

describe('contextual discovery tips', () => {
    it.each([
        { enabled: false, ready: true, dismissed: [] },
        { enabled: true, ready: false, dismissed: [] },
        { enabled: true, ready: true, dismissed: ['tables'] },
    ])('does not show a tip before eligibility or after dismissal: %j', (state) => {
        mockUseDiscoveryGuide.mockReturnValue(state);
        const screen = render(<DiscoveryTip topic="tables" />);
        expect(screen.queryByTestId('discovery-tip-tables')).toBeNull();
        expect(mockDismissTip).not.toHaveBeenCalled();
    });

    it('does not show a signed-out user cached guide state', () => {
        mockUserId = null;
        const screen = render(<DiscoveryTip topic="places" />);
        expect(mockUseDiscoveryGuide).toHaveBeenCalledWith(undefined);
        expect(screen.queryByTestId('discovery-tip-places')).toBeNull();
    });

    it('dismisses only the requested topic for the current account, then hides on the next state update', () => {
        mockUserId = 'tip-current-viewer';
        const screen = render(<DiscoveryTip topic="tables" />);
        fireEvent.press(screen.getByLabelText('Dismiss Your people tip'));
        expect(mockDismissTip).toHaveBeenCalledTimes(1);
        expect(mockDismissTip).toHaveBeenCalledWith('tip-current-viewer', 'tables');
        expect(mockPush).not.toHaveBeenCalled();

        mockUseDiscoveryGuide.mockReturnValue({ enabled: true, ready: true, dismissed: ['tables'] });
        screen.rerender(<DiscoveryTip topic="tables" />);
        expect(screen.queryByTestId('discovery-tip-tables')).toBeNull();
        screen.rerender(<DiscoveryTip topic="places" />);
        expect(screen.getByTestId('discovery-tip-places')).toBeTruthy();
    });

    it('opens a topic replay without dismissing it or restarting the introduction', () => {
        const screen = render(<DiscoveryTip topic="friends" />);
        fireEvent.press(screen.getByLabelText('Learn about Your food world'));
        expect(mockPush).toHaveBeenCalledWith({ pathname: '/welcome', params: { topic: 'friends' } });
        expect(mockDismissTip).not.toHaveBeenCalled();
        expect(mockEnableGuide).not.toHaveBeenCalled();
    });
});

describe('zero-Table introduction', () => {
    it('waits for an explicit CTA and delegates navigation without creating a Table', () => {
        const create = jest.fn();
        const learn = jest.fn();
        const screen = render(<TableIntroduction palette={Colors.light} onCreate={create} onLearn={learn} />);
        expect(create).not.toHaveBeenCalled();
        expect(learn).not.toHaveBeenCalled();
        fireEvent.press(screen.getByText('How Tables work'));
        expect(learn).toHaveBeenCalledTimes(1);
        expect(create).not.toHaveBeenCalled();
        fireEvent.press(screen.getByText('Start a Table'));
        expect(create).toHaveBeenCalledTimes(1);
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockEnableGuide).not.toHaveBeenCalled();
        expect(mockDismissTip).not.toHaveBeenCalled();
    });
});
