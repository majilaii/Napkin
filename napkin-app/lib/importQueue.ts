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
import {
    listImportManifests,
    writeImportManifest,
    removeImportManifest,
} from '@/modules/media-extract';

const MAX_ATTEMPTS = 3;

export type ImportManifestStatus = 'pending' | 'failed';

/** A resolved spot in the exact shape resolve-url `save_spots` expects. */
export interface PersistedImportSpot {
    candidate_id: string;
    client_nonce: string;
    restaurant_id: string | null;
    external_id: string | null;
    restaurant_name: string | null;
    restaurant_city: string | null;
    table_id: string | null;
    table_client_nonce: string | null;
    place: unknown;
}

/** Where the import's spots should land. Chosen on the in-extension card. */
export interface ImportDestinations {
    /** Always true today (wishlist is the base destination). */
    wishlist: boolean;
    /** Existing lists to also file every saved spot into (multi-select). */
    listIds: string[];
    /** New lists to CREATE on the fly, then file the spots into. */
    newListTitles: string[];
    /** One Table to share to — only VERIFIED spots reach it (RPC ghost quarantine). */
    tableId: string | null;
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
}

const DEFAULT_DESTINATIONS: ImportDestinations = {
    wishlist: true,
    listIds: [],
    newListTitles: [],
    tableId: null,
};

function normalizeDestinations(d: unknown): ImportDestinations {
    const o = (d ?? {}) as Partial<ImportDestinations>;
    return {
        wishlist: o.wishlist !== false, // default true
        listIds: Array.isArray(o.listIds)
            ? o.listIds.filter((x): x is string => typeof x === 'string')
            : [],
        newListTitles: Array.isArray(o.newListTitles)
            ? o.newListTitles.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            : [],
        tableId: typeof o.tableId === 'string' ? o.tableId : null,
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
        mode: 'auto',
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

/** Persist resolved spots (checkpoint after first resolve) so re-drains reuse them. */
export function setImportSpots(jobId: string, spots: PersistedImportSpot[]): void {
    const m = readAll().find((x) => x.jobId === jobId);
    if (!m) return;
    writeManifest({ ...m, spots });
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
