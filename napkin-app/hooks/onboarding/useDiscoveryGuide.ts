import { useCallback, useSyncExternalStore } from 'react';

import { getDiscoveryGuideSnapshot, subscribeDiscoveryGuide } from '@/lib/discoveryGuide';

/** Changing accounts changes the subscription and snapshot in the same render. */
export function useDiscoveryGuide(userId?: string | null) {
    const subscribe = useCallback(
        (listener: () => void) => subscribeDiscoveryGuide(userId, listener),
        [userId],
    );
    const getSnapshot = useCallback(() => getDiscoveryGuideSnapshot(userId), [userId]);
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
