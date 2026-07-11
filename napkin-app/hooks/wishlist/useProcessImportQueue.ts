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
 *   kind 'video' → on-device OCR;  kind 'url' → cheap caption+ASR fast path,
 *                 escalating into download+OCR when the gate rejects (TICKET-164).
 *   mode 'auto'  → save silently here. A content-reason gate reject that
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
import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { callEdgeFn, isAuthFailure, SessionExpiredError } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { safeRandomUUID } from '@/lib/uuid';
import { track } from '@/lib/track';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import {
    extractFromVideo,
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
    setImportMode,
    setDefaultImportMode,
    setLargeJob,
    bumpImportAttempt,
    acquireDrainLock,
    releaseDrainLock,
    onImportEnqueued,
    pokeImportQueue,
    type ImportManifest,
    type PersistedImportSpot,
    type LargeImportJob,
} from '@/lib/importQueue';
import { evaluateFastPath, isContentGate } from '@/lib/importFastPath';
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
    fetchTikTokPerception,
    isTikTokUrl,
    downloadTikTokVideo,
    deleteCachedTikTokVideo,
} from '@/lib/tiktokPerception';
import { fetchInstagramPerception, isInstagramUrl } from '@/lib/instagramPerception';
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

/**
 * Resolve "create new list" titles to list ids — title-deduped against the user's
 * existing lists so a re-drain reuses the list it already created (replay-safe;
 * lists.create is NOT idempotent on its own).
 */
async function resolveNewLists(titles: string[]): Promise<string[]> {
    if (!titles || titles.length === 0) return [];
    let mine: { id: string; title: string }[] = [];
    try {
        mine = (await callEdgeFn<{ id: string; title: string }[]>('lists', { action: 'list_mine' })) ?? [];
    } catch {
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
            const created = await callEdgeFn<{ id: string }>('lists', { action: 'create', body: { title } });
            if (created?.id) {
                out.push(created.id);
                mine.push({ id: created.id, title });
            }
        } catch {
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

    // ── TICKET-152: large Maps-list drain ─────────────────────────────────────
    // A large job is client-pumped in chunks of 20 through resolve_spots →
    // save_spots, advancing a persisted cursor ONLY after the post-save manifest
    // write (frozen nonces cover the crash window). One chunk per invocation, then
    // a deferred poke schedules the next — progress re-renders per chunk, the drain
    // lock releases between chunks, and search stays responsive (separate bucket).
    const processLargeJob = useCallback(
        async (m: ImportManifest) => {
            const job = m.largeJob;
            if (!job) return;
            // Kickoff is HELD for the sheet; done is owned by the digest — no drain.
            if (job.phase !== 'running') return;

            const source = { type: 'google_maps', url: m.url ?? '' };

            const saveChunkSpots = (jb: LargeImportJob, spots: LargeImportSpotInput[]) =>
                callEdgeFn<LargeSaveResult>('resolve-url', {
                    action: 'save_spots',
                    body: {
                        import_nonce: m.importNonce,
                        spots,
                        source,
                        // pin_wishlist honors the kickoff toggle: false = list-only
                        // (the destination list, NOT the personal wishlist).
                        pin_wishlist: jb.pinAll,
                        // notify_done false on EVERY chunk — ONE completion bell is
                        // emitted client-side at the end with the grand total.
                        notify_done: false,
                    },
                });

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
                        (await callEdgeFn<{ id: string; title: string }[]>('lists', {
                            action: 'list_mine',
                        })) ?? [];
                    const existing = mine.find(
                        (l) => (l.title ?? '').trim().toLowerCase() === t.toLowerCase(),
                    );
                    if (existing) return existing.id;
                } catch {
                    /* fall through to create */
                }
                try {
                    const created = await callEdgeFn<{ id: string }>('lists', {
                        action: 'create',
                        body: { title: t },
                    });
                    return created?.id ?? null;
                } catch {
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
                if (!destListId && jb.destListTitle && chunkRestaurantIds.length > 0) {
                    destListId = await ensureDestList(jb.destListTitle);
                }
                // Route to the destination list. A failure here is tolerated (never
                // fails the import) but RECORDED per item via the listRouted flag —
                // the completion reconcile retries, then flags survivors needsLook
                // (P1: list membership must never silently drop).
                let routed = false;
                if (destListId && chunkRestaurantIds.length > 0) {
                    try {
                        // ≤20 ids per chunk « the 200-cap, so no sub-chunking needed.
                        await callEdgeFn('lists', {
                            action: 'add_entries',
                            body: { list_id: destListId, restaurant_ids: chunkRestaurantIds },
                        });
                        routed = true;
                    } catch {
                        /* tolerated — the completion reconcile retries (P1) */
                    }
                }
                // Only a job WITH a destination list tracks routing state.
                const routedOutcomes = jb.destListTitle
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
                if (jobNow.destListTitle) {
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
                                    await callEdgeFn('lists', {
                                        action: 'add_entries',
                                        body: { list_id: destListId, restaurant_ids: batch },
                                    });
                                    for (const id of batch) routedIds.add(id);
                                } catch {
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
                }).catch(() => {});

                track('import_completed', {
                    spot_count: counts.imported,
                    source_type: 'google_maps',
                });
                if (counts.imported > 0) markImportCompleted();

                // TICKET-120: backgrounded → local notification (foreground = toast).
                if (AppState.currentState !== 'active') {
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
                    counts.needsLook > 0
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
                        const resolveData = await callEdgeFn<ResolveSpotsData>('resolve-url', {
                            action: 'resolve_spots',
                            body: {
                                import_nonce: m.importNonce,
                                items: chunk.map((c) => ({
                                    name: c.name,
                                    address: c.address,
                                    client_nonce: c.client_nonce,
                                })),
                            },
                        });
                        // ghost_mode = kill-switch (RESOLVE_SPOTS_GHOST_ONLY) →
                        // ghost-save this chunk; the switch is re-read per chunk.
                        forceGhost = resolveData?.ghost_mode === true;
                        results = forceGhost ? [] : (resolveData?.results ?? []);
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

            // Save (idempotent on frozen nonces).
            let saveResult: LargeSaveResult;
            try {
                saveResult = await saveChunkSpots(
                    jobNow,
                    forceGhost ? buildGhostSpots(chunk) : buildResolvedSpots(results, chunk),
                );
            } catch (err) {
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

            const outcomes = toChunkOutcomes(chunk, results, saveResult, forceGhost);
            const newJob = await commitChunk(jobNow, outcomes, saveResult, end);
            if (isDrained(newJob)) {
                await finalizeLargeJob(newJob);
                return;
            }
            // Continue with the next chunk on a fresh drain (deferred so THIS drain's
            // lock releases first — a synchronous poke would no-op behind the lock).
            setTimeout(() => pokeImportQueue(), 0);
        },
        [userId, queryClient, toast],
    );

    const processOne = useCallback(
        async (m: ImportManifest) => {
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
            let clipThumbUrl: string | null = null;
            let clipProvider: ClipThumbSourceType | null = null;
            // TICKET-164 [review-1 FAIL-1]: hoisted like the TICKET-156 locals above
            // — the toast/track site reads THIS on a fresh pass (setImportDiagnostics
            // writes the manifest file, never the in-memory `m`, so `m.diag` is stale
            // until a re-drain re-parses it). Stays false on a re-drain; the persisted
            // diag covers that side.
            let fastPath = false;

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

                // TICKET-113: this is the first time the app sees this import's
                // authored mode — the user's explicit per-share choice (the iOS
                // extension "auto-save" toggle). Remember it so the NEXT import
                // defaults the same way. Recorded ONCE per fresh manifest — a
                // re-drain has `spots` set and skips this. Deliberately NOT the
                // import-review drain-release (that flips to 'auto' as a mechanism,
                // not a preference — decision 4).
                setDefaultImportMode(m.mode);

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
                        // deadlineAt (epoch ms) caps the perception fetches' internal
                        // timeouts — only the escalation RETRY passes one (R8).
                        const fetchPerception = (deadlineAt?: number) =>
                            provider === 'tiktok'
                                ? fetchTikTokPerception(m.url as string, deadlineAt)
                                : fetchInstagramPerception(m.url as string, deadlineAt);
                        let perception = await fetchPerception();
                        // Caption ALWAYS fuses: even a name-free caption carries
                        // the city signal (hashtags/handle) that Places needs.
                        // (086c — it was dropped whenever the ASR was missing.)
                        const pageText = perception?.text || null;

                        // ── TICKET-164 FAST PATH: caption + platform-ASR text ONLY ──
                        // Resolve the cheap tier (NO video download) and auto-save iff
                        // every conservative gate passes. desc + transcript ride
                        // SEPARATELY (caption + extracted_text) so the server fuses
                        // [desc, transcript] exactly once, never double (R6). Bias:
                        // uncertain ⇒ escalate to today's download → OCR → STT ladder.
                        const desc = (perception as { desc?: string })?.desc ?? '';
                        const transcript = (perception as { transcript?: string })?.transcript ?? '';
                        if (desc || transcript) {
                            cheapTierRan = true;
                            // [review-1 Codex-4] The cheap tier is an OPTIMIZATION and
                            // must never fail an import the ladder would have handled.
                            // Session/transient rethrow (same drain semantics as every
                            // resolve: break the round, resume later); anything
                            // deterministic fails OPEN into the ladder. cheapTierRan
                            // stays true — the server may have billed the slot (R5).
                            let cheap: ResolveUrlData | null = null;
                            try {
                                cheap = await callEdgeFn<ResolveUrlData>('resolve-url', {
                                    body: transcript
                                        ? { caption: desc || undefined, extracted_text: transcript }
                                        : { extracted_text: desc },
                                });
                            } catch (err) {
                                if (isSessionError(err) || isTransientError(err)) throw err;
                                fastPathGate = 'cheap_error'; // structural — never review-holds
                            }
                            if (cheap) {
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
                        let downloadOk = false;
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
                            for (let attempt = 0; attempt < 2; attempt++) {
                                if (!perception?.playAddr) break;
                                const fileUri = await downloadTikTokVideo(
                                    perception.playAddr,
                                    // IG's fbcdn checks the embed-page referer;
                                    // TikTok's CDN wants the video page itself.
                                    (perception as { refererUrl?: string }).refererUrl ??
                                        (m.url as string),
                                    // R8: the REMAINING shared budget, never a fresh 30s.
                                    Math.max(0, stageDeadlineAt - Date.now()),
                                );
                                if (!fileUri) {
                                    // [review-1 Codex-5] the refetch's own page/VTT
                                    // fetches run against the REMAINING stage budget
                                    // (threaded as a deadline), never fresh timeouts —
                                    // and are skipped outright when the stage is spent.
                                    if (attempt === 0 && stageDeadlineAt - Date.now() > 1000) {
                                        perception =
                                            (await fetchPerception(stageDeadlineAt)) ?? perception;
                                    }
                                    continue;
                                }
                                downloadOk = true;
                                try {
                                    const { ocr, transcript: spoken } = await extractFromVideo(
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
                                    );
                                    ocrLines = ocr?.length ?? 0;
                                    sttChars = (spoken ?? '').length;
                                    ocrText =
                                        [...(ocr ?? []), perception?.hasTranscript ? '' : (spoken ?? '')]
                                            .filter(Boolean)
                                            .join('\n')
                                            .trim() || null;
                                } catch {
                                    // OCR channel is best-effort by contract.
                                }
                                deleteCachedTikTokVideo(fileUri);
                                break; // extraction ran — don't re-download
                            }
                            extractedText =
                                [ocrText, pageText].filter(Boolean).join('\n').trim() || null;
                            // R3: did escalation add ANY new perception text? If not,
                            // the fused text ≡ the cheap-tier text, so a content-reason
                            // gate reject holds for review instead of auto-saving.
                            escalationAddedEvidence = ocrLines > 0 || sttChars > 0;
                        }

                        // Which channels actually contributed — without this the
                        // "why did this import flop?" question is unanswerable. R9:
                        // fast_path + gate ride in the diag (MERGE via
                        // setImportDiagnostics) so a re-drain reports truthfully.
                        const diag = {
                            provider,
                            page: !!perception,
                            caption_chars: pageText?.length ?? 0,
                            tiktok_asr: perception?.hasTranscript ?? false,
                            video: downloadOk,
                            ocr_lines: ocrLines,
                            stt_chars: sttChars,
                            fast_path: fastPath,
                            gate: fastPathGate,
                        };
                        console.log('[import] channels', JSON.stringify(diag));
                        setImportDiagnostics(m.jobId, diag);

                        // TICKET-156: capture the fresh (unexpired) provider cover
                        // + IG handle from the LAST perception (the retry loop may
                        // have re-fetched it). Read at the source build / post-save
                        // below. tiktok+instagram only — never `video`.
                        clipProvider = provider;
                        clipThumbUrl =
                            (perception as { thumbnailUrl?: string | null })?.thumbnailUrl ?? null;
                        if (provider === 'instagram') {
                            igAuthorHandle =
                                (perception as { authorHandle?: string | null })?.authorHandle ?? null;
                        }
                    }
                    // ── Shared resolve — SKIPPED on the fast path (candidates set). ──
                    if (!fastPath) {
                        // Same proven contract as the video path: extracted_text
                        // rides alone (never alongside url).
                        // TICKET-152: advertise supports_large_lists on the url tier so a
                        // Maps list over the sync cap ENUMERATES (no Places call) instead
                        // of truncating at 20. Harmless for non-maps urls (server ignores
                        // the flag below the cap / for non-list sources).
                        const resolved = await callEdgeFn<ResolveUrlData & Partial<LargeListEnumeration>>(
                            'resolve-url',
                            {
                                body: extractedText
                                    ? { extracted_text: extractedText }
                                    : { url: m.url, supports_large_lists: true },
                            },
                        );
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
                        // R5: also skip whenever the cheap tier already ran this import
                        // (caps escalation at 2 resolve_url slots, not 3).
                        if (
                            candidates.length === 0 &&
                            extractedText &&
                            provider !== 'instagram' &&
                            !cheapTierRan
                        ) {
                            const fallback = await callEdgeFn<ResolveUrlData>('resolve-url', {
                                body: { url: m.url },
                            });
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
                    callEdgeFn('notifications', {
                        action: 'emit_self',
                        body: {
                            kind: 'import_done',
                            subject_meta: { job_id: m.jobId, count: n, outcome: 'review' },
                        },
                    }).catch(() => {});
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
            const tableIds = m.destinations.tableIds;
            const spotsForTable = (t: string): PersistedImportSpot[] =>
                spots!.map((s) => ({
                    ...s,
                    table_id: t,
                    table_client_nonce:
                        s.table_shares?.[t] ?? (s.table_id === t ? s.table_client_nonce : null),
                }));
            // TICKET-123: the WISHLIST-BASE call carries notify_done so the server
            // writes the durable `import_done` row (outcome 'saved') off its own
            // savedCount — set on the single no-tables call AND the i===0 fan-out
            // call ONLY. Never on tables 2..N, which would double-emit the row.
            let result: SaveImportSpotsResult | undefined;
            if (tableIds.length === 0) {
                result = await callEdgeFn<SaveImportSpotsResult>('resolve-url', {
                    action: 'save_spots',
                    body: { import_nonce: m.importNonce, spots, source, notify_done: true },
                });
            } else {
                for (let i = 0; i < tableIds.length; i++) {
                    const r = await callEdgeFn<SaveImportSpotsResult>('resolve-url', {
                        action: 'save_spots',
                        body: {
                            import_nonce: m.importNonce,
                            spots: spotsForTable(tableIds[i]),
                            source,
                            notify_done: i === 0,
                        },
                    });
                    if (i === 0) result = r; // first call pinned the wishlist + did routing
                }
            }

            // Route saved spots into the chosen lists (idempotent bulk add).
            const restaurantIds = (result?.results ?? [])
                .map((r) => r.restaurant_id)
                .filter((x): x is string => !!x);
            if (restaurantIds.length > 0) {
                // Create any "new list" titles (title-deduped), then file into every
                // chosen list (existing + new) via the idempotent bulk add.
                const newListIds = await resolveNewLists(m.destinations.newListTitles);
                const allListIds = [...new Set([...m.destinations.listIds, ...newListIds])];
                for (const listId of allListIds) {
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

            // TICKET-156 [ARCH-REVIEW W1]: cache the clip's cover frame AFTER
            // save_spots succeeded (we're past it — a throw would have propagated),
            // so a thumb is bound to a real save. Fire-and-forget; keyed by VIDEO
            // (shared across savers), idempotent server-side. tiktok+instagram only;
            // null on a re-drain (no fresh perception) — the thumb was cached on the
            // first pass. Never blocks or fails the import.
            if (clipProvider && clipThumbUrl && m.url) {
                void captureClipThumbFromUrl(m.url, clipThumbUrl, clipProvider);
            }

            const saved = result?.summary?.saved ?? 0;
            const already = result?.summary?.already_pinned ?? 0;
            // On a retry/re-drain the save may have landed on the prior pass and now
            // come back as already_pinned — still a success, count both.
            const done = saved + already;
            // TICKET-164 [R9 + review-1 FAIL-1]: a FRESH pass reads the hoisted local
            // (setImportDiagnostics writes the manifest FILE, never this in-memory
            // `m`, so `m.diag` is stale until a re-drain re-parses it); a RE-DRAIN
            // (spots persisted, resolve skipped, local false) reads the checkpointed
            // diag instead.
            const fastPathDiag = freshlyResolved
                ? fastPath
                : (m.diag as { fast_path?: boolean } | undefined)?.fast_path === true;
            // TICKET-088: the capture funnel's terminal event (fire-and-forget).
            track('import_completed', {
                spot_count: done,
                source_type: source.type,
                fast_path: fastPathDiag,
            });
            // TICKET-122: first completed import flips the activation-hub signal so
            // the empty-state hub collapses full→compact. Idempotent, best-effort.
            if (done > 0) markImportCompleted();
            // Extraction is fallible by nature — the toast carries a "review"
            // action so a wrong pin is taps away from corrected. Routes via the
            // imports HUB (hierarchical back-nav is sacred — never deep-link
            // past the intermediate screen; the fresh batch is its top row).
            const reviewAction = done > 0
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
            toast.show(
                saved > 0
                    ? fastPathName
                        ? `pinned ${fastPathName}`
                        : note
                          ? `pinned ${saved} · ${note}`
                          : `pinned ${saved} ${saved === 1 ? 'spot' : 'spots'}`
                    : done > 0
                      ? note
                          ? `already in your wishlist · ${note}`
                          : 'already in your wishlist'
                      : "couldn't import that",
                reviewAction,
            );
            // TICKET-120: mirror the "pinned N" success to a local notification when
            // backgrounded (only on a fresh save — an already-pinned re-drain stays
            // silent). Foreground = toast-only.
            if (saved > 0 && AppState.currentState !== 'active') {
                presentImportNotification({
                    title: `pinned ${saved} ${saved === 1 ? 'spot' : 'spots'}`,
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
        [userId, queryClient, toast, processLargeJob],
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
            const pending = listPendingImports().filter(
                // Review-mode manifests ARE drained — they get resolved (OCR/caption)
                // and persisted, then HELD (processOne returns before save) until the
                // user confirms in the review screen. Only cross-account manifests are
                // skipped (their destinations belong to the other user).
                (m) => !(m.userId && m.userId !== userId),
            );
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
                        callEdgeFn('notifications', {
                            action: 'emit_self',
                            body: {
                                kind: 'import_done',
                                subject_meta: { job_id: m.jobId, count: 0, outcome: 'failed' },
                            },
                        }).catch(() => {});
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
