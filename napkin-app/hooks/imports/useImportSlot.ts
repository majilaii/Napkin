/**
 * useImportSlot — the live "one import card, ever" state (TICKET-185).
 *
 * A pure move of the derivation that used to live inline in app/wishlist.tsx, so
 * the map-tab status chip and the profile Explore "Imports" row share one source
 * of truth. Behaviour is identical, including the sacred via-hub routing.
 */
import { useMemo } from 'react';

import { useActiveImports } from '@/hooks/wishlist/useActiveImports';
import { useRecentImports } from '@/hooks/wishlist/useRecentImports';
import { deriveImportSlot, type ImportSlot } from './importSlotUtils';

export type { ImportSlot };

export function useImportSlot(userId: string | null | undefined): ImportSlot | null {
    // Canonical limit-free fetch (TICKET-191) — the derivation only `.find`s
    // the latest-within-48h, so the full shared array is fine.
    const { data: recentImports } = useRecentImports(userId);
    const activeImports = useActiveImports();
    return useMemo(
        () => deriveImportSlot(activeImports, recentImports),
        [activeImports, recentImports],
    );
}
