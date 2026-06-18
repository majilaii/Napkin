/**
 * useActiveImports — live state of in-flight imports (b48).
 *
 * Backs the wishlist "imports in progress" band + the /import-progress hub.
 * Reads the App-Group queue on mount, on foreground, and whenever it's poked
 * (the drain pokes after each resolve), so phases update live.
 *
 * Phase per manifest:
 *   reading — captured, OCR/caption not done yet (no spots)
 *   saving  — resolved (spots) + auto mode → drain is about to / is saving
 *   review  — resolved (spots) + review mode → awaiting your confirmation
 *   failed  — poisoned after MAX_ATTEMPTS deterministic failures
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/providers/AuthProvider';
import { listActiveManifests, onImportEnqueued, type ImportManifest } from '@/lib/importQueue';

export type ImportPhase = 'reading' | 'saving' | 'review' | 'failed';

export interface ActiveImport {
    jobId: string;
    phase: ImportPhase;
    spotCount: number;
    manifest: ImportManifest;
}

function phaseOf(m: ImportManifest): ImportPhase {
    if (m.status === 'failed') return 'failed';
    const hasSpots = Array.isArray(m.spots) && m.spots.length > 0;
    if (hasSpots) return m.mode === 'review' ? 'review' : 'saving';
    return 'reading';
}

export function useActiveImports(): ActiveImport[] {
    const { session } = useAuth();
    const userId = session?.user?.id;
    const [items, setItems] = useState<ActiveImport[]>([]);

    const refresh = useCallback(() => {
        setItems(
            listActiveManifests(userId).map((m) => ({
                jobId: m.jobId,
                phase: phaseOf(m),
                spotCount: m.spots?.length ?? 0,
                manifest: m,
            })),
        );
    }, [userId]);

    useEffect(() => {
        refresh();
        const sub = AppState.addEventListener('change', (s) => {
            if (s === 'active') refresh();
        });
        const unsub = onImportEnqueued(() => refresh());
        // While anything is still resolving ('reading'/'saving'), poll briefly so
        // the phase advances even without a poke (OCR completes mid-screen).
        const tick = setInterval(refresh, 2500);
        return () => {
            sub.remove();
            unsub();
            clearInterval(tick);
        };
    }, [refresh]);

    return items;
}
