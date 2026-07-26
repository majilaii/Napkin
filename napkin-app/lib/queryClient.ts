import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { SessionExpiredError } from '@/lib/edgeInvoke';
import { isOfflineError, notifyNetworkFailure } from '@/lib/connectivity';
import { captureError } from '@/lib/sentry';
import { trackError } from '@/lib/track';

// TICKET-121: global observational error handlers — every query/mutation
// failure that isn't already reported at the callEdgeFn choke point lands in
// the events table + Sentry. No retries, no cache behavior changes, and the
// handlers can never throw.
function shouldSkip(err: unknown): boolean {
    if (err instanceof SessionExpiredError) return true;
    return !!(err as { __napkinReported?: boolean } | null)?.__napkinReported;
}

function report(err: unknown, buildContext: () => string): void {
    try {
        // Runs BEFORE the skip check: transport failures are marked
        // `__napkinReported` at the callEdgeFn choke point (they are not app
        // bugs), so gating this behind `shouldSkip` would mean the one signal
        // we most want — a request that never left the device — is the one
        // signal we never act on.
        if (isOfflineError(err)) notifyNetworkFailure();
        if (shouldSkip(err)) return;
        const context = buildContext();
        trackError(err, context);
        captureError(err, { context });
    } catch {
        /* observational only — never throw */
    }
}

export const queryClient = new QueryClient({
    queryCache: new QueryCache({
        onError: (err, query) => {
            report(err, () => `query:${JSON.stringify(query.queryKey).slice(0, 120)}`);
        },
    }),
    mutationCache: new MutationCache({
        onError: (err, _variables, _onMutateResult, mutation) => {
            report(err, () => {
                const key = mutation.options.mutationKey;
                return `mutation:${key ? JSON.stringify(key).slice(0, 120) : 'anonymous'}`;
            });
        },
    }),
    defaultOptions: {
        queries: {
            staleTime: 1000 * 60 * 5, // 5 minutes
            gcTime: 1000 * 60 * 30, // 30 minutes (formerly cacheTime)
            retry: 2,
            refetchOnWindowFocus: false,
        },
    },
});
