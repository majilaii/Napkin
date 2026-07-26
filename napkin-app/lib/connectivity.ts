export type ConnectivityStatus = 'checking' | 'online' | 'offline';

/**
 * Did this failure mean "the request never left the device"?
 *
 * `callEdgeFn` already tags transport failures `code: 'NETWORK'` (Supabase's
 * FunctionsFetchError), but it only used that to SUPPRESS error reporting —
 * nothing ever told the user. So an action taken with no signal failed with
 * generic copy ("couldn't do that — try again"), which reads as "the feature is
 * broken" rather than "you're offline". Founder hit exactly this proposing a
 * gathering with no connection (2026-07-25).
 */
export function isOfflineError(error: unknown): boolean {
    let current: unknown = error;
    for (let depth = 0; depth < 3 && current; depth += 1) {
        const candidate = current as { code?: unknown; cause?: unknown };
        if (candidate.code === 'NETWORK') return true;
        current = candidate.cause;
    }
    return false;
}

/**
 * A failed request is the STRONGEST evidence we have that the device is
 * offline — stronger and earlier than NetInfo's periodic reachability probe,
 * which can lag seconds behind a dropped connection. So any NETWORK failure
 * kicks the provider into re-probing immediately, and the offline banner shows
 * up at the moment the user actually notices something went wrong instead of
 * whenever the OS gets around to it.
 *
 * Kept as a tiny module-level registry because `queryClient` cannot import the
 * provider (the provider imports the query client — `onlineManager` binding).
 */
type NetworkFailureListener = () => void;
const networkFailureListeners = new Set<NetworkFailureListener>();

export function onNetworkFailure(listener: NetworkFailureListener): () => void {
    networkFailureListeners.add(listener);
    return () => networkFailureListeners.delete(listener);
}

export function notifyNetworkFailure(): void {
    for (const listener of networkFailureListeners) {
        // One bad listener must never swallow the others, and this runs inside
        // an error path — it can never throw.
        try {
            listener();
        } catch {
            /* observational only */
        }
    }
}

export interface ReachabilitySnapshot {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
}

/**
 * Convert NetInfo's nullable startup values into the three states the app uses.
 * A definite negative always wins (including a captive Wi-Fi network with no
 * internet). Nullable startup values stay `checking`, so the app never flashes
 * an incorrect offline state while native reachability is still resolving.
 */
export function resolveConnectivityStatus(
    snapshot: ReachabilitySnapshot,
): ConnectivityStatus {
    if (
        snapshot.isConnected === false ||
        snapshot.isInternetReachable === false
    ) {
        return 'offline';
    }

    // A live network interface alone is not enough: captive portals and dead
    // Wi-Fi both report `isConnected: true`. Wait for a confirmed reachability
    // probe before letting a cold launch begin its network reads.
    if (snapshot.isInternetReachable === true) {
        return 'online';
    }

    return 'checking';
}
