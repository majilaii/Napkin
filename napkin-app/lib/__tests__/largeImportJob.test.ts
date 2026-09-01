/**
 * largeImportJob — pure job-state units (TICKET-152 Phase B test plan).
 *
 * Covers chunk math, the resolve+save reducer, resume idempotency, the
 * 429-vs-503 branch, ghost-degradation marking, the digest partition +
 * affordance branch, the completion guard, and the defensive manifest parse.
 */
import {
    LARGE_JOB_CHUNK_SIZE,
    LARGE_JOB_MAX_CHUNK_ATTEMPTS,
    buildLargeJob,
    normalizeLargeJob,
    isLargeListEnumeration,
    chunkBounds,
    chunkCount,
    isDrained,
    deriveCounts,
    applyChunkOutcomes,
    applyListRouting,
    pendingListRoutes,
    markListRouted,
    markUnroutedNeedsLook,
    ghostSpot,
    buildResolvedSpots,
    buildGhostSpots,
    toChunkOutcomes,
    awaitCompletenessLedger,
    shouldEmitCompletion,
    classifyDrainError,
    partitionDigest,
    reconcileLargeJobCompleteness,
    isExceptionItem,
    isPinnedItem,
    type LargeImportJob,
    type LargeImportJobItem,
    type ChunkItemOutcome,
    type ResolveSpotResult,
    type LargeSaveResult,
} from '../largeImportJob';

// ── helpers ─────────────────────────────────────────────────────────────────
function mkItems(n: number): LargeImportJobItem[] {
    return Array.from({ length: n }, (_, i) => ({
        name: `Spot ${i}`,
        address: `${i} Main St`,
        client_nonce: `nonce-${i}`,
        status: 'pending' as const,
    }));
}

function mkJob(overrides: Partial<LargeImportJob> = {}): LargeImportJob {
    return {
        title: 'Best pies',
        listCount: 3,
        items: mkItems(3),
        cursor: 0,
        chunkSize: LARGE_JOB_CHUNK_SIZE,
        chunkAttempts: 0,
        phase: 'running',
        pinAll: true,
        destListTitle: 'Best pies',
        destListId: null,
        serverJobId: null,
        completionEmitted: false,
        ghostDegraded: false,
        resolvedChunk: null,
        ...overrides,
    };
}

function mkResolveResult(i: number, over: Partial<ResolveSpotResult> = {}): ResolveSpotResult {
    return {
        client_nonce: `nonce-${i}`,
        candidate_id: `cand-${i}`,
        restaurant_id: null,
        external_id: `ChIJ-${i}`,
        restaurant_name: `Resolved ${i}`,
        restaurant_city: 'Sydney',
        place: { external_id: `ChIJ-${i}`, name: `Resolved ${i}` },
        ghost: false,
        ...over,
    };
}

function mkSaveResult(
    entries: { i: number; status: 'saved' | 'already_pinned' | 'ghost' | 'failed'; wishlist_id?: string | null; restaurant_id?: string | null }[],
): LargeSaveResult {
    return {
        results: entries.map((e) => ({
            candidate_id: `cand-${e.i}`,
            client_nonce: `nonce-${e.i}`,
            status: e.status,
            wishlist_id: e.wishlist_id ?? null,
            restaurant_id: e.restaurant_id ?? null,
        })),
        summary: { saved: 0, already_pinned: 0, failed: 0 },
        job_id: null,
    };
}

// ── enumeration → job ─────────────────────────────────────────────────────────
describe('isLargeListEnumeration', () => {
    it('detects mode:large_list with items[]', () => {
        expect(isLargeListEnumeration({ mode: 'large_list', items: [] })).toBe(true);
    });
    it('rejects normal candidate responses and junk', () => {
        expect(isLargeListEnumeration({ candidates: [] })).toBe(false);
        expect(isLargeListEnumeration({ mode: 'large_list' })).toBe(false); // no items[]
        expect(isLargeListEnumeration(null)).toBe(false);
        expect(isLargeListEnumeration(undefined)).toBe(false);
    });
});

describe('buildLargeJob', () => {
    it('freezes distinct nonces, defaults pinAll ON, phase kickoff, cursor 0', () => {
        const job = buildLargeJob({
            title: 'Sydney',
            items: [
                { name: 'A', address: '1 St' },
                { name: 'B', address: null },
            ],
            list_count: 117,
        });
        expect(job.phase).toBe('kickoff');
        expect(job.pinAll).toBe(true);
        expect(job.cursor).toBe(0);
        expect(job.completionEmitted).toBe(false);
        expect(job.ghostDegraded).toBe(false);
        expect(job.resolvedChunk).toBeNull();
        expect(job.destListTitle).toBe('Sydney'); // default = title
        expect(job.listCount).toBe(117); // honest denominator, NOT items.length
        expect(job.items).toHaveLength(2);
        expect(job.items[0].client_nonce).toBeTruthy();
        expect(job.items[0].client_nonce).not.toBe(job.items[1].client_nonce);
        expect(job.items.every((i) => i.status === 'pending')).toBe(true);
        expect(job.items[1].address).toBeNull();
    });
    it('falls listCount back to items.length when list_count absent', () => {
        const job = buildLargeJob({ title: null, items: [{ name: 'A', address: null }] });
        expect(job.listCount).toBe(1);
        expect(job.destListTitle).toBeNull();
    });
});

// ── chunk math ──────────────────────────────────────────────────────────────
describe('chunk math', () => {
    it('chunkCount partitions N into ceil(N/20), remainder last', () => {
        expect(chunkCount(0)).toBe(0);
        expect(chunkCount(20)).toBe(1);
        expect(chunkCount(21)).toBe(2);
        expect(chunkCount(117)).toBe(6); // 5×20 + 17
        expect(chunkCount(500)).toBe(25);
    });
    it('chunkBounds yields the [cursor, cursor+20) window clamped to len', () => {
        expect(chunkBounds(0, 117)).toEqual({ start: 0, end: 20 });
        expect(chunkBounds(100, 117)).toEqual({ start: 100, end: 117 }); // remainder
        expect(chunkBounds(117, 117)).toEqual({ start: 117, end: 117 }); // drained
        expect(chunkBounds(-5, 10)).toEqual({ start: 0, end: 10 }); // clamps negative
        expect(chunkBounds(999, 10)).toEqual({ start: 10, end: 10 }); // clamps past-end
    });
    it('isDrained is true only at/after the end', () => {
        expect(isDrained({ cursor: 0, items: mkItems(3) })).toBe(false);
        expect(isDrained({ cursor: 2, items: mkItems(3) })).toBe(false);
        expect(isDrained({ cursor: 3, items: mkItems(3) })).toBe(true);
    });
});

// ── the reducer ─────────────────────────────────────────────────────────────
describe('applyChunkOutcomes', () => {
    it('maps saved/already/ghost/failed by nonce and sets needsLook', () => {
        const items = mkItems(4);
        const outcomes: ChunkItemOutcome[] = [
            { client_nonce: 'nonce-0', ghost: false, saveStatus: 'saved', restaurant_id: 'r0', wishlist_id: 'w0', restaurant_name: 'Zero' },
            { client_nonce: 'nonce-1', ghost: false, saveStatus: 'already_pinned', restaurant_id: 'r1', wishlist_id: 'w1' },
            { client_nonce: 'nonce-2', ghost: true, saveStatus: 'ghost', restaurant_id: 'r2', wishlist_id: null },
            { client_nonce: 'nonce-3', ghost: false, saveStatus: 'failed' },
        ];
        const next = applyChunkOutcomes(items, outcomes);
        expect(next[0]).toMatchObject({ status: 'saved', needsLook: false, restaurant_id: 'r0', wishlist_id: 'w0', restaurant_name: 'Zero' });
        expect(next[1]).toMatchObject({ status: 'already', needsLook: false, wishlist_id: 'w1' });
        expect(next[2]).toMatchObject({ status: 'ghost', needsLook: true, restaurant_id: 'r2', wishlist_id: null });
        expect(next[3]).toMatchObject({ status: 'failed', needsLook: true });
    });

    it('marks a PINNED ghost (pinAll: save=saved but ghost=true) as ghost+needsLook, keeping wishlist_id', () => {
        const items = mkItems(1);
        const next = applyChunkOutcomes(items, [
            { client_nonce: 'nonce-0', ghost: true, saveStatus: 'saved', restaurant_id: 'r0', wishlist_id: 'w0' },
        ]);
        expect(next[0].status).toBe('ghost');
        expect(next[0].needsLook).toBe(true);
        expect(next[0].wishlist_id).toBe('w0'); // still pinned → digest shows unpin
    });

    it('leaves items absent from the chunk untouched', () => {
        const items = mkItems(3);
        const next = applyChunkOutcomes(items, [
            { client_nonce: 'nonce-0', ghost: false, saveStatus: 'saved', restaurant_id: 'r0' },
        ]);
        expect(next[1].status).toBe('pending');
        expect(next[2].status).toBe('pending');
    });

    it('resume idempotency: re-applying an already-saved chunk keeps ids, no dup, already status', () => {
        const items = mkItems(2);
        const first = applyChunkOutcomes(items, [
            { client_nonce: 'nonce-0', ghost: false, saveStatus: 'saved', restaurant_id: 'r0', wishlist_id: 'w0', restaurant_name: 'Zero' },
            { client_nonce: 'nonce-1', ghost: false, saveStatus: 'saved', restaurant_id: 'r1', wishlist_id: 'w1' },
        ]);
        // Re-drain lands already_pinned WITHOUT re-carrying wishlist_id (RPC may omit it).
        const second = applyChunkOutcomes(first, [
            { client_nonce: 'nonce-0', ghost: false, saveStatus: 'already_pinned', restaurant_id: 'r0' },
            { client_nonce: 'nonce-1', ghost: false, saveStatus: 'already_pinned', restaurant_id: 'r1' },
        ]);
        expect(second[0]).toMatchObject({ status: 'already', restaurant_id: 'r0', wishlist_id: 'w0', restaurant_name: 'Zero' });
        expect(second[1]).toMatchObject({ status: 'already', wishlist_id: 'w1' });
        expect(second).toHaveLength(2); // never grows
    });
});

// ── derived counts ──────────────────────────────────────────────────────────
describe('deriveCounts', () => {
    it('imported = saved+already, needsLook = ghost+failed', () => {
        const items: LargeImportJobItem[] = [
            { name: 'a', address: null, client_nonce: '0', status: 'saved' },
            { name: 'b', address: null, client_nonce: '1', status: 'already' },
            { name: 'c', address: null, client_nonce: '2', status: 'ghost' },
            { name: 'd', address: null, client_nonce: '3', status: 'failed' },
            { name: 'e', address: null, client_nonce: '4', status: 'pending' },
        ];
        expect(deriveCounts(items)).toEqual({
            total: 5,
            pending: 1,
            queued: 0,
            imported: 2,
            ghosted: 1,
            failed: 1,
            needsLook: 2,
        });
    });
    it('all-clean: needsLook 0', () => {
        const items: LargeImportJobItem[] = mkItems(3).map((i) => ({ ...i, status: 'saved' }));
        expect(deriveCounts(items).needsLook).toBe(0);
        expect(deriveCounts(items).imported).toBe(3);
    });
    it('keeps accepted deferred items out of both imported and needs-look', () => {
        const counts = deriveCounts([
            { name: 'later', address: null, client_nonce: 'q', status: 'queued' },
        ]);
        expect(counts).toMatchObject({ queued: 1, imported: 0, needsLook: 0 });
    });
});

// ── completion guard (L1) ───────────────────────────────────────────────────
describe('shouldEmitCompletion', () => {
    it('true only when drained AND not already emitted', () => {
        expect(shouldEmitCompletion({ cursor: 3, items: mkItems(3), completionEmitted: false })).toBe(true);
    });
    it('false when not drained', () => {
        expect(shouldEmitCompletion({ cursor: 2, items: mkItems(3), completionEmitted: false })).toBe(false);
    });
    it('false when already emitted (resume never re-fires the bell)', () => {
        expect(shouldEmitCompletion({ cursor: 3, items: mkItems(3), completionEmitted: true })).toBe(false);
    });
});

// ── 429-vs-503 branch (M3) ──────────────────────────────────────────────────
describe('classifyDrainError', () => {
    it('429 → budget (ghost-degrade the rest)', () => {
        expect(classifyDrainError(429, false)).toBe('budget');
    });
    it('503 → transient (pause+resume, NEVER ghost-degrade)', () => {
        expect(classifyDrainError(503, false)).toBe('transient');
    });
    it('other 5xx + network death → transient', () => {
        expect(classifyDrainError(500, false)).toBe('transient');
        expect(classifyDrainError(502, false)).toBe('transient');
        expect(classifyDrainError(undefined, false)).toBe('transient');
    });
    it('session error → transient', () => {
        expect(classifyDrainError(401, true)).toBe('transient');
    });
    it('a real 4xx (not 429) → deterministic (poison)', () => {
        expect(classifyDrainError(400, false)).toBe('deterministic');
        expect(classifyDrainError(404, false)).toBe('deterministic');
    });
});

// ── ghost-degradation marking (429/kill-switch → remaining ghost+needsLook) ──
describe('ghost-degradation reduces remaining items to ghost+needsLook', () => {
    it('forced ghost outcomes mark items ghost+needsLook even when save succeeds', () => {
        const items = mkItems(3);
        // budget exhausted → the drain ghost-saves with ghost:true on every item.
        const outcomes: ChunkItemOutcome[] = items.map((it) => ({
            client_nonce: it.client_nonce,
            ghost: true,
            saveStatus: 'ghost',
            restaurant_id: `ghost-${it.client_nonce}`,
            wishlist_id: null,
        }));
        const next = applyChunkOutcomes(items, outcomes);
        expect(next.every((i) => i.status === 'ghost' && i.needsLook === true)).toBe(true);
        expect(deriveCounts(next).needsLook).toBe(3);
    });
});

// ── digest partition + affordance branch (M2) ───────────────────────────────
describe('partitionDigest', () => {
    it('exceptions first (ghost/failed/needsLook), imported below (saved/already)', () => {
        const items: LargeImportJobItem[] = [
            { name: 'ok', address: null, client_nonce: '0', status: 'saved' },
            { name: 'ghost', address: null, client_nonce: '1', status: 'ghost', needsLook: true },
            { name: 'again', address: null, client_nonce: '2', status: 'already' },
            { name: 'bad', address: null, client_nonce: '3', status: 'failed', needsLook: true },
        ];
        const { exceptions, imported } = partitionDigest(items);
        expect(exceptions.map((i) => i.name)).toEqual(['ghost', 'bad']);
        expect(imported.map((i) => i.name)).toEqual(['ok', 'again']);
    });
    it('drops leftover pending items from both sections', () => {
        const { exceptions, imported } = partitionDigest([
            { name: 'p', address: null, client_nonce: '0', status: 'pending' },
        ]);
        expect(exceptions).toHaveLength(0);
        expect(imported).toHaveLength(0);
    });
    it('renders queued items in the completing section only', () => {
        const sections = partitionDigest([
            { name: 'later', address: null, client_nonce: 'q', status: 'queued' },
        ]);
        expect(sections.completing.map((item) => item.name)).toEqual(['later']);
        expect(sections.exceptions).toHaveLength(0);
        expect(sections.imported).toHaveLength(0);
    });
});

describe('isPinnedItem', () => {
    it('true when wishlist_id set, false when null (list-only)', () => {
        expect(isPinnedItem({ wishlist_id: 'w0' })).toBe(true);
        expect(isPinnedItem({ wishlist_id: null })).toBe(false);
        expect(isPinnedItem({ wishlist_id: undefined })).toBe(false);
    });
});

// ── defensive manifest parse (old manifests keep working; cursor clamp) ──────
describe('normalizeLargeJob', () => {
    it('returns undefined for non-job blobs (⇒ single-shot manifest, verbatim)', () => {
        expect(normalizeLargeJob(undefined)).toBeUndefined();
        expect(normalizeLargeJob(null)).toBeUndefined();
        expect(normalizeLargeJob({})).toBeUndefined(); // no items[]
        expect(normalizeLargeJob({ items: 'nope' })).toBeUndefined();
    });
    it('round-trips a valid job and defaults pinAll ON', () => {
        const job = mkJob({ cursor: 1, pinAll: undefined as unknown as boolean });
        const parsed = normalizeLargeJob(JSON.parse(JSON.stringify(job)));
        expect(parsed?.cursor).toBe(1);
        expect(parsed?.pinAll).toBe(true); // absent → default true
        expect(parsed?.items).toHaveLength(3);
    });
    it('clamps an out-of-range cursor into [0, items.length]', () => {
        const parsed = normalizeLargeJob({ items: mkItems(3), cursor: 999 });
        expect(parsed?.cursor).toBe(3);
        const parsedNeg = normalizeLargeJob({ items: mkItems(3), cursor: -4 });
        expect(parsedNeg?.cursor).toBe(0);
    });
    it('drops malformed items (missing name / client_nonce) but keeps valid ones', () => {
        const parsed = normalizeLargeJob({
            items: [
                { name: 'good', address: '1 St', client_nonce: 'n0', status: 'saved' },
                { address: 'no name', client_nonce: 'n1' },
                { name: 'no nonce' },
                'garbage',
            ],
        });
        expect(parsed?.items).toHaveLength(1);
        expect(parsed?.items[0]).toMatchObject({ name: 'good', status: 'saved' });
    });
    it('coerces an unknown status/phase to safe defaults', () => {
        const parsed = normalizeLargeJob({
            items: [{ name: 'x', client_nonce: 'n0', status: 'bogus' }],
            phase: 'nope',
        });
        expect(parsed?.items[0].status).toBe('pending');
        expect(parsed?.phase).toBe('kickoff');
    });
    it('pinAll survives an explicit false (list-only)', () => {
        const parsed = normalizeLargeJob({ items: mkItems(1), pinAll: false });
        expect(parsed?.pinAll).toBe(false);
    });
    it('parses ghostDegraded (default false) and item listRouted (default absent)', () => {
        const on = normalizeLargeJob({ items: mkItems(1), ghostDegraded: true });
        expect(on?.ghostDegraded).toBe(true);
        const off = normalizeLargeJob({ items: mkItems(1) });
        expect(off?.ghostDegraded).toBe(false);
        const routed = normalizeLargeJob({
            items: [{ name: 'x', client_nonce: 'n0', listRouted: true }],
        });
        expect(routed?.items[0].listRouted).toBe(true);
        const notRouted = normalizeLargeJob({
            items: [{ name: 'x', client_nonce: 'n0', listRouted: 'yes' }],
        });
        expect(notRouted?.items[0].listRouted).toBeUndefined();
    });
    it('round-trips a resolve checkpoint; drops a malformed one (chunk re-resolves)', () => {
        const ckpt = { cursor: 2, results: [mkResolveResult(2)], ghostMode: false };
        const parsed = normalizeLargeJob({ items: mkItems(3), cursor: 2, resolvedChunk: ckpt });
        expect(parsed?.resolvedChunk).toEqual(ckpt);
        // Malformed shapes → null (never crash; the drain just re-resolves).
        expect(normalizeLargeJob({ items: mkItems(1), resolvedChunk: 'junk' })?.resolvedChunk).toBeNull();
        expect(
            normalizeLargeJob({ items: mkItems(1), resolvedChunk: { cursor: 'x', results: [] } })
                ?.resolvedChunk,
        ).toBeNull();
        expect(
            normalizeLargeJob({ items: mkItems(1), resolvedChunk: { cursor: 0, results: 'x' } })
                ?.resolvedChunk,
        ).toBeNull();
        // Result entries without the client_nonce join key are dropped.
        const dirty = normalizeLargeJob({
            items: mkItems(1),
            resolvedChunk: { cursor: 0, results: [mkResolveResult(0), { ghost: true }, null], ghostMode: true },
        });
        expect(dirty?.resolvedChunk?.results).toHaveLength(1);
        expect(dirty?.resolvedChunk?.ghostMode).toBe(true);
    });
});

// ── chunk zip (chunk-authoritative no-drop — the AC-1 core) ──────────────────
describe('buildResolvedSpots / ghostSpot / buildGhostSpots', () => {
    it('missing resolve result → ghost spot input (external_id null), never a drop', () => {
        const chunk = mkItems(2);
        const spots = buildResolvedSpots([mkResolveResult(0)], chunk);
        expect(spots).toHaveLength(2); // one per chunk item unless server explicitly type-rejects it
        expect(spots[0]).toMatchObject({
            client_nonce: 'nonce-0',
            external_id: 'ChIJ-0',
            restaurant_name: 'Resolved 0',
        });
        // Item 1 had no result → ghost-saved from the enumerated fields.
        expect(spots[1]).toMatchObject({
            client_nonce: 'nonce-1',
            external_id: null,
            restaurant_id: null,
            restaurant_name: 'Spot 1',
        });
    });
    it('zips by client_nonce, never by array index', () => {
        const chunk = mkItems(2);
        // Results arrive reversed — nonce join must still land each correctly.
        const spots = buildResolvedSpots([mkResolveResult(1), mkResolveResult(0)], chunk);
        expect(spots[0].external_id).toBe('ChIJ-0');
        expect(spots[1].external_id).toBe('ChIJ-1');
    });
    it('explicit type rejection is omitted from save input, never ghost-staged', () => {
        const chunk = mkItems(2);
        const rejected = mkResolveResult(0, {
            external_id: null,
            place: { type_rejected: true },
            type_rejected: true,
        });
        const spots = buildResolvedSpots([rejected, mkResolveResult(1)], chunk);

        expect(spots).toHaveLength(1);
        expect(spots[0].client_nonce).toBe('nonce-1');
        expect(spots.some((spot) => spot.client_nonce === 'nonce-0')).toBe(false);
    });
    it('an all-type-rejected chunk yields no save input', () => {
        const chunk = mkItems(2);
        const spots = buildResolvedSpots(
            chunk.map((_, i) => mkResolveResult(i, { type_rejected: true })),
            chunk,
        );
        expect(spots).toEqual([]);
    });
    it('v2 ledgers type-rejected items so the frozen destination count can seal', () => {
        const chunk = mkItems(2);
        const rejected = chunk.map((_, i) =>
            mkResolveResult(i, {
                external_id: null,
                place: { type_rejected: true },
                type_rejected: true,
                resolution_id: `resolution-${i}`,
            }),
        );
        const spots = buildResolvedSpots(rejected, chunk, true);

        expect(spots).toHaveLength(2);
        expect(spots).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    client_nonce: 'nonce-0',
                    external_id: null,
                    restaurant_id: null,
                    resolution_id: 'resolution-0',
                }),
                expect.objectContaining({
                    client_nonce: 'nonce-1',
                    external_id: null,
                    restaurant_id: null,
                    resolution_id: 'resolution-1',
                }),
            ]),
        );
    });
    it('ghostSpot pins table fields null and carries the address in place', () => {
        const g = ghostSpot(mkItems(1)[0]);
        expect(g).toMatchObject({
            candidate_id: 'nonce-0',
            client_nonce: 'nonce-0',
            table_id: null,
            table_client_nonce: null,
            external_id: null,
        });
        expect((g.place as { location?: { address?: string } }).location?.address).toBe('0 Main St');
    });
    it('buildGhostSpots ghosts the whole chunk', () => {
        const spots = buildGhostSpots(mkItems(3));
        expect(spots).toHaveLength(3);
        expect(spots.every((s) => s.external_id === null && s.restaurant_id === null)).toBe(true);
    });
});

describe('toChunkOutcomes (chunk-authoritative zip)', () => {
    it('missing resolve result → ghost:true', () => {
        const chunk = mkItems(2);
        const save = mkSaveResult([
            { i: 0, status: 'saved', restaurant_id: 'r0', wishlist_id: 'w0' },
            { i: 1, status: 'ghost', restaurant_id: 'g1' },
        ]);
        const outcomes = toChunkOutcomes(chunk, [mkResolveResult(0)], save, false);
        expect(outcomes).toHaveLength(2); // one per chunk item — always
        expect(outcomes[0]).toMatchObject({ ghost: false, saveStatus: 'saved', restaurant_id: 'r0' });
        expect(outcomes[1].ghost).toBe(true); // absent from resolve ⇒ ghost
    });
    it('missing save result → saveStatus failed (surfaces as needsLook), never a drop', () => {
        const chunk = mkItems(2);
        const save = mkSaveResult([{ i: 0, status: 'saved', restaurant_id: 'r0' }]);
        const outcomes = toChunkOutcomes(chunk, [mkResolveResult(0), mkResolveResult(1)], save, false);
        expect(outcomes[1].saveStatus).toBe('failed');
        const items = applyChunkOutcomes(chunk, outcomes);
        expect(items[1]).toMatchObject({ status: 'failed', needsLook: true });
    });
    it('forceGhost (budget/kill-switch) marks every outcome ghost', () => {
        const chunk = mkItems(2);
        const save = mkSaveResult([
            { i: 0, status: 'ghost', restaurant_id: 'g0' },
            { i: 1, status: 'ghost', restaurant_id: 'g1' },
        ]);
        const outcomes = toChunkOutcomes(chunk, [], save, true);
        expect(outcomes.every((o) => o.ghost && o.saveStatus === 'ghost')).toBe(true);
    });
    it('id fallback: save result wins, resolve second (restaurant_id)', () => {
        const chunk = mkItems(1);
        const rr = mkResolveResult(0, { restaurant_id: 'resolve-id' });
        const outFromSave = toChunkOutcomes(
            chunk,
            [rr],
            mkSaveResult([{ i: 0, status: 'saved', restaurant_id: 'save-id' }]),
            false,
        );
        expect(outFromSave[0].restaurant_id).toBe('save-id');
        const outFromResolve = toChunkOutcomes(chunk, [rr], mkSaveResult([]), false);
        expect(outFromResolve[0].restaurant_id).toBe('resolve-id');
    });
});

// ── list routing state (P1 — the destination list never silently drops) ──────
describe('list routing (P1)', () => {
    it('applyListRouting stamps only routable outcomes (restaurant_id known)', () => {
        const outcomes: ChunkItemOutcome[] = [
            { client_nonce: 'nonce-0', ghost: false, saveStatus: 'saved', restaurant_id: 'r0' },
            { client_nonce: 'nonce-1', ghost: false, saveStatus: 'failed', restaurant_id: null },
        ];
        const ok = applyListRouting(outcomes, true);
        expect(ok[0].listRouted).toBe(true);
        expect(ok[1].listRouted).toBeUndefined(); // unroutable — no flag
        const fail = applyListRouting(outcomes, false);
        expect(fail[0].listRouted).toBe(false);
    });

    it('route FAILURE → unrouted marker → reconcile helpers → needsLook → counted, not silently imported', () => {
        // A chunk saves fine but its add_entries fails (network blip).
        const items = mkItems(2);
        const outcomes = applyListRouting(
            [
                { client_nonce: 'nonce-0', ghost: false, saveStatus: 'saved', restaurant_id: 'r0', wishlist_id: 'w0' },
                { client_nonce: 'nonce-1', ghost: false, saveStatus: 'saved', restaurant_id: 'r1', wishlist_id: 'w1' },
            ],
            false, // ← the add_entries failed
        );
        const applied = applyChunkOutcomes(items, outcomes);
        expect(applied.every((i) => i.listRouted === false)).toBe(true);

        // The completion reconcile retries exactly these…
        expect(pendingListRoutes(applied).map((i) => i.client_nonce)).toEqual(['nonce-0', 'nonce-1']);

        // …the retry lands r0 but r1 fails again…
        const reconciled = markUnroutedNeedsLook(markListRouted(applied, new Set(['r0'])));
        expect(reconciled[0]).toMatchObject({ listRouted: true, needsLook: false, status: 'saved' });
        expect(reconciled[1]).toMatchObject({ needsLook: true, status: 'saved' });

        // …and the survivor is COUNTED and SURFACED, never silently dropped.
        expect(isExceptionItem(reconciled[1])).toBe(true);
        const counts = deriveCounts(reconciled);
        expect(counts.imported).toBe(1);
        expect(counts.needsLook).toBe(1);
        const { exceptions, imported } = partitionDigest(reconciled);
        expect(exceptions.map((i) => i.client_nonce)).toEqual(['nonce-1']);
        expect(imported.map((i) => i.client_nonce)).toEqual(['nonce-0']);
    });

    it('route success marks listRouted true and stays clean', () => {
        const items = mkItems(1);
        const applied = applyChunkOutcomes(
            items,
            applyListRouting(
                [{ client_nonce: 'nonce-0', ghost: false, saveStatus: 'saved', restaurant_id: 'r0' }],
                true,
            ),
        );
        expect(applied[0].listRouted).toBe(true);
        expect(pendingListRoutes(applied)).toHaveLength(0);
        expect(markUnroutedNeedsLook(applied)[0].needsLook).toBe(false);
    });

    it('listRouted is monotonic — a resume with a failed re-add never unroutes', () => {
        const items = mkItems(1);
        const first = applyChunkOutcomes(
            items,
            applyListRouting(
                [{ client_nonce: 'nonce-0', ghost: false, saveStatus: 'saved', restaurant_id: 'r0' }],
                true,
            ),
        );
        expect(first[0].listRouted).toBe(true);
        // Resume re-applies the chunk; this time the (idempotent, so harmless)
        // re-add blips — the durable truth from the first success must survive.
        const second = applyChunkOutcomes(
            first,
            applyListRouting(
                [{ client_nonce: 'nonce-0', ghost: false, saveStatus: 'already_pinned', restaurant_id: 'r0' }],
                false,
            ),
        );
        expect(second[0].listRouted).toBe(true);
    });

    it('markUnroutedNeedsLook skips unroutable items (no restaurant_id)', () => {
        const items: LargeImportJobItem[] = [
            { name: 'x', address: null, client_nonce: '0', status: 'failed', restaurant_id: null },
        ];
        expect(markUnroutedNeedsLook(items)[0].needsLook).toBeUndefined();
    });
});

describe('deriveCounts × unrouted (P1c — header/toast include them)', () => {
    it('a saved-but-unrouted (needsLook) item counts under needsLook, not imported', () => {
        const items: LargeImportJobItem[] = [
            { name: 'a', address: null, client_nonce: '0', status: 'saved', listRouted: true },
            { name: 'b', address: null, client_nonce: '1', status: 'saved', needsLook: true, listRouted: false },
            { name: 'c', address: null, client_nonce: '2', status: 'ghost', needsLook: true },
        ];
        const c = deriveCounts(items);
        expect(c.imported).toBe(1);
        expect(c.needsLook).toBe(2); // unrouted + ghost — matches the digest sections
        expect(c.ghosted).toBe(1);
    });
});

describe('v2 completeness reconciliation', () => {
    it('keeps inline terminal responses non-actionable until route ids are hydrated', () => {
        const outcomes: ChunkItemOutcome[] = [{
            client_nonce: 'nonce-0',
            ghost: false,
            saveStatus: 'saved',
            restaurant_id: 'restaurant-0',
        }];
        expect(awaitCompletenessLedger(outcomes)).toEqual([{
            ...outcomes[0],
            saveStatus: 'queued',
        }]);
    });

    it('hydrates server-created wishlist/list ids and transitions queued to saved', () => {
        const job = mkJob({
            phase: 'done',
            items: [{ ...mkItems(1)[0], status: 'queued' }],
            serverJobId: 'job-server',
        });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                id: 'queue-item-0',
                item_nonce: 'nonce-0',
                state: 'resolved',
                restaurant_id: 'restaurant-canonical',
                last_error: null,
                destinations: [
                    {
                        destination_kind: 'wishlist',
                        outcome: 'fulfilled',
                        result: {
                            status: 'already_pinned',
                            wishlist_id: 'wishlist-live',
                            restaurant_id: 'restaurant-canonical',
                        },
                    },
                    {
                        destination_kind: 'new_list',
                        outcome: 'fulfilled',
                        result: {
                            list_id: 'list-server-created',
                            entry_id: 'entry-live',
                            restaurant_id: 'restaurant-canonical',
                        },
                    },
                ],
            }],
        });

        expect(next.destListId).toBe('list-server-created');
        expect(next.items[0]).toMatchObject({
            status: 'already',
            restaurant_id: 'restaurant-canonical',
            wishlist_id: 'wishlist-live',
            completenessItemId: 'queue-item-0',
            listRouted: true,
            needsLook: false,
        });
        expect(deriveCounts(next.items).queued).toBe(0);
    });

    it('transitions exhausted items to the correction surface without fabricating routes', () => {
        const job = mkJob({ items: [{ ...mkItems(1)[0], status: 'queued' }] });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                id: 'queue-item-exhausted',
                item_nonce: 'nonce-0',
                state: 'exhausted',
                restaurant_id: 'private-ghost',
                last_error: 'no_result',
                destinations: [{
                    destination_kind: 'wishlist',
                    outcome: 'pending',
                    result: null,
                }],
            }],
        });

        expect(next.items[0]).toMatchObject({
            status: 'failed',
            restaurant_id: 'private-ghost',
            completenessItemId: 'queue-item-exhausted',
            needsLook: true,
        });
        expect(next.items[0].wishlist_id).toBeUndefined();
    });

    it('hydrates exhausted ghost pins instead of reporting a failed save', () => {
        const job = mkJob({
            items: [{ ...mkItems(1)[0], status: 'queued' }],
            destListTitle: null,
        });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                id: 'queue-item-exhausted',
                item_nonce: 'nonce-0',
                state: 'exhausted',
                restaurant_id: 'private-ghost',
                last_error: 'no_result',
                destinations: [{
                    destination_kind: 'wishlist',
                    outcome: 'fulfilled',
                    result: {
                        status: 'saved',
                        wishlist_id: 'wishlist-ghost',
                        restaurant_id: 'private-ghost',
                    },
                }],
            }],
        });

        expect(next.items[0]).toMatchObject({
            status: 'ghost',
            restaurant_id: 'private-ghost',
            wishlist_id: 'wishlist-ghost',
            completenessItemId: 'queue-item-exhausted',
            needsLook: true,
        });
    });

    it('upgrades a pre-fix failed manifest after the server backfills its ghost pin', () => {
        const job = mkJob({
            items: [{ ...mkItems(1)[0], status: 'failed', needsLook: true }],
            destListTitle: null,
        });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                id: 'queue-item-backfilled',
                item_nonce: 'nonce-0',
                state: 'exhausted',
                restaurant_id: 'private-ghost',
                last_error: 'no_result',
                destinations: [{
                    destination_kind: 'wishlist',
                    outcome: 'fulfilled',
                    result: {
                        wishlist_id: 'wishlist-backfilled',
                        restaurant_id: 'private-ghost',
                    },
                }],
            }],
        });

        expect(next.items[0]).toMatchObject({
            status: 'ghost',
            wishlist_id: 'wishlist-backfilled',
            completenessItemId: 'queue-item-backfilled',
            needsLook: true,
        });
    });

    it('leaves an exhausted fulfilled route untouched until its ledger result is hydrated', () => {
        const original: LargeImportJobItem = {
            ...mkItems(1)[0],
            status: 'queued',
        };
        const job = mkJob({ items: [original], destListTitle: null });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                id: 'queue-item-exhausted',
                item_nonce: 'nonce-0',
                state: 'exhausted',
                restaurant_id: 'private-ghost',
                last_error: 'no_result',
                destinations: [{
                    destination_kind: 'wishlist',
                    outcome: 'fulfilled',
                    result: null,
                }],
            }],
        });

        expect(next.items[0]).toEqual(original);
    });

    it.each([
        {
            label: 'an expected route is still pending',
            wishlist: {
                destination_kind: 'wishlist' as const,
                outcome: 'fulfilled' as const,
                result: { status: 'saved', wishlist_id: 'wishlist-live' },
            },
            list: {
                destination_kind: 'new_list' as const,
                outcome: 'pending' as const,
                result: null,
            },
        },
        {
            label: 'a fulfilled route ledger has not exposed its live id',
            wishlist: {
                destination_kind: 'wishlist' as const,
                outcome: 'fulfilled' as const,
                result: { status: 'saved' },
            },
            list: {
                destination_kind: 'new_list' as const,
                outcome: 'fulfilled' as const,
                result: { list_id: 'list-live' },
            },
        },
    ])('keeps a terminal server item queued when $label', ({ wishlist, list }) => {
        const job = mkJob({ items: [{ ...mkItems(1)[0], status: 'queued' }] });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                id: 'queue-item-0',
                item_nonce: 'nonce-0',
                state: 'resolved',
                restaurant_id: 'restaurant-live',
                last_error: null,
                destinations: [wishlist, list],
            }],
        });

        expect(next.items[0]).toMatchObject({
            status: 'queued',
            completenessItemId: 'queue-item-0',
            needsLook: false,
        });
    });

    it('turns a terminal rejected route into an actionable needs-look row', () => {
        const job = mkJob({ items: [{ ...mkItems(1)[0], status: 'queued' }] });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                id: 'queue-item-0',
                item_nonce: 'nonce-0',
                state: 'resolved',
                restaurant_id: 'restaurant-live',
                last_error: null,
                destinations: [
                    {
                        destination_kind: 'wishlist',
                        outcome: 'fulfilled',
                        result: { status: 'saved', wishlist_id: 'wishlist-live' },
                    },
                    {
                        destination_kind: 'new_list',
                        outcome: 'rejected',
                        result: null,
                    },
                ],
            }],
        });

        expect(next.items[0]).toMatchObject({
            status: 'saved',
            completenessItemId: 'queue-item-0',
            wishlist_id: 'wishlist-live',
            listRouted: false,
            needsLook: true,
        });
    });

    it.each(['pending', 'leased', 'deferred'])(
        're-arms an exhausted local row only after the owner retry reaches server state %s',
        (state) => {
            const failed: LargeImportJobItem = {
                ...mkItems(1)[0],
                status: 'failed',
                restaurant_id: 'private-ghost',
                needsLook: true,
            };
            const next = reconcileLargeJobCompleteness(mkJob({ items: [failed] }), {
                job_id: 'job-server',
                sealed: true,
                done_emitted: true,
                items: [{
                    item_nonce: 'nonce-0',
                    state,
                    restaurant_id: 'private-ghost',
                    last_error: null,
                    destinations: [],
                }],
            });

            expect(next.items[0]).toMatchObject({
                status: 'queued',
                restaurant_id: 'private-ghost',
                needsLook: false,
            });
        },
    );

    it('does not overwrite a user-corrected terminal row with the immutable original route', () => {
        const corrected: LargeImportJobItem = {
            ...mkItems(1)[0],
            status: 'saved',
            resolution_id: 'resolution-corrected',
            restaurant_id: 'restaurant-corrected',
            wishlist_id: 'wishlist-corrected',
            restaurant_name: 'Corrected match',
            needsLook: false,
        };
        const job = mkJob({ items: [corrected] });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                item_nonce: 'nonce-0',
                state: 'resolved',
                restaurant_id: 'restaurant-original',
                last_error: null,
                destinations: [{
                    destination_kind: 'wishlist',
                    outcome: 'fulfilled',
                    result: {
                        status: 'saved',
                        wishlist_id: 'wishlist-original',
                        restaurant_id: 'restaurant-original',
                    },
                }],
            }],
        });

        expect(next.items[0]).toEqual(corrected);
    });

    it('does not restore a server wishlist id after the user unpins a terminal row', () => {
        const unpinned: LargeImportJobItem = {
            ...mkItems(1)[0],
            status: 'saved',
            restaurant_id: 'restaurant-0',
            wishlist_id: null,
            listRouted: true,
        };
        const job = mkJob({ items: [unpinned] });
        const next = reconcileLargeJobCompleteness(job, {
            job_id: 'job-server',
            sealed: true,
            done_emitted: true,
            items: [{
                item_nonce: 'nonce-0',
                state: 'verified',
                restaurant_id: 'restaurant-0',
                last_error: null,
                destinations: [{
                    destination_kind: 'wishlist',
                    outcome: 'fulfilled',
                    result: {
                        status: 'saved',
                        wishlist_id: 'wishlist-original',
                        restaurant_id: 'restaurant-0',
                    },
                }],
            }],
        });

        expect(next.items[0]).toEqual(unpinned);
    });
});

describe('constants', () => {
    it('chunk size 20 aligns with save_spots cap; max attempts 3', () => {
        expect(LARGE_JOB_CHUNK_SIZE).toBe(20);
        expect(LARGE_JOB_MAX_CHUNK_ATTEMPTS).toBe(3);
    });
});
