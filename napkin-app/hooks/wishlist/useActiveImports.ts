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
import { deriveCounts } from '@/lib/largeImportJob';

// TICKET-152: 'kickoff' = an enumerated large Maps list awaiting the kickoff
// sheet (destination + pin-all). A large job in phase 'running' reports 'saving'
// (carrying cursor/listCount); phase 'done' reports 'review' (routes to the
// digest, not import-review).
export type ImportPhase = 'reading' | 'saving' | 'review' | 'failed' | 'kickoff';

/** TICKET-152: live large-job progress the /import-progress hub renders. */
export interface ActiveLargeImport {
    /** kickoff | running | done — drives the row's CTA + routing. */
    phase: 'kickoff' | 'running' | 'done';
    /** index of the next item to process — the honest numerator ("41 of 117"). */
    cursor: number;
    /** items.length — the honest denominator. */
    listCount: number;
    title: string | null;
    imported: number;
    needsLook: number;
}

export interface ActiveImport {
    jobId: string;
    phase: ImportPhase;
    spotCount: number;
    manifest: ImportManifest;
    /** Present iff this manifest is a large Maps-list job (TICKET-152). */
    large?: ActiveLargeImport;
}

function phaseOf(m: ImportManifest): ImportPhase {
    if (m.status === 'failed') return 'failed';
    // TICKET-152: a large job's phase is authoritative over the spots heuristic.
    if (m.largeJob) {
        if (m.largeJob.phase === 'kickoff') return 'kickoff';
        if (m.largeJob.phase === 'done') return 'review'; // → digest (row branches on `large`)
        return 'saving'; // running
    }
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
            listActiveManifests(userId).map((m) => {
                const lj = m.largeJob;
                let large: ActiveLargeImport | undefined;
                if (lj) {
                    const c = deriveCounts(lj.items);
                    large = {
                        phase: lj.phase,
                        cursor: lj.cursor,
                        listCount: lj.listCount,
                        title: lj.title,
                        imported: c.imported,
                        needsLook: c.needsLook,
                    };
                }
                return {
                    jobId: m.jobId,
                    phase: phaseOf(m),
                    // Large jobs count by listCount (spots[] is unused on that path).
                    spotCount: lj ? lj.listCount : (m.spots?.length ?? 0),
                    manifest: m,
                    large,
                };
            }),
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
