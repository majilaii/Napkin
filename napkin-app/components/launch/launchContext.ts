import { createContext, useContext } from 'react';

import type { AccountLaunchState, ConnectivityLaunchState } from './launchState';

/**
 * How providers tell the launch screen what they are waiting on. Kept apart
 * from the screen itself so providers (and their tests) do not import any
 * animation or asset code.
 */
export interface LaunchReporter {
    setConnectivity: (state: ConnectivityLaunchState) => void;
    setAccount: (state: AccountLaunchState) => void;
    setRouteSettled: (settled: boolean) => void;
}

export const LaunchReporterContext = createContext<LaunchReporter | null>(null);

/** True while the launch screen covers the app (cold launch or a later account check). */
export const LaunchCoveringContext = createContext(false);

export function useLaunchReporter(): LaunchReporter | null {
    return useContext(LaunchReporterContext);
}

export function useLaunchCovering(): boolean {
    return useContext(LaunchCoveringContext);
}
