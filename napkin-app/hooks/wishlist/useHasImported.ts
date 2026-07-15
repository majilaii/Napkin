/**
 * useHasImported — has the user landed at least one import? (TICKET-122)
 *
 * Drives the activation hub's full→compact collapse. Two OR'd signals:
 *   1. The durable AsyncStorage flag (markImportCompleted on first completed drain),
 *      module-cached so the initial state seeds SYNCHRONOUSLY — repeat users never
 *      see the full hub flash before it collapses to compact.
 *   2. useRecentImports (server) as a back-compat fallback: users who imported
 *      before this flag shipped still read as "imported" with no migration/backfill.
 *
 * Rejected pure-server (flash + batches drop out of list_imports when all spots are
 * pruned) and wishlist-count (search-added spots aren't imports) — see the ticket.
 */
import { useEffect, useState } from 'react';

import { getImportCompletedCached, getImportCompletedFlag } from '@/lib/importActivation';
import { useRecentImports } from './useRecentImports';
import { combineHasImported } from './hasImportedSignal';

// Re-exported for callers that want the pure combine (also unit-tested directly).
export { combineHasImported };

export function useHasImported(userId: string | null | undefined): boolean {
    // Seed from the synchronous module cache so the first render already reflects a
    // prior import (no full→compact flash).
    const [flag, setFlag] = useState<boolean>(() => getImportCompletedCached());

    // Canonical shared fetch (TICKET-191): the query key is limit-agnostic, so
    // every consumer fetches RECENT_IMPORTS_FETCH_LIMIT and slices locally —
    // one cache entry, no mount-order truncation. One row is still proof enough.
    const { data: recent } = useRecentImports(userId);

    useEffect(() => {
        let cancelled = false;
        getImportCompletedFlag().then((v) => {
            if (!cancelled && v) setFlag(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    return combineHasImported(flag, recent?.length);
}
