/**
 * importQueue — durable manifest queue for async video imports (TICKET-083 Part B).
 *
 * STORE (inc3): the App-Group container, via native file ops in the media-extract
 * module. This is shared with the iOS share EXTENSION, which writes a manifest
 * directly (it can't call JS) — so a shared video is captured with NO app-switch
 * and the main app drains the queue on next open/foreground.
 *
 * One JSON file per job at <AppGroup>/import-queue/<jobId>.json (the extension
 * writes the .mov fully, THEN the manifest .tmp→rename — so a manifest never
 * references a half-copied video). The native writeImportManifest is also atomic
 * (.tmp→rename) for the app's own updates.
 *
 * REPLAY-SAFETY: per-spot nonces are minted ONCE and PERSISTED on the manifest
 * (`spots`) after the first resolve. A re-drain reuses them → save_spots dedups
 * on (user_id, client_nonce) → no double-save. (We never re-derive nonces from
 * non-deterministic OCR output — that was the original double-save bug.)
 *
 * Native calls throw when the module isn't linked; every accessor is wrapped so
 * the queue degrades to "empty / no-op" rather than crashing.
 */
import { safeRandomUUID } from './uuid';
import { normalizeLargeJob, type LargeImportJob } from './largeImportJob';
import {
    expectedImportDestinations,
    importDestinationTargets,
    normalizeImportDestinationNonces,
    reconcileImportDestinationNonces,
    type ImportDestinationNonceState,
    type ImportDestinationSelection,
    type ImportProtocolGeneration,
} from './importProtocol';
import {
    listImportManifests,
    writeImportManifest,
    removeImportManifest,
} from '@/modules/media-extract';

export type { LargeImportJob, LargeImportJobItem } from './largeImportJob';
export type {
    CompletenessDestinationIntent,
    ImportDestinationNonceState,
    ImportDestinationTarget,
    ImportProtocolGeneration,
} from './importProtocol';

const MAX_ATTEMPTS = 3;

export type ImportManifestStatus = 'pending' | 'failed';

/**
 * TICKET-180: the stage the single-shot drain is currently in, written
 * fire-and-forget at each boundary (fetching page → downloading video / reading
 * slides → reading the video → matching spots → saving). The imports hub renders
 * it live as the in-flight subtitle so a slow import isn't an opaque spinner-less
 * row. Lowercase, ≤3 words. NEVER set for the large-Maps-job path (its chunk cursor
 * already carries an honest numerator). A failed manifest keeps its LAST stage so
 * "died while downloading video" stays visible context.
 */
export type ImportStage =
    | 'fetching page'
    | 'downloading video'
    | 'reading slides'
    | 'reading the video'
    | 'matching spots'
    | 'saving';

/** A resolved spot in the exact shape resolve-url `save_spots` expects. */
export interface PersistedImportSpot {
    candidate_id: string;
    client_nonce: string;
    /** Server-minted, caller-bound provenance for the evaluated candidate. */
    resolution_id?: string | null;
    restaurant_id: string | null;
    external_id: string | null;
    restaurant_name: string | null;
    restaurant_city: string | null;
    area?: string | null;
    /** Legacy single-table nonce (b47 and earlier manifests). */
    table_id: string | null;
    table_client_nonce: string | null;
    /**
     * b48 multi-table: per-table share client_nonce, keyed by tableId. Minted once
     * + persisted so a re-drain reuses them (table_shares dedup on
     * (author_id, table_id, client_nonce)). Replaces the single legacy pair.
     */
    table_shares?: Record<string, string>;
    place: unknown;
    /** TICKET-086c: 'warned' = the creator warned AGAINST this spot ("most
     * overrated…"). Never auto-saved; review shows it unticked. */
    stance?: 'recommended' | 'warned' | 'neutral' | null;
}

/** Where the import's spots should land. Chosen on the in-extension card. */
export interface ImportDestinations {
    /** Always true today (wishlist is the base destination). */
    wishlist: boolean;
    /** Existing lists to also file every saved spot into (multi-select). */
    listIds: string[];
    /** New lists to CREATE on the fly, then file the spots into. */
    newListTitles: string[];
    /** Legacy single-table field (b47 and earlier manifests / Swift). */
    tableId: string | null;
    /** b48: Tables to share to (multi-select) — only VERIFIED spots reach them. */
    tableIds: string[];
}

export interface ImportManifest {
    jobId: string;
    /** 'video' = saved file → OCR; 'url' = shared link → caption resolve. */
    kind: 'video' | 'url';
    /** Present for kind 'video'. */
    videoPath?: string;
    /** Present for kind 'url'. */
    url?: string;
    importNonce: string;
    /**
     * Fixed when the manifest is created. Missing means legacy so a pre-v2
     * manifest resumed after an app update never changes routing protocols.
     */
    protocolGeneration?: ImportProtocolGeneration;
    /** Stable per-destination and per-new-list-title nonces for v2 replays. */
    destinationNonces?: ImportDestinationNonceState;
    /** Exact item x destination record count declared on every v2 fan-out call. */
    expectedDestinations?: number;
    createdAt: number;
    attempts: number;
    /** Account that created the import (from the snapshot). The drain skips a
     *  manifest belonging to a different signed-in user (cross-account safety). */
    userId?: string | null;
    /** 'review' (toggle off) holds the batch for the candidate picker on next open. */
    status: ImportManifestStatus;
    /** 'review' defers to the picker; 'auto' releases a confirmed/legacy job to save. */
    mode: 'auto' | 'review';
    destinations: ImportDestinations;
    /** Set after the FIRST successful resolve → re-drain skips OCR/resolve. */
    spots?: PersistedImportSpot[];
    /** TICKET-086c: per-channel perception diagnostics from the last resolve
     * (caption chars, tiktok_asr, ocr_lines, …) — extraction is opaque without
     * a record of which channels actually contributed. */
    diag?: Record<string, unknown>;
    /** TICKET-151: the resolver's TRUE item count for a google_maps LIST —
     * candidates are capped at MAPS_LIST_CAP (20) server-side. Persisted so the
     * drain toast + review header can say "first 20 of 117" after the review
     * hold / re-drain. Deliberately NEVER set for other sources: their
     * list_count is the ≤6 listicle heuristic (TICKET-063), not a real total. */
    listCount?: number | null;
    /**
     * TICKET-152: the large Maps-list import JOB (>20 items). Additive — a
     * manifest with no `largeJob` behaves EXACTLY as today (single-shot path). A
     * manifest is either single-shot OR large, never both: `largeJob` present ⇒
     * the drain takes `processLargeJob` and ignores `spots`/`destinations`. The
     * durable job (frozen nonces, chunk cursor, per-item outcomes) is the
     * dispatch-on-read work queue — survives app kill, resumes on next open. */
    largeJob?: LargeImportJob;
    /**
     * TICKET-180: the fresh (unexpired) provider cover URL + resolved creator
     * handle, checkpointed ONCE at first resolve (alongside `spots`) so the review
     * screen + imports hub can show WHERE an import came from before you approve it.
     * Replay-invariant — a re-drain that skips resolve inherits the first pass's
     * values. The thumb URL rots in hours–days; the review card degrades it to the
     * platform-logo plate on load failure. RN-authored ONLY — the iOS share
     * extension writes none of these (camelCase, like every other manifest field). */
    sourceThumbUrl?: string | null;
    /** TICKET-180: creator handle (tiktok @user off the resolved page URL / IG
     * embed anchor). Manifest-only — the saved wishlist `source` shape is untouched
     * (a tiktok author_handle would need the DB CHECK + validator). Null when unknown. */
    sourceHandle?: string | null;
    /** TICKET-180: live drain stage (see ImportStage). Fire-and-forget per boundary. */
    stage?: ImportStage;
    /**
     * TICKET-181: whether the single-shot save pins each spot to the personal
     * wishlist. Default TRUE (wishlist is the base destination) — the review editor
     * sets it FALSE for a list-only save (spots land only in the chosen list(s), not
     * the wishlist). Top-level (NOT inside `destinations`) so it maps 1:1 to
     * save_spots' `pin_wishlist` param and rides the same readAll explicit-parse
     * survival law as listCount/stage: an un-parsed field is DROPPED the instant a
     * setter rewrites the file via `{...m}`. RN-authored only (the iOS share
     * extension never writes it → absent → the `?? true` default). */
    pinWishlist?: boolean;
}

const DEFAULT_DESTINATIONS: ImportDestinations = {
    wishlist: true,
    listIds: [],
    newListTitles: [],
    tableId: null,
    tableIds: [],
};

function normalizeDestinations(d: unknown): ImportDestinations {
    const o = (d ?? {}) as Partial<ImportDestinations>;
    // Back-compat: read both the new tableIds[] (b48 Swift) and the legacy single
    // tableId (b47 manifests), de-duped. tableId is preserved so any old reader
    // still sees the first table.
    const tableIds: string[] = [];
    if (Array.isArray(o.tableIds)) {
        for (const x of o.tableIds) if (typeof x === 'string') tableIds.push(x);
    }
    if (typeof o.tableId === 'string' && o.tableId.length > 0 && !tableIds.includes(o.tableId)) {
        tableIds.push(o.tableId);
    }
    return {
        wishlist: o.wishlist !== false, // default true
        listIds: Array.isArray(o.listIds)
            ? o.listIds.filter((x): x is string => typeof x === 'string')
            : [],
        newListTitles: Array.isArray(o.newListTitles)
            ? o.newListTitles.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            : [],
        tableId: tableIds.length > 0 ? tableIds[0] : null,
        tableIds,
    };
}

export function importManifestProtocol(
    manifest: Pick<ImportManifest, 'protocolGeneration'>,
): ImportProtocolGeneration {
    return manifest.protocolGeneration === 'v2' ? 'v2' : 'legacy';
}

function destinationSelectionForManifest(manifest: ImportManifest): ImportDestinationSelection {
    if (manifest.largeJob) {
        return {
            wishlist: manifest.largeJob.pinAll,
            tableIds: [],
            listIds: [],
            newListTitles: manifest.largeJob.destListTitle
                ? [manifest.largeJob.destListTitle]
                : [],
        };
    }
    const tableIds = [...new Set(manifest.destinations.tableIds)];
    return {
        // A Table share is always a share OF a wishlist save.
        wishlist: tableIds.length > 0 || effectivePinWishlist(manifest),
        tableIds,
        listIds: [...new Set(manifest.destinations.listIds)],
        newListTitles: manifest.destinations.newListTitles,
    };
}

/**
 * Freeze the complete v2 routing declaration before the first save request.
 * Pure/exported for contract tests; callers persist the returned manifest.
 */
export function prepareV2ImportRouting(
    manifest: ImportManifest,
    uuid: () => string = safeRandomUUID,
): ImportManifest {
    if (importManifestProtocol(manifest) !== 'v2') return manifest;
    const itemCount = manifest.largeJob
        ? manifest.largeJob.items.length
        : (manifest.spots?.length ?? 0);
    const selection = destinationSelectionForManifest(manifest);
    const destinationNonces = reconcileImportDestinationNonces(
        selection,
        manifest.destinationNonces,
        uuid,
    );
    const targets = importDestinationTargets(selection, destinationNonces);
    return {
        ...manifest,
        destinationNonces,
        expectedDestinations: expectedImportDestinations(itemCount, targets.length),
    };
}

/** Persist/fetch the frozen v2 declaration immediately before a drain save. */
export function ensureImportV2Routing(jobId: string): ImportManifest | null {
    const manifest = readAll().find((candidate) => candidate.jobId === jobId);
    if (!manifest) return null;
    const prepared = prepareV2ImportRouting(manifest);
    return writeManifest(prepared) ? prepared : null;
}

function readAll(): ImportManifest[] {
    try {
        const raw = listImportManifests();
        const out: ImportManifest[] = [];
        for (const s of raw) {
            try {
                const p = JSON.parse(s) as Partial<ImportManifest> & Record<string, unknown>;
                if (typeof p.jobId !== 'string') continue;
                const kind: 'video' | 'url' = p.kind === 'url' ? 'url' : 'video';
                const videoPath = typeof p.videoPath === 'string' ? p.videoPath : undefined;
                const url = typeof p.url === 'string' ? p.url : undefined;
                // Must carry a source for its kind.
                if (kind === 'video' && !videoPath) continue;
                if (kind === 'url' && !url) continue;
                // Build explicitly — the extension-written JSON is untrusted input.
                // Missing/invalid mode defaults to review. Explicit `auto` remains
                // valid because confirmation uses it internally to release a held
                // manifest; treating every `auto` as review would deadlock saves.
                // Missing destinations still normalize to the wishlist inbox.
                out.push({
                    jobId: p.jobId,
                    kind,
                    videoPath,
                    url,
                    importNonce: typeof p.importNonce === 'string' ? p.importNonce : safeRandomUUID(),
                    protocolGeneration:
                        p.protocolGeneration === 'v2'
                            ? 'v2'
                            : p.protocolGeneration === 'legacy'
                              ? 'legacy'
                              : undefined,
                    destinationNonces: normalizeImportDestinationNonces(p.destinationNonces),
                    expectedDestinations:
                        typeof p.expectedDestinations === 'number' &&
                        Number.isSafeInteger(p.expectedDestinations) &&
                        p.expectedDestinations >= 0
                            ? p.expectedDestinations
                            : undefined,
                    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
                    attempts: typeof p.attempts === 'number' ? p.attempts : 0,
                    userId: typeof p.userId === 'string' ? p.userId : null,
                    status: p.status === 'failed' ? 'failed' : 'pending',
                    mode: p.mode === 'auto' ? 'auto' : 'review',
                    destinations: normalizeDestinations(p.destinations),
                    spots: Array.isArray(p.spots) ? (p.spots as PersistedImportSpot[]) : undefined,
                    diag: p.diag && typeof p.diag === 'object' && !Array.isArray(p.diag)
                        ? (p.diag as Record<string, unknown>)
                        : undefined,
                    // TICKET-151: parse listCount back so the `{...m}` spreads in
                    // setImportSpots/setImportMode preserve it across the review hold.
                    listCount: typeof p.listCount === 'number' ? p.listCount : undefined,
                    // TICKET-152: parse the large-import job back (untrusted extension
                    // JSON — validate item shapes, clamp cursor). Absent/invalid ⇒
                    // undefined → the single-shot path runs verbatim (old manifests).
                    // Without this the `{...m}` spreads in the setters would DROP it.
                    largeJob: normalizeLargeJob(p.largeJob),
                    // TICKET-180: parse the source identity + live stage back
                    // EXPLICITLY. readAll rebuilds each manifest field-by-field, so an
                    // un-parsed field is silently DROPPED the instant a setter rewrites
                    // the file from a re-read manifest — e.g. setImportMode('auto') at
                    // review-confirm would wipe the thumb/handle/stage. This is the
                    // load-bearing parse (same trap as listCount/largeJob above).
                    sourceThumbUrl: typeof p.sourceThumbUrl === 'string' ? p.sourceThumbUrl : null,
                    sourceHandle: typeof p.sourceHandle === 'string' ? p.sourceHandle : null,
                    stage: typeof p.stage === 'string' ? (p.stage as ImportStage) : undefined,
                    // TICKET-181: parse pinWishlist back EXPLICITLY (same survival law
                    // as sourceThumbUrl/stage above). The review editor's list-only
                    // toggle MUST persist through the setImportMode('auto') rewrite at
                    // save-confirm — without this line a re-drain would pin the
                    // wishlist anyway, silently defeating a list-only save.
                    pinWishlist: typeof p.pinWishlist === 'boolean' ? p.pinWishlist : undefined,
                });
            } catch {
                /* skip a corrupt manifest */
            }
        }
        return out;
    } catch {
        return []; // native module absent
    }
}

function writeManifest(m: ImportManifest): boolean {
    try {
        return writeImportManifest(m.jobId, JSON.stringify(m));
    } catch {
        return false;
    }
}

// ── enqueue notifier (in-process; cross-process extension writes are picked up
//    by the on-foreground/launch drain) ───────────────────────────────────────
type EnqueueListener = () => void;
const enqueueListeners = new Set<EnqueueListener>();

export function onImportEnqueued(fn: EnqueueListener): () => void {
    enqueueListeners.add(fn);
    return () => {
        enqueueListeners.delete(fn);
    };
}

// ── enqueue (serialized; fallback path — the extension normally enqueues) ──────
let enqueueChain: Promise<unknown> = Promise.resolve();

export function enqueueVideoImport(
    videoPath: string,
    userId?: string | null,
): Promise<ImportManifest> {
    const run = enqueueChain.then(() => doEnqueue(videoPath, userId));
    enqueueChain = run.catch(() => undefined);
    return run;
}

async function doEnqueue(
    videoPath: string,
    userId?: string | null,
): Promise<ImportManifest> {
    const existing = readAll().find((m) =>
        m.videoPath === videoPath &&
        (userId
            ? m.userId == null || m.userId === userId
            : m.userId == null)
    );
    if (existing) {
        // A signed-out capture is intentionally ownerless until the first user.
        // Once signed in, claim it atomically before returning the idempotent row.
        if (userId && existing.userId == null) {
            const claimed = claimImportOwner(existing.jobId, userId);
            if (!claimed) throw new Error('Failed to claim import manifest');
            return claimed;
        }
        return existing;
    }

    const manifest: ImportManifest = {
        jobId: safeRandomUUID(),
        kind: 'video',
        videoPath,
        importNonce: safeRandomUUID(),
        protocolGeneration: 'v2',
        createdAt: Date.now(),
        attempts: 0,
        userId: userId ?? null,
        status: 'pending',
        // Review-first policy: fallback/deep-link video imports must never bypass
        // the same confirmation gate as the native share extension.
        mode: 'review',
        destinations: { ...DEFAULT_DESTINATIONS },
    };
    if (!writeManifest(manifest)) {
        throw new Error('Failed to persist import manifest');
    }
    enqueueListeners.forEach((l) => {
        try {
            l();
        } catch {
            /* a bad listener must not break enqueue */
        }
    });
    return manifest;
}

/** Pending (not-yet-poisoned) manifests, oldest first. */
export function listPendingImports(): ImportManifest[] {
    return readAll()
        .filter((m) => m.status === 'pending')
        .sort((a, b) => a.createdAt - b.createdAt);
}

export function removeImport(jobId: string): void {
    try {
        removeImportManifest(jobId);
    } catch {
        /* native module absent */
    }
}

/** A single manifest by id (for the review screen). */
export function getImport(jobId: string): ImportManifest | null {
    return readAll().find((m) => m.jobId === jobId) ?? null;
}

/** Strict owner-scoped read for route screens and server reconciliation. */
export function getImportForUser(
    jobId: string,
    userId: string | null | undefined,
): ImportManifest | null {
    if (!userId) return null;
    return readAll().find((m) => m.jobId === jobId && m.userId === userId) ?? null;
}

/**
 * Bind an ownerless share-extension manifest to the first signed-in account.
 * Existing ownership is immutable: another account gets null and cannot read or
 * mutate the manifest through an owner-scoped route. A failed durable write does
 * not report a successful claim.
 */
export function claimImportOwner(
    jobId: string,
    userId: string | null | undefined,
): ImportManifest | null {
    if (!userId) return null;
    const manifest = readAll().find((m) => m.jobId === jobId);
    if (!manifest || (manifest.userId != null && manifest.userId !== userId)) return null;
    if (manifest.userId === userId) return manifest;
    const claimed = { ...manifest, userId };
    return writeManifest(claimed) ? claimed : null;
}

/** Flip auto↔review (the review screen flips to 'auto' on confirm, then pokes). */
export function setImportMode(jobId: string, mode: 'auto' | 'review'): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, mode });
}

/** Un-poison a failed import — reset attempts + status, then poke the drain. */
export function retryImport(jobId: string): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, attempts: 0, status: 'pending' });
    pokeImportQueue();
}

/**
 * All in-flight imports for the viewer (pending OR failed) — backs the live
 * "in progress" surface. Cross-account manifests excluded; unknown viewer → [].
 */
export function listActiveManifests(userId?: string | null): ImportManifest[] {
    if (!userId) return [];
    const owned: ImportManifest[] = [];
    for (const manifest of readAll()) {
        if (manifest.status !== 'pending' && manifest.status !== 'failed') continue;
        if (manifest.userId === userId) owned.push(manifest);
        else if (manifest.userId == null) {
            const claimed = claimImportOwner(manifest.jobId, userId);
            if (claimed) owned.push(claimed);
        }
    }
    return owned.sort((a, b) => b.createdAt - a.createdAt); // newest first
}

/** Kick the drain without enqueueing (e.g. after a review confirm). */
export function pokeImportQueue(): void {
    enqueueListeners.forEach((l) => {
        try {
            l();
        } catch {
            /* a bad listener must not break the poke */
        }
    });
}

/** Persist resolved spots (checkpoint after first resolve) so re-drains reuse them. */
export function setImportSpots(jobId: string, spots: PersistedImportSpot[]): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, spots });
}

/**
 * Persist the review editor's destination edits BEFORE the drain-release flips
 * mode → 'auto'. Only keys present in `edits` are applied. When tables change,
 * update both the modern array and legacy first-table field so normalization can
 * never resurrect a removed legacy destination.
 */
export function setImportDestinations(
    jobId: string,
    edits: {
        listIds?: string[];
        newListTitles?: string[];
        tableIds?: string[];
        pinWishlist?: boolean;
    },
): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    const tableIds = edits.tableIds === undefined ? undefined : [...new Set(edits.tableIds)];
    writeManifest({
        ...m,
        destinations: {
            ...m.destinations,
            ...(edits.listIds !== undefined ? { listIds: edits.listIds } : {}),
            ...(edits.newListTitles !== undefined ? { newListTitles: edits.newListTitles } : {}),
            ...(tableIds !== undefined
                ? { tableIds, tableId: tableIds[0] ?? null }
                : {}),
        },
        ...(edits.pinWishlist !== undefined ? { pinWishlist: edits.pinWishlist } : {}),
        // Destination editing happens only before the review is released. Rebuild
        // the exact cardinality/nonces from the final selection at confirmation.
        ...(importManifestProtocol(m) === 'v2'
            ? { destinationNonces: undefined, expectedDestinations: undefined }
            : {}),
    });
}

/**
 * Atomically commit the review editor's confirmed spots, destinations, and mode
 * release. A single manifest rewrite prevents a partial native write from pairing
 * new Table ids with missing nonces or silently dropping the user's filing choice.
 */
export function confirmImportReview(
    jobId: string,
    confirmation: {
        spots: PersistedImportSpot[];
        listIds: string[];
        newListTitles: string[];
        tableIds: string[];
        pinWishlist: boolean;
    },
): boolean {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return false;
    const tableIds = [...new Set(confirmation.tableIds)];
    const confirmed: ImportManifest = {
        ...m,
        mode: 'auto',
        spots: confirmation.spots,
        destinations: {
            ...m.destinations,
            listIds: confirmation.listIds,
            newListTitles: confirmation.newListTitles,
            tableIds,
            tableId: tableIds[0] ?? null,
        },
        pinWishlist: tableIds.length > 0 ? true : confirmation.pinWishlist,
    };
    return writeManifest(prepareV2ImportRouting(confirmed));
}

/**
 * TICKET-181: the effective `pin_wishlist` flag the single-shot save_spots call
 * sends. Default TRUE (wishlist is the base destination) — only the review editor's
 * explicit list-only toggle sets it false. Pure + exported so the save-body wiring
 * is unit-testable without mounting the drain hook.
 */
export function effectivePinWishlist(m: Pick<ImportManifest, 'pinWishlist'>): boolean {
    return m.pinWishlist ?? true;
}

/**
 * Persist per-channel perception diagnostics (best-effort; debugging surface).
 * TICKET-164 [R9]: MERGES into any existing diag (never replaces) so fast_path /
 * gate and the channel fields co-exist and a re-drain reports truthfully.
 */
export function setImportDiagnostics(jobId: string, diag: Record<string, unknown>): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, diag: { ...(m.diag ?? {}), ...diag } });
}

/**
 * TICKET-152: replace the large-import job wholesale (atomic .tmp→rename write,
 * same as every other manifest mutation). The ONE setter behind every large-job
 * transition — enumeration (build → kickoff), the kickoff sheet confirm
 * (kickoff → running), each chunk commit (new items + cursor + ids), completion
 * (completionEmitted + phase done), and poison (via `opts.status:'failed'`).
 * The drain COMPUTES the next job with the pure reducers in `largeImportJob.ts`
 * and hands the whole object here — this layer stays a thin persist.
 */
export function setLargeJob(
    jobId: string,
    largeJob: LargeImportJob,
    opts?: { status?: ImportManifestStatus },
): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    const next: ImportManifest = {
        ...m,
        largeJob,
        ...(opts?.status ? { status: opts.status } : {}),
    };
    writeManifest(
        importManifestProtocol(next) === 'v2' && largeJob.phase === 'running'
            ? prepareV2ImportRouting(next)
            : next,
    );
}

/**
 * TICKET-151: persist the resolver's true list item count (checkpoint alongside
 * spots) so the drain toast + review header can render "first N of M" after the
 * review hold / a re-drain. Like setImportSpots, this writes the file WITHOUT
 * mutating any in-memory manifest — the fresh-drain toast must read its local
 * listCount variable, not m.listCount.
 */
export function setImportListCount(jobId: string, listCount: number): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, listCount });
}

/**
 * TICKET-180: checkpoint the clip's source identity (fresh provider cover URL +
 * resolved creator handle) at first resolve, alongside setImportSpots. Replay-
 * invariant — persisted once so the review screen / hub can show provenance even
 * after the review hold or a re-drain. Writes the file only (never mutates the
 * in-memory manifest), exactly like setImportSpots/setImportListCount.
 */
export function setImportSource(
    jobId: string,
    src: { thumbUrl: string | null; handle: string | null },
): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, sourceThumbUrl: src.thumbUrl, sourceHandle: src.handle });
}

/**
 * TICKET-180: write the drain's current stage (one call per boundary, single-shot
 * path only — the large-job path skips it). Fire-and-forget on the
 * setImportDiagnostics pattern: readAll swallows (native-absent → []), writeManifest
 * swallows (→ no-op), the call is synchronous `void` and NEVER awaited — so no stage
 * write can throw into the drain. A failed manifest keeps its last stage
 * (bumpImportAttempt spreads {...m} off a fresh readAll → the parsed stage survives).
 */
export function setImportStage(jobId: string, stage: ImportStage): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, stage });
}

/**
 * Increment attempts; at >= MAX_ATTEMPTS mark 'failed' (poison) so
 * listPendingImports excludes it — never re-claimed. Only DETERMINISTIC failures
 * bump (transient auth/429/5xx are retried without bumping). Returns the update.
 */
export function bumpImportAttempt(jobId: string): ImportManifest | null {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return null;
    const attempts = m.attempts + 1;
    const updated: ImportManifest = {
        ...m,
        attempts,
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
    };
    writeManifest(updated);
    return updated;
}

// ── drain lock (module-level; survives double-mount / StrictMode) ──────────────
let draining = false;

export function acquireDrainLock(): boolean {
    if (draining) return false;
    draining = true;
    return true;
}

export function releaseDrainLock(): void {
    draining = false;
}
