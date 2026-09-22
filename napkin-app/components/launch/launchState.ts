/**
 * Launch screen state: one cover from the native splash until the first real
 * screen is ready. It replaces three separate cold-launch screens (the
 * connection spinner, the "No connection" page and the "Checking your
 * account…" gate) with a single branded surface.
 *
 * Providers report what they are waiting on; this module decides what the
 * cover shows. Pure so the matrix is testable without animation.
 */

export type ConnectivityLaunchState =
    | { status: 'checking' }
    | { status: 'offline'; retrying: boolean; retry: () => void }
    | { status: 'ready' };

export type AccountLaunchState =
    | { status: 'checking' }
    | { status: 'unreachable'; retry: () => void }
    | { status: 'ready' };

export type LaunchStatus =
    | { kind: 'loading' }
    | { kind: 'offline'; retrying: boolean; retry: () => void }
    | { kind: 'unreachable'; retry: () => void }
    | { kind: 'ready' };

/**
 * Connectivity is resolved first because the app (and so the account check)
 * only mounts once a cold launch knows it is online. The cover stays up until
 * the navigator has also settled on its destination, so the user never sees
 * an intermediate route (for example `/` redirecting to Places before auth
 * routing replaces it).
 */
export function resolveLaunchStatus(
    connectivity: ConnectivityLaunchState,
    account: AccountLaunchState,
    routeSettled: boolean,
): LaunchStatus {
    if (connectivity.status === 'offline') {
        return { kind: 'offline', retrying: connectivity.retrying, retry: connectivity.retry };
    }
    if (connectivity.status === 'checking') return { kind: 'loading' };
    if (account.status === 'unreachable') {
        return { kind: 'unreachable', retry: account.retry };
    }
    if (account.status === 'checking' || !routeSettled) return { kind: 'loading' };
    return { kind: 'ready' };
}

/** Where the cover is in its life. `splash` waits for the native splash handoff. */
export type LaunchPhase = 'splash' | 'intro' | 'waiting' | 'exiting' | 'done';

/**
 * `launch` picks up from the native splash and plays the intro. `resume`
 * covers a later account check (signing in) and simply fades the masthead in.
 */
export type LaunchMode = 'launch' | 'resume';

export const LAUNCH_TIMING = {
    /** Rules draw outward from the wordmark after the native splash hides. */
    ruleDelayMs: 60,
    ruleStaggerMs: 90,
    ruleDrawMs: 620,
    /** Intro is complete once both rules have drawn. */
    introMs: 780,
    /** The wet terracotta stroke dries to the masthead's quiet hairline. */
    inkDryDelayMs: 640,
    inkDryMs: 620,
    /** Masthead fade-in when the cover returns for a later account check. */
    resumeFadeMs: 200,
    /** Masthead lifts away, then the paper dissolves to reveal the app. */
    exitMastheadMs: 220,
    exitPaperDelayMs: 90,
    exitPaperMs: 300,
    exitMs: 420,
    /** Quiet status line only when a launch is slower than this. */
    slowAfterMs: 3500,
    /** The pen stroke that runs along the lower rule while waiting. */
    nibPassMs: 1150,
    nibRestMs: 280,
    /** Automatic retry cadence while the account check cannot reach Napkin. */
    autoRetryMs: 8000,
    /** Never keep the native splash up longer than this waiting for the image. */
    splashFallbackMs: 1200,
    /** Navigator must hold one route this long before the cover lifts. */
    routeSettleMs: 120,
} as const;

/** Copy for the status line under the masthead. Kept terse on purpose. */
export const LAUNCH_COPY = {
    slow: 'Setting the table…',
    offline: 'No connection',
    unreachable: 'Couldn’t reach Napkin',
    retry: 'try again',
} as const;

export function launchStatusLine(status: LaunchStatus, slow: boolean): string | null {
    if (status.kind === 'offline') return LAUNCH_COPY.offline;
    if (status.kind === 'unreachable') return LAUNCH_COPY.unreachable;
    if (status.kind === 'loading' && slow) return LAUNCH_COPY.slow;
    return null;
}

/** The pen stroke runs only while the cover is genuinely waiting on work. */
export function isLaunchBusy(status: LaunchStatus): boolean {
    return status.kind === 'loading' || (status.kind === 'offline' && status.retrying);
}
