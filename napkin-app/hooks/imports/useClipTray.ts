import { useMemo } from 'react';

import { buildClipLedger, deriveClipPill } from '@/components/wishlist/clipTrayUtils';
import { useActiveImports } from '@/hooks/wishlist/useActiveImports';
import { useRecentImports } from '@/hooks/wishlist/useRecentImports';
import { useExhaustedCompletenessItems } from './useCompletenessRetries';

/**
 * Live presentation for the Places clip doorway. The needs-look query returns
 * its mounted first page (currently capped at 50); the pill reports that honest
 * count without inventing a plus suffix. Recent imports rely on existing exact
 * invalidations and deliberately do not add a polling interval.
 */
export function useClipTray(userId: string | null | undefined) {
    const active = useActiveImports();
    const { data: recent } = useRecentImports(userId);
    const { data: exhausted = [] } = useExhaustedCompletenessItems(userId, {
        pollMs: 60_000,
    });

    return useMemo(() => {
        const firstPageExhausted = exhausted.slice(0, 50);
        const { rows, hasOlder } = buildClipLedger({
            active,
            recent,
            exhausted: firstPageExhausted,
        });
        return {
            pill: deriveClipPill(active, firstPageExhausted),
            rows,
            hasOlder,
            isEmpty: rows.length === 0,
        };
    }, [active, exhausted, recent]);
}
