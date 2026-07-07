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
import {
    listPendingImports,
    removeImport,
    setImportSpots,
    setImportDiagnostics,
    setDefaultImportMode,
    bumpImportAttempt,
    acquireDrainLock,
    releaseDrainLock,
    onImportEnqueued,
    pokeImportQueue,
    type ImportManifest,
    type PersistedImportSpot,
} from '@/lib/importQueue';
import {
    fetchTikTokPerception,
    isTikTokUrl,
    downloadTikTokVideo,
    deleteCachedTikTokVideo,
} from '@/lib/tiktokPerception';
import { fetchInstagramPerception, isInstagramUrl } from '@/lib/instagramPerception';
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

export function useProcessImportQueue() {
    const { session } = useAuth();
    const userId = session?.user?.id;
    const queryClient = useQueryClient();
    const toast = useToast();

    const processOne = useCallback(
        async (m: ImportManifest) => {
            let spots: PersistedImportSpot[] | undefined = m.spots;
            let freshlyResolved = false;

            // First process: acquire candidates (OCR for video / caption for url),
            // build + PERSIST spots (frozen nonces) before the save.
            if (!spots || spots.length === 0) {
                freshlyResolved = true;
                let candidates: ResolvedCandidate[] = [];

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
                        const fetchPerception = () =>
                            provider === 'tiktok'
                                ? fetchTikTokPerception(m.url as string)
                                : fetchInstagramPerception(m.url as string);
                        let perception = await fetchPerception();
                        // Caption ALWAYS fuses: even a name-free caption carries
                        // the city signal (hashtags/handle) that Places needs.
                        // (086c — it was dropped whenever the ASR was missing.)
                        const pageText = perception?.text || null;
                        let ocrText: string | null = null;
                        let ocrLines = 0;
                        let sttChars = 0;
                        let downloadOk = false;
                        // Signed playAddr URLs are session-bound and flaky; one
                        // fresh-perception retry halves silent OCR-channel loss.
                        for (let attempt = 0; attempt < 2; attempt++) {
                            if (!perception?.playAddr) break;
                            const fileUri = await downloadTikTokVideo(
                                perception.playAddr,
                                // IG's fbcdn checks the embed-page referer;
                                // TikTok's CDN wants the video page itself.
                                (perception as { refererUrl?: string }).refererUrl ??
                                    (m.url as string),
                            );
                            if (!fileUri) {
                                if (attempt === 0) {
                                    perception = (await fetchPerception()) ?? perception;
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
                                    {
                                        maxFrames: 240,
                                        fps: 2,
                                        transcribe: !perception?.hasTranscript,
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
                        // Which channels actually contributed — without this the
                        // "why did this import flop?" question is unanswerable.
                        const diag = {
                            provider,
                            page: !!perception,
                            caption_chars: pageText?.length ?? 0,
                            tiktok_asr: perception?.hasTranscript ?? false,
                            video: downloadOk,
                            ocr_lines: ocrLines,
                            stt_chars: sttChars,
                        };
                        console.log('[import] channels', JSON.stringify(diag));
                        setImportDiagnostics(m.jobId, diag);
                    }
                    // Same proven contract as the video path: extracted_text
                    // rides alone (never alongside url).
                    const resolved = await callEdgeFn<ResolveUrlData>('resolve-url', {
                        body: extractedText ? { extracted_text: extractedText } : { url: m.url },
                    });
                    candidates = resolved?.candidates ?? [];
                    // Instagram's url tier is a login-walled constant (zero
                    // candidates + ig_nudge, which this queue ignores) — the
                    // fallback would burn a resolve_url rate slot for nothing.
                    if (candidates.length === 0 && extractedText && provider !== 'instagram') {
                        const fallback = await callEdgeFn<ResolveUrlData>('resolve-url', {
                            body: { url: m.url },
                        });
                        candidates = fallback?.candidates ?? [];
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

                // 086c: 'warned' spots ("most overrated…") never auto-save. In
                // review mode they stay visible — unticked — so the user can
                // override; in auto mode they're dropped here.
                if (m.mode === 'auto') {
                    candidates = candidates.filter((c) => c.stance !== 'warned');
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
            // page shows "saved from tiktok" + taps out to that exact video; other
            // links → 'web'; a shared file → 'video' (no URL to deep-link).
            // Instagram deliberately saves as 'web' (still taps out to the reel):
            // the wishlist_items_source_shape DB CHECK whitelists source types, so
            // a first-class 'instagram' variant needs a migration — separate ticket.
            const source: Record<string, string> =
                m.kind === 'url' && m.url
                    ? /tiktok\.com/i.test(m.url)
                        ? { type: 'tiktok', url: m.url }
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
            let result: SaveImportSpotsResult | undefined;
            if (tableIds.length === 0) {
                result = await callEdgeFn<SaveImportSpotsResult>('resolve-url', {
                    action: 'save_spots',
                    body: { import_nonce: m.importNonce, spots, source },
                });
            } else {
                for (let i = 0; i < tableIds.length; i++) {
                    const r = await callEdgeFn<SaveImportSpotsResult>('resolve-url', {
                        action: 'save_spots',
                        body: { import_nonce: m.importNonce, spots: spotsForTable(tableIds[i]), source },
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

            const saved = result?.summary?.saved ?? 0;
            const already = result?.summary?.already_pinned ?? 0;
            // On a retry/re-drain the save may have landed on the prior pass and now
            // come back as already_pinned — still a success, count both.
            const done = saved + already;
            // TICKET-088: the capture funnel's terminal event (fire-and-forget).
            track('import_completed', { spot_count: done, source_type: source.type });
            // Extraction is fallible by nature — the toast carries a "review"
            // action so a wrong pin is taps away from corrected. Routes via the
            // imports HUB (hierarchical back-nav is sacred — never deep-link
            // past the intermediate screen; the fresh batch is its top row).
            const reviewAction = done > 0
                ? { label: 'review', onPress: () => router.push('/import-progress' as any) }
                : undefined;
            toast.show(
                saved > 0
                    ? `pinned ${saved} ${saved === 1 ? 'spot' : 'spots'}`
                    : done > 0
                      ? 'already in your wishlist'
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
        [userId, queryClient, toast],
    );

    const drain = useCallback(async () => {
        if (!userId) return;
        if (!isVideoImportAvailable()) return;
        if (!acquireDrainLock()) return;

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
