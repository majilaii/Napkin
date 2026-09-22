import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Colors } from '@/constants/theme';

import {
    LaunchCoveringContext,
    LaunchReporterContext,
    type LaunchReporter,
} from './launchContext';
import { LaunchScreen } from './LaunchScreen';
import {
    LAUNCH_TIMING,
    resolveLaunchStatus,
    type AccountLaunchState,
    type ConnectivityLaunchState,
    type LaunchMode,
} from './launchState';
import { useLaunchSequence } from './useLaunchSequence';

type Presence = { mode: LaunchMode; key: number } | null;

/**
 * Hosts the launch screen above the whole app. Mount it at the root, outside
 * every provider that can hold the app back (connectivity, auth, the
 * onboarding gate): they report their state here and render plain paper
 * while they wait, so a cold launch shows one screen instead of three.
 */
export function LaunchProvider({ children }: { children: ReactNode }) {
    const [connectivity, setConnectivity] = useState<ConnectivityLaunchState>({ status: 'checking' });
    const [account, setAccount] = useState<AccountLaunchState>({ status: 'checking' });
    const [routeSettled, setRouteSettled] = useState(false);
    const [presence, setPresence] = useState<Presence>({ mode: 'launch', key: 0 });

    const status = resolveLaunchStatus(connectivity, account, routeSettled);

    // A later account check (signing in) brings the cover back without the
    // intro. Layout effect, so it paints together with the gate's blocker.
    const needsCover = status.kind !== 'ready';
    useLayoutEffect(() => {
        if (needsCover && presence === null) {
            setPresence((current) => current ?? { mode: 'resume', key: Date.now() });
        }
    }, [needsCover, presence]);

    // The account check retries on its own while Napkin is unreachable; the
    // button is there for impatience, not as the only way out.
    const autoRetry = status.kind === 'unreachable' ? status.retry : null;
    useEffect(() => {
        if (!autoRetry) return;
        const timer = setTimeout(autoRetry, LAUNCH_TIMING.autoRetryMs);
        return () => clearTimeout(timer);
    }, [autoRetry]);

    const reporter = useMemo<LaunchReporter>(
        () => ({ setConnectivity, setAccount, setRouteSettled }),
        [],
    );
    const handleDone = useCallback(() => setPresence(null), []);

    return (
        <LaunchReporterContext.Provider value={reporter}>
            <LaunchCoveringContext.Provider value={presence !== null}>
                <View style={styles.root}>
                    {children}
                    {presence ? (
                        <LaunchCover
                            key={presence.key}
                            mode={presence.mode}
                            status={status}
                            onDone={handleDone}
                        />
                    ) : null}
                </View>
            </LaunchCoveringContext.Provider>
        </LaunchReporterContext.Provider>
    );
}

function LaunchCover({
    mode,
    status,
    onDone,
}: {
    mode: LaunchMode;
    status: ReturnType<typeof resolveLaunchStatus>;
    onDone: () => void;
}) {
    const { phase, slow, onWordmarkLoaded } = useLaunchSequence({
        mode,
        ready: status.kind === 'ready',
        onDone,
    });
    return (
        <LaunchScreen
            mode={mode}
            phase={phase}
            status={status}
            slow={slow}
            onWordmarkLoaded={onWordmarkLoaded}
        />
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: Colors.light.background,
    },
});
