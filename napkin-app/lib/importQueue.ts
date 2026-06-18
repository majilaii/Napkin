/**
 * importQueue — durable manifest queue for async video imports (TICKET-083 Part B).
 *
 * A shared video lands here (app/import.tsx receiving the share-extension deep
 * link); the main-app processor (useProcessImportQueue) drains it in the
 * background — OCR + resolve + auto-save — so the user never waits on a blocking
 * sheet. Durable (survives app kill): a half-finished import resumes on next open.
 *
 * STORE: AsyncStorage for increment 2. Increment 3 (the in-extension modal, no
 * app-switch) migrates the store to the App-Group container so the Swift
 * extension can write it — the drain logic is unchanged.
 *
 * REPLAY-SAFETY (review BLOCKER fix): per-spot nonces are minted ONCE and
 * PERSISTED on the manifest (`spots`) after the first successful resolve. A
 * re-drain (app killed before removeImport) reuses the SAME nonces → save_spots
 * ON CONFLICT (user_id, client_nonce) DO NOTHING → no double-save. We do NOT
 * re-derive nonces from OCR output (OCR is non-deterministic — frame order, LLM
 * cache misses → the derived id drifted → the original double-save bug).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { safeRandomUUID } from './uuid';

const KEY = 'napkin.importQueue.v1';
const MAX_ATTEMPTS = 3;

export type ImportManifestStatus = 'pending' | 'failed';

/**
 * A resolved spot in the exact shape resolve-url `save_spots` expects. Minted
 * once at first resolve and persisted so re-drains reuse identical nonces.
 */
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

export interface ImportManifest {
    jobId: string;
    kind: 'video';
    videoPath: string;
    importNonce: string;
    createdAt: number;
    attempts: number;
    status: ImportManifestStatus;
    /**
     * Set after the FIRST successful resolve. Present → re-drain skips OCR/resolve
     * and goes straight to the (idempotent) save with these frozen nonces.
     */
    spots?: PersistedImportSpot[];
}

async function readAll(): Promise<ImportManifest[]> {
    try {
        const raw = await AsyncStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function writeAll(items: ImportManifest[]): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

// ── enqueue notifier ────────────────────────────────────────────────────────
// The processor drains on mount + foreground, but a share deep-link can
// foreground the app BEFORE app/import.tsx enqueues — that drain finds nothing.
// This notifier lets the processor re-drain the moment a new manifest lands.
type EnqueueListener = () => void;
const enqueueListeners = new Set<EnqueueListener>();

export function onImportEnqueued(fn: EnqueueListener): () => void {
    enqueueListeners.add(fn);
    return () => {
        enqueueListeners.delete(fn);
    };
}

// ── enqueue (serialized) ──────────────────────────────────────────────────────
// Read-modify-write must be atomic or two near-simultaneous deep-link re-emits
// race and append two manifests (two jobIds) for one video → double-save. Chain
// every enqueue so they run one at a time.
let enqueueChain: Promise<unknown> = Promise.resolve();

export function enqueueVideoImport(videoPath: string): Promise<ImportManifest> {
    const run = enqueueChain.then(() => doEnqueue(videoPath));
    // keep the chain alive even if one enqueue rejects
    enqueueChain = run.catch(() => undefined);
    return run;
}

async function doEnqueue(videoPath: string): Promise<ImportManifest> {
    const items = await readAll();
    const existing = items.find((m) => m.videoPath === videoPath);
    if (existing) return existing; // idempotent on videoPath

    const manifest: ImportManifest = {
        jobId: safeRandomUUID(),
        kind: 'video',
        videoPath,
        importNonce: safeRandomUUID(),
        createdAt: Date.now(),
        attempts: 0,
        status: 'pending',
    };
    await writeAll([...items, manifest]);
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
export async function listPendingImports(): Promise<ImportManifest[]> {
    return (await readAll())
        .filter((m) => m.status === 'pending')
        .sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeImport(jobId: string): Promise<void> {
    const items = await readAll();
    await writeAll(items.filter((m) => m.jobId !== jobId));
}

/** Persist resolved spots (checkpoint after first resolve) so re-drains reuse them. */
export async function setImportSpots(jobId: string, spots: PersistedImportSpot[]): Promise<void> {
    const items = await readAll();
    await writeAll(items.map((m) => (m.jobId === jobId ? { ...m, spots } : m)));
}

/**
 * Increment a manifest's attempt counter. At >= MAX_ATTEMPTS the manifest is
 * marked 'failed' (poison) and excluded from listPendingImports — never
 * re-claimed. ONLY deterministic failures bump this; transient ones (auth /
 * 429 / 5xx) are retried without bumping (see useProcessImportQueue).
 */
export async function bumpImportAttempt(jobId: string): Promise<ImportManifest | null> {
    const items = await readAll();
    let updated: ImportManifest | null = null;
    const next = items.map((m) => {
        if (m.jobId !== jobId) return m;
        const attempts = m.attempts + 1;
        updated = { ...m, attempts, status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending' };
        return updated;
    });
    await writeAll(next);
    return updated;
}

// ── drain lock (module-level) ─────────────────────────────────────────────────
// A per-hook useRef guard does NOT survive a double-mount (StrictMode / remount):
// two instances → two refs → two concurrent drains. A module-level singleton is
// process-wide, so only one drain runs at a time regardless of how many hook
// instances mount.
let draining = false;

export function acquireDrainLock(): boolean {
    if (draining) return false;
    draining = true;
    return true;
}

export function releaseDrainLock(): void {
    draining = false;
}
