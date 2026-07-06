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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeRandomUUID } from './uuid';
import {
    listImportManifests,
    writeImportManifest,
    removeImportManifest,
    setSharedDefault,
} from '@/modules/media-extract';

const MAX_ATTEMPTS = 3;

// ── Default import mode preference (TICKET-113) ────────────────────────────────
// The founder always opts to review imports; that choice should stick so the NEXT
// share defaults the same way — without a settings screen. We persist the mode the
// user last explicitly chose and seed every new RN-created job (doEnqueue) from it.
//
// Cross-process note: the iOS share EXTENSION writes its own manifest directly (it
// can't read AsyncStorage), carrying the mode from its in-extension "auto-save"
// toggle. Those manifests keep their authored mode; the drain records that explicit
// choice back into this preference so future jobs inherit it.
export type ImportMode = 'auto' | 'review';
const DEFAULT_MODE_KEY = 'napkin.import.defaultMode';
// TICKET-113 Part B: the KEY for the App-Group shared default read by the iOS
// share extension. It is the BARE string 'import.defaultMode' — deliberately
// DISTINCT from the AsyncStorage key above (different stores). This literal MUST
// stay byte-identical with ShareViewController.swift and MediaExtractModule.swift.
const SHARED_DEFAULT_MODE_KEY = 'import.defaultMode';

// In-memory mirror so job creation can read the preference synchronously. Primed
// from AsyncStorage on module load; falls back to 'auto' (today's behavior) until
// primed and whenever nothing was ever stored.
let cachedDefaultMode: ImportMode = 'auto';

// Prime the cache once at module load (best-effort; a miss leaves 'auto').
AsyncStorage.getItem(DEFAULT_MODE_KEY)
    .then((raw) => {
        if (raw === 'review' || raw === 'auto') cachedDefaultMode = raw;
    })
    .catch(() => {
        /* storage unavailable — keep the 'auto' fallback */
    });

/** The mode new imports should default to. Synchronous (in-memory mirror). */
export function getDefaultImportMode(): ImportMode {
    return cachedDefaultMode;
}

/**
 * Remember the user's explicit mode choice so future imports default to it.
 * No-op write when the preference is unchanged. Fire-and-forget persist.
 */
export function setDefaultImportMode(mode: ImportMode): void {
    if (mode !== 'auto' && mode !== 'review') return;
    if (cachedDefaultMode === mode) return; // unchanged — nothing to persist
    cachedDefaultMode = mode;
    AsyncStorage.setItem(DEFAULT_MODE_KEY, mode).catch(() => {
        /* best-effort — the in-memory mirror still holds for this session */
    });
    // TICKET-113 Part B: mirror into the App-Group shared default so the iOS share
    // extension (separate process, can't read AsyncStorage) seeds its auto-save
    // toggle from it on next launch. Guarded — a missing native module (Android /
    // unlinked) degrades gracefully; the RN-side pref still holds.
    try {
        setSharedDefault(SHARED_DEFAULT_MODE_KEY, mode);
    } catch {
        /* native module absent — RN-side pref still holds */
    }
}

export type ImportManifestStatus = 'pending' | 'failed';

/** A resolved spot in the exact shape resolve-url `save_spots` expects. */
export interface PersistedImportSpot {
    candidate_id: string;
    client_nonce: string;
    restaurant_id: string | null;
    external_id: string | null;
    restaurant_name: string | null;
    restaurant_city: string | null;
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
    createdAt: number;
    attempts: number;
    /** Account that created the import (from the snapshot). The drain skips a
     *  manifest belonging to a different signed-in user (cross-account safety). */
    userId?: string | null;
    /** 'review' (toggle off) holds the batch for the candidate picker on next open. */
    status: ImportManifestStatus;
    /** 'auto' (default) saves silently; 'review' defers to the picker on app open. */
    mode: 'auto' | 'review';
    destinations: ImportDestinations;
    /** Set after the FIRST successful resolve → re-drain skips OCR/resolve. */
    spots?: PersistedImportSpot[];
    /** TICKET-086c: per-channel perception diagnostics from the last resolve
     * (caption chars, tiktok_asr, ocr_lines, …) — extraction is opaque without
     * a record of which channels actually contributed. */
    diag?: Record<string, unknown>;
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
                // Missing mode/destinations default to auto/wishlist (b43 manifests).
                out.push({
                    jobId: p.jobId,
                    kind,
                    videoPath,
                    url,
                    importNonce: typeof p.importNonce === 'string' ? p.importNonce : safeRandomUUID(),
                    createdAt: typeof p.createdAt === 'number' ? p.createdAt : 0,
                    attempts: typeof p.attempts === 'number' ? p.attempts : 0,
                    userId: typeof p.userId === 'string' ? p.userId : null,
                    status: p.status === 'failed' ? 'failed' : 'pending',
                    mode: p.mode === 'review' ? 'review' : 'auto',
                    destinations: normalizeDestinations(p.destinations),
                    spots: Array.isArray(p.spots) ? (p.spots as PersistedImportSpot[]) : undefined,
                    diag: p.diag && typeof p.diag === 'object' && !Array.isArray(p.diag)
                        ? (p.diag as Record<string, unknown>)
                        : undefined,
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

function writeManifest(m: ImportManifest): void {
    try {
        writeImportManifest(m.jobId, JSON.stringify(m));
    } catch {
        /* native module absent — no-op */
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

export function enqueueVideoImport(videoPath: string): Promise<ImportManifest> {
    const run = enqueueChain.then(() => doEnqueue(videoPath));
    enqueueChain = run.catch(() => undefined);
    return run;
}

async function doEnqueue(videoPath: string): Promise<ImportManifest> {
    const existing = readAll().find((m) => m.videoPath === videoPath);
    if (existing) return existing; // idempotent on videoPath

    const manifest: ImportManifest = {
        jobId: safeRandomUUID(),
        kind: 'video',
        videoPath,
        importNonce: safeRandomUUID(),
        createdAt: Date.now(),
        attempts: 0,
        status: 'pending',
        // TICKET-113: seed from the remembered preference (fallback 'auto').
        mode: getDefaultImportMode(),
        destinations: { ...DEFAULT_DESTINATIONS },
    };
    writeManifest(manifest);
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
    return readAll()
        .filter((m) => m.status === 'pending' || m.status === 'failed')
        .filter((m) => !(m.userId && m.userId !== userId))
        .sort((a, b) => b.createdAt - a.createdAt); // newest first
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

/** Persist per-channel perception diagnostics (best-effort; debugging surface). */
export function setImportDiagnostics(jobId: string, diag: Record<string, unknown>): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, diag });
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
