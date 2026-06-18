/**
 * useProcessImportQueue — drains the durable import queue in the background
 * (TICKET-083 Part B). Mounted once in RootLayoutNav.
 *
 * The queue lives in the App-Group container (written by the iOS share EXTENSION
 * with no app-switch). This drains it on launch + every foreground + on enqueue —
 * OCR/caption resolve → auto-save ALL spots → route to the chosen destinations
 * (wishlist always; lists via add_entries; one Table via per-spot table_id) — with
 * a non-blocking toast.
 *
 *   kind 'video' → on-device OCR;  kind 'url' → caption resolve (no OCR).
 *   mode 'auto'  → save silently here.
 *   mode 'review' (video only) → SKIPPED here; the candidate picker opens on next
 *                 app-open (useReviewImportTrigger). url is always auto.
 *
 * Replay-safety: spots (with their nonces) are PERSISTED on the manifest after the
 * first resolve; a re-drain reuses them and re-runs only the idempotent save.
 *
 * Error policy: auth/expired/429/5xx → stop the round, no poison; deterministic →
 * bump attempts, poison at 3 + drop the .mov.
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
function isSessionError(err: unknown): boolean {
    return (
        err instanceof SessionExpiredError ||
        (err as { code?: string } | null)?.code === 'session_expired' ||
        isAuthFailure(err)
    );
}
function isTransientError(err: unknown): boolean {
    const s = errStatus(err);
    return s === 429 || (typeof s === 'number' && s >= 500);
}

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

function safeDeleteMov(path: string | undefined): void {
    if (!path) return;
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

            // First process: acquire candidates (OCR for video / caption for url),
            // build + PERSIST spots (frozen nonces) before the save.
            if (!spots || spots.length === 0) {
                let candidates: ResolvedCandidate[] = [];

                if (m.kind === 'url') {
                    const resolved = await callEdgeFn<ResolveUrlData>('resolve-url', {
                        body: { url: m.url },
                    });
                    candidates = resolved?.candidates ?? [];
                } else {
                    let info = { exists: true, size: 1 };
                    try {
                        info = appGroupFileInfo(m.videoPath as string);
                    } catch {
                        /* native absent — let extractFromVideo surface it */
                    }
                    if (!info.exists || info.size === 0) {
                        removeImport(m.jobId); // file gone — fail fast
                        toast.show("couldn't read that video");
                        return;
                    }
                    const { ocr, transcript } = await extractFromVideo(m.videoPath as string);
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
                    candidates = resolved?.candidates ?? [];
                }

                if (candidates.length === 0) {
                    removeImport(m.jobId);
                    safeDeleteMov(m.videoPath);
                    toast.show("couldn't find spots in that import");
                    return;
                }

                const tableId = m.destinations.tableId;
                spots = candidates.map((c) => ({
                    candidate_id: c.candidate_id ?? safeRandomUUID(),
                    client_nonce: safeRandomUUID(),
                    restaurant_id: c.restaurant_id ?? null,
                    external_id: c.restaurant_id ? null : (c.restaurant.external_id ?? null),
                    restaurant_name: c.restaurant.name ?? null,
                    restaurant_city: c.restaurant.city ?? null,
                    // Per-spot Table share — fn_save_import_spot ghost-quarantines so
                    // only VERIFIED spots actually reach the Table.
                    table_id: tableId,
                    table_client_nonce: tableId ? safeRandomUUID() : null,
                    place: buildPlace(c),
                }));
                setImportSpots(m.jobId, spots);
            }

            // Save (idempotent on import_nonce + per-spot client_nonce). Wishlist is
            // the base destination; per-spot table_id fans out to the Table.
            // Provenance: a tiktok link gets a 'tiktok' source so the restaurant
            // page shows "saved from tiktok" + taps out to that exact video; other
            // links → 'web'; a shared file → 'video' (no URL to deep-link).
            const source: Record<string, string> =
                m.kind === 'url' && m.url
                    ? /tiktok\.com/i.test(m.url)
                        ? { type: 'tiktok', url: m.url }
                        : { type: 'web', url: m.url }
                    : { type: 'video' };
            const result = await callEdgeFn<SaveImportSpotsResult>('resolve-url', {
                action: 'save_spots',
                body: {
                    import_nonce: m.importNonce,
                    spots,
                    source,
                },
            });

            // Route saved spots into the chosen lists (idempotent bulk add).
            const restaurantIds = (result?.results ?? [])
                .map((r) => r.restaurant_id)
                .filter((x): x is string => !!x);
            if (restaurantIds.length > 0) {
                for (const listId of m.destinations.listIds) {
                    try {
                        await callEdgeFn('lists', {
                            action: 'add_entries',
                            body: { list_id: listId, restaurant_ids: restaurantIds },
                        });
                    } catch {
                        /* a bad/removed list must not fail the import */
                    }
                }
            }

            removeImport(m.jobId);
            safeDeleteMov(m.videoPath);

            const saved = result?.summary?.saved ?? 0;
            const already = result?.summary?.already_pinned ?? 0;
            toast.show(
                saved > 0
                    ? `pinned ${saved} ${saved === 1 ? 'spot' : 'spots'}`
                    : already > 0
                      ? 'already in your wishlist'
                      : "couldn't import that",
            );

            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.wishlist.personal(userId) });
                queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.all(userId) });
                if (m.destinations.listIds.length > 0) {
                    queryClient.invalidateQueries({ queryKey: queryKeys.lists.mine(userId) });
                    for (const listId of m.destinations.listIds) {
                        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(listId) });
                    }
                }
            }
            if (m.destinations.tableId) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.tables.activityForTable(m.destinations.tableId),
                });
            }
        },
        [userId, queryClient, toast],
    );

    const drain = useCallback(async () => {
        if (!userId) return;
        if (!isVideoImportAvailable()) return;
        if (!acquireDrainLock()) return;

        try {
            const pending = listPendingImports().filter(
                (m) =>
                    // review-mode VIDEOS are handled by the picker on app-open, not here.
                    !(m.mode === 'review' && m.kind === 'video') &&
                    // skip a manifest created under a DIFFERENT account (cross-account
                    // safety — its destinations belong to the other user).
                    !(m.userId && m.userId !== userId),
            );
            for (const m of pending) {
                if (!session) break;
                try {
                    await processOne(m);
                } catch (err) {
                    if (isSessionError(err) || isTransientError(err)) break;
                    const updated = bumpImportAttempt(m.jobId);
                    if (updated?.status === 'failed') {
                        toast.show("couldn't import that");
                        safeDeleteMov(m.videoPath);
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
