/**
 * useProcessImportQueue — drains the durable import queue in the background
 * (TICKET-083 Part B). Mounted once in RootLayoutNav.
 *
 * The queue lives in the App-Group container (written by the iOS share EXTENSION
 * with no app-switch). This drains it on launch + every foreground + on enqueue —
 * OCR/caption resolve → hold review-mode jobs for confirmation → save released
 * jobs to the in-app destinations, with a non-blocking toast.
 *
 *   kind 'video' → on-device OCR;  kind 'url' → cheap caption+ASR fast path,
 *                 escalating into download+OCR when the gate rejects (TICKET-164).
 *   mode 'auto'  → save here after confirmation (plus legacy jobs). A gate reject that
 *                 escalation adds no evidence to flips to 'review' instead (R3).
 *   mode 'review' → resolved + persisted, then HELD; surfaced via the imports
 *                 hub (import-progress → import-review) on next app-open.
 *
 * Replay-safety: spots (with their nonces) are PERSISTED on the manifest after the
 * first resolve; a re-drain reuses them and re-runs only the idempotent save.
 *
 * Error policy: auth/expired/429/5xx → stop the round, no poison; deterministic →
 * bump attempts, poison at 3 + drop the .mov.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { callEdgeFn, isAuthFailure, SessionExpiredError } from '@/lib/edgeInvoke';
import { clientBuildMetadata } from '@/lib/clientBuild';
import { queryKeys } from '@/lib/queryKeys';
import { safeRandomUUID } from '@/lib/uuid';
import { track } from '@/lib/track';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import {
    extractFromVideo,
    extractFromImages,
    isVideoImportAvailable,
    appGroupFileInfo,
    deleteAppGroupFile,
    beginBackgroundTask,
    endBackgroundTask,
} from '@/modules/media-extract';
import { presentImportNotification, maybeOfferNotifPrompt } from '@/lib/localNotify';
import { markImportCompleted } from '@/lib/importActivation';
import {
    listPendingImports,
    removeImport,
    setImportSpots,
    setImportListCount,
    setImportDiagnostics,
    setImportSource,
    setImportStage,
    setImportMode,
    setLargeJob,
    effectivePinWishlist,
    bumpImportAttempt,
    acquireDrainLock,
    releaseDrainLock,
    ensureImportV2Routing,
    importManifestProtocol,
    claimImportOwner,
    onImportEnqueued,
    pokeImportQueue,
    type ImportManifest,
    type PersistedImportSpot,
    type LargeImportJob,
} from '@/lib/importQueue';
import {
    buildCompletenessDestinationIntent,
    importDestinationTargets,
    type ImportDestinationTarget,
} from '@/lib/importProtocol';
import { evaluateFastPath, isContentGate } from '@/lib/importFastPath';
import {
    allowsGenericUrlFallback,
    capPhotoImportCandidates,
    fusePhotoSlideText,
    photoImportContextFromDiagnostics,
    type PhotoImportContext,
} from '@/lib/photoImportFusion';
import {
    VIDEO_DOWNLOAD_TIMEOUT_MS,
    OCR_WALLCLOCK_BUDGET_MS,
    STT_TIMEOUT_MS,
    STT_MAX_DURATION_SEC,
} from '@/lib/importBudgets';
import {
    buildLargeJob,
    isLargeListEnumeration,
    chunkBounds,
    isDrained,
    deriveCounts,
    applyChunkOutcomes,
    applyListRouting,
    pendingListRoutes,
    markListRouted,
    markUnroutedNeedsLook,
    buildResolvedSpots,
    buildGhostSpots,
    toChunkOutcomes,
    awaitCompletenessLedger,
    classifyDrainError,
    LARGE_JOB_MAX_CHUNK_ATTEMPTS,
    type ChunkItemOutcome,
    type LargeListEnumeration,
    type ResolveSpotResult,
    type ResolveSpotsData,
    type LargeSaveResult,
    type LargeImportSpotInput,
} from '@/lib/largeImportJob';
import { truncationNote } from '@/lib/importTruncation';
import {
    requireActiveImportOwner,
    runWithActiveImportOwner,
} from '@/lib/importOwnerGuard';
import {
    fetchTikTokPerception,
    isTikTokUrl,
    downloadTikTokVideo,
    deleteCachedTikTokVideo,
    downloadSlideImage,
    deleteCachedSlide,
    type TikTokPerception,
} from '@/lib/tiktokPerception';
import {
    fetchInstagramPerception,
    isInstagramUrl,
    type InstagramPerception,
} from '@/lib/instagramPerception';
import { captureClipThumbFromUrl, type ClipThumbSourceType } from '@/lib/clipThumbCapture';
import { isMapsShareUrl } from '@/lib/mapsShare';
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

// TICKET-187: no photo fields — the server ignores client photo fields and
// mirrors the hero server-side (post-response) by the DB-derived external_id.
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
        googleRating: r.googleRating ?? null,
        googleRatingCount: r.googleRatingCount ?? null,
        priceLevel: r.priceLevel ?? null,
        cuisine: r.cuisine ?? null,
    };
}

function v2Targets(manifest: ImportManifest): ImportDestinationTarget[] {
    if (!manifest.destinationNonces) return [];
    const selection = manifest.largeJob
        ? {
              wishlist: manifest.largeJob.pinAll,
              tableIds: [],
              listIds: [],
              newListTitles: manifest.largeJob.destListTitle
                  ? [manifest.largeJob.destListTitle]
                  : [],
          }
        : {
              wishlist:
                  manifest.destinations.tableIds.length > 0 || effectivePinWishlist(manifest),
              tableIds: manifest.destinations.tableIds,
              listIds: manifest.destinations.listIds,
              newListTitles: manifest.destinations.newListTitles,
          };
    return importDestinationTargets(selection, manifest.destinationNonces);
}

function v2SaveFields(
    manifest: ImportManifest,
    itemNonces: string[],
    targets: ImportDestinationTarget[],
    notifyDone: boolean,
): Record<string, unknown> {
    if (importManifestProtocol(manifest) !== 'v2') return {};
    if (manifest.expectedDestinations == null || targets.length === 0) {
        throw new Error('Incomplete v2 import routing declaration');
    }
    return {
        protocol_generation: 'v2',
        protocol_version: 2,
        expected_destinations: manifest.expectedDestinations,
        destination_intent: buildCompletenessDestinationIntent(itemNonces, targets, notifyDone),
    };
}

function assertV2ResolutionIds(spots: Array<{ resolution_id?: string | null }>): void {
    if (
        spots.some(
            (spot) => typeof spot.resolution_id !== 'string' || spot.resolution_id.length === 0,
        )
    ) {
        throw new Error('A v2 import item is missing server provenance');
    }
}

/**
 * Resolve "create new list" titles to list ids — title-deduped against the user's
 * existing lists so a re-drain reuses the list it already created (replay-safe;
 * lists.create is NOT idempotent on its own).
 */
type OwnerBoundRunner = <T>(operation: () => Promise<T>) => Promise<T>;

async function resolveNewLists(
    titles: string[],
    runOwnerBound: OwnerBoundRunner,
): Promise<string[]> {
    if (!titles || titles.length === 0) return [];
    let mine: { id: string; title: string }[] = [];
    try {
        mine = (await runOwnerBound(() =>
            callEdgeFn<{ id: string; title: string }[]>('lists', { action: 'list_mine' })
        )) ?? [];
    } catch (error) {
        if (isSessionError(error)) throw error;
        mine = [];
    }
    const out: string[] = [];
    for (const raw of titles) {
        const title = raw.trim();
        if (!title) continue;
        const existing = mine.find((l) => (l.title ?? '').trim().toLowerCase() === title.toLowerCase());
        if (existing) {
            out.push(existing.id);
            continue;
        }
        try {
            const created = await runOwnerBound(() =>
                callEdgeFn<{ id: string }>('lists', {
                    action: 'create',
                    body: { title },
                })
            );
            if (created?.id) {
                out.push(created.id);
                mine.push({ id: created.id, title });
            }
        } catch (error) {
            if (isSessionError(error)) throw error;
            /* skip a failed create */
        }
    }
    return out;
}

function safeDeleteMov(path: string | undefined): void {
    if (!path) return;
    try {
        deleteAppGroupFile(path);
    } catch {
        /* best-effort */
    }
}

// TICKET-164 [R10]: set when a drain is requested while another drain holds the
// lock (an enqueue/poke that lands mid-drain). The in-flight drain rescans on
// release — otherwise that wakeup is LOST (nothing re-triggers until the next
// foreground/enqueue) and a just-enqueued import sits idle. Module-level so it
// survives the double-mount / StrictMode, exactly like the drain lock itself.
let drainRescanRequested = false;

export function useProcessImportQueue() {
    const { session } = useAuth();
    const userId = session?.user?.id;
    const queryClient = useQueryClient();
    const toast = useToast();
    const activeUserIdRef = useRef<string | null>(userId ?? null);
    activeUserIdRef.current = userId ?? null;

    const runOwnerBound = useCallback(
        <T,>(manifest: ImportManifest, operation: (ownerId: string) => Promise<T>) =>
            runWithActiveImportOwner(
                manifest.userId,
                () => activeUserIdRef.current,
                operation,
            ),
        [],
    );

    const callImportResolveUrl = useCallback(
        <T,>(
            manifest: ImportManifest,
            action: string | undefined,
            body: Record<string, unknown>,
        ): Promise<T> =>
            runOwnerBound(manifest, (expectedOwnerId) =>
                callEdgeFn<T>('resolve-url', {
                    action,
                    body: { ...body, expected_owner_id: expectedOwnerId },
                })
            ),
        [runOwnerBound],
    );

    // ── TICKET-152: large Maps-list drain ─────────────────────────────────────
    // A large job is client-pumped in chunks of 20 through resolve_spots →
    // save_spots, advancing a persisted cursor ONLY after the post-save manifest
    // write (frozen nonces cover the crash window). One chunk per invocation, then
    // a deferred poke schedules the next — progress re-renders per chunk, the drain
    // lock releases between chunks, and search stays responsive (separate bucket).
    const processLargeJob = useCallback(
        async (queuedManifest: ImportManifest) => {
            requireActiveImportOwner(queuedManifest.userId, activeUserIdRef.current);
            const m =
                importManifestProtocol(queuedManifest) === 'v2'
                    ? ensureImportV2Routing(queuedManifest.jobId)
                    : queuedManifest;
            if (!m) return;
            const job = m.largeJob;
            if (!job) return;
            // Kickoff is HELD for the sheet; done is owned by the digest — no drain.
            if (job.phase !== 'running') return;

            const source = { type: 'google_maps', url: m.url ?? '' };
            const isV2 = importManifestProtocol(m) === 'v2';
            const routingTargets = isV2 ? v2Targets(m) : [];

            const saveChunkSpots = (jb: LargeImportJob, spots: LargeImportSpotInput[]) => {
                // Merely including `resolution_id` classifies a request as v2. A
                // pre-upgrade manifest must therefore omit it even when a newer
                // resolver happened to echo provenance during a resumed drain.
                if (isV2) assertV2ResolutionIds(spots);
                const wireSpots = isV2
                    ? spots
                    : spots.map(({ resolution_id: _resolutionId, ...spot }) => spot);
                return callImportResolveUrl<LargeSaveResult>(
                    m,
                    'save_spots',
                    {
                        import_nonce: m.importNonce,
                        spots: wireSpots,
                        source,
                        ...clientBuildMetadata(),
                        // pin_wishlist honors the kickoff toggle: false = list-only
                        // (the destination list, NOT the personal wishlist).
                        pin_wishlist: jb.pinAll,
                        // notify_done false on EVERY chunk — ONE completion bell is
                        // emitted client-side at the end with the grand total.
                        notify_done: false,
                        ...v2SaveFields(
                            m,
                            spots.map((spot) => spot.client_nonce),
                            routingTargets,
                            false,
                        ),
                    },
                );
            };

            // Deterministic (non-transient) failure at the current cursor: bump
            // chunkAttempts; poison at MAX so /import-progress shows try-again.
            const bumpChunkAttempts = (jb: LargeImportJob) => {
                const attempts = jb.chunkAttempts + 1;
                setLargeJob(
                    m.jobId,
                    { ...jb, chunkAttempts: attempts },
                    attempts >= LARGE_JOB_MAX_CHUNK_ATTEMPTS ? { status: 'failed' } : undefined,
                );
            };

            // Destination list: created ONCE, on the first chunk with ≥1 routable
            // spot (avoids an empty list if the user backgrounds before any save).
            // Title-deduped against the user's lists so a crash between create and
            // persist finds the existing list rather than duplicating (mirrors
            // resolveNewLists).
            const ensureDestList = async (title: string): Promise<string | null> => {
                const t = title.trim().slice(0, 60); // lists.create caps title at 60
                if (!t) return null;
                try {
                    const mine =
                        (await runOwnerBound(m, () =>
                            callEdgeFn<{ id: string; title: string }[]>('lists', {
                                action: 'list_mine',
                            })
                        )) ?? [];
                    const existing = mine.find(
                        (l) => (l.title ?? '').trim().toLowerCase() === t.toLowerCase(),
                    );
                    if (existing) return existing.id;
                } catch (error) {
                    if (isSessionError(error)) throw error;
                    /* fall through to create */
                }
                try {
                    const created = await runOwnerBound(m, () =>
                        callEdgeFn<{ id: string }>('lists', {
                            action: 'create',
                            body: { title: t },
                        })
                    );
                    return created?.id ?? null;
                } catch (error) {
                    if (isSessionError(error)) throw error;
                    return null;
                }
            };

            // Fold a chunk's outcomes into the job, route to the list, advance the
            // cursor, and PERSIST — all in one manifest write. INVARIANT: the cursor
            // advances only here, after the save landed (frozen-nonce dedup covers a
            // crash between save and this write → a resume re-saves as already_pinned).
            const commitChunk = async (
                jb: LargeImportJob,
                outcomes: ChunkItemOutcome[],
                saveResult: LargeSaveResult | null,
                newCursor: number,
            ): Promise<LargeImportJob> => {
                const serverJobId = jb.serverJobId ?? saveResult?.job_id ?? null;
                const chunkRestaurantIds = outcomes
                    .map((o) => o.restaurant_id)
                    .filter((x): x is string => !!x);

                let destListId = jb.destListId;
                if (!isV2 && !destListId && jb.destListTitle && chunkRestaurantIds.length > 0) {
                    destListId = await ensureDestList(jb.destListTitle);
                }
                // Route to the destination list. A failure here is tolerated (never
                // fails the import) but RECORDED per item via the listRouted flag —
                // the completion reconcile retries, then flags survivors needsLook
                // (P1: list membership must never silently drop).
                let routed = false;
                if (!isV2 && destListId && chunkRestaurantIds.length > 0) {
                    try {
                        // ≤20 ids per chunk « the 200-cap, so no sub-chunking needed.
                        await runOwnerBound(m, () =>
                            callEdgeFn('lists', {
                                action: 'add_entries',
                                body: { list_id: destListId, restaurant_ids: chunkRestaurantIds },
                            })
                        );
                        routed = true;
                    } catch (error) {
                        if (isSessionError(error)) throw error;
                        /* tolerated — the completion reconcile retries (P1) */
                    }
                }
                // Only a job WITH a destination list tracks routing state.
                const routedOutcomes = !isV2 && jb.destListTitle
                    ? applyListRouting(outcomes, routed)
                    : outcomes;
                const newItems = applyChunkOutcomes(jb.items, routedOutcomes);

                const newJob: LargeImportJob = {
                    ...jb,
                    items: newItems,
                    cursor: newCursor,
                    chunkAttempts: 0, // a successful chunk resets the poison counter
                    serverJobId,
                    destListId,
                    resolvedChunk: null, // the checkpoint is spent once the cursor advances (P2)
                };
                setLargeJob(m.jobId, newJob);
                return newJob;
            };

            const finalizeLargeJob = async (jb: LargeImportJob) => {
                if (jb.completionEmitted) {
                    if (jb.phase !== 'done') setLargeJob(m.jobId, { ...jb, phase: 'done' });
                    return;
                }

                // ── P1 reconcile: the destination list must never silently drop. ──
                // Chunk-time add_entries is best-effort; before completing, RETRY
                // membership for every item that never routed (add_entries is
                // idempotent → replay-safe). This runs BEFORE the completionEmitted
                // write — the guard stays LAST — so a crash mid-reconcile resumes
                // right back here. Items STILL unrouted after the retry are marked
                // needsLook: they surface in the digest (find match re-files them;
                // remove drops them) and the header/toast counts include them,
                // instead of existing in no user-visible surface at all.
                let jobNow = jb;
                if (!isV2 && jobNow.destListTitle) {
                    const unrouted = pendingListRoutes(jobNow.items);
                    if (unrouted.length > 0) {
                        let destListId = jobNow.destListId;
                        if (!destListId) destListId = await ensureDestList(jobNow.destListTitle);
                        const routedIds = new Set<string>();
                        if (destListId) {
                            const ids = [
                                ...new Set(
                                    unrouted
                                        .map((i) => i.restaurant_id)
                                        .filter((x): x is string => !!x),
                                ),
                            ];
                            // lists.add_entries caps at 200 ids/call — chunk the retry
                            // (a 500-item job can retry up to 500 ids here).
                            for (let i = 0; i < ids.length; i += 200) {
                                const batch = ids.slice(i, i + 200);
                                try {
                                    await runOwnerBound(m, () =>
                                        callEdgeFn('lists', {
                                            action: 'add_entries',
                                            body: { list_id: destListId, restaurant_ids: batch },
                                        })
                                    );
                                    for (const id of batch) routedIds.add(id);
                                } catch (error) {
                                    if (isSessionError(error)) throw error;
                                    /* still unrouted → needsLook below */
                                }
                            }
                        }
                        const items = markUnroutedNeedsLook(
                            markListRouted(jobNow.items, routedIds),
                        );
                        jobNow = { ...jobNow, items, destListId: destListId ?? jobNow.destListId };
                        setLargeJob(m.jobId, jobNow);
                    }
                }

                // L1: persist completionEmitted + phase:done FIRST so a crash before
                // the bell can never DOUBLE-fire it (import_done has no dedup key).
                const doneJob: LargeImportJob = { ...jobNow, completionEmitted: true, phase: 'done' };
                setLargeJob(m.jobId, doneJob);

                const counts = deriveCounts(doneJob.items);
                // ONE completion bell. outcome:'review' — emit_self HARD-REJECTS
                // 'saved' (the client may not forge a pinned row) and 'review' is
                // whitelisted + semantically right (the job ends in a digest).
                if (!isV2) {
                    void runOwnerBound(m, () =>
                        callEdgeFn('notifications', {
                            action: 'emit_self',
                            body: {
                                kind: 'import_done',
                                subject_meta: {
                                    job_id: doneJob.serverJobId,
                                    count: counts.imported,
                                    outcome: 'review',
                                },
                            },
                        })
                    ).catch(() => {});
                }

                track('import_completed', {
                    spot_count: counts.imported,
                    source_type: 'google_maps',
                });
                if (counts.imported > 0) markImportCompleted();

                // TICKET-120: backgrounded → local notification (foreground = toast).
                if (!isV2 && AppState.currentState !== 'active') {
                    presentImportNotification({
                        title: `imported ${counts.imported} of ${doneJob.listCount}`,
                        body: counts.needsLook > 0 ? 'tap to see what needs a look' : 'tap to review',
                    });
                }
                // Self-contained large-job toast (NOT the ≤20 truncationNote path).
                const reviewAction = {
                    label: 'review',
                    onPress: () => router.push(`/import-digest?jobId=${m.jobId}` as any),
                };
                toast.show(
                    isV2 && counts.queued > 0
                        ? `${counts.queued} ${counts.queued === 1 ? 'spot is' : 'spots are'} completing…`
                        : counts.needsLook > 0
                        ? `imported ${counts.imported} of ${doneJob.listCount} · ${counts.needsLook} need a look`
                        : `imported ${counts.imported} of ${doneJob.listCount}`,
                    reviewAction,
                );

                if (userId) {
                    queryClient.invalidateQueries({ queryKey: queryKeys.wishlist.personal(userId) });
                    queryClient.invalidateQueries({ queryKey: queryKeys.lists.mine(userId) });
                    queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.all(userId) });
                }
                if (doneJob.destListId) {
                    queryClient.invalidateQueries({
                        queryKey: queryKeys.lists.detail(doneJob.destListId),
                    });
                }
                // Refresh the /import-progress row to its done (→ digest) state. The
                // manifest is NOT removed here — it survives so the digest stays
                // re-openable; removeImport fires when the user dismisses the digest.
                pokeImportQueue();
            };

            // ── Already drained → finalize (idempotent via completionEmitted). ──
            if (isDrained(job)) {
                await finalizeLargeJob(job);
                return;
            }

            // ── Process ONE chunk ──────────────────────────────────────────────
            const { end } = chunkBounds(job.cursor, job.items.length, job.chunkSize);
            const chunk = job.items.slice(job.cursor, end);

            // Resolve — skipped entirely once the job is budget-degraded, and
            // reused from the persisted checkpoint when a crash landed between
            // resolve and the cursor write (P2: never pay Places twice per chunk).
            let jobNow = job;
            let results: ResolveSpotResult[] = [];
            let forceGhost = jobNow.ghostDegraded;
            if (!forceGhost) {
                const ckpt = jobNow.resolvedChunk;
                if (ckpt && ckpt.cursor === jobNow.cursor) {
                    results = ckpt.results;
                    forceGhost = ckpt.ghostMode;
                } else {
                    try {
                        const resolveData = await callImportResolveUrl<ResolveSpotsData>(
                            m,
                            'resolve_spots',
                            {
                                import_nonce: m.importNonce,
                                protocol_generation: m.protocolGeneration,
                                items: chunk.map((c) => ({
                                    name: c.name,
                                    address: c.address,
                                    client_nonce: c.client_nonce,
                                })),
                            },
                        );
                        // ghost_mode = kill-switch (RESOLVE_SPOTS_GHOST_ONLY) →
                        // ghost-save this chunk; the switch is re-read per chunk.
                        forceGhost = resolveData?.ghost_mode === true;
                        // New resolvers still return per-item provenance for a
                        // kill-switched/no-result decision. Keep it even when the
                        // payload is ghost-shaped so v2 never loses its binding.
                        results = resolveData?.results ?? [];
                        if (
                            isV2 &&
                            forceGhost &&
                            chunk.some((item) => {
                                const result = results.find(
                                    (candidate) => candidate.client_nonce === item.client_nonce,
                                );
                                return (
                                    typeof result?.resolution_id !== 'string' ||
                                    result.resolution_id.length === 0
                                );
                            })
                        ) {
                            // Older kill-switched servers returned an empty result
                            // array. V2 must not fabricate a provenance-free ghost,
                            // and this response spent no Places budget, so do not
                            // checkpoint it: the next foreground/enqueue wakeup will
                            // resolve this same cursor again after the switch changes.
                            return;
                        }
                        const observedTypeRejected = resolveData?.type_rejected;
                        if (
                            typeof observedTypeRejected === 'number' &&
                            Number.isFinite(observedTypeRejected)
                        ) {
                            const priorTypeRejected =
                                typeof m.diag?.type_rejected === 'number' &&
                                Number.isFinite(m.diag.type_rejected)
                                    ? Math.max(0, Math.floor(m.diag.type_rejected))
                                    : 0;
                            // Max is resume-safe: if a crash lands before the paid
                            // resolution checkpoint, retrying this chunk cannot
                            // double-count the same Places drops.
                            setImportDiagnostics(m.jobId, {
                                type_rejected: Math.max(
                                    priorTypeRejected,
                                    Math.max(0, Math.floor(observedTypeRejected)),
                                ),
                            });
                        }
                        // P2 checkpoint: persist the paid-for resolution BEFORE the
                        // save, so a crash anywhere in the save/route window resumes
                        // straight to save — no double Places spend. commitChunk
                        // clears it when the cursor advances.
                        jobNow = {
                            ...jobNow,
                            resolvedChunk: { cursor: jobNow.cursor, results, ghostMode: forceGhost },
                        };
                        setLargeJob(m.jobId, jobNow);
                    } catch (err) {
                        requireActiveImportOwner(m.userId, activeUserIdRef.current);
                        if (isSessionError(err)) throw err;
                        const cls = classifyDrainError(errStatus(err), isSessionError(err));
                        // M3: 503 (inner Places throttle) / 5xx / network / session →
                        // transient — pause + resume, NEVER a ghost-degrade.
                        if (cls === 'transient') return;
                        if (cls === 'deterministic') {
                            // A real 4xx (malformed) → attempts/poison. Per-spot save
                            // failures never reach here (they mark items, drain continues).
                            bumpChunkAttempts(jobNow);
                            return;
                        }
                        if (isV2) {
                            // A v2 item may never be fabricated without a
                            // server-minted resolution. Leave it on the local retry
                            // surface instead of silently downgrading its protocol.
                            bumpChunkAttempts(jobNow);
                            return;
                        }
                        // 429 = import_spots budget ONLY — terminal for the session.
                        // PERSIST the degrade decision (resume-safe, and no wasted
                        // 429 round-trip per later chunk), then pump the REST as
                        // ghost chunks ONE per pass exactly like the happy path —
                        // progress stays live, the drain lock is never held across
                        // the whole remainder, and the job still COMPLETES (never-fail).
                        jobNow = { ...jobNow, ghostDegraded: true };
                        setLargeJob(m.jobId, jobNow);
                        forceGhost = true;
                    }
                }
            }

            // Save (idempotent on frozen nonces). A fully type-rejected chunk has
            // no inputs by design: advance it as failed/needs-look without calling
            // save_spots with an invalid empty array (and never ghost-stage it).
            let saveResult: LargeSaveResult;
            const resolutionByNonce = new Map(
                results.map((result) => [result.client_nonce, result.resolution_id ?? null]),
            );
            const saveInputs = forceGhost
                ? buildGhostSpots(chunk).map((spot) => ({
                      ...spot,
                      resolution_id:
                          resolutionByNonce.get(spot.client_nonce) ?? spot.resolution_id ?? null,
                  }))
                : buildResolvedSpots(results, chunk, isV2);
            if (saveInputs.length === 0) {
                saveResult = { results: [] };
            } else {
                try {
                    saveResult = await saveChunkSpots(jobNow, saveInputs);
                } catch (err) {
                    requireActiveImportOwner(m.userId, activeUserIdRef.current);
                    if (isSessionError(err)) throw err;
                    // save_spots has no rate bucket — a 429 HERE is not a budget signal,
                    // so everything non-deterministic (429/503/5xx/network/session) is a
                    // plain resumable transient. The resolve checkpoint above means the
                    // retry re-saves WITHOUT re-resolving (P2). Deterministic → poison.
                    if (classifyDrainError(errStatus(err), isSessionError(err)) !== 'deterministic') {
                        return;
                    }
                    bumpChunkAttempts(jobNow);
                    return;
                }
            }

            const rawOutcomes = toChunkOutcomes(chunk, results, saveResult, forceGhost);
            const outcomes = isV2 ? awaitCompletenessLedger(rawOutcomes) : rawOutcomes;
            const newJob = await commitChunk(jobNow, outcomes, saveResult, end);
            if (isDrained(newJob)) {
                await finalizeLargeJob(newJob);
                return;
            }
            // Continue with the next chunk on a fresh drain (deferred so THIS drain's
            // lock releases first — a synchronous poke would no-op behind the lock).
            setTimeout(() => pokeImportQueue(), 0);
        },
        [userId, queryClient, toast, callImportResolveUrl, runOwnerBound],
    );

    const processOne = useCallback(
        async (m: ImportManifest) => {
            requireActiveImportOwner(m.userId, activeUserIdRef.current);
            // TICKET-152: a large Maps-list job takes its own client-pumped chunk
            // drain — never the single-shot resolve/save below.
            if (m.largeJob) {
                await processLargeJob(m);
                return;
            }
            let spots: PersistedImportSpot[] | undefined = m.spots;
            let freshlyResolved = false;
            // TICKET-151: the resolver's true Maps-list size (candidates are capped
            // at MAPS_LIST_CAP). Seed from the manifest so a re-drain — which skips
            // resolve entirely — inherits the persisted value; a fresh resolve
            // overwrites it below. The toast reads THIS local, never m.listCount:
            // setImportListCount writes the file without mutating this in-memory m.
            let listCount: number | null = m.listCount ?? null;

            // TICKET-156 [ARCH-REVIEW W1/W2]: hoisted to processOne scope because
            // `perception` (and `provider`) are block-scoped to the fresh-resolve
            // branch below, but the IG handle is read at the source build and the
            // clip cover is captured only AFTER save_spots succeeds. Assigned in
            // the fresh-resolve branch; both stay null on a re-drain (spots already
            // persisted → no fresh perception → no capture; the thumb was cached on
            // the first pass). A re-drain losing the handle is accepted (no manifest
            // persistence needed).
            let igAuthorHandle: string | null = null;
            // TICKET-180: the tiktok @handle from the RESOLVED page URL (perception
            // captures it alongside isPhotoPost). Hoisted like igAuthorHandle — read
            // at the setImportSource checkpoint below, which is outside the provider
            // block where `provider`/`perception` are scoped. Stays null on a re-drain
            // (source already persisted on the first pass).
            let tkHandle: string | null = null;
            let clipThumbUrl: string | null = null;
            let clipProvider: ClipThumbSourceType | null = null;
            // TICKET-164 [review-1 FAIL-1]: hoisted like the TICKET-156 locals above
            // — the toast/track site reads THIS on a fresh pass (setImportDiagnostics
            // writes the manifest file, never the in-memory `m`, so `m.diag` is stale
            // until a re-drain re-parses it). Stays false on a re-drain; the persisted
            // diag covers that side.
            let fastPath = false;
            // A review hold re-enters with spots already checkpointed, so recover the
            // photo-only request context from the equally durable diagnostics. Fresh
            // photo resolution replaces this below with the exact carousel count.
            let photoImportContext: PhotoImportContext | null =
                photoImportContextFromDiagnostics(m.diag);
            let photoSlideCount = photoImportContext?.slide_count ?? 0;
            let typeRejected =
                typeof m.diag?.type_rejected === 'number' &&
                Number.isFinite(m.diag.type_rejected)
                    ? Math.max(0, Math.floor(m.diag.type_rejected))
                    : 0;
            let channelDiagnostics: Record<string, unknown> | null = null;
            const mergeTypeRejected = (data: Pick<ResolveUrlData, 'type_rejected'> | null) => {
                const count = data?.type_rejected;
                if (typeof count !== 'number' || !Number.isFinite(count)) return;
                // A fallback may retry the same candidate set. Max attributes the
                // deepest observed drop count without double-counting retries.
                typeRejected = Math.max(typeRejected, Math.max(0, Math.floor(count)));
                setImportDiagnostics(m.jobId, { type_rejected: typeRejected });
            };

            // First process: acquire candidates (OCR for video / caption for url),
            // build + PERSIST spots (frozen nonces) before the save.
            if (!spots || spots.length === 0) {
                freshlyResolved = true;
                let candidates: ResolvedCandidate[] = [];
                let resolvedSourceType: string | null = null;
                // TICKET-164 fast-path bookkeeping — read by the diag write, the R3
                // no-new-evidence guard, and (for the R5 rate cap) the shared resolve.
                let fastPathGate = 'no_cheap_tier';
                let cheapTierRan = false;
                let escalationAddedEvidence = false;
                // TICKET-175: read by the R5 fallback refinement OUTSIDE the
                // provider block — a no-video escalation may still fall back.
                let downloadOk = false;

                if (m.kind === 'url') {
                    // TICKET-086/086b/086c extraction for TikTok links — FUSE
                    // every channel. Creators PRINT exact names on-screen (OCR)
                    // and SPEAK context (ASR transcript); each channel alone
                    // misses spots, the union covers them (TOPJAW E2E 2026-07-02
                    // + 07-03). Ladder: page text (caption + TikTok's own ASR,
                    // fetched on-device) + playAddr download → media-extract OCR
                    // → fused extracted_text → server caption resolve as fallback.
                    // Instagram Reels ride the SAME ladder (caption + embed-page
                    // video_url; no platform ASR, so speech is transcribed
                    // on-device) — the server's Instagram branch is login-walled
                    // by design and returns zero candidates, so without this an
                    // IG share died instantly.
                    let extractedText: string | null = null;
                    const provider = isTikTokUrl(m.url)
                        ? 'tiktok'
                        : isInstagramUrl(m.url)
                          ? 'instagram'
                          : null;
                    if (provider) {
                        // TICKET-180 stage 1/6: on-device page fetch (caption + ASR).
                        setImportStage(m.jobId, 'fetching page');
                        // deadlineAt (epoch ms) caps the perception fetches' internal
                        // timeouts — only the escalation RETRY passes one (R8).
                        const fetchPerception = (deadlineAt?: number) =>
                            runOwnerBound<TikTokPerception | InstagramPerception | null>(m, async () =>
                                provider === 'tiktok'
                                    ? await fetchTikTokPerception(m.url as string, deadlineAt)
                                    : await fetchInstagramPerception(m.url as string, deadlineAt)
                            );
                        let perception = await fetchPerception();
                        // Caption ALWAYS fuses: even a name-free caption carries
                        // the city signal (hashtags/handle) that Places needs.
                        // (086c — it was dropped whenever the ASR was missing.)
                        const pageText = perception?.text || null;
                        // [review-2 Codex-1] the escalation retry may REFRESH
                        // perception (e.g. the initial VTT fetch failed, the retry
                        // recovered TikTok's ASR) — the fuse, the R3 evidence test,
                        // and the diag all read the LATEST text via this. Channels
                        // merge (never shrink); only a GAINED channel is evidence.
                        let latestPageText = pageText;
                        let pageTextGained = false;

                        // TICKET-175: photo-mode posts have no video and no ASR —
                        // the spots live in the IMAGES. Neither the cheap tier nor
                        // the video ladder can help; the server's url tier (oEmbed
                        // + thumbnail vision) is how photo lists have always
                        // resolved. Detected from the RESOLVED page URL, never the
                        // blob shape.
                        const isPhotoPost =
                            (perception as { isPhotoPost?: boolean })?.isPhotoPost === true;

                        // ── TICKET-164 FAST PATH: caption + platform-ASR text ONLY ──
                        // Resolve the cheap tier (NO video download) and auto-save iff
                        // every conservative gate passes. desc + transcript ride
                        // SEPARATELY (caption + extracted_text) so the server fuses
                        // [desc, transcript] exactly once, never double (R6). Bias:
                        // uncertain ⇒ escalate to today's download → OCR → STT ladder.
                        const desc = (perception as { desc?: string })?.desc ?? '';
                        const transcript = (perception as { transcript?: string })?.transcript ?? '';
                        if (!isPhotoPost && (desc || transcript)) {
                            cheapTierRan = true;
                            // TICKET-180 stage 5/6: resolving candidates against text.
                            setImportStage(m.jobId, 'matching spots');
                            // [review-1 Codex-4] The cheap tier is an OPTIMIZATION and
                            // must never fail an import the ladder would have handled.
                            // Session/transient rethrow (same drain semantics as every
                            // resolve: break the round, resume later); anything
                            // deterministic fails OPEN into the ladder. cheapTierRan
                            // stays true — the server may have billed the slot (R5).
                            let cheap: ResolveUrlData | null = null;
                            try {
                                cheap = await callImportResolveUrl<ResolveUrlData>(
                                    m,
                                    undefined,
                                    transcript
                                        ? { caption: desc || undefined, extracted_text: transcript }
                                        : { extracted_text: desc },
                                );
                            } catch (err) {
                                if (isSessionError(err) || isTransientError(err)) throw err;
                                fastPathGate = 'cheap_error'; // structural — never review-holds
                            }
                            if (cheap) {
                                mergeTypeRejected(cheap);
                                const cheapCandidates = cheap.candidates ?? [];
                                fastPathGate = evaluateFastPath({
                                    provider,
                                    candidates: cheapCandidates,
                                    listCountRaw: cheap.list_count_raw,
                                    transcriptChars: transcript.length,
                                });
                                if (fastPathGate === 'pass') {
                                    fastPath = true;
                                    candidates = cheapCandidates;
                                    resolvedSourceType = cheap.source_type ?? 'video';
                                    listCount = null; // a video source is never a denominator
                                }
                            }
                        }

                        let ocrLines = 0;
                        let sttChars = 0;
                        // TICKET-176: count of photo-mode slides actually downloaded
                        // (diagnostic — how many the OCR pass had to work with).
                        let photoSlides = 0;
                        if (!fastPath) {
                            // ── ESCALATION: today's download → OCR → STT ladder ──
                            // Ladder: page text (caption + ASR) + playAddr download →
                            // media-extract OCR → fused extracted_text (086c). ONE
                            // shared stage deadline spans BOTH retry attempts + the
                            // re-fetch (R8) — signed playAddr URLs are session-bound
                            // and flaky; one fresh-perception retry halves silent
                            // OCR-channel loss.
                            let ocrText: string | null = null;
                            const stageDeadlineAt = Date.now() + VIDEO_DOWNLOAD_TIMEOUT_MS;
                            // ── TICKET-176: photo-mode slide OCR ──────────────────
                            // A photo list has no playAddr — the video loop below
                            // no-ops for it (breaks on the null guard). The spots
                            // live ON the slides (the caption is name-free), so
                            // download each signed slide JPEG under ONE shared stage
                            // deadline (they're small — one budget for all, not per
                            // file) and OCR them on-device. Slide files are deleted
                            // right after extraction. A client with no slide context
                            // keeps the legacy {url} path; once context exists, a
                            // generic fallback may not bypass the photo noise rules.
                            if (isPhotoPost) {
                                // The photo marker's `text` is '' (no transcript), so
                                // latestPageText is null — but the caption (desc)
                                // carries the city/hashtag signal Places needs. Keep
                                // it in latestPageText for truthful diagnostics;
                                // fusePhotoSlideText adds it once as [caption] below.
                                // (Video posts never reach here.)
                                latestPageText = desc || null;
                                const slideUrls =
                                    (perception as { slideUrls?: string[] }).slideUrls ?? [];
                                // TICKET-180 stage 2/6: photo branch — on-device slide OCR.
                                if (slideUrls.length > 0) setImportStage(m.jobId, 'reading slides');
                                const slideFiles: Array<string | null> = Array(
                                    slideUrls.length,
                                ).fill(null);
                                for (
                                    let slideIndex = 0;
                                    slideIndex < slideUrls.length;
                                    slideIndex++
                                ) {
                                    // Shared budget across all slides — the signed CDN
                                    // is not referer-bound (verified), so m.url (the
                                    // share link in any form) is a fine Referer.
                                    const remaining = Math.max(0, stageDeadlineAt - Date.now());
                                    if (remaining <= 0) break;
                                    const file = await runOwnerBound(m, () =>
                                        downloadSlideImage(
                                            slideUrls[slideIndex],
                                            m.url as string,
                                            remaining,
                                        )
                                    );
                                    slideFiles[slideIndex] = file;
                                }
                                photoSlides = slideFiles.filter(
                                    (file): file is string => file != null,
                                ).length;
                                photoSlideCount = slideUrls.length;
                                photoImportContext =
                                    photoSlideCount > 0
                                        ? { source_kind: 'photo', slide_count: photoSlideCount }
                                        : null;
                                const slideLines: string[][] = slideFiles.map(() => []);
                                if (photoSlides > 0) {
                                    // Each native call sees ONE slide, so its internal
                                    // dedupe cannot erase repeated cross-slide lines.
                                    // One JS deadline spans the entire loop; every call
                                    // receives only what remains, never a fresh 45s.
                                    const ocrDeadlineAt = Date.now() + OCR_WALLCLOCK_BUDGET_MS;
                                    for (
                                        let slideIndex = 0;
                                        slideIndex < slideFiles.length;
                                        slideIndex++
                                    ) {
                                        const file = slideFiles[slideIndex];
                                        if (!file) continue;
                                        const remainingOcrBudgetMs = Math.max(
                                            0,
                                            ocrDeadlineAt - Date.now(),
                                        );
                                        if (remainingOcrBudgetMs <= 0) break;
                                        try {
                                            const res = await runOwnerBound(m, () =>
                                                extractFromImages([file], {
                                                    ocrBudgetMs: remainingOcrBudgetMs,
                                                })
                                            );
                                            slideLines[slideIndex] = (res?.ocr ?? [])
                                                .map((line) => line.trim())
                                                .filter(Boolean);
                                        } catch (error) {
                                            if (isSessionError(error)) throw error;
                                            // One bad slide must not erase the others.
                                        }
                                    }
                                    ocrLines = slideLines.reduce(
                                        (sum, lines) => sum + lines.length,
                                        0,
                                    );
                                }
                                // Preserve the source carousel shape even when a
                                // slide download/OCR yields no lines. The caption is
                                // fused exactly once in its own labelled section.
                                ocrText = photoSlideCount > 0
                                    ? fusePhotoSlideText(slideLines, desc)
                                    : null;
                                for (const file of slideFiles) {
                                    if (file) void deleteCachedSlide(file);
                                }
                            }
                            // TICKET-180 stage 3/6: video branch — pull the mp4 (only
                            // when there's a playAddr; a photo post skips the loop below).
                            if (perception?.playAddr) setImportStage(m.jobId, 'downloading video');
                            for (let attempt = 0; attempt < 2; attempt++) {
                                const playAddr = perception?.playAddr;
                                if (!playAddr) break;
                                const refererUrl =
                                    (perception as { refererUrl?: string }).refererUrl ??
                                    (m.url as string);
                                const fileUri = await runOwnerBound(m, () =>
                                    downloadTikTokVideo(
                                        playAddr,
                                        // IG's fbcdn checks the embed-page referer;
                                        // TikTok's CDN wants the video page itself.
                                        refererUrl,
                                        // R8: the REMAINING shared budget, never a fresh 30s.
                                        Math.max(0, stageDeadlineAt - Date.now()),
                                    )
                                );
                                if (!fileUri) {
                                    // [review-1 Codex-5] the refetch's own page/VTT
                                    // fetches run against the REMAINING stage budget
                                    // (threaded as a deadline), never fresh timeouts —
                                    // and are skipped outright when the stage is spent.
                                    if (attempt === 0 && stageDeadlineAt - Date.now() > 1000) {
                                        const refreshed = await fetchPerception(stageDeadlineAt);
                                        if (refreshed) {
                                            perception = refreshed;
                                            // [review-3 Codex-1] merge channel-by-
                                            // channel: a DEGRADED refetch (page ok,
                                            // VTT failed) must never LOSE an initial
                                            // channel — and only a channel the cheap
                                            // tier never saw counts as R3 evidence
                                            // (string inequality read channel loss /
                                            // whitespace drift as "new evidence").
                                            const mergedDesc = refreshed.desc || desc;
                                            const mergedTranscript =
                                                refreshed.transcript || transcript;
                                            if (
                                                (refreshed.desc && !desc) ||
                                                (refreshed.transcript && !transcript)
                                            ) {
                                                pageTextGained = true;
                                            }
                                            latestPageText =
                                                [mergedDesc, mergedTranscript]
                                                    .filter(Boolean)
                                                    .join('\n')
                                                    .trim() || latestPageText;
                                        }
                                    }
                                    continue;
                                }
                                downloadOk = true;
                                // TICKET-180 stage 4/6: on-device OCR + STT of the mp4.
                                setImportStage(m.jobId, 'reading the video');
                                try {
                                    const { ocr, transcript: spoken } = await runOwnerBound(m, () =>
                                        extractFromVideo(
                                            fileUri,
                                            // 2fps: creators flash "Name, Area" overlays
                                            // for ~1s — the old 60-frame/1.5s stride
                                            // missed most of them (086c E2E: 2/7 caught
                                            // at 1.5s stride, 7/7 at 0.5s).
                                            // TikTok's ASR already covers speech when
                                            // present — only transcribe as a fallback.
                                            // Budgets threaded (R8/R4 — native-gated).
                                            {
                                                maxFrames: 240,
                                                fps: 2,
                                                transcribe: !perception?.hasTranscript,
                                                ocrBudgetMs: OCR_WALLCLOCK_BUDGET_MS,
                                                sttTimeoutMs: STT_TIMEOUT_MS,
                                                sttMaxDurationSec: STT_MAX_DURATION_SEC,
                                            },
                                        )
                                    );
                                    ocrLines = ocr?.length ?? 0;
                                    sttChars = (spoken ?? '').length;
                                    ocrText =
                                        [...(ocr ?? []), perception?.hasTranscript ? '' : (spoken ?? '')]
                                            .filter(Boolean)
                                            .join('\n')
                                            .trim() || null;
                                } catch (error) {
                                    if (isSessionError(error)) throw error;
                                    // OCR channel is best-effort by contract.
                                }
                                deleteCachedTikTokVideo(fileUri);
                                break; // extraction ran — don't re-download
                            }
                            // TICKET-176: a photo post now FUSES on-device slide OCR
                            // with the caption as explicit labelled sections — the
                            // spots live on the slides. Empty slide sections are kept
                            // so slide_count and the prompt's boundaries stay aligned.
                            // A zero-candidate photo-aware pass stays empty rather than
                            // retrying through a generic prompt. Videos are unaffected.
                            extractedText = isPhotoPost
                                ? ocrText
                                : [ocrText, latestPageText]
                                    .filter(Boolean)
                                    .join('\n')
                                    .trim() || null;
                            // R3: did escalation add ANY new perception text? OCR
                            // lines (video frames OR photo slides), on-device STT, or
                            // a page-text CHANNEL the retry recovered that the cheap
                            // tier never saw — if none, the fused text ≡ the
                            // cheap-tier text, so a content-reason gate reject holds
                            // for review instead of auto-saving.
                            escalationAddedEvidence =
                                ocrLines > 0 || sttChars > 0 || pageTextGained;
                        }

                        // Which channels actually contributed — without this the
                        // "why did this import flop?" question is unanswerable. R9:
                        // fast_path + gate ride in the diag (MERGE via
                        // setImportDiagnostics) so a re-drain reports truthfully.
                        channelDiagnostics = {
                            provider,
                            page: !!perception,
                            caption_chars: latestPageText?.length ?? 0,
                            tiktok_asr: perception?.hasTranscript ?? false,
                            video: downloadOk,
                            photo_post: isPhotoPost,
                            // Exact carousel count used for photo prompt boundaries.
                            // Keep photo_slides below as the legacy/downloaded count.
                            slide_count: photoSlideCount,
                            // TICKET-176: how many slides downloaded for the OCR pass
                            // (0 on a video post) — ocr_lines above now counts slide
                            // OCR too, so the pair explains a photo-list flop.
                            photo_slides: photoSlides,
                            ocr_lines: ocrLines,
                            stt_chars: sttChars,
                            fast_path: fastPath,
                            gate: fastPathGate,
                            type_rejected: typeRejected,
                        };
                        // Checkpoint the perception channels before the server
                        // resolve. The final log/write below replaces the seeded
                        // rejection count after Places has answered.
                        setImportDiagnostics(m.jobId, channelDiagnostics);

                        // TICKET-156: capture the fresh (unexpired) provider cover
                        // + IG handle from the LAST perception (the retry loop may
                        // have re-fetched it). Read at the source build / post-save
                        // below. tiktok+instagram only — never `video`.
                        clipProvider = provider;
                        clipThumbUrl =
                            (perception as { thumbnailUrl?: string | null })?.thumbnailUrl ?? null;
                        // TICKET-156 + TICKET-180: capture the creator handle from the
                        // LAST perception (the retry loop may have re-fetched it). IG
                        // reads its embed anchor; tiktok reads the resolved-URL @handle.
                        if (provider === 'instagram') {
                            igAuthorHandle =
                                (perception as { authorHandle?: string | null })?.authorHandle ?? null;
                        } else if (provider === 'tiktok') {
                            tkHandle =
                                (perception as { authorHandle?: string | null })?.authorHandle ?? null;
                        }
                    }
                    // ── Shared resolve — SKIPPED on the fast path (candidates set). ──
                    if (!fastPath) {
                        // TICKET-180 stage 5/6: resolving candidates (covers the fallback
                        // re-resolve just below — same matching phase, no re-write).
                        setImportStage(m.jobId, 'matching spots');
                        // Same proven contract as the video path: extracted_text
                        // rides alone (never alongside url).
                        // TICKET-152: advertise supports_large_lists on the url tier so a
                        // Maps list over the sync cap ENUMERATES (no Places call) instead
                        // of truncating at 20. Harmless for non-maps urls (server ignores
                        // the flag below the cap / for non-list sources).
                        const resolved = await callImportResolveUrl<
                            ResolveUrlData & Partial<LargeListEnumeration>
                        >(
                            m,
                            undefined,
                            extractedText
                                ? {
                                    extracted_text: extractedText,
                                    ...(photoImportContext ?? {}),
                                }
                                : {
                                    url: m.url,
                                    supports_large_lists: true,
                                },
                        );
                        mergeTypeRejected(resolved);
                        // A large Maps list → build the durable job + HOLD for the kickoff
                        // sheet. Feature-detect on `mode` (never a version): an old server
                        // or a ≤20 list returns normal candidates and falls through to
                        // today's path, byte-for-byte.
                        if (isLargeListEnumeration(resolved)) {
                            setLargeJob(
                                m.jobId,
                                buildLargeJob({
                                    title: resolved.title ?? null,
                                    items: resolved.items,
                                    list_count: resolved.list_count,
                                }),
                            );
                            pokeImportQueue(); // surface the kickoff row + trip the trigger
                            return;
                        }
                        candidates = resolved?.candidates ?? [];
                        resolvedSourceType = resolved?.source_type ?? null;
                        // TICKET-151: only a google_maps LIST carries a truthful total here
                        // (candidates capped at MAPS_LIST_CAP). Every other source returns
                        // the TICKET-063 listicle heuristic — a caption-regex guess clamped
                        // to ≤6 — which must never render as a denominator (review P1-1).
                        listCount = resolvedSourceType === 'google_maps'
                            ? (resolved?.list_count ?? null)
                            : null;
                        // Instagram's url tier is a login-walled constant (zero
                        // candidates + ig_nudge, which this queue ignores) — the
                        // fallback would burn a resolve_url rate slot for nothing.
                        // R5 (refined, TICKET-175): skip only when the ladder truly
                        // FUSED video-derived text (cheap tier ran AND a download
                        // succeeded) — then the fallback re-resolves the same data.
                        // A no-video escalation (flaked download / perception-shape
                        // drift) may fall back: the server's url tier adds oEmbed +
                        // thumbnail vision the client never had. A photo-aware pass
                        // may not: the generic tier lacks its scene-noise rules.
                        if (
                            candidates.length === 0 &&
                            extractedText &&
                            provider !== 'instagram' &&
                            allowsGenericUrlFallback(photoImportContext) &&
                            !(cheapTierRan && downloadOk)
                        ) {
                            const fallback = await callImportResolveUrl<ResolveUrlData>(
                                m,
                                undefined,
                                { url: m.url },
                            );
                            mergeTypeRejected(fallback);
                            candidates = fallback?.candidates ?? [];
                            resolvedSourceType = fallback?.source_type ?? resolvedSourceType;
                            // listCount must describe the response that produced candidates —
                            // same google_maps-only gate as above.
                            listCount = fallback?.source_type === 'google_maps'
                                ? (fallback?.list_count ?? null)
                                : null;
                        }
                    }
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
                    // TICKET-180 stage 4/6: shared-file video → on-device OCR + STT.
                    setImportStage(m.jobId, 'reading the video');
                    const { ocr, transcript } = await runOwnerBound(m, () =>
                        extractFromVideo(m.videoPath as string)
                    );
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
                    // TICKET-180 stage 5/6: resolving candidates against the OCR text.
                    setImportStage(m.jobId, 'matching spots');
                    const resolved = await callImportResolveUrl<ResolveUrlData>(
                        m,
                        undefined,
                        { extracted_text: extractedText },
                    );
                    mergeTypeRejected(resolved);
                    candidates = resolved?.candidates ?? [];
                }

                // Final photo-only compatibility cap protects the generic {url}
                // fallback and clients talking to an older server. It follows the
                // 12-item listicle ceiling; slide_count remains prompt context only.
                candidates = capPhotoImportCandidates(candidates, photoImportContext);

                // Emit the attributable diagnostic only AFTER every resolve/fallback
                // has had a chance to report its Places type drops. This must run
                // before the empty-candidate branch removes the manifest, otherwise
                // an all-rejected photo misfire leaves only a misleading zero.
                const finalDiagnostics = {
                    ...(channelDiagnostics ?? {}),
                    slide_count: photoSlideCount,
                    type_rejected: typeRejected,
                };
                console.log('[import] channels', JSON.stringify(finalDiagnostics));
                setImportDiagnostics(m.jobId, finalDiagnostics);

                // ── TICKET-164 [R3] no-new-evidence escalation guard ────────────
                // A CONTENT-reason gate reject (stance / count_short / ghost /
                // low_conf) that escalation could NOT add perception text to (0 OCR
                // lines AND empty STT ⇒ the fused text ≡ the cheap-tier text ⇒
                // re-extraction only reproduces the same rejected candidates) must
                // NOT auto-save from text alone — flip to the EXISTING review-hold.
                // [review-1 Codex-3] This runs BEFORE the 086c auto-mode filters:
                // a warned-only reject would otherwise filter to empty and be
                // DISCARDED below before the flip could hold it — the flipped
                // review keeps warned candidates visible (unticked) in the picker.
                // Structural rejects (old_server / no_asr_ambiguous / cheap_error /
                // never-ran) and evidence-adding escalations save as today.
                if (
                    m.mode === 'auto' &&
                    !fastPath &&
                    isContentGate(fastPathGate) &&
                    !escalationAddedEvidence
                ) {
                    setImportMode(m.jobId, 'review');
                    m.mode = 'review';
                }

                // 086c: 'warned' spots ("most overrated…") never auto-save. In
                // review mode they stay visible — unticked — so the user can
                // override; in auto mode they're dropped here.
                if (m.mode === 'auto') {
                    candidates = candidates.filter((c) => c.stance !== 'warned');
                }
                // google_maps 'low' candidates are ALTERNATIVE Places matches
                // for the same spot (single-place: [exact, low, low]), not
                // additional spots — auto-saving them pins duplicates/wrong
                // places. Review mode keeps them for the picker.
                if (m.mode === 'auto' && resolvedSourceType === 'google_maps') {
                    candidates = candidates.filter((c) => c.confidence !== 'low');
                }

                if (candidates.length === 0) {
                    removeImport(m.jobId);
                    safeDeleteMov(m.videoPath);
                    toast.show("couldn't find spots in that import");
                    return;
                }

                const tableIds = m.destinations.tableIds;
                spots = candidates.map((c) => {
                    // Per-(spot, table) share nonce, minted ONCE + persisted, so a
                    // re-drain reuses them (table_shares dedup). Multi-select tables.
                    const tableShares: Record<string, string> = {};
                    for (const t of tableIds) tableShares[t] = safeRandomUUID();
                    return {
                        candidate_id: c.candidate_id ?? safeRandomUUID(),
                        client_nonce: safeRandomUUID(),
                        resolution_id: c.resolution_id ?? null,
                        restaurant_id: c.restaurant_id ?? null,
                        external_id: c.restaurant_id ? null : (c.restaurant.external_id ?? null),
                        restaurant_name: c.restaurant.name ?? null,
                        restaurant_city: c.restaurant.city ?? null,
                        // Legacy single-table fields kept for back-compat readers.
                        table_id: tableIds[0] ?? null,
                        table_client_nonce: tableIds[0] ? tableShares[tableIds[0]] : null,
                        table_shares: tableShares,
                        place: buildPlace(c),
                        stance: c.stance ?? null,
                    };
                });
                setImportSpots(m.jobId, spots);
                // TICKET-151: checkpoint the list size alongside the spots so it
                // survives the review hold + any re-drain (readAll parses it back).
                if (listCount != null) setImportListCount(m.jobId, listCount);
                // TICKET-180: checkpoint the clip's source identity (fresh cover URL +
                // creator handle) at the SAME boundary as the spots — replay-invariant,
                // review-time-only. tiktok/instagram carry a handle; other sources
                // (video/web/maps) leave it null. clipThumbUrl is the fresh (unexpired)
                // provider cover captured above; the review card degrades it to the
                // platform-logo plate on load failure. A re-drain skips this block, so
                // the first pass's values stand (identical reasoning to why spots are
                // checkpointed once).
                setImportSource(m.jobId, {
                    thumbUrl: clipThumbUrl,
                    handle: clipProvider === 'tiktok' ? tkHandle : igAuthorHandle,
                });
            }

            // Review mode: resolved → HOLD for in-app confirmation. The review
            // screen prunes the spots, flips mode to 'auto', and re-pokes the
            // drain, which re-enters here and saves (spots already persisted).
            if (m.mode === 'review') {
                if (freshlyResolved) {
                    const n = spots.length;
                    toast.show(`${n} ${n === 1 ? 'spot' : 'spots'} ready to review`);
                    // TICKET-120: the toast is invisible if the user backgrounded the
                    // app mid-import — post a local notification instead. Foreground
                    // stays toast-only (never double-announce).
                    if (AppState.currentState !== 'active') {
                        presentImportNotification({
                            title: `${n} ${n === 1 ? 'spot' : 'spots'} ready to review`,
                            body: 'tap to confirm your import',
                        });
                    }
                    // TICKET-123: write the SILENT durable inbox row (outcome
                    // 'review'). Always — never AppState-gated (the loud channel
                    // above is; the row is the quiet always-on third). The drain
                    // has no service-role INSERT, so it emits via the self-directed
                    // notifications action. Fire-and-forget — never fail the import.
                    void runOwnerBound(m, () =>
                        callEdgeFn('notifications', {
                            action: 'emit_self',
                            body: {
                                kind: 'import_done',
                                subject_meta: { job_id: m.jobId, count: n, outcome: 'review' },
                            },
                        })
                    ).catch(() => {});
                    if (userId) {
                        queryClient.invalidateQueries({
                            queryKey: queryKeys.importJobs.all(userId),
                        });
                    }
                    // Refresh the wishlist "to review" band live (safe — the drain's
                    // own listener no-ops behind the held lock).
                    pokeImportQueue();
                }
                return;
            }

            // Save (idempotent on import_nonce + per-spot client_nonce). Wishlist is
            // the base destination; per-spot table_id fans out to the Table.
            // Provenance: a tiktok link gets a 'tiktok' source so the restaurant
            // page shows "saved from tiktok" + taps out to that exact video; a
            // maps link → 'google_maps' (list/place share); other links → 'web';
            // a shared file → 'video' (no URL to deep-link).
            // Instagram deliberately saves as 'web' (still taps out to the reel):
            // the wishlist_items_source_shape DB CHECK whitelists source types, so
            // a first-class 'instagram' variant needs a migration — separate ticket.
            // TICKET-156: an Instagram save carries author_handle (when perception
            // resolved one) on its `web` source, so the rail can render the @handle
            // row. Plain web links stay {type,url}; the DB CHECK permits the extra
            // key unchanged (validated in _shared/wishlistSource.ts too).
            const source: Record<string, string> =
                m.kind === 'url' && m.url
                    ? /tiktok\.com/i.test(m.url)
                        ? { type: 'tiktok', url: m.url }
                        : isMapsShareUrl(m.url)
                            ? { type: 'google_maps', url: m.url }
                            : isInstagramUrl(m.url) && igAuthorHandle
                                ? { type: 'web', url: m.url, author_handle: igAuthorHandle }
                                : { type: 'web', url: m.url }
                    : { type: 'video' };

            // Multi-table fan-out: one save_spots call per destination table (same
            // per-spot wishlist client_nonce → wishlist dedups; per-table nonce →
            // each table gets its own share). The RPC (mig 20260618000100) keeps
            // sharing even when the wishlist row already exists, so tables 2..N
            // aren't dropped. Calls are SEQUENTIAL so the first call's wishlist
            // insert lands before the already-pinned table calls. No tables → one
            // wishlist-only call.
            const activeManifest =
                importManifestProtocol(m) === 'v2' ? ensureImportV2Routing(m.jobId) : m;
            if (!activeManifest) throw new Error('Import manifest disappeared before save');
            const isV2 = importManifestProtocol(activeManifest) === 'v2';
            const allRoutingTargets = isV2 ? v2Targets(activeManifest) : [];
            const tableIds = activeManifest.destinations.tableIds;
            const spotsForTable = (t: string): PersistedImportSpot[] =>
                spots!.map((s) => ({
                    ...s,
                    table_id: t,
                    table_client_nonce:
                        s.table_shares?.[t] ?? (s.table_id === t ? s.table_client_nonce : null),
                }));
            const wireSpots = (input: PersistedImportSpot[]) =>
                isV2
                    ? input
                    : input.map(({ resolution_id: _resolutionId, ...spot }) => spot);
            const saveOnce = (
                input: PersistedImportSpot[],
                targets: ImportDestinationTarget[],
                notifyDone: boolean,
                pinWishlistValue?: boolean,
            ) => {
                if (isV2) assertV2ResolutionIds(input);
                return callImportResolveUrl<SaveImportSpotsResult>(
                    activeManifest,
                    'save_spots',
                    {
                        import_nonce: activeManifest.importNonce,
                        spots: wireSpots(input),
                        source,
                        ...clientBuildMetadata(),
                        notify_done: notifyDone,
                        ...(pinWishlistValue == null ? {} : { pin_wishlist: pinWishlistValue }),
                        ...(photoImportContext ?? {}),
                        ...v2SaveFields(
                            activeManifest,
                            input.map((spot) => spot.client_nonce),
                            targets,
                            notifyDone,
                        ),
                    },
                );
            };
            // TICKET-123: the WISHLIST-BASE call carries notify_done so the server
            // writes the durable `import_done` row (outcome 'saved') off its own
            // savedCount — set on the single no-tables call AND the i===0 fan-out
            // call ONLY. Never on tables 2..N, which would double-emit the row.
            // TICKET-180 stage 6/6: the final save (auto mode only — a review hold
            // returned above; a review-confirm re-drain re-enters here and saves).
            setImportStage(m.jobId, 'saving');
            // TICKET-181: the review editor's list-only toggle → pin_wishlist. Default
            // true (base destination); false = the spots land only in the chosen
            // list(s), not the personal wishlist. No-tables path only — the table
            // fan-out below forces true. The server still returns restaurant_ids for
            // list routing when false (large-job path precedent).
            const pinWishlist = effectivePinWishlist(activeManifest);
            let result: SaveImportSpotsResult | undefined;
            if (tableIds.length === 0) {
                result = await saveOnce(spots, allRoutingTargets, true, pinWishlist);
            } else {
                for (let i = 0; i < tableIds.length; i++) {
                    // pin_wishlist is FORCED true when tables exist: a table share is a
                    // share OF the save — fn_save_import_spot mints the pin and table[0]'s
                    // post together, and the list-only branch skips it entirely. A false
                    // here would silently drop the pre-chosen table's share (the review
                    // editor locks the wishlist chip on for the same reason).
                    const tableTarget = allRoutingTargets.find(
                        (target) => target.kind === 'table' && target.tableId === tableIds[i],
                    );
                    if (isV2 && !tableTarget) {
                        throw new Error(`Missing frozen destination nonce for Table ${tableIds[i]}`);
                    }
                    const nonTableTargets = allRoutingTargets.filter(
                        (target) => target.kind !== 'table',
                    );
                    const requestTargets = isV2
                        ? [
                              ...(i === 0 ? nonTableTargets : []),
                              ...(tableTarget ? [tableTarget] : []),
                          ]
                        : [];
                    const r = await saveOnce(
                        spotsForTable(tableIds[i]),
                        requestTargets,
                        i === 0,
                        i === 0 ? true : undefined,
                    );
                    if (i === 0) result = r; // first call pinned the wishlist + did routing
                }
            }

            // Route saved spots into the chosen lists (idempotent bulk add).
            const restaurantIds = (result?.results ?? [])
                .map((r) => r.restaurant_id)
                .filter((x): x is string => !!x);
            if (!isV2 && restaurantIds.length > 0) {
                // Create any "new list" titles (title-deduped), then file into every
                // chosen list (existing + new) via the idempotent bulk add.
                const newListIds = await resolveNewLists(
                    m.destinations.newListTitles,
                    (operation) => runOwnerBound(activeManifest, () => operation()),
                );
                const allListIds = [...new Set([...m.destinations.listIds, ...newListIds])];
                for (const listId of allListIds) {
                    try {
                        await runOwnerBound(activeManifest, () =>
                            callEdgeFn('lists', {
                                action: 'add_entries',
                                body: { list_id: listId, restaurant_ids: restaurantIds },
                            })
                        );
                    } catch (error) {
                        if (isSessionError(error)) throw error;
                        /* a bad/removed list must not fail the import */
                    }
                }
            }

            removeImport(m.jobId);
            safeDeleteMov(m.videoPath);

            // TICKET-156 [ARCH-REVIEW W1]: cache the clip's cover frame AFTER
            // save_spots succeeded (we're past it — a throw would have propagated),
            // so a thumb is bound to a real save. Fire-and-forget; keyed by VIDEO
            // (shared across savers), idempotent server-side. tiktok+instagram only;
            // null on a re-drain (no fresh perception) — the thumb was cached on the
            // first pass. Never blocks or fails the import.
            if (clipProvider && clipThumbUrl && m.url) {
                void runOwnerBound(activeManifest, (expectedOwnerId) =>
                    captureClipThumbFromUrl(
                        m.url!,
                        clipThumbUrl,
                        clipProvider,
                        expectedOwnerId,
                    )
                ).catch(() => {});
            }

            const saved = result?.summary?.saved ?? 0;
            const already = result?.summary?.already_pinned ?? 0;
            // TICKET-181: a list-only save (wishlist toggled off) comes back all
            // `ghost` — filed into the chosen list(s) by the routing above,
            // deliberately NOT pinned. A success, not a failure.
            const ghost = result?.summary?.ghost ?? 0;
            const queued =
                result?.summary?.queued ??
                (result?.results ?? []).filter((item) => item.status === 'queued').length;
            const listOnly = saved === 0 && ghost > 0;
            // On a retry/re-drain the save may have landed on the prior pass and now
            // come back as already_pinned — still a success, count all three.
            const done = saved + already + ghost;
            const accepted = done + queued;
            // TICKET-164 [R9 + review-1 FAIL-1]: a FRESH pass reads the hoisted local
            // (setImportDiagnostics writes the manifest FILE, never this in-memory
            // `m`, so `m.diag` is stale until a re-drain re-parses it); a RE-DRAIN
            // (spots persisted, resolve skipped, local false) reads the checkpointed
            // diag instead.
            const fastPathDiag = freshlyResolved
                ? fastPath
                : (m.diag as { fast_path?: boolean } | undefined)?.fast_path === true;
            // TICKET-088: the capture funnel's terminal event (fire-and-forget).
            if (done > 0) {
                track('import_completed', {
                    spot_count: done,
                    source_type: source.type,
                    fast_path: fastPathDiag,
                });
            }
            // TICKET-122: first completed import flips the activation-hub signal so
            // the empty-state hub collapses full→compact. Idempotent, best-effort.
            if (done > 0) markImportCompleted();
            // Extraction is fallible by nature — the toast carries a "review"
            // action so a wrong pin is taps away from corrected. Routes via the
            // imports HUB (hierarchical back-nav is sacred — never deep-link
            // past the intermediate screen; the fresh batch is its top row).
            const reviewAction = accepted > 0
                ? { label: 'review', onPress: () => router.push('/import-progress' as any) }
                : undefined;
            // TICKET-151: when a Maps list was truncated (list_count > kept), say so
            // — "pinned 18 · first 20 of 117". Null for non-list / ≤20 imports, where
            // the toast reads exactly as before. Appended to the success + already-
            // pinned branches only; never the error branch, never the backgrounded
            // local-notification mirror below (a terse push title, not a metadata line).
            const note = truncationNote(listCount, spots.length);
            // TICKET-164: a single-spot fast-path save carries the MATCHED NAME
            // ("pinned Moor Hall") — the whole point of the cheap tier is one
            // confident spot. Name only, no extra sentence (copy economy). Falls
            // back to the generic count when it's not a single fast-path save or the
            // name is missing.
            const fastPathName =
                fastPathDiag && saved === 1 && spots.length === 1
                    ? (spots[0].restaurant_name ?? null)
                    : null;
            // TICKET-181: "pinned" stays the wishlist verb — a list-only save says
            // where the spots actually went.
            const listNoun =
                m.destinations.listIds.length + m.destinations.newListTitles.length === 1
                    ? 'your list'
                    : 'your lists';
            toast.show(
                queued > 0
                    ? `${queued} ${queued === 1 ? 'spot is' : 'spots are'} completing…`
                    : saved > 0
                    ? fastPathName
                        ? `pinned ${fastPathName}`
                        : note
                          ? `pinned ${saved} · ${note}`
                          : `pinned ${saved} ${saved === 1 ? 'spot' : 'spots'}`
                    : listOnly
                      ? ghost === 1 && spots.length === 1 && spots[0].restaurant_name
                          ? `saved ${spots[0].restaurant_name} to ${listNoun}`
                          : `saved ${ghost} to ${listNoun}`
                      : done > 0
                        ? note
                            ? `already in your wishlist · ${note}`
                            : 'already in your wishlist'
                        : "couldn't import that",
                reviewAction,
            );
            // TICKET-120: mirror the success to a local notification when backgrounded
            // (only on a fresh save — an already-pinned re-drain stays silent).
            // Foreground = toast-only.
            if (!isV2 && (saved > 0 || listOnly) && AppState.currentState !== 'active') {
                presentImportNotification({
                    title: listOnly
                        ? `saved ${ghost} to ${listNoun}`
                        : `pinned ${saved} ${saved === 1 ? 'spot' : 'spots'}`,
                    body: 'tap to fix anything',
                });
            }

            if (userId) {
                queryClient.invalidateQueries({ queryKey: queryKeys.wishlist.personal(userId) });
                queryClient.invalidateQueries({ queryKey: queryKeys.importJobs.all(userId) });
                if (m.destinations.listIds.length > 0 || m.destinations.newListTitles.length > 0) {
                    queryClient.invalidateQueries({ queryKey: queryKeys.lists.mine(userId) });
                    for (const listId of m.destinations.listIds) {
                        queryClient.invalidateQueries({ queryKey: queryKeys.lists.detail(listId) });
                    }
                }
            }
            for (const tableId of m.destinations.tableIds) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.tables.activityForTable(tableId),
                });
            }
        },
        [
            userId,
            queryClient,
            toast,
            processLargeJob,
            callImportResolveUrl,
            runOwnerBound,
        ],
    );

    const drain = useCallback(async () => {
        if (!userId) return;
        if (!isVideoImportAvailable()) return;
        // R10: another drain holds the lock — remember that a rescan was asked for
        // so the in-flight drain re-runs on release (a lost enqueue wakeup else).
        if (!acquireDrainLock()) {
            drainRescanRequested = true;
            return;
        }

        // TICKET-120: iOS suspends JS a few seconds after backgrounding; a background
        // task buys ~30s so an import that finishes while backgrounded can post its
        // completion notification. Guarded (absent module → -1 → release no-ops).
        // Ended in finally; the Swift expiration handler is a backstop.
        let bgTask = -1;
        try {
            bgTask = beginBackgroundTask();
        } catch {
            /* native module absent — no-op */
        }

        try {
            const pending = listPendingImports().flatMap((manifest) => {
                // Review-mode manifests ARE drained — they get resolved (OCR/caption)
                // and persisted, then HELD (processOne returns before save) until the
                // user confirms in the review screen. Ownerless extension captures
                // bind to the first signed-in account before any resolve/save work;
                // another account's manifest is excluded.
                const claimed = claimImportOwner(manifest.jobId, userId);
                return claimed ? [claimed] : [];
            });
            // TICKET-120: actively draining ≥1 import while the user is here is the
            // demonstrated-value beat to (quietly, cadence-gated) offer notifications.
            if (pending.length > 0 && AppState.currentState === 'active') {
                maybeOfferNotifPrompt();
            }
            for (const m of pending) {
                if (!session) break;
                try {
                    await processOne(m);
                } catch (err) {
                    if (activeUserIdRef.current !== m.userId) break;
                    if (isSessionError(err) || isTransientError(err)) break;
                    const updated = bumpImportAttempt(m.jobId);
                    if (updated?.status === 'failed') {
                        toast.show("couldn't import that");
                        // TICKET-120: notify the poison too when backgrounded (the
                        // toast is invisible then). Foreground = toast-only.
                        if (AppState.currentState !== 'active') {
                            presentImportNotification({
                                title: "couldn't import that",
                                body: 'tap to try again',
                            });
                        }
                        // TICKET-123: SILENT durable inbox row (outcome 'failed',
                        // count 0). Always written regardless of AppState; the row
                        // is the quiet always-on record so a decliner/missed-banner
                        // user can still catch it. Fire-and-forget.
                        void runOwnerBound(m, () =>
                            callEdgeFn('notifications', {
                                action: 'emit_self',
                                body: {
                                    kind: 'import_done',
                                    subject_meta: {
                                        job_id: m.jobId,
                                        count: 0,
                                        outcome: 'failed',
                                    },
                                },
                            })
                        ).catch(() => {});
                        // Keep the .mov: a poisoned manifest stays for "try again" in
                        // the progress hub (re-OCR needs the source). The .mov is
                        // deleted on success (processOne) or when the user discards.
                    }
                }
            }
        } finally {
            releaseDrainLock();
            // TICKET-120: release the background-task grant (safe on an invalid id).
            if (bgTask >= 0) {
                try {
                    endBackgroundTask(bgTask);
                } catch {
                    /* best-effort */
                }
            }
            // R10: a drain was requested while we held the lock — rescan now that it's
            // free. Deferred so THIS drain's release settles first (a synchronous
            // re-enter would race the just-cleared lock); pokeImportQueue fans out to
            // the same onImportEnqueued → drain listener the enqueue would have hit.
            if (drainRescanRequested) {
                drainRescanRequested = false;
                setTimeout(() => pokeImportQueue(), 0);
            }
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
