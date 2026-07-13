import React from 'react';
import { Text } from 'react-native';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Snapshot = {
    type: 'none' | 'wifi';
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    details: null;
};

let mockNetworkListener: ((snapshot: Snapshot) => void) | undefined;
let mockAppStateListener: ((state: string) => void) | undefined;
const mockUnsubscribe = jest.fn();
const mockRemoveAppStateListener = jest.fn();
const mockFetch = jest.fn();
const mockRefresh = jest.fn();
let mockTopInset = 0;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => {
        const Component = (props: Record<string, unknown>) =>
            ReactModule.createElement(name, props, props.children);
        Component.displayName = name;
        return Component;
    };

    return {
        View: host('View'),
        Text: host('Text'),
        ActivityIndicator: host('ActivityIndicator'),
        Pressable: host('Pressable'),
        AppState: {
            addEventListener: jest.fn((_event: string, listener: (state: string) => void) => {
                mockAppStateListener = listener;
                return { remove: mockRemoveAppStateListener };
            }),
        },
        StyleSheet: {
            create: (styles: unknown) => styles,
        },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});

jest.mock('@react-native-community/netinfo', () => ({
    __esModule: true,
    default: {
        configure: jest.fn(),
        addEventListener: jest.fn((listener: (snapshot: Snapshot) => void) => {
            mockNetworkListener = listener;
            return mockUnsubscribe;
        }),
        fetch: (...args: unknown[]) => mockFetch(...args),
        refresh: (...args: unknown[]) => mockRefresh(...args),
    },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
    SafeAreaProvider: (props: Record<string, unknown>) =>
        require('react').createElement('SafeAreaProvider', props, props.children),
    useSafeAreaInsets: () => ({ top: mockTopInset, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/ui/napkin', () => ({
    PressableScale: (props: Record<string, unknown>) =>
        require('react').createElement('PressableScale', props, props.children),
}));

import {
    onlineManager,
    QueryClient,
    QueryClientProvider,
    useQuery,
} from '@tanstack/react-query';
import { ConnectivityProvider } from '../ConnectivityProvider';

const checking: Snapshot = {
    type: 'wifi',
    isConnected: null,
    isInternetReachable: null,
    details: null,
};
const offline: Snapshot = {
    type: 'none',
    isConnected: false,
    isInternetReachable: false,
    details: null,
};
const online: Snapshot = {
    type: 'wifi',
    isConnected: true,
    isInternetReachable: true,
    details: null,
};
const connectedUnknown: Snapshot = {
    type: 'wifi',
    isConnected: true,
    isInternetReachable: null,
    details: null,
};

// react-test-renderer is intentionally untyped in this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textContent(renderer: any): string {
    return renderer.root
        .findAllByType('Text')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .flatMap((node: any) => node.props.children)
        .filter((child: unknown) => typeof child === 'string')
        .join(' ');
}

function renderProvider() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <ConnectivityProvider>
                <Text>App content</Text>
            </ConnectivityProvider>,
        );
    });
    return renderer;
}

function QueryProbe({ queryFn }: { queryFn: () => Promise<string> }) {
    const query = useQuery({ queryKey: ['connectivity-probe'], queryFn, retry: false });
    return <Text>{query.fetchStatus}</Text>;
}

function viewWithTestId(renderer: ReturnType<typeof renderProvider>, testID: string) {
    return renderer.root.findAll(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (node: any) => node.type === 'View' && node.props.testID === testID,
    );
}

describe('ConnectivityProvider', () => {
    beforeEach(() => {
        mockNetworkListener = undefined;
        mockAppStateListener = undefined;
        mockUnsubscribe.mockClear();
        mockRemoveAppStateListener.mockClear();
        mockFetch.mockReset().mockReturnValue(new Promise(() => {}));
        mockRefresh.mockReset();
        mockTopInset = 0;
        onlineManager.setOnline(true);
    });

    afterEach(() => {
        // onlineManager is a process singleton. Production deliberately leaves
        // its last truthful value intact; each test owns its own reset.
        onlineManager.setOnline(true);
    });

    it('gates a cold offline launch, then preserves the mounted app on later drops', () => {
        const renderer = renderProvider();

        expect(textContent(renderer)).not.toContain('App content');

        act(() => mockNetworkListener?.(checking));
        expect(viewWithTestId(renderer, 'no-connection-state')).toHaveLength(0);

        act(() => mockNetworkListener?.(offline));
        expect(viewWithTestId(renderer, 'no-connection-state')).toHaveLength(1);
        expect(textContent(renderer)).toContain('No connection');
        expect(textContent(renderer)).not.toContain('App content');
        expect(onlineManager.isOnline()).toBe(false);

        act(() => mockNetworkListener?.(online));
        expect(textContent(renderer)).toContain('App content');
        expect(viewWithTestId(renderer, 'no-connection-state')).toHaveLength(0);
        expect(onlineManager.isOnline()).toBe(true);

        act(() => mockNetworkListener?.(offline));
        expect(textContent(renderer)).toContain('App content');
        expect(viewWithTestId(renderer, 'offline-banner')).toHaveLength(1);
        expect(onlineManager.isOnline()).toBe(false);

        act(() => renderer.unmount());
        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
        expect(mockRemoveAppStateListener).toHaveBeenCalledTimes(1);
        expect(onlineManager.isOnline()).toBe(false);
    });

    it('rechecks from the full offline state and mounts automatically on success', async () => {
        const renderer = renderProvider();
        act(() => mockNetworkListener?.(offline));
        mockRefresh.mockResolvedValueOnce(online);

        const retry = renderer.root.findByProps({ testID: 'no-connection-retry' });
        await act(async () => {
            await retry.props.onPress();
        });

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(textContent(renderer)).toContain('App content');
        expect(onlineManager.isOnline()).toBe(true);
        act(() => renderer.unmount());
    });

    it('keeps retry busy until a checking refresh receives a definitive event', async () => {
        const renderer = renderProvider();
        act(() => mockNetworkListener?.(offline));
        mockRefresh.mockResolvedValueOnce(connectedUnknown);

        const retry = renderer.root.findByProps({ testID: 'no-connection-retry' });
        act(() => {
            void retry.props.onPress();
            void retry.props.onPress();
        });
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(
            renderer.root.findByProps({ testID: 'no-connection-retry' }).props
                .accessibilityState,
        ).toEqual({ busy: true, disabled: true });
        expect(textContent(renderer)).not.toContain('App content');

        await act(async () => {
            mockNetworkListener?.(online);
            await Promise.resolve();
        });

        expect(textContent(renderer)).toContain('App content');
        expect(onlineManager.isOnline()).toBe(true);
        act(() => renderer.unmount());
    });

    it('bounds a refresh promise that never settles', async () => {
        jest.useFakeTimers();
        try {
            const renderer = renderProvider();
            act(() => mockNetworkListener?.(offline));
            mockRefresh.mockReturnValueOnce(new Promise(() => {}));

            const retry = renderer.root.findByProps({ testID: 'no-connection-retry' });
            act(() => {
                void retry.props.onPress();
            });
            expect(
                renderer.root.findByProps({ testID: 'no-connection-retry' }).props
                    .accessibilityState,
            ).toEqual({ busy: true, disabled: true });

            await act(async () => {
                await jest.advanceTimersByTimeAsync(6_000);
            });

            expect(
                renderer.root.findByProps({ testID: 'no-connection-retry' }).props
                    .accessibilityState,
            ).toEqual({ busy: false, disabled: false });
            expect(viewWithTestId(renderer, 'no-connection-state')).toHaveLength(1);
            act(() => renderer.unmount());
        } finally {
            jest.useRealTimers();
        }
    });

    it('ignores a retry result that arrives after unmount', async () => {
        let resolveRefresh!: (snapshot: Snapshot) => void;
        mockRefresh.mockReturnValueOnce(
            new Promise<Snapshot>((resolve) => {
                resolveRefresh = resolve;
            }),
        );
        const renderer = renderProvider();
        act(() => mockNetworkListener?.(offline));
        const retry = renderer.root.findByProps({ testID: 'no-connection-retry' });
        act(() => {
            void retry.props.onPress();
            renderer.unmount();
        });

        await act(async () => {
            resolveRefresh(online);
            await Promise.resolve();
        });

        expect(onlineManager.isOnline()).toBe(false);
    });

    it('does not let an older fetch overwrite a newer listener event', async () => {
        let resolveFetch!: (snapshot: Snapshot) => void;
        mockFetch.mockReturnValueOnce(
            new Promise<Snapshot>((resolve) => {
                resolveFetch = resolve;
            }),
        );
        const renderer = renderProvider();

        act(() => mockNetworkListener?.(offline));
        await act(async () => {
            resolveFetch(online);
            await Promise.resolve();
        });

        expect(viewWithTestId(renderer, 'no-connection-state')).toHaveLength(1);
        expect(textContent(renderer)).not.toContain('App content');
        expect(onlineManager.isOnline()).toBe(false);
        act(() => renderer.unmount());
    });

    it('refreshes reachability when the app returns to the foreground', async () => {
        const renderer = renderProvider();
        mockRefresh.mockResolvedValueOnce(online);

        await act(async () => {
            mockAppStateListener?.('active');
            await Promise.resolve();
        });

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(textContent(renderer)).toContain('App content');
        act(() => renderer.unmount());
    });

    it('pauses an active query offline and resumes it once after reconnecting', async () => {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const queryFn = jest.fn().mockResolvedValue('fresh');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let renderer: any;

        act(() => {
            renderer = TestRenderer.create(
                <ConnectivityProvider>
                    <QueryClientProvider client={client}>
                        <QueryProbe queryFn={queryFn} />
                    </QueryClientProvider>
                </ConnectivityProvider>,
            );
        });

        act(() => mockNetworkListener?.(offline));
        expect(queryFn).not.toHaveBeenCalled();

        await act(async () => {
            mockNetworkListener?.(online);
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(queryFn).toHaveBeenCalledTimes(1);

        act(() => mockNetworkListener?.(offline));
        act(() => {
            void client.invalidateQueries({ queryKey: ['connectivity-probe'] });
        });
        await act(async () => {
            await Promise.resolve();
        });
        expect(queryFn).toHaveBeenCalledTimes(1);
        expect(client.getQueryState(['connectivity-probe'])?.fetchStatus).toBe('paused');

        await act(async () => {
            mockNetworkListener?.(online);
            await Promise.resolve();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(queryFn).toHaveBeenCalledTimes(2);

        act(() => renderer.unmount());
        client.clear();
    });

    it('scopes safe-area calculation below the in-flow banner on notched screens', () => {
        mockTopInset = 47;
        const renderer = renderProvider();
        act(() => mockNetworkListener?.(online));
        act(() => mockNetworkListener?.(offline));

        const banner = renderer.root.findByProps({ testID: 'offline-banner' });
        const dynamicBannerStyle = banner.props.style.at(-1);
        expect(dynamicBannerStyle.marginTop).toBe(47 + 8);
        expect(renderer.root.findAllByType('SafeAreaProvider')).toHaveLength(1);
        expect(textContent(renderer)).toContain('App content');

        act(() => renderer.unmount());
    });
});
