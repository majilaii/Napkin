/**
 * useProcessImportQueue — drains the durable video-import queue in the background
 * (TICKET-083 Part B). Mounted once in RootLayoutNav.
 *
 * inc3: the queue lives in the App-Group container (written by the iOS share
 * EXTENSION with no app-switch). This drains it on launch + every foreground —
 * OCR → resolve → auto-save ALL spots — with a non-blocking toast. Spots land in
 * the wishlist + "recently imported" band when the user next opens the app.
 *
 * Replay-safety: spots (with their nonces) are PERSISTED on the manifest after
 * the first resolve; a re-drain reuses them and re-runs only the idempotent save.
 *
 * Error policy:
 *   - auth / expired session            → stop the round, NO poison (retry after sign-in)
 *   - 429 / 5xx (transient)             → stop the round, NO poison (retry next drain)
 *   - everything else (deterministic)   → bump attempts; poison at 3, drop the .mov
 */
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { callEdgeFn, isAuthFailure, SessionExpiredError } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { safeRandomUUID } from '@/lib/uuid';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import {
    extractFromVideo,
    isVideoImportAvailable,
    appGroupFileInfo,
    deleteAppGroupFile,
} from '@/modules/media-extract';
import {
    listPendingImports,
    removeImport,
    setImportSpots,
    bumpImportAttempt,
    acquireDrainLock,
    releaseDrainLock,
    onImportEnqueued,
    type ImportManifest,
    type PersistedImportSpot,
} from '@/lib/importQueue';
import type { ResolveUrlData, ResolvedCandidate } from './useResolveUrl';
import type { SaveImportSpotsResult } from './useSaveImportSpots';

function errStatus(err: unknown): number | undefined {
    return (err as { cause?: { status?: number } } | null)?.cause?.status;
}

/** Auth / expired session — retry after sign-in; never poison. */
function isSessionError(err: unknown): boolean {
    return (
        err instanceof SessionExpiredError ||
        (err as { code?: string } | null)?.code === 'session_expired' ||
        isAuthFailure(err)
    );
}

/** Transient server errors — retry next drain; never poison. */
function isTransientError(err: unknown): boolean {
    const s = errStatus(err);
    return s === 429 || (typeof s === 'number' && s >= 500);
}

/** Metadata-complete place payload from a resolved candidate. */
function buildPlace(c: ResolvedCandidate): unknown {
    const r = c.restaurant;
    if (!r) return null;
    return {
        external_id: r.external_id ?? null,
        name: r.name ?? null,
        location: {
            address: r.formattedAddress ?? undefined,
            locality: r.city ?? undefined,
            country: r.country ?? undefined,
        },
        latitude: r.latitude ?? null,
        longitude: r.longitude ?? null,
        photoReference: r.photoReference ?? null,
        googleRating: r.googleRating ?? null,
        googleRatingCount: r.googleRatingCount ?? null,
        priceLevel: r.priceLevel ?? null,
        cuisine: r.cuisine ?? null,
    };
}

/** Delete the App-Group .mov (native; expo-file-system can't reach that path). */
function safeDeleteMov(path: string): void {
    try {
        deleteAppGroupFile(path);
    } catch {
        /* best-effort */
    }
}

export function useProcessImportQueue() {
    const { session } = useAuth();
    const userId = session?.user?.id;
    const queryClient = useQueryClient();
    const toast = useToast();

    const processOne = useCallback(
        async (m: ImportManifest) => {
            let spots: PersistedImportSpot[] | undefined = m.spots;

            // First process: verify file → OCR → resolve → build + PERSIST spots.
            if (!spots || spots.length === 0) {
                let info = { exists: true, size: 1 };
                try {
                    info = appGroupFileInfo(m.videoPath);
                } catch {
                    /* native absent — let extractFromVideo surface the failure */
                }
                if (!info.exists || info.size === 0) {
                    removeImport(m.jobId); // file gone — fail fast, don't retry
                    toast.show("couldn't read that video");
                    return;
                }

                const { ocr, transcript } = await extractFromVideo(m.videoPath);
                const extractedText = [...(ocr ?? []), transcript ?? '']
                    .filter(Boolean)
                    .join('\n')
                    .trim();
                if (!extractedText) {
                    removeImport(m.jobId);
                    safeDeleteMov(m.videoPath);
                    toast.show("couldn't read spots from that video");
                    return;
                }

                const resolved = await callEdgeFn<ResolveUrlData>('resolve-url', {
                    body: { extracted_text: extractedText },
                });
                const candidates = resolved?.candidates ?? [];
                if (candidates.length === 0) {
                    removeImport(m.jobId);
                    safeDeleteMov(m.videoPath);
                    toast.show("couldn't find spots in that video");
                    return;
                }

                // Mint nonces ONCE; persist before the save so a re-drain reuses them.
                spots = candidates.map((c) => ({
                    candidate_id: c.candidate_id ?? safeRandomUUID(),
                    client_nonce: safeRandomUUID(),
                    restaurant_id: c.restaurant_id ?? null,
                    external_id: c.restaurant_id ? null : (c.restaurant.external_id ?? null),
                    restaurant_name: c.restaurant.name ?? null,
                    restaurant_city: c.restaurant.city ?? null,
                    table_id: null,
                    table_client_nonce: null,
                    place: buildPlace(c),
                }));
                setImportSpots(m.jobId, spots);
            }

            // Save (idempotent on import_nonce + per-spot client_nonce).
            const result = await callEdgeFn<SaveImportSpotsResult>('resolve-url', {
                action: 'save_spots',
                body: {
                    import_nonce: m.importNonce,
                    spots,
                    source: { type: 'video' },
                },
            });

            removeImport(m.jobId);
            safeDeleteMov(m.videoPath);

            const saved = result?.summary?.saved ?? 0;
            const already = result?.summary?.already_pinned ?? 0;
            toast.show(
                saved > 0
                    ? `pinned ${saved} ${saved === 1 ? 'spot' : 'spots'}`
                    : already > 0
                      ? 'already in your wishlist'
                      : "couldn't import that video",
            );

            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.wishlist.personal(userId) });
                queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.all(userId) });
            }
        },
        [userId, queryClient, toast],
    );

    const drain = useCallback(async () => {
        if (!userId) return;                      // session-gated
        if (!isVideoImportAvailable()) return;    // native module absent → skip
        if (!acquireDrainLock()) return;          // process-wide re-entrancy guard

        try {
            const pending = listPendingImports();
            for (const m of pending) {
                if (!session) break;               // session dropped → stop
                try {
                    await processOne(m);
                } catch (err) {
                    // Transient (auth/expired/429/5xx) → stop the round, retry later,
                    // DON'T burn an attempt (else a rate-limit / outage poisons a valid import).
                    if (isSessionError(err) || isTransientError(err)) break;
                    const updated = bumpImportAttempt(m.jobId);
                    if (updated?.status === 'failed') {
                        toast.show("couldn't import that video");
                        safeDeleteMov(m.videoPath); // poison → drop the file
                    }
                }
            }
        } finally {
            releaseDrainLock();
        }
    }, [userId, session, processOne, toast]);

    useEffect(() => {
        drain();
        const sub = AppState.addEventListener('change', (s) => {
            if (s === 'active') drain();
        });
        const unsub = onImportEnqueued(() => drain());
        return () => {
            sub.remove();
            unsub();
        };
    }, [drain]);
}
