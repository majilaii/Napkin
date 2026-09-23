/* eslint-disable import/first -- mock native surfaces before importing the launch screen. */
import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockHideAsync = jest.fn(() => Promise.resolve());
let mockReducedMotion = false;

jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => {
        const Component = (props: Record<string, unknown>) =>
            ReactModule.createElement(name, props, props.children);
        Component.displayName = name;
        return Component;
    };
    return {
        View: host('View'),
        Text: host('Text'),
        Image: host('Image'),
        ActivityIndicator: host('ActivityIndicator'),
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => (Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {})),
            absoluteFill: {},
            absoluteFillObject: {},
            hairlineWidth: 1 / 3,
        },
    };
});
jest.mock('react-native-reanimated', () => {
    const ReactModule = jest.requireActual('react');
    const identity = (value: unknown) => value;
    return {
        __esModule: true,
        default: { View: jest.requireMock('react-native').View },
        useSharedValue: (initial: unknown) => {
            const ref = ReactModule.useRef(null);
            if (ref.current === null) {
                let value = initial;
                ref.current = { get: () => value, set: (next: unknown) => { value = next; } };
            }
            return ref.current;
        },
        useAnimatedStyle: (worklet: () => unknown) => worklet(),
        useReducedMotion: () => mockReducedMotion,
        withTiming: identity,
        withDelay: (_delay: number, animation: unknown) => animation,
        withRepeat: identity,
        withSequence: (...animations: unknown[]) => animations[animations.length - 1],
        cancelAnimation: () => undefined,
        interpolate: (_value: number, _input: number[], output: number[]) => output[0],
        Easing: {
            bezier: () => identity,
            in: identity,
            out: identity,
            inOut: identity,
            cubic: identity,
        },
        FadeIn: { duration: () => undefined },
    };
});
jest.mock('expo-splash-screen', () => ({
    hideAsync: () => mockHideAsync(),
    preventAutoHideAsync: jest.fn(),
}));
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('@/assets/images/splash-wordmark.png', () => 1);
jest.mock('@/components/ui/napkin', () => ({
    PressableScale: (props: Record<string, unknown>) =>
        jest.requireActual('react').createElement('PressableScale', props, props.children),
}));

(globalThis as { requestAnimationFrame?: (callback: () => void) => number })
    .requestAnimationFrame = (callback) => setTimeout(callback, 16) as unknown as number;

import { Text } from 'react-native';

import { LaunchProvider } from '../LaunchProvider';
import { useLaunchCovering, useLaunchReporter, type LaunchReporter } from '../launchContext';
import { LAUNCH_COPY, LAUNCH_TIMING } from '../launchState';

let reporter: LaunchReporter | null = null;
let covering = false;

function Probe() {
    reporter = useLaunchReporter();
    covering = useLaunchCovering();
    return <Text>App content</Text>;
}

function renderLaunch() {
    return render(
        <LaunchProvider>
            <Probe />
        </LaunchProvider>,
    );
}

function advance(ms: number) {
    act(() => {
        jest.advanceTimersByTime(ms);
    });
}

function reportEverythingReady() {
    act(() => {
        reporter?.setConnectivity({ status: 'ready' });
        reporter?.setAccount({ status: 'ready' });
        reporter?.setRouteSettled(true);
    });
}

describe('LaunchProvider', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        mockHideAsync.mockClear();
        mockReducedMotion = false;
        reporter = null;
        covering = false;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('covers the app from the first frame while it mounts underneath', () => {
        const screen = renderLaunch();

        expect(screen.getByTestId('launch-screen')).toBeTruthy();
        expect(screen.getByTestId('launch-wordmark').props.accessibilityLabel).toBe('Napkin');
        // Mounted underneath, but out of VoiceOver's reach until the cover lifts.
        expect(screen.getByText('App content', { includeHiddenElements: true })).toBeTruthy();
        expect(screen.queryByText('App content')).toBeNull();
        expect(covering).toBe(true);
        // No separate account-check copy: a quick launch is just the wordmark.
        expect(screen.queryByText(/checking/i)).toBeNull();
    });

    it('hides the native splash two frames after the wordmark has loaded', () => {
        const screen = renderLaunch();

        act(() => {
            screen.getByTestId('launch-wordmark').props.onLoad();
        });
        expect(mockHideAsync).not.toHaveBeenCalled();

        advance(40);
        expect(mockHideAsync).toHaveBeenCalledTimes(1);

        advance(LAUNCH_TIMING.splashFallbackMs);
        expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it('never strands the native splash when the image load event is missed', () => {
        renderLaunch();

        advance(LAUNCH_TIMING.splashFallbackMs - 1);
        expect(mockHideAsync).not.toHaveBeenCalled();
        advance(1);
        expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it('finishes the intro before lifting, then unmounts the cover', () => {
        const screen = renderLaunch();
        act(() => {
            screen.getByTestId('launch-wordmark').props.onLoad();
        });
        advance(40);

        reportEverythingReady();
        advance(LAUNCH_TIMING.introMs - 1);
        expect(screen.getByTestId('launch-screen').props.pointerEvents).toBe('auto');

        advance(1);
        expect(screen.getByTestId('launch-screen').props.pointerEvents).toBe('none');
        expect(covering).toBe(true);

        advance(LAUNCH_TIMING.exitMs);
        expect(screen.queryByTestId('launch-screen')).toBeNull();
        expect(screen.getByText('App content')).toBeTruthy();
        expect(covering).toBe(false);
    });

    it('hides the app from TalkBack and VoiceOver only while covered', () => {
        const screen = renderLaunch();
        const appRoot = () => screen.getByText('App content', { includeHiddenElements: true }).parent;
        const hidingAncestor = () => {
            let node = appRoot();
            while (node && node.props.importantForAccessibility === undefined) node = node.parent;
            return node;
        };
        expect(hidingAncestor()?.props.importantForAccessibility).toBe('no-hide-descendants');
        expect(hidingAncestor()?.props.accessibilityElementsHidden).toBe(true);

        advance(LAUNCH_TIMING.splashFallbackMs);
        reportEverythingReady();
        advance(LAUNCH_TIMING.introMs);
        advance(LAUNCH_TIMING.exitMs);
        expect(screen.queryByTestId('launch-screen')).toBeNull();
        expect(hidingAncestor()?.props.importantForAccessibility).toBe('auto');
        expect(hidingAncestor()?.props.accessibilityElementsHidden).toBe(false);
    });

    it('waits for the navigator to settle even when the account check is done', () => {
        const screen = renderLaunch();
        advance(LAUNCH_TIMING.splashFallbackMs);
        act(() => {
            reporter?.setConnectivity({ status: 'ready' });
            reporter?.setAccount({ status: 'ready' });
        });

        advance(LAUNCH_TIMING.introMs + LAUNCH_TIMING.exitMs);
        expect(screen.getByTestId('launch-screen')).toBeTruthy();

        act(() => reporter?.setRouteSettled(true));
        advance(LAUNCH_TIMING.exitMs);
        expect(screen.queryByTestId('launch-screen')).toBeNull();
    });

    it('adds a quiet line only when the launch runs slow', () => {
        const screen = renderLaunch();
        advance(LAUNCH_TIMING.splashFallbackMs);

        advance(LAUNCH_TIMING.slowAfterMs - 1);
        expect(screen.queryByText(LAUNCH_COPY.slow)).toBeNull();

        advance(1);
        expect(screen.getByText(LAUNCH_COPY.slow)).toBeTruthy();
        expect(screen.queryByTestId('launch-retry')).toBeNull();
    });

    it('offers the connection retry inside the launch screen on a cold offline launch', () => {
        const retry = jest.fn();
        const screen = renderLaunch();
        advance(LAUNCH_TIMING.splashFallbackMs);
        act(() => reporter?.setConnectivity({ status: 'offline', retrying: false, retry }));

        expect(screen.getByText(LAUNCH_COPY.offline)).toBeTruthy();
        act(() => {
            screen.getByTestId('launch-retry').props.onPress();
        });
        expect(retry).toHaveBeenCalledTimes(1);

        act(() => reporter?.setConnectivity({ status: 'offline', retrying: true, retry }));
        expect(screen.getByTestId('launch-retry').props.accessibilityState).toEqual({
            busy: true,
            disabled: true,
        });

        // Reachability returns: the cover carries on to the account check.
        act(() => reporter?.setConnectivity({ status: 'ready' }));
        expect(screen.queryByText(LAUNCH_COPY.offline)).toBeNull();
        expect(screen.getByTestId('launch-screen')).toBeTruthy();
    });

    it('retries an unreachable account check by itself and on request', () => {
        const retry = jest.fn();
        const screen = renderLaunch();
        advance(LAUNCH_TIMING.splashFallbackMs);
        act(() => {
            reporter?.setConnectivity({ status: 'ready' });
            reporter?.setAccount({ status: 'unreachable', retry });
        });

        expect(screen.getByText(LAUNCH_COPY.unreachable)).toBeTruthy();
        act(() => {
            screen.getByTestId('launch-retry').props.onPress();
        });
        expect(retry).toHaveBeenCalledTimes(1);

        advance(LAUNCH_TIMING.autoRetryMs);
        expect(retry).toHaveBeenCalledTimes(2);

        // Each failed round schedules the next automatic attempt.
        act(() => reporter?.setAccount({ status: 'checking' }));
        act(() => reporter?.setAccount({ status: 'unreachable', retry }));
        advance(LAUNCH_TIMING.autoRetryMs);
        expect(retry).toHaveBeenCalledTimes(3);
    });

    it('comes back without the intro for a later account check, then leaves again', () => {
        const screen = renderLaunch();
        advance(LAUNCH_TIMING.splashFallbackMs);
        reportEverythingReady();
        advance(LAUNCH_TIMING.introMs);
        advance(LAUNCH_TIMING.exitMs);
        expect(screen.queryByTestId('launch-screen')).toBeNull();

        // Signing in: the onboarding gate blocks again while the profile loads.
        act(() => reporter?.setAccount({ status: 'checking' }));
        expect(screen.getByTestId('launch-screen')).toBeTruthy();
        expect(covering).toBe(true);

        act(() => reporter?.setAccount({ status: 'ready' }));
        advance(LAUNCH_TIMING.resumeFadeMs);
        advance(LAUNCH_TIMING.exitMs);
        expect(screen.queryByTestId('launch-screen')).toBeNull();
        expect(covering).toBe(false);
        expect(mockHideAsync).toHaveBeenCalledTimes(1);
    });

    it('does not come back when the route changes while it dissolves', () => {
        const screen = renderLaunch();
        advance(LAUNCH_TIMING.splashFallbackMs);
        reportEverythingReady();
        advance(LAUNCH_TIMING.introMs);
        expect(screen.getByTestId('launch-screen').props.pointerEvents).toBe('none');

        // A tap or deep link during the exit re-arms route settling.
        act(() => reporter?.setRouteSettled(false));
        advance(LAUNCH_TIMING.exitMs);
        expect(screen.queryByTestId('launch-screen')).toBeNull();
        expect(covering).toBe(false);

        advance(LAUNCH_TIMING.routeSettleMs + LAUNCH_TIMING.resumeFadeMs);
        expect(screen.queryByTestId('launch-screen')).toBeNull();
    });

    it('runs the same sequence with reduced motion', () => {
        mockReducedMotion = true;
        const screen = renderLaunch();
        advance(LAUNCH_TIMING.splashFallbackMs);
        reportEverythingReady();
        advance(LAUNCH_TIMING.introMs);
        advance(LAUNCH_TIMING.exitMs);
        expect(screen.queryByTestId('launch-screen')).toBeNull();
    });
});
