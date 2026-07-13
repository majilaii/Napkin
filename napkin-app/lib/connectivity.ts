export type ConnectivityStatus = 'checking' | 'online' | 'offline';

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
