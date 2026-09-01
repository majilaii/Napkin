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

export type LargeJobItemStatus = 'pending' | 'queued' | 'saved' | 'already' | 'ghost' | 'failed';

export interface LargeImportJobItem {
    name: string;
    address: string | null;
    /** Frozen at enumeration — minted ONCE, reused on every resume (save_spots
     *  dedups on (user_id, client_nonce), so a re-drained chunk never double-saves). */
    client_nonce: string;
    /** Latest server-owned candidate provenance (freshened after a correction). */
    resolution_id?: string | null;
    /** Server queue identity used for owner-scoped exhausted-item correction. */
    completenessItemId?: string | null;
    status: LargeJobItemStatus;
    restaurant_id?: string | null;
    /** From save_spots — needed for the digest repoint/unpin. null ⇒ list-only. */
    wishlist_id?: string | null;
    restaurant_name?: string | null;
    restaurant_city?: string | null;
    external_id?: string | null;
    /** ghost / per-spot save failure / still-unrouted after the completion
     *  reconcile (P1) → digest exception. */
    needsLook?: boolean;
    /** P1 — true once this item's restaurant_id landed in the destination list
     *  (its chunk's / the reconcile's add_entries succeeded). Meaningful only
     *  when the job HAS a destination list; monotonic once true. */
    listRouted?: boolean;
}

export type LargeJobPhase = 'kickoff' | 'running' | 'done';

// ── Wire shapes (client view of the frozen Phase-A server contract) ───────────

/** One resolve_spots result — echoed per input item, keyed by client_nonce.
 *  resolve_spots NEVER drops an item; a within-chunk true-dupe repeats the same
 *  external_id and collapses at save time. */
export interface ResolveSpotResult {
    client_nonce: string;
    resolution_id?: string | null;
    candidate_id: string;
    restaurant_id: string | null;
    external_id: string | null;
    restaurant_name: string | null;
    restaurant_city: string | null;
    place: unknown;
    confidence?: string;
    /** true ⇒ no verified Places match (similarity-gate miss / no result). */
    ghost: boolean;
    /** TICKET-195: non-food/drink Places top result; never send to save_spots. */
    type_rejected?: true;
}

export interface ResolveSpotsData {
    results: ResolveSpotResult[];
    /** true ⇒ kill-switch (RESOLVE_SPOTS_GHOST_ONLY) — no Places ran. */
    ghost_mode: boolean;
    /** Count rejected by the import-only Places venue-type backstop. */
    type_rejected?: number;
}

export interface LargeSaveSpotResult {
    candidate_id: string;
    client_nonce: string;
    status: 'saved' | 'already_pinned' | 'queued' | 'ghost' | 'failed';
    wishlist_id?: string | null;
    restaurant_id?: string | null;
}

export interface LargeSaveResult {
    results: LargeSaveSpotResult[];
    summary?: {
        saved: number;
        already_pinned: number;
        queued?: number;
        ghost?: number;
        failed: number;
    };
    job_id?: string | null;
}

/** The save_spots per-spot input the large path sends — structurally a
 *  PersistedImportSpot with the table fields pinned null (large jobs never fan
 *  out to Tables). Declared here, not imported from importQueue, so this module
 *  stays native-free and jest-loadable. */
export interface LargeImportSpotInput {
    candidate_id: string;
    client_nonce: string;
    resolution_id?: string | null;
    restaurant_id: string | null;
    external_id: string | null;
    restaurant_name: string | null;
    restaurant_city: string | null;
    table_id: null;
    table_client_nonce: null;
    place: unknown;
}

/** P2 — one chunk's paid-for resolution, persisted after resolve_spots succeeds
 *  and BEFORE save_spots, so a crash in the save window resumes straight to
 *  save (never re-pays Places for the same chunk). Spent (cleared) when the
 *  cursor advances. */
export interface ResolvedChunkCheckpoint {
    /** The cursor this resolve pays for — reused iff it equals job.cursor. */
    cursor: number;
    results: ResolveSpotResult[];
    /** true ⇒ the server answered ghost_mode (kill-switch) for this chunk. */
    ghostMode: boolean;
}

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
    /** M3/429 — the import_spots budget exhausted mid-job. Every remaining chunk
     *  ghost-saves (no resolve call). PERSISTED so a resume keeps degrading —
     *  the daily cap won't clear within the session, and the job's doctrine is
     *  complete-now-as-ghosts + lazy verify-on-open, not wait-for-tomorrow. */
    ghostDegraded: boolean;
    /** P2 — the in-flight chunk's resolve checkpoint (see the type doc). */
    resolvedChunk?: ResolvedChunkCheckpoint | null;
}

export interface CompletenessDestinationSnapshot {
    destination_kind: 'wishlist' | 'table' | 'list' | 'new_list';
    outcome: 'pending' | 'fulfilled' | 'rejected';
    result: Record<string, unknown> | null;
}

export interface CompletenessItemSnapshot {
    id?: string;
    item_nonce: string;
    state: string;
    restaurant_id: string | null;
    last_error: string | null;
    destinations: CompletenessDestinationSnapshot[];
}

export interface CompletenessJobSnapshot {
    job_id: string;
    sealed: boolean;
    done_emitted: boolean;
    items: CompletenessItemSnapshot[];
}

function resultString(value: Record<string, unknown> | null, key: string): string | null {
    const candidate = value?.[key];
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}

function terminalRouteIsHydrated(
    destination: CompletenessDestinationSnapshot | undefined,
    fulfilledIdKey: 'wishlist_id' | 'list_id',
): boolean {
    if (!destination || destination.outcome === 'pending') return false;
    // A rejected route is terminal and intentionally has no live side-effect id;
    // it can leave the completing section as an actionable needs-look row.
    if (destination.outcome === 'rejected') return true;
    return resultString(destination.result, fulfilledIdKey) !== null;
}

/**
 * Reconcile a manifest with the server-owned queue + routing ledger. This is
 * the only transition from local `queued` to saved/exhausted, and it captures
 * the actual wishlist/list ids needed by digest corrections.
 */
export function reconcileLargeJobCompleteness(
    job: LargeImportJob,
    snapshot: CompletenessJobSnapshot,
): LargeImportJob {
    const byNonce = new Map(snapshot.items.map((item) => [item.item_nonce, item]));
    let discoveredListId = job.destListId;
    const items = job.items.map((item): LargeImportJobItem => {
        const server = byNonce.get(item.client_nonce);
        if (!server) return item;
        const exhaustedWithFulfilledRoute =
            server.state === 'exhausted' &&
            server.destinations.some(
                (destination) =>
                    destination.destination_kind !== 'table' &&
                    destination.outcome === 'fulfilled',
            );
        if (
            item.status === 'failed' &&
            (server.state === 'pending' || server.state === 'leased' || server.state === 'deferred')
        ) {
            // The owner retry RPC is the sole server transition out of exhausted.
            // Observing its nonterminal state safely re-arms this local row without
            // letting the immutable original terminal route overwrite a correction.
            return {
                ...item,
                completenessItemId: server.id ?? item.completenessItemId ?? null,
                status: 'queued',
                needsLook: false,
            };
        }
        if (
            item.status === 'failed' && server.state === 'exhausted' && server.id &&
            item.completenessItemId !== server.id &&
            !exhaustedWithFulfilledRoute
        ) {
            // Upgrade/resume safety: an older local manifest may already expose the
            // exhausted row without the queue id introduced by the status protocol.
            return { ...item, completenessItemId: server.id };
        }
        // The server snapshot describes the immutable original import route. Once
        // a row has left `queued`, the digest owns any later correction/unpin and
        // a polling tick must never restore the stale pre-edit route identities.
        if (item.status !== 'queued' && !(item.status === 'failed' && exhaustedWithFulfilledRoute)) {
            return item;
        }
        const wishlist = server.destinations.find(
            (destination) => destination.destination_kind === 'wishlist',
        );
        const list = server.destinations.find(
            (destination) =>
                destination.destination_kind === 'list' ||
                destination.destination_kind === 'new_list',
        );
        const listId = resultString(list?.result ?? null, 'list_id');
        if (listId) discoveredListId = listId;
        const restaurantId =
            server.restaurant_id ??
            resultString(wishlist?.result ?? null, 'restaurant_id') ??
            resultString(list?.result ?? null, 'restaurant_id') ??
            item.restaurant_id ??
            null;

        if (server.state === 'verified' || server.state === 'resolved') {
            const expectsWishlist = job.pinAll;
            const expectsList = job.destListTitle != null;
            const routesHydrated =
                (!expectsWishlist || terminalRouteIsHydrated(wishlist, 'wishlist_id')) &&
                (!expectsList || terminalRouteIsHydrated(list, 'list_id'));

            // Queue terminalization and route acknowledgement are separate database
            // transactions, and the status endpoint's reads can observe them through
            // different snapshots. Keep the row non-actionable until every expected
            // route is terminal and every fulfilled route exposes its live id.
            if (!routesHydrated) {
                return {
                    ...item,
                    completenessItemId: server.id ?? item.completenessItemId ?? null,
                    status: 'queued',
                    restaurant_id: restaurantId,
                    needsLook: false,
                };
            }
            const wishlistStatus = resultString(wishlist?.result ?? null, 'status');
            const hasListDestination = job.destListTitle != null;
            const listRouted = hasListDestination ? list?.outcome === 'fulfilled' : item.listRouted;
            const rejected = server.destinations.some(
                (destination) => destination.outcome === 'rejected',
            );
            return {
                ...item,
                completenessItemId: server.id ?? item.completenessItemId ?? null,
                status: wishlistStatus === 'already_pinned' ? 'already' : 'saved',
                restaurant_id: restaurantId,
                wishlist_id:
                    resultString(wishlist?.result ?? null, 'wishlist_id') ?? item.wishlist_id ?? null,
                listRouted,
                needsLook: rejected || (hasListDestination && listRouted !== true),
            };
        }
        if (server.state === 'exhausted') {
            if (exhaustedWithFulfilledRoute) {
                const hasListDestination = job.destListTitle != null;
                const listRouted = hasListDestination
                    ? list?.outcome === 'fulfilled'
                    : item.listRouted;
                return {
                    ...item,
                    completenessItemId: server.id ?? item.completenessItemId ?? null,
                    status: 'ghost',
                    restaurant_id: restaurantId,
                    wishlist_id:
                        resultString(wishlist?.result ?? null, 'wishlist_id') ??
                        item.wishlist_id ??
                        null,
                    listRouted,
                    needsLook: true,
                };
            }
            return {
                ...item,
                completenessItemId: server.id ?? item.completenessItemId ?? null,
                status: 'failed',
                restaurant_id: restaurantId,
                needsLook: true,
            };
        }
        return {
            ...item,
            completenessItemId: server.id ?? item.completenessItemId ?? null,
            status: 'queued',
            restaurant_id: restaurantId,
            needsLook: false,
        };
    });
    return { ...job, items, destListId: discoveredListId };
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
        ghostDegraded: false,
        resolvedChunk: null,
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
            r.status === 'queued' ||
            r.status === 'already' ||
            r.status === 'ghost' ||
            r.status === 'failed'
                ? r.status
                : 'pending';
        items.push({
            name: r.name,
            address: typeof r.address === 'string' ? r.address : null,
            client_nonce: r.client_nonce,
            resolution_id: typeof r.resolution_id === 'string' ? r.resolution_id : null,
            completenessItemId:
                typeof r.completenessItemId === 'string' ? r.completenessItemId : null,
            status,
            restaurant_id: typeof r.restaurant_id === 'string' ? r.restaurant_id : null,
            wishlist_id: typeof r.wishlist_id === 'string' ? r.wishlist_id : null,
            restaurant_name: typeof r.restaurant_name === 'string' ? r.restaurant_name : null,
            restaurant_city: typeof r.restaurant_city === 'string' ? r.restaurant_city : null,
            external_id: typeof r.external_id === 'string' ? r.external_id : null,
            needsLook: r.needsLook === true,
            listRouted: r.listRouted === true ? true : undefined,
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

    // P2 — the resolve checkpoint: keep only a well-formed one (numeric cursor +
    // results whose entries at least carry the string client_nonce join key —
    // buildResolvedSpots reads every other field through ?? fallbacks). Anything
    // malformed ⇒ null ⇒ the chunk simply re-resolves.
    const resolvedChunk = ((): ResolvedChunkCheckpoint | null => {
        const rc = o.resolvedChunk;
        if (!rc || typeof rc !== 'object') return null;
        const r = rc as Record<string, unknown>;
        if (typeof r.cursor !== 'number' || !Number.isFinite(r.cursor)) return null;
        if (!Array.isArray(r.results)) return null;
        const results = r.results.filter(
            (x): x is ResolveSpotResult =>
                !!x &&
                typeof x === 'object' &&
                typeof (x as { client_nonce?: unknown }).client_nonce === 'string',
        );
        return { cursor: Math.floor(r.cursor), results, ghostMode: r.ghostMode === true };
    })();

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
        ghostDegraded: o.ghostDegraded === true,
        resolvedChunk,
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

/**
 * THE digest-exception predicate — shared by `deriveCounts` and
 * `partitionDigest` so the header/toast tallies always match the sections.
 * Exceptions: ghosts, per-spot save failures, and anything explicitly flagged
 * `needsLook` (e.g. a saved-but-unrouted item after the P1 reconcile).
 */
export function isExceptionItem(
    it: Pick<LargeImportJobItem, 'status' | 'needsLook'>,
): boolean {
    return it.needsLook === true || it.status === 'ghost' || it.status === 'failed';
}

export interface LargeJobCounts {
    total: number;
    pending: number;
    /** Accepted by v2 but not yet terminal in the completeness worker. */
    queued: number;
    /** saved/already AND clean — the digest "imported" tally (exceptions excluded,
     *  so a saved-but-unrouted item counts under needsLook, not here — P1c). */
    imported: number;
    ghosted: number;
    failed: number;
    /** Everything `isExceptionItem` — the digest "need a look" tally. */
    needsLook: number;
}

export function deriveCounts(items: LargeImportJobItem[]): LargeJobCounts {
    let pending = 0;
    let queued = 0;
    let imported = 0;
    let ghosted = 0;
    let failed = 0;
    let needsLook = 0;
    for (const it of items) {
        if (it.status === 'pending') pending++;
        else if (it.status === 'queued') queued++;
        else if (it.status === 'ghost') ghosted++;
        else if (it.status === 'failed') failed++;
        if (isExceptionItem(it)) needsLook++;
        else if (it.status === 'saved' || it.status === 'already') imported++;
    }
    return { total: items.length, pending, queued, imported, ghosted, failed, needsLook };
}

// ── The reducer: fold one chunk's resolve+save outcomes into the item list ──────

/** Per-item outcome the drain zips from resolve_spots + save_spots (by nonce). */
export interface ChunkItemOutcome {
    client_nonce: string;
    resolution_id?: string | null;
    /** true ⇒ no VERIFIED Places match (similarity-gate miss, or degraded/killed). */
    ghost: boolean;
    /** save_spots per-spot status. */
    saveStatus: 'saved' | 'already_pinned' | 'queued' | 'ghost' | 'failed';
    restaurant_id?: string | null;
    wishlist_id?: string | null;
    restaurant_name?: string | null;
    restaurant_city?: string | null;
    external_id?: string | null;
    /** P1 — whether this chunk's destination-list add_entries succeeded for the
     *  item (set via `applyListRouting`; absent when the job has no dest list). */
    listRouted?: boolean;
}

/** V2 save responses do not expose route row ids; keep rows non-actionable
 * until the owner-scoped status endpoint hydrates the authoritative ledger. */
export function awaitCompletenessLedger(
    outcomes: ChunkItemOutcome[],
): ChunkItemOutcome[] {
    return outcomes.map((outcome) => ({ ...outcome, saveStatus: 'queued' }));
}

function resolveItemStatus(o: ChunkItemOutcome): {
    status: LargeJobItemStatus;
    needsLook: boolean;
} {
    if (o.saveStatus === 'queued') return { status: 'queued', needsLook: false };
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
            resolution_id: o.resolution_id ?? it.resolution_id ?? null,
            wishlist_id: o.wishlist_id ?? it.wishlist_id ?? null,
            restaurant_name: o.restaurant_name ?? it.restaurant_name ?? it.name,
            restaurant_city: o.restaurant_city ?? it.restaurant_city ?? null,
            external_id: o.external_id ?? it.external_id ?? null,
            // Monotonic once true — a resume's failed re-add must never unroute
            // an item that already landed in the list (add_entries is idempotent,
            // so the first success is the durable truth).
            listRouted:
                o.listRouted === true || it.listRouted === true
                    ? true
                    : (o.listRouted ?? it.listRouted),
        };
    });
}

// ── Chunk zip: resolve_spots + save_spots results → per-item outcomes ───────────
// CHUNK-AUTHORITATIVE no-drop discipline: every helper below iterates the CHUNK
// (never the results), so an item missing from a response degrades explicitly
// (ghost / failed) instead of silently vanishing — the AC-1 hazard.

/** A ghost save_spots input built from an enumerated item (external_id null →
 *  the server mints a deterministic ghost row keyed on (user, client_nonce)). */
export function ghostSpot(it: LargeImportJobItem): LargeImportSpotInput {
    return {
        candidate_id: it.client_nonce,
        client_nonce: it.client_nonce,
        resolution_id: it.resolution_id ?? null,
        restaurant_id: null,
        external_id: null,
        restaurant_name: it.name,
        restaurant_city: it.restaurant_city ?? null,
        table_id: null,
        table_client_nonce: null,
        place: {
            external_id: null,
            name: it.name,
            location: { address: it.address ?? undefined },
        },
    };
}

/** Build save_spots input from resolve_spots results — iterate the CHUNK
 *  (authoritative), look up by nonce, and ghost-save any defensively-missing
 *  result rather than dropping it. Legacy omits explicit server type rejects;
 *  v2 can ledger their terminal provenance without pinning a ghost venue. */
export function buildResolvedSpots(
    results: ResolveSpotResult[],
    chunk: LargeImportJobItem[],
    preserveRejectedForCompleteness = false,
): LargeImportSpotInput[] {
    const byNonce = new Map(results.map((r) => [r.client_nonce, r]));
    return chunk.flatMap((it): LargeImportSpotInput[] => {
        const r = byNonce.get(it.client_nonce);
        // Legacy intentionally omits scene-noise/type-rejected candidates. V2
        // must nevertheless ledger the enumerated item so its frozen exact
        // destination count can seal. Its server-owned no_result provenance
        // makes the completeness worker exhaust it without creating a pin.
        if (r?.type_rejected === true && !preserveRejectedForCompleteness) return [];
        if (!r) return [ghostSpot(it)];
        return [{
            candidate_id: r.candidate_id ?? it.client_nonce,
            client_nonce: it.client_nonce,
            resolution_id: r.resolution_id ?? null,
            restaurant_id: r.restaurant_id ?? null,
            external_id: r.external_id ?? null,
            restaurant_name: r.restaurant_name ?? it.name,
            restaurant_city: r.restaurant_city ?? null,
            table_id: null,
            table_client_nonce: null,
            place: r.place ?? null,
        }];
    });
}

/** Every item in the chunk as a ghost save (budget-degrade / kill-switch path). */
export function buildGhostSpots(chunk: LargeImportJobItem[]): LargeImportSpotInput[] {
    return chunk.map(ghostSpot);
}

/** Zip resolve (ghost flag + names) + save (status + ids) into the reducer's
 *  outcome, keyed by client_nonce. `forceGhost` for the budget/kill-switch path
 *  (no resolve ran). A missing save result ⇒ 'failed' (needsLook), never a drop. */
export function toChunkOutcomes(
    chunk: LargeImportJobItem[],
    resolveResults: ResolveSpotResult[],
    saveResult: LargeSaveResult | null,
    forceGhost: boolean,
): ChunkItemOutcome[] {
    const resolveByNonce = new Map(resolveResults.map((r) => [r.client_nonce, r]));
    const saveByNonce = new Map((saveResult?.results ?? []).map((r) => [r.client_nonce, r]));
    return chunk.map((it) => {
        const rr = resolveByNonce.get(it.client_nonce);
        const sr = saveByNonce.get(it.client_nonce);
        return {
            client_nonce: it.client_nonce,
            resolution_id: rr?.resolution_id ?? it.resolution_id ?? null,
            ghost: forceGhost || (rr?.ghost ?? true),
            saveStatus: sr?.status ?? 'failed',
            restaurant_id: sr?.restaurant_id ?? rr?.restaurant_id ?? null,
            wishlist_id: sr?.wishlist_id ?? null,
            restaurant_name: rr?.restaurant_name ?? it.name,
            restaurant_city: rr?.restaurant_city ?? it.restaurant_city ?? null,
            external_id: rr?.external_id ?? null,
        };
    });
}

// ── Destination-list routing state (P1 — never silently drop from the list) ─────

/** Stamp a chunk's outcomes with whether their add_entries call succeeded.
 *  Only items that CAN be routed (restaurant_id) carry the flag. */
export function applyListRouting(
    outcomes: ChunkItemOutcome[],
    routed: boolean,
): ChunkItemOutcome[] {
    return outcomes.map((o) => (o.restaurant_id ? { ...o, listRouted: routed } : o));
}

/** Items that should be in the destination list but aren't yet (routable —
 *  restaurant_id known — and never successfully added). The reconcile's input.
 *  Callers gate on the job HAVING a destination list. */
export function pendingListRoutes(items: LargeImportJobItem[]): LargeImportJobItem[] {
    return items.filter((it) => it.restaurant_id != null && it.listRouted !== true);
}

/** Mark every item whose restaurant_id was in a successful (re-)add batch. */
export function markListRouted(
    items: LargeImportJobItem[],
    routedRestaurantIds: ReadonlySet<string>,
): LargeImportJobItem[] {
    return items.map((it) =>
        it.restaurant_id != null && routedRestaurantIds.has(it.restaurant_id)
            ? { ...it, listRouted: true }
            : it,
    );
}

/** P1b — items STILL unrouted after the completion reconcile become digest
 *  exceptions (`needsLook`) so they never vanish from every user surface.
 *  Callers gate on the job HAVING a destination list. */
export function markUnroutedNeedsLook(items: LargeImportJobItem[]): LargeImportJobItem[] {
    return items.map((it) =>
        it.restaurant_id != null && it.listRouted !== true
            ? { ...it, needsLook: true }
            : it,
    );
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

/** Split the drained items into digest sections: exceptions first, then imported.
 *  Uses the SAME `isExceptionItem` predicate as `deriveCounts`, so the header
 *  tallies always match the section contents (P1c). */
export function partitionDigest(items: LargeImportJobItem[]): {
    exceptions: LargeImportJobItem[];
    completing: LargeImportJobItem[];
    imported: LargeImportJobItem[];
} {
    const exceptions: LargeImportJobItem[] = [];
    const completing: LargeImportJobItem[] = [];
    const imported: LargeImportJobItem[] = [];
    for (const it of items) {
        if (isExceptionItem(it)) {
            exceptions.push(it);
        } else if (it.status === 'queued') {
            completing.push(it);
        } else if (it.status === 'saved' || it.status === 'already') {
            imported.push(it);
        }
        // 'pending' items (shouldn't exist post-drain) fall through — shown nowhere.
    }
    return { exceptions, completing, imported };
}

/**
 * M2 — the digest's row affordances branch on wishlist_id: a PINNED spot
 * (wishlist_id != null) gets replace·unpin·remove; a LIST-ONLY spot
 * (wishlist_id == null) gets replace·remove ("unpin" is meaningless).
 */
export function isPinnedItem(item: Pick<LargeImportJobItem, 'wishlist_id'>): boolean {
    return item.wishlist_id != null;
}
