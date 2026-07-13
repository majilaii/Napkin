import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import {
    ActivityIndicator,
    AppState,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
    SafeAreaProvider,
    useSafeAreaInsets,
} from 'react-native-safe-area-context';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    resolveConnectivityStatus,
    type ConnectivityStatus,
} from '@/lib/connectivity';
import { PressableScale } from '@/components/ui/napkin';

// Keep the reachability probe on a small, public Napkin-owned resource rather
// than the library's third-party default. A HEAD request proves internet access
// without downloading the page body.
NetInfo.configure({
    reachabilityUrl: 'https://napkin-legal.vercel.app/privacy.html',
    reachabilityMethod: 'HEAD',
    reachabilityTest: async (response) => response.ok,
    reachabilityShortTimeout: 3_000,
    reachabilityLongTimeout: 60_000,
    reachabilityRequestTimeout: 5_000,
    useNativeReachability: false,
});

const REACHABILITY_SETTLE_TIMEOUT_MS = 6_000;

interface Props {
    children: React.ReactNode;
}

interface ConnectivityContextValue {
    status: ConnectivityStatus;
    isRefreshing: boolean;
    refresh: () => Promise<void>;
}

const ConnectivityContext = createContext<ConnectivityContextValue>({
    // A safe default keeps isolated component tests and previews usable. The real
    // app always supplies the provider at its root.
    status: 'online',
    isRefreshing: false,
    refresh: async () => {},
});

export function useConnectivity(): ConnectivityContextValue {
    return useContext(ConnectivityContext);
}

/**
 * Owns the native reachability subscription for both the UI and TanStack Query.
 *
 * The first definitive result gates the rest of the app, preventing a cold
 * offline launch from firing auth/profile reads and mistaking transport errors
 * for product state. After the app has mounted once, it stays mounted through a
 * disconnect so cached screens and in-progress forms are preserved behind the
 * compact banner.
 */
export function ConnectivityProvider({ children }: Props) {
    const [status, setStatus] = useState<ConnectivityStatus>('checking');
    const [hasMountedApp, setHasMountedApp] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const isMountedRef = useRef(true);
    const refreshInFlightRef = useRef(false);
    const pendingDefinitiveWaitersRef = useRef(new Set<() => void>());

    const waitForDefinitiveSnapshot = useCallback(() => {
        let settle!: () => void;
        const promise = new Promise<void>((resolve) => {
            const timeout = setTimeout(() => settle(), REACHABILITY_SETTLE_TIMEOUT_MS);
            settle = () => {
                clearTimeout(timeout);
                pendingDefinitiveWaitersRef.current.delete(settle);
                resolve();
            };
            pendingDefinitiveWaitersRef.current.add(settle);
        });

        return { promise, cancel: settle };
    }, []);

    const applySnapshot = useCallback((snapshot: NetInfoState) => {
        const next = resolveConnectivityStatus(snapshot);

        // A nullable native startup snapshot is not evidence that an established
        // connection changed. Keep the last definitive state until NetInfo knows.
        if (next === 'checking') return;

        for (const settle of [...pendingDefinitiveWaitersRef.current]) settle();
        const online = next === 'online';
        onlineManager.setOnline(online);
        setStatus(next);
        if (online) setHasMountedApp(true);
    }, []);

    const assumeOnlineAfterDetectorFailure = useCallback(() => {
        // Reachability detection itself must never strand the app on a spinner.
        // Normal request-level errors remain visible through existing states.
        onlineManager.setOnline(true);
        setStatus('online');
        setHasMountedApp(true);
    }, []);

    useEffect(() => {
        let active = true;
        let definitiveEventReceived = false;
        let unsubscribe = () => {};
        isMountedRef.current = true;

        const applyIfActive = (snapshot: NetInfoState) => {
            if (active) applySnapshot(snapshot);
        };

        const applyEventIfActive = (snapshot: NetInfoState) => {
            if (resolveConnectivityStatus(snapshot) !== 'checking') {
                definitiveEventReceived = true;
            }
            applyIfActive(snapshot);
        };

        try {
            unsubscribe = NetInfo.addEventListener(applyEventIfActive);
            void NetInfo.fetch()
                .then((snapshot) => {
                    // The listener is authoritative. Do not let an older fetch
                    // resolve late and overwrite a newer disconnect/reconnect.
                    if (!definitiveEventReceived) applyIfActive(snapshot);
                })
                .catch(() => {
                    if (active && !definitiveEventReceived) {
                        assumeOnlineAfterDetectorFailure();
                    }
                });
        } catch {
            assumeOnlineAfterDetectorFailure();
        }

        // iOS reachability can miss changes made while the app is backgrounded.
        // Refreshing on foreground keeps both the banner and query manager honest.
        const appStateSubscription = AppState.addEventListener('change', (next) => {
            if (next !== 'active') return;
            void NetInfo.refresh().then(applyIfActive).catch(() => {});
        });

        return () => {
            active = false;
            isMountedRef.current = false;
            unsubscribe();
            appStateSubscription.remove();
            for (const settle of [...pendingDefinitiveWaitersRef.current]) settle();
        };
    }, [applySnapshot, assumeOnlineAfterDetectorFailure]);

    const refresh = useCallback(async () => {
        if (refreshInFlightRef.current) return;
        refreshInFlightRef.current = true;
        setIsRefreshing(true);
        // NetInfo.refresh() returns the native interface snapshot before its
        // custom HTTP reachability probe finishes. Start listening first so a
        // fast definitive event cannot slip between the promise and the waiter.
        const definitiveWaiter = waitForDefinitiveSnapshot();
        let acceptRefreshResult = true;
        try {
            const refreshTask = NetInfo.refresh()
                .then((snapshot) => {
                    if (!acceptRefreshResult || !isMountedRef.current) return;
                    applySnapshot(snapshot);
                    if (resolveConnectivityStatus(snapshot) === 'checking') {
                        return definitiveWaiter.promise;
                    }
                })
                .catch(() => {
                    // Stay in the current state; the subscription can recover.
                });

            // NetInfo queues concurrent refreshes internally. Bound the whole
            // operation as well as the HTTP probe so a stuck queued refresh can
            // never leave the retry control busy forever.
            await Promise.race([refreshTask, definitiveWaiter.promise]);
        } finally {
            acceptRefreshResult = false;
            definitiveWaiter.cancel();
            refreshInFlightRef.current = false;
            if (isMountedRef.current) setIsRefreshing(false);
        }
    }, [applySnapshot, waitForDefinitiveSnapshot]);

    const contextValue = useMemo(
        () => ({ status, isRefreshing, refresh }),
        [isRefreshing, refresh, status],
    );

    if (!hasMountedApp) {
        if (status === 'offline') {
            return (
                <ConnectivityContext.Provider value={contextValue}>
                    <NoConnectionState
                        isRefreshing={isRefreshing}
                        onRetry={refresh}
                    />
                </ConnectivityContext.Provider>
            );
        }
        return (
            <ConnectivityContext.Provider value={contextValue}>
                <ConnectivityLoadingState />
            </ConnectivityContext.Provider>
        );
    }

    return (
        <ConnectivityContext.Provider value={contextValue}>
            <View style={styles.appShell}>
                {status === 'offline' ? (
                    <OfflineBanner
                        key="offline-banner"
                        isRefreshing={isRefreshing}
                        onRetry={refresh}
                    />
                ) : null}
                <SafeAreaProvider key="app-content" style={styles.appContent}>
                    {children}
                </SafeAreaProvider>
            </View>
        </ConnectivityContext.Provider>
    );
}

function ConnectivityLoadingState() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View
            style={[styles.loadingRoot, { backgroundColor: palette.background }]}
            accessibilityLabel="Checking connection"
        >
            <ActivityIndicator size="small" color={palette.primary} />
        </View>
    );
}

function NoConnectionState({
    isRefreshing,
    onRetry,
}: {
    isRefreshing: boolean;
    onRetry: () => void;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    return (
        <View
            style={[styles.offlineRoot, { backgroundColor: palette.background }]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityViewIsModal
            testID="no-connection-state"
        >
            <View
                style={[
                    styles.offlineIconTile,
                    Shadow.subtle,
                    { backgroundColor: palette.surfaceJournal },
                ]}
            >
                <Ionicons
                    name="cloud-offline-outline"
                    size={34}
                    color={palette.primary}
                />
            </View>
            <Text style={[styles.offlineTitle, { color: palette.text }]}>No connection</Text>
            <Text style={[styles.offlineBody, { color: palette.textMuted }]}>
                {'Check your connection and try again. Your place in Napkin is safe.'}
            </Text>
            <PressableScale
                onPress={onRetry}
                disabled={isRefreshing}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel="Try connection again"
                accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
                testID="no-connection-retry"
                style={[
                    styles.offlineRetry,
                    {
                        borderColor: palette.primary,
                        opacity: isRefreshing ? 0.6 : 1,
                    },
                ]}
            >
                {isRefreshing ? (
                    <ActivityIndicator size="small" color={palette.primary} />
                ) : (
                    <Text style={[styles.offlineRetryLabel, { color: palette.primary }]}>try again</Text>
                )}
            </PressableScale>
        </View>
    );
}

function OfflineBanner({
    isRefreshing,
    onRetry,
}: {
    isRefreshing: boolean;
    onRetry: () => void;
}) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();

    return (
        <View
            style={[
                styles.banner,
                Shadow.ambient,
                {
                    marginTop: insets.top + Spacing.sm,
                    backgroundColor: palette.surfaceNote,
                },
            ]}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            testID="offline-banner"
        >
            <View style={[styles.bannerIcon, { backgroundColor: palette.surfaceJournal }]}>
                <Ionicons
                    name="cloud-offline-outline"
                    size={18}
                    color={palette.primary}
                />
            </View>
            <Text style={[styles.bannerLabel, { color: palette.text }]}>No connection</Text>
            <PressableScale
                onPress={onRetry}
                disabled={isRefreshing}
                haptic="selection"
                accessibilityRole="button"
                accessibilityLabel="Try connection again"
                accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
                style={styles.bannerRetry}
            >
                {isRefreshing ? (
                    <ActivityIndicator size="small" color={palette.primary} />
                ) : (
                    <Text style={[styles.bannerRetryLabel, { color: palette.primary }]}>try again</Text>
                )}
            </PressableScale>
        </View>
    );
}

const styles = StyleSheet.create({
    appShell: {
        flex: 1,
    },
    appContent: {
        flex: 1,
    },
    loadingRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    offlineRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        paddingBottom: 28,
    },
    offlineIconTile: {
        width: 72,
        height: 72,
        borderRadius: Radius.xl,
        alignItems: 'center',
        justifyContent: 'center',
    },
    offlineTitle: {
        marginTop: 26,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        lineHeight: 32,
        letterSpacing: -0.4,
        textAlign: 'center',
    },
    offlineBody: {
        marginTop: 10,
        maxWidth: 290,
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 21,
        textAlign: 'center',
    },
    offlineRetry: {
        minWidth: 132,
        minHeight: 48,
        marginTop: 26,
        paddingHorizontal: 22,
        borderRadius: Radius.full,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    offlineRetryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    banner: {
        marginHorizontal: 12,
        marginBottom: Spacing.sm,
        minHeight: 56,
        padding: 8,
        borderRadius: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    bannerIcon: {
        width: 32,
        height: 32,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bannerLabel: {
        flex: 1,
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        lineHeight: 20,
    },
    bannerRetry: {
        minWidth: 76,
        minHeight: 40,
        paddingHorizontal: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    bannerRetryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.2,
    },
});
