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
    shouldEmitCompletion,
    classifyDrainError,
    partitionDigest,
    isPinnedItem,
    type LargeImportJob,
    type LargeImportJobItem,
    type ChunkItemOutcome,
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
        ...overrides,
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
});

describe('constants', () => {
    it('chunk size 20 aligns with save_spots cap; max attempts 3', () => {
        expect(LARGE_JOB_CHUNK_SIZE).toBe(20);
        expect(LARGE_JOB_MAX_CHUNK_ATTEMPTS).toBe(3);
    });
});
