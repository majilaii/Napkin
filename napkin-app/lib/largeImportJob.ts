/**
 * largeImportJob — pure job-state logic for the large Maps-list import
 * (TICKET-152 Phase B).
 *
 * DELIBERATELY dependency-free (only `safeRandomUUID`, itself pure): no
 * react-native / expo / native-module imports. So the chunk math, the
 * resolve+save reducer, the ghost/budget degradation classification, the
 * completion guard, and the digest partition are all jest-unit-testable in
 * isolation. The manifest layer (`lib/importQueue.ts`) and the drain
 * (`hooks/wishlist/useProcessImportQueue.ts`) COMPOSE these — they never
 * re-derive the logic. (Same "extract the pure gate module" discipline the
 * feed gates use, because `importQueue.ts` pulls in native modules that jest
 * can't load.)
 *
 * Single source of truth: counts are DERIVED from `items[].status` by a pure
 * reducer, never stored — so a resume can't drift them.
 */
import { safeRandomUUID } from './uuid';

// ── Constants ─────────────────────────────────────────────────────────────────
/** One drain chunk = 20 items — aligns with resolve_spots' hard 20-cap and
 *  save_spots' 20-slice, so a chunk is one round-trip on each. */
export const LARGE_JOB_CHUNK_SIZE = 20;
/** Deterministic (non-transient) chunk failures poison the job at this count. */
export const LARGE_JOB_MAX_CHUNK_ATTEMPTS = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LargeJobItemStatus = 'pending' | 'saved' | 'already' | 'ghost' | 'failed';

export interface LargeImportJobItem {
    name: string;
    address: string | null;
    /** Frozen at enumeration — minted ONCE, reused on every resume (save_spots
     *  dedups on (user_id, client_nonce), so a re-drained chunk never double-saves). */
    client_nonce: string;
    status: LargeJobItemStatus;
    restaurant_id?: string | null;
    /** From save_spots — needed for the digest repoint/unpin. null ⇒ list-only. */
    wishlist_id?: string | null;
    restaurant_name?: string | null;
    restaurant_city?: string | null;
    external_id?: string | null;
    /** ghost / per-spot save failure → digest exception. */
    needsLook?: boolean;
}

export type LargeJobPhase = 'kickoff' | 'running' | 'done';

export interface LargeImportJob {
    title: string | null;
    /** items.length (the honest denominator). */
    listCount: number;
    items: LargeImportJobItem[];
    /** Index of the NEXT item to process; === items.length ⇒ drained. */
    cursor: number;
    chunkSize: number;
    /** Consecutive DETERMINISTIC chunk failures at the current cursor (poison ≥ MAX). */
    chunkAttempts: number;
    phase: LargeJobPhase;
    /** From the kickoff sheet (default true). false ⇒ list-only (no wishlist pin). */
    pinAll: boolean;
    /** editable; default = title; null ⇒ no list, wishlist-only. */
    destListTitle: string | null;
    /** Created ONCE on the first chunk, persisted → resume never re-creates. */
    destListId: string | null;
    /** import_jobs.job_id from chunk-1 save_spots. NULL for a pin_wishlist=false
     *  (list-only) job — no RPC ⇒ no import_jobs row (L5). The completion
     *  deep-link rides the MANIFEST jobId, never this. */
    serverJobId: string | null;
    /** L1 — set with the phase:'done' write so a resume never re-fires the bell. */
    completionEmitted: boolean;
}

// ── Enumeration → job ─────────────────────────────────────────────────────────

/** The flag-gated `large_list` response shape (nested inside `data`; callEdgeFn
 *  already strips the outer envelope). */
export interface LargeListEnumeration {
    mode: 'large_list';
    title: string | null;
    items: { name: string; address: string | null }[];
    list_count?: number | null;
}

/** Feature-detect the enumeration response by its `mode` discriminator — NEVER a
 *  version number. Absence ⇒ old server / sub-cap path → normal ≤20 drain. */
export function isLargeListEnumeration(r: unknown): r is LargeListEnumeration {
    return (
        !!r &&
        typeof r === 'object' &&
        (r as { mode?: unknown }).mode === 'large_list' &&
        Array.isArray((r as { items?: unknown }).items)
    );
}

/** Build a fresh kickoff job. Nonces are FROZEN here (minted once). */
export function buildLargeJob(enumeration: {
    title: string | null;
    items: { name: string; address: string | null }[];
    list_count?: number | null;
}): LargeImportJob {
    const items: LargeImportJobItem[] = enumeration.items.map((it) => ({
        name: it.name,
        address: it.address ?? null,
        client_nonce: safeRandomUUID(),
        status: 'pending',
    }));
    const listCount =
        typeof enumeration.list_count === 'number' && Number.isFinite(enumeration.list_count)
            ? enumeration.list_count
            : items.length;
    return {
        title: enumeration.title ?? null,
        listCount,
        items,
        cursor: 0,
        chunkSize: LARGE_JOB_CHUNK_SIZE,
        chunkAttempts: 0,
        phase: 'kickoff',
        pinAll: true, // kickoff default ON
        destListTitle: enumeration.title ?? null,
        destListId: null,
        serverJobId: null,
        completionEmitted: false,
    };
}

/**
 * Defensive parse of an untrusted `largeJob` blob read back off the App-Group
 * manifest (the iOS share extension writes manifests directly, and an older /
 * corrupt file must never crash the drain). Validates item shapes, clamps the
 * cursor into range, and falls every unknown field back to a safe default.
 * Returns undefined when the blob isn't a usable job (⇒ single-shot manifest).
 */
export function normalizeLargeJob(v: unknown): LargeImportJob | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.items)) return undefined;

    const items: LargeImportJobItem[] = [];
    for (const raw of o.items) {
        if (!raw || typeof raw !== 'object') continue;
        const r = raw as Record<string, unknown>;
        if (typeof r.name !== 'string' || typeof r.client_nonce !== 'string') continue;
        const status: LargeJobItemStatus =
            r.status === 'saved' ||
            r.status === 'already' ||
            r.status === 'ghost' ||
            r.status === 'failed'
                ? r.status
                : 'pending';
        items.push({
            name: r.name,
            address: typeof r.address === 'string' ? r.address : null,
            client_nonce: r.client_nonce,
            status,
            restaurant_id: typeof r.restaurant_id === 'string' ? r.restaurant_id : null,
            wishlist_id: typeof r.wishlist_id === 'string' ? r.wishlist_id : null,
            restaurant_name: typeof r.restaurant_name === 'string' ? r.restaurant_name : null,
            restaurant_city: typeof r.restaurant_city === 'string' ? r.restaurant_city : null,
            external_id: typeof r.external_id === 'string' ? r.external_id : null,
            needsLook: r.needsLook === true,
        });
    }

    const phase: LargeJobPhase =
        o.phase === 'running' || o.phase === 'done' ? o.phase : 'kickoff';
    const cursorRaw =
        typeof o.cursor === 'number' && Number.isFinite(o.cursor) ? Math.floor(o.cursor) : 0;
    const cursor = Math.max(0, Math.min(cursorRaw, items.length)); // clamp into range
    const chunkSize =
        typeof o.chunkSize === 'number' && o.chunkSize > 0
            ? Math.floor(o.chunkSize)
            : LARGE_JOB_CHUNK_SIZE;

    return {
        title: typeof o.title === 'string' ? o.title : null,
        listCount:
            typeof o.listCount === 'number' && Number.isFinite(o.listCount)
                ? o.listCount
                : items.length,
        items,
        cursor,
        chunkSize,
        chunkAttempts:
            typeof o.chunkAttempts === 'number' && o.chunkAttempts >= 0
                ? Math.floor(o.chunkAttempts)
                : 0,
        phase,
        pinAll: o.pinAll !== false, // default true
        destListTitle: typeof o.destListTitle === 'string' ? o.destListTitle : null,
        destListId: typeof o.destListId === 'string' ? o.destListId : null,
        serverJobId: typeof o.serverJobId === 'string' ? o.serverJobId : null,
        completionEmitted: o.completionEmitted === true,
    };
}

// ── Chunk math ─────────────────────────────────────────────────────────────────

/** The [cursor, cursor+chunkSize) window, clamped into [0, len]. */
export function chunkBounds(
    cursor: number,
    len: number,
    chunkSize = LARGE_JOB_CHUNK_SIZE,
): { start: number; end: number } {
    const start = Math.max(0, Math.min(cursor, len));
    const end = Math.min(start + chunkSize, len);
    return { start, end };
}

/** Number of chunks N items partition into (ceil(N/size); remainder is the last). */
export function chunkCount(len: number, chunkSize = LARGE_JOB_CHUNK_SIZE): number {
    if (len <= 0 || chunkSize <= 0) return 0;
    return Math.ceil(len / chunkSize);
}

/** cursor has reached the end ⇒ every item processed. */
export function isDrained(job: Pick<LargeImportJob, 'cursor' | 'items'>): boolean {
    return job.cursor >= job.items.length;
}

// ── Derived counts (never stored — single source of truth) ──────────────────────

export interface LargeJobCounts {
    total: number;
    pending: number;
    /** saved + already_pinned — landed cleanly (the digest "imported" tally). */
    imported: number;
    ghosted: number;
    failed: number;
    /** ghost + failed — the digest "need a look" tally. */
    needsLook: number;
}

export function deriveCounts(items: LargeImportJobItem[]): LargeJobCounts {
    let pending = 0;
    let imported = 0;
    let ghosted = 0;
    let failed = 0;
    for (const it of items) {
        switch (it.status) {
            case 'pending':
                pending++;
                break;
            case 'saved':
            case 'already':
                imported++;
                break;
            case 'ghost':
                ghosted++;
                break;
            case 'failed':
                failed++;
                break;
        }
    }
    return {
        total: items.length,
        pending,
        imported,
        ghosted,
        failed,
        needsLook: ghosted + failed,
    };
}

// ── The reducer: fold one chunk's resolve+save outcomes into the item list ──────

/** Per-item outcome the drain zips from resolve_spots + save_spots (by nonce). */
export interface ChunkItemOutcome {
    client_nonce: string;
    /** true ⇒ no VERIFIED Places match (similarity-gate miss, or degraded/killed). */
    ghost: boolean;
    /** save_spots per-spot status. */
    saveStatus: 'saved' | 'already_pinned' | 'ghost' | 'failed';
    restaurant_id?: string | null;
    wishlist_id?: string | null;
    restaurant_name?: string | null;
    restaurant_city?: string | null;
    external_id?: string | null;
}

function resolveItemStatus(o: ChunkItemOutcome): {
    status: LargeJobItemStatus;
    needsLook: boolean;
} {
    // A hard save failure trumps everything — nothing landed.
    if (o.saveStatus === 'failed') return { status: 'failed', needsLook: true };
    // A ghost (no verified match) needs a look even when it PINNED (pinAll mints a
    // ghost wishlist row → saveStatus 'saved', but o.ghost stays true).
    if (o.saveStatus === 'ghost' || o.ghost) return { status: 'ghost', needsLook: true };
    if (o.saveStatus === 'already_pinned') return { status: 'already', needsLook: false };
    return { status: 'saved', needsLook: false };
}

/**
 * Apply a chunk's outcomes to the item list, keyed by client_nonce (NEVER by
 * name — the similarity gate can correct a name). Items absent from `outcomes`
 * are left untouched. Idempotent on resume: re-applying an already-saved chunk
 * lands `already` and preserves the ids the first pass wrote.
 */
export function applyChunkOutcomes(
    items: LargeImportJobItem[],
    outcomes: ChunkItemOutcome[],
): LargeImportJobItem[] {
    const byNonce = new Map(outcomes.map((o) => [o.client_nonce, o]));
    return items.map((it) => {
        const o = byNonce.get(it.client_nonce);
        if (!o) return it;
        const { status, needsLook } = resolveItemStatus(o);
        return {
            ...it,
            status,
            needsLook,
            // Fallback chain preserves a first-pass id when a resume's outcome
            // (e.g. already_pinned) doesn't re-carry it.
            restaurant_id: o.restaurant_id ?? it.restaurant_id ?? null,
            wishlist_id: o.wishlist_id ?? it.wishlist_id ?? null,
            restaurant_name: o.restaurant_name ?? it.restaurant_name ?? it.name,
            restaurant_city: o.restaurant_city ?? it.restaurant_city ?? null,
            external_id: o.external_id ?? it.external_id ?? null,
        };
    });
}

// ── Completion guard (L1) ───────────────────────────────────────────────────────

/** Emit the completion bell exactly once — drained AND not already emitted. */
export function shouldEmitCompletion(
    job: Pick<LargeImportJob, 'cursor' | 'items' | 'completionEmitted'>,
): boolean {
    return job.cursor >= job.items.length && !job.completionEmitted;
}

// ── Drain error classification (M3: 429=budget vs 503/net=transient) ─────────────

export type DrainErrorClass = 'budget' | 'transient' | 'deterministic';

/**
 * Classify a resolve_spots failure for the large drain. resolve_spots reserves
 * HTTP 429 EXCLUSIVELY for the import_spots budget (terminal for the session ⇒
 * ghost-degrade the rest); an inner Places throttle surfaces as 503 and is a
 * plain resumable transient. Session/network/5xx also pause+resume. Any other
 * 4xx is deterministic (poison after MAX attempts). This is why the large path
 * must NOT reuse the shared `isTransientError` (which lumps 429 with 5xx) for
 * the ghost-degrade decision.
 */
export function classifyDrainError(
    status: number | undefined,
    isSession: boolean,
): DrainErrorClass {
    if (isSession) return 'transient';
    if (status === 429) return 'budget';
    if (status === 503) return 'transient';
    if (typeof status === 'number' && status >= 500) return 'transient';
    if (status === undefined) return 'transient'; // network death → pause
    return 'deterministic'; // a real 4xx (not 429) → poison
}

// ── Digest partition + affordance branch ────────────────────────────────────────

/** Split the drained items into digest sections: exceptions first, then imported. */
export function partitionDigest(items: LargeImportJobItem[]): {
    exceptions: LargeImportJobItem[];
    imported: LargeImportJobItem[];
} {
    const exceptions: LargeImportJobItem[] = [];
    const imported: LargeImportJobItem[] = [];
    for (const it of items) {
        if (it.needsLook || it.status === 'ghost' || it.status === 'failed') {
            exceptions.push(it);
        } else if (it.status === 'saved' || it.status === 'already') {
            imported.push(it);
        }
        // 'pending' items (shouldn't exist post-drain) fall through — shown nowhere.
    }
    return { exceptions, imported };
}

/**
 * M2 — the digest's row affordances branch on wishlist_id: a PINNED spot
 * (wishlist_id != null) gets replace·unpin·remove; a LIST-ONLY spot
 * (wishlist_id == null) gets replace·remove ("unpin" is meaningless).
 */
export function isPinnedItem(item: Pick<LargeImportJobItem, 'wishlist_id'>): boolean {
    return item.wishlist_id != null;
}
