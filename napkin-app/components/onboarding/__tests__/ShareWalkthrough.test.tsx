/* eslint-disable import/first -- mock native surfaces before importing the real walkthrough. */
import React from 'react';

const mockClose = jest.fn();
const mockDone = jest.fn();
const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockEnableGuide = jest.fn();
const mockShare = jest.fn();
const mockAnnounce = jest.fn();
const mockLiveImport = jest.fn();
let mockParams: { intro?: string; preview?: string; topic?: string } = {};

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) => ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'), Text: host('Text'), Image: host('Image'), ScrollView: host('ScrollView'),
        Pressable: (props: Record<string, unknown>) => ReactModule.createElement('View', {
            accessible: true, ...props, onStartShouldSetResponder: () => !props.disabled,
        }, props.children),
        Modal: (props: Record<string, unknown>) => props.visible ? ReactModule.createElement('Modal', props, props.children) : null,
        AccessibilityInfo: { announceForAccessibility: (...args: unknown[]) => mockAnnounce(...args) },
        Share: { share: (...args: unknown[]) => mockShare(...args) },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style ?? {},
            absoluteFill: {}, absoluteFillObject: {},
        },
    };
});
jest.mock('react-native-reanimated', () => ({
    __esModule: true,
    default: { View: jest.requireMock('react-native').View },
    FadeIn: { duration: () => undefined },
    useReducedMotion: () => true,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/assets/images/icon.png', () => 1);
jest.mock('@/assets/onboarding/tiktok-crudo.png', () => 2);
jest.mock('@/assets/onboarding/reel-kitchen.png', () => 3);
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack, canGoBack: () => true }),
    useLocalSearchParams: () => mockParams,
    Stack: { Screen: () => null },
    Redirect: ({ href }: { href: string }) => jest.requireActual('react').createElement('Redirect', { testID: 'redirect', href }),
}));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'walkthrough-viewer' }, onboardedAt: '2026-09-13T00:00:00Z' }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/onboarding/GuideIllustration', () => ({ GuideIllustration: () => null }));
jest.mock('@/lib/discoveryGuide', () => ({ enableDiscoveryGuide: (...args: unknown[]) => mockEnableGuide(...args) }));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: (...args: unknown[]) => mockLiveImport(...args) }));
jest.mock('@/lib/supabase', () => ({ supabase: {
    from: (...args: unknown[]) => mockLiveImport(...args),
    rpc: (...args: unknown[]) => mockLiveImport(...args),
    functions: { invoke: (...args: unknown[]) => mockLiveImport(...args) },
} }));
jest.mock('@/lib/importQueue', () => ({
    enqueueVideoImport: (...args: unknown[]) => mockLiveImport(...args),
    confirmImportReview: (...args: unknown[]) => mockLiveImport(...args),
}));

import { fireEvent, render } from '@testing-library/react-native';
import { Platform } from 'react-native';
import { Colors } from '@/constants/theme';
import WelcomeScreen from '@/app/welcome';
import ImportTutorialReplayScreen from '@/app/settings/import-tutorial';
import { ShareWalkthrough } from '../ShareWalkthrough';

type Screen = ReturnType<typeof render>;
function reachReview(screen: Screen, source: 'TikTok' | 'Instagram' = 'TikTok', hiddenApp = false) {
    if (source === 'Instagram') fireEvent.press(screen.getByRole('tab', { name: 'Instagram' }));
    expect(screen.getByRole('tab', { name: source }).props.accessibilityState.selected).toBe(true);
    fireEvent.press(screen.getByLabelText(`Share ${source} video`));
    expect(screen.getByText(`A clip from ${source}`)).toBeTruthy();
    expect(screen.queryByLabelText('Choose Napkin')).toBeNull();
    fireEvent.press(screen.getByLabelText('More sharing options'));
    if (hiddenApp) {
        fireEvent.press(screen.getByLabelText('More apps'));
        expect(screen.getByText('Apps')).toBeTruthy();
        expect(screen.queryByLabelText('More apps')).toBeNull();
    }
    fireEvent.press(screen.getByLabelText('Choose Napkin'));
    expect(screen.getByText(`link ready · ${source}`)).toBeTruthy();
    expect(screen.queryByLabelText('Save 3 spots')).toBeNull();
    fireEvent.press(screen.getByLabelText('add for review'));
    expect(screen.getByText(`You’re back in ${source}. The clip is waiting in Napkin.`)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.press(screen.getByLabelText('Open Napkin in the demo'));
    expect(screen.getByText('Places · clip tray')).toBeTruthy();
    expect(screen.getByLabelText('Sharing demo').props.accessibilityValue.now).toBe(6);
}

describe('offline sharing walkthrough', () => {
    let fetchSpy: jest.SpyInstance;
    beforeEach(() => {
        jest.clearAllMocks();
        mockParams = {};
        Platform.OS = 'ios';
        mockEnableGuide.mockResolvedValue(undefined);
        mockLiveImport.mockImplementation(() => { throw new Error('A sharing rehearsal must not import or mutate'); });
        fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('The demo must stay offline'));
    });
    afterEach(() => {
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(mockShare).not.toHaveBeenCalled();
        expect(mockLiveImport).not.toHaveBeenCalled();
        fetchSpy.mockRestore();
    });

    it.each(['TikTok', 'Instagram'] as const)('rehearses the full %s handoff, review and result without leaving the demo', (source) => {
        const screen = render(<ShareWalkthrough palette={Colors.light} onClose={mockClose} onDone={mockDone} />);
        expect(screen.getByLabelText('Previous demo step').props.accessibilityState.disabled).toBe(true);
        expect(screen.getByText('A practice run. Nothing is saved.')).toBeTruthy();
        reachReview(screen, source);
        expect(screen.getAllByRole('checkbox')).toHaveLength(3);
        expect(mockDone).not.toHaveBeenCalled();
        fireEvent.press(screen.getByLabelText('Save 3 spots'));
        expect(screen.getByText('Example · your map')).toBeTruthy();
        for (const name of ['Matchado', 'TSUJIRI', 'Frothee']) expect(screen.getByText(name)).toBeTruthy();
        expect(screen.getAllByText('pinned')).toHaveLength(3);
        expect(mockDone).not.toHaveBeenCalled();
        fireEvent.press(screen.getByLabelText('Got it'));
        expect(mockDone).toHaveBeenCalledTimes(1);
        expect(mockClose).not.toHaveBeenCalled();
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('lets a hidden Napkin be found under More and keeps the chosen source on back navigation', () => {
        const screen = render(<ShareWalkthrough palette={Colors.light} onClose={mockClose} onDone={mockDone} />);
        reachReview(screen, 'Instagram', true);
        for (let index = 0; index < 5; index++) fireEvent.press(screen.getByLabelText('Previous demo step'));
        expect(screen.getByRole('tab', { name: 'Instagram' }).props.accessibilityState.selected).toBe(true);
        expect(screen.getByLabelText('Share Instagram video')).toBeTruthy();
        expect(mockAnnounce).toHaveBeenLastCalledWith('A good find starts here. Tap the video’s Share button.');
    });

    it('requires one selected restaurant and puts only the selected picks on the result map', () => {
        const screen = render(<ShareWalkthrough palette={Colors.light} onClose={mockClose} onDone={mockDone} />);
        reachReview(screen);
        for (const name of ['Matchado', 'TSUJIRI', 'Frothee']) fireEvent.press(screen.getByRole('checkbox', { name }));
        expect(screen.getByLabelText('Save 0 spots').props.accessibilityState.disabled).toBe(true);
        fireEvent.press(screen.getByLabelText('Save 0 spots'));
        expect(screen.getByText('Places · clip tray')).toBeTruthy();
        expect(screen.queryByText('Example · your map')).toBeNull();
        fireEvent.press(screen.getByRole('checkbox', { name: 'TSUJIRI' }));
        expect(screen.getByRole('checkbox', { name: 'TSUJIRI' }).props.accessibilityState.checked).toBe(true);
        expect(screen.getByLabelText('Save 1 spot').props.accessibilityState.disabled).toBe(false);
        fireEvent.press(screen.getByLabelText('Save 1 spot'));
        expect(screen.getByText('TSUJIRI')).toBeTruthy();
        expect(screen.queryByText('Matchado')).toBeNull();
        expect(screen.queryByText('Frothee')).toBeNull();
        expect(screen.getAllByText('pinned')).toHaveLength(1);
        fireEvent.press(screen.getByLabelText('Previous demo step'));
        expect(screen.getByRole('checkbox', { name: 'Matchado' }).props.accessibilityState.checked).toBe(false);
        expect(screen.getByRole('checkbox', { name: 'TSUJIRI' }).props.accessibilityState.checked).toBe(true);
    });

    it('closes at any stage without completing', () => {
        const screen = render(<ShareWalkthrough palette={Colors.light} onClose={mockClose} onDone={mockDone} />);
        fireEvent.press(screen.getByLabelText('Share TikTok video'));
        fireEvent.press(screen.getByLabelText('Close sharing demo'));
        expect(mockClose).toHaveBeenCalledTimes(1);
        expect(mockDone).not.toHaveBeenCalled();
    });

    it('unmounts and resets the real walkthrough when the welcome modal closes and reopens', () => {
        mockParams = { topic: 'sharing' };
        const screen = render(<WelcomeScreen />);
        fireEvent.press(screen.getByText('Try the sharing demo'));
        reachReview(screen, 'Instagram');
        fireEvent.press(screen.getByRole('checkbox', { name: 'Matchado' }));
        fireEvent.press(screen.getByLabelText('Close sharing demo'));
        expect(screen.queryByLabelText('Sharing demo')).toBeNull();
        expect(screen.getByRole('header', { name: 'Turn clips into places.' })).toBeTruthy();
        fireEvent.press(screen.getByText('Try the sharing demo'));
        expect(screen.getByLabelText('Sharing demo').props.accessibilityValue.now).toBe(1);
        expect(screen.getByRole('tab', { name: 'TikTok' }).props.accessibilityState.selected).toBe(true);
        reachReview(screen);
        expect(screen.getByRole('checkbox', { name: 'Matchado' }).props.accessibilityState.checked).toBe(true);
        expect(mockEnableGuide).not.toHaveBeenCalled();
    });

    it.each([false, true])('finishes the welcome modal and advances only the first-run introduction (%s)', (intro) => {
        mockParams = intro ? { intro: '1' } : { topic: 'sharing' };
        const screen = render(<WelcomeScreen />);
        if (intro) {
            fireEvent.press(screen.getByText('Continue'));
            fireEvent.press(screen.getByText('Continue'));
        }
        fireEvent.press(screen.getByText('Try the sharing demo'));
        reachReview(screen);
        fireEvent.press(screen.getByLabelText('Save 3 spots'));
        fireEvent.press(screen.getByLabelText('Got it'));
        expect(screen.queryByLabelText('Sharing demo')).toBeNull();
        expect(screen.getByRole('header', { name: intro ? 'A Table for your people.' : 'Turn clips into places.' })).toBeTruthy();
        if (intro) expect(screen.getByLabelText('Introduction').props.accessibilityValue.now).toBe(4);
        expect(mockPush).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('closes an open rehearsal when a new guide topic arrives on the mounted route', () => {
        mockParams = { topic: 'sharing' };
        const screen = render(<WelcomeScreen />);
        fireEvent.press(screen.getByText('Try the sharing demo'));
        fireEvent.press(screen.getByLabelText('Share TikTok video'));
        mockParams = { topic: 'tables' };
        screen.rerender(<WelcomeScreen />);
        expect(screen.queryByLabelText('Sharing demo')).toBeNull();
        expect(screen.getByRole('header', { name: 'A Table for your people.' })).toBeTruthy();
    });

    it.each(['close', 'done'])('replays from Settings and returns to Settings on %s without enrollment', (exit) => {
        const screen = render(<ImportTutorialReplayScreen />);
        expect(screen.getByLabelText('Share TikTok video')).toBeTruthy();
        if (exit === 'close') fireEvent.press(screen.getByLabelText('Close sharing demo'));
        else {
            reachReview(screen);
            fireEvent.press(screen.getByLabelText('Save 3 spots'));
            fireEvent.press(screen.getByLabelText('Got it'));
        }
        expect(mockBack).toHaveBeenCalledTimes(1);
        expect(mockEnableGuide).not.toHaveBeenCalled();
        expect(mockReplace).not.toHaveBeenCalled();
    });

    it('keeps the iOS Settings tutorial harmless on an Android deep link', () => {
        Platform.OS = 'android';
        const screen = render(<ImportTutorialReplayScreen />);
        expect(screen.getByTestId('redirect').props.href).toBe('/settings');
        expect(screen.queryByLabelText('Sharing demo')).toBeNull();
        expect(mockEnableGuide).not.toHaveBeenCalled();
    });
});
