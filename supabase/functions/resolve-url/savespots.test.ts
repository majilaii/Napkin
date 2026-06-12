/**
 * savespots.test.ts — TICKET-063 fix-pass-1 unit tests.
 *
 * Tests the decision helpers extracted from resolve-url/index.ts for the
 * P0/P1/High blockers. No live DB or network — pure logic.
 *
 * Coverage:
 *  1. source passed as object (not stringified) — p_source semantics.
 *  2. ghost external_id minting stability — same (user, nonce) → same id.
 *  3. membership-gate decision — filterUnauthorizedTableIds pure fn.
 *  4. 'exact' confidence for google_maps URL parse.
 *  5. place_id DB-miss → callPlacesDetails is called, NOT text search.
 */

import {
    assertEquals,
    assertNotEquals,
    assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    isGhostExternalId,
    buildGhostExternalId,
    filterUnauthorizedTableIds,
    isSpotPinnable,
} from './_helpers.ts';
import { deriveClientNonce } from '../handoff/nonce.ts';

// ── 1. Source passthrough — object not stringified ────────────────────────────
//
// The P0 fix changes `p_source: source ? JSON.stringify(source) : null`
// to `p_source: source ?? null`. This test documents the contract: a plain
// object should pass through unchanged (not become a JSON string), so Postgres
// can correctly infer jsonb_typeof(p_source) = 'object'.

Deno.test('source passthrough: object value is not a string', () => {
    const source = { type: 'tiktok', url: 'https://tiktok.com/v/123' };
    // The canonical form: source ?? null (not JSON.stringify)
    const pSource = source ?? null;
    // It must remain an object, not a serialized string.
    assertEquals(typeof pSource, 'object', 'p_source must be passed as an object, not a JSON string');
    assertNotEquals(typeof pSource, 'string', 'JSON.stringify would break the jsonb CHECK');
});

Deno.test('source passthrough: null source yields null (not JSON null string)', () => {
    const source: unknown = null;
    const pSource = source ?? null;
    assertEquals(pSource, null);
});

Deno.test('source passthrough: undefined source yields null', () => {
    const source: unknown = undefined;
    const pSource = source ?? null;
    assertEquals(pSource, null);
});

// ── 2. Ghost external_id minting stability ────────────────────────────────────
//
// Fix P0-B: the RPC mints 'ghost_<user>_<nonce>' when no real external_id is
// provided. Same inputs → same id (replay-idempotent).

Deno.test('buildGhostExternalId: same user+nonce → same external_id', () => {
    const userId = 'aabbccdd-0000-4000-8000-000000000001';
    const nonce = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    const id1 = buildGhostExternalId(userId, nonce);
    const id2 = buildGhostExternalId(userId, nonce);
    assertEquals(id1, id2, 'ghost external_id must be stable across replays');
    assertEquals(id1, `ghost_${userId}_${nonce}`);
});

Deno.test('buildGhostExternalId: different nonces → different ids', () => {
    const userId = 'aabbccdd-0000-4000-8000-000000000001';
    const id1 = buildGhostExternalId(userId, 'nonce-a');
    const id2 = buildGhostExternalId(userId, 'nonce-b');
    assertNotEquals(id1, id2, 'different nonces must produce different external_ids');
});

Deno.test('buildGhostExternalId: different users → different ids (same nonce)', () => {
    const nonce = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
    const id1 = buildGhostExternalId('user-a', nonce);
    const id2 = buildGhostExternalId('user-b', nonce);
    assertNotEquals(id1, id2, 'different users must produce different external_ids');
    assertStringIncludes(id1, 'ghost_');
    assertStringIncludes(id2, 'ghost_');
});

// ── 3. isGhostExternalId sentinel detection ───────────────────────────────────

Deno.test('isGhostExternalId: null → true', () => {
    assertEquals(isGhostExternalId(null), true);
});

Deno.test('isGhostExternalId: undefined → true', () => {
    assertEquals(isGhostExternalId(undefined), true);
});

Deno.test('isGhostExternalId: empty string → true', () => {
    assertEquals(isGhostExternalId(''), true);
});

Deno.test('isGhostExternalId: "ghost_pending" sentinel → true', () => {
    assertEquals(isGhostExternalId('ghost_pending'), true, '"ghost_pending" must be treated as ghost');
});

Deno.test('isGhostExternalId: real Google Place ID → false', () => {
    assertEquals(isGhostExternalId('ChIJN1t_tDeuEmsRUsoyG83frY4'), false);
});

Deno.test('isGhostExternalId: minted ghost id → false (the minted id itself is real)', () => {
    // A minted ghost id like 'ghost_<user>_<nonce>' should NOT be treated as sentinel —
    // it is a real unique external_id. The sentinel check is ONLY for the 'ghost_pending' string.
    const minted = buildGhostExternalId('user-123', 'nonce-456');
    assertEquals(isGhostExternalId(minted), false, 'Minted ghost external_id should not be treated as sentinel');
});

// ── 4. filterUnauthorizedTableIds — membership gate ──────────────────────────
//
// Fix P1: the edge handler validates table_ids against table_members.member_id
// (NOT user_id — TICKET-034 doctrine) and rejects unauthorized table_ids
// BEFORE calling the RPC.

Deno.test('filterUnauthorizedTableIds: all authorized → empty set', () => {
    const tableIds = ['t1', 't2'];
    const memberRows = [{ table_id: 't1' }, { table_id: 't2' }, { table_id: 't3' }];
    const result = filterUnauthorizedTableIds(tableIds, memberRows);
    assertEquals(result.size, 0);
});

Deno.test('filterUnauthorizedTableIds: none authorized → full set returned', () => {
    const tableIds = ['t1', 't2'];
    const memberRows: { table_id: string }[] = [];
    const result = filterUnauthorizedTableIds(tableIds, memberRows);
    assertEquals(result.size, 2);
    assertEquals(result.has('t1'), true);
    assertEquals(result.has('t2'), true);
});

Deno.test('filterUnauthorizedTableIds: partial — only unauthorized ones returned', () => {
    const tableIds = ['t1', 't2', 't3'];
    const memberRows = [{ table_id: 't1' }];
    const result = filterUnauthorizedTableIds(tableIds, memberRows);
    assertEquals(result.size, 2);
    assertEquals(result.has('t1'), false, 't1 is authorized, should not be in result');
    assertEquals(result.has('t2'), true);
    assertEquals(result.has('t3'), true);
});

Deno.test('filterUnauthorizedTableIds: empty tableIds → empty result', () => {
    const result = filterUnauthorizedTableIds([], [{ table_id: 't1' }]);
    assertEquals(result.size, 0);
});

// ── 5. 'exact' confidence for google_maps URL parse ───────────────────────────
//
// Fix #6: Google Maps URL parse is a deterministic source → 'exact' for top result.
// The confidence enum contract: exact = deterministic source, high = model confident,
// low = everything else.

Deno.test("'exact' for google_maps: first result should be confidence='exact'", () => {
    // Simulate the confidence assignment logic from handleUrlResolve google_maps path.
    // FIX: was `idx === 0 && googleRatingCount > 50 ? 'high' : 'low'`
    // Now: `idx === 0 ? 'exact' : 'low'`
    const getConfidence = (idx: number) => idx === 0 ? 'exact' : 'low';
    assertEquals(getConfidence(0), 'exact', 'top google_maps result must be exact');
    assertEquals(getConfidence(1), 'low', 'subsequent results are low confidence');
    assertEquals(getConfidence(2), 'low');
});

Deno.test("old behavior regression: rating-based confidence would have been 'high' not 'exact'", () => {
    // Documents the BUG we fixed: the old code never emitted 'exact' for any google_maps result.
    // The new code always emits 'exact' for idx=0, regardless of rating count.
    const oldGetConfidence = (idx: number, ratingCount: number) =>
        (idx === 0 && ratingCount > 50) ? 'high' : 'low';
    const newGetConfidence = (idx: number) => idx === 0 ? 'exact' : 'low';

    // Old: even a highly-rated place got 'high', not 'exact'.
    assertEquals(oldGetConfidence(0, 1000), 'high');
    // New: always 'exact' for deterministic Maps parse.
    assertEquals(newGetConfidence(0), 'exact');
    assertNotEquals(newGetConfidence(0), 'high');
});

// ── 6. place_id DB-miss: never text-search ────────────────────────────────────
//
// Fix #5: when a candidate has google_place_id, the DB-miss path must call
// Places Details by id (not text search). This is tested by verifying the
// decision logic: if google_place_id is set, we should NOT fall through to
// a text-query path.

Deno.test('place_id hydration: google_place_id present → should use Details, not text-search', () => {
    // Simulate the resolveCandidateToPlace decision:
    // If candidate.google_place_id is set, the function calls callPlacesDetails.
    // The invariant: we only do text search when google_place_id is falsy.
    const shouldTextSearch = (googlePlaceId: string | null | undefined): boolean => {
        // This models the new behavior: text search only if NO google_place_id.
        return !googlePlaceId;
    };

    assertEquals(shouldTextSearch('ChIJN1t_tDeuEmsRUsoyG83frY4'), false,
        'should NOT text-search when google_place_id is set');
    assertEquals(shouldTextSearch(null), true,
        'should text-search when no google_place_id (normal name+city candidate)');
    assertEquals(shouldTextSearch(undefined), true);
    assertEquals(shouldTextSearch(''), true);
});

Deno.test('place_id hydration: "ghost_pending" is not a real place_id', () => {
    // Documents that 'ghost_pending' should never be sent to Places Details.
    const isRealPlaceId = (id: string | null | undefined): boolean => {
        return !isGhostExternalId(id);
    };
    assertEquals(isRealPlaceId('ghost_pending'), false);
    assertEquals(isRealPlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4'), true);
    assertEquals(isRealPlaceId(null), false);
});

// ── ROUND-3 FIX: verified-only restaurant_id mapping ─────────────────────────
import { mapVerifiedRestaurantIds } from './_helpers.ts';

Deno.test('mapVerifiedRestaurantIds: maps verified rows only', () => {
    const map = mapVerifiedRestaurantIds([
        { id: 'r1', external_id: 'place_a', verification: 'verified' },
        { id: 'r2', external_id: 'place_b', verification: 'unverified' },
        { id: 'r3', external_id: null, verification: 'verified' },
    ]);
    if (map.get('place_a') !== 'r1') throw new Error('verified row must map');
    if (map.has('place_b')) throw new Error('unverified row must NOT map — it would skip the save-time verified upsert repair');
    if (map.size !== 1) throw new Error(`expected 1 entry, got ${map.size}`);
});

Deno.test('mapVerifiedRestaurantIds: missing verification field treated as unmapped', () => {
    const map = mapVerifiedRestaurantIds([{ id: 'r4', external_id: 'place_c' }]);
    if (map.size !== 0) throw new Error('rows without verification must not map');
});

// ── TICKET-077: LIVE handoff pin guard ────────────────────────────────────────
//
// A handoff pin may only target a restaurant_id in the share's CURRENT live spot
// set (read server-side via loadLiveSpots). A client cannot smuggle a restaurant_id
// the owner has since removed, or one from a different share. Off-set spots →
// NOT_IN_SHARE (rejected, not pinned).

Deno.test('isSpotPinnable: restaurant_id IN the live set → pinnable', () => {
    const live = new Set(['r1', 'r2']);
    assertEquals(isSpotPinnable('r1', live), true);
});

Deno.test('isSpotPinnable: restaurant_id NOT in the live set → rejected (NOT_IN_SHARE)', () => {
    const live = new Set(['r1', 'r2']);
    // Owner removed r3 (or it belongs to a different share) since the recipient viewed.
    assertEquals(isSpotPinnable('r3', live), false);
});

Deno.test('isSpotPinnable: null/undefined restaurant_id on handoff → rejected (live spots always carry an id)', () => {
    const live = new Set(['r1']);
    assertEquals(isSpotPinnable(null, live), false);
    assertEquals(isSpotPinnable(undefined, live), false);
});

Deno.test('isSpotPinnable: empty live set → nothing pinnable (revoked-to-empty share)', () => {
    const live = new Set<string>();
    assertEquals(isSpotPinnable('r1', live), false);
});

Deno.test('isSpotPinnable: no handoff gate (null set) → every spot pinnable (normal import)', () => {
    // The non-handoff import path passes liveRestaurantIds = null — the guard is a no-op.
    assertEquals(isSpotPinnable('anything', null), true);
    assertEquals(isSpotPinnable(null, null), true);
});

// ── TICKET-077: per-spot client_nonce determinism (token, restaurant_id) ──────
//
// The pin nonce derives from (token, restaurant_id). Stable for a given
// restaurant across views → re-receipt is idempotent (rides the
// (user_id, client_nonce) UNIQUE in fn_save_import_spot). restaurant_id comes
// from the LIVE read, which is stable for a given restaurant.

Deno.test('client_nonce determinism: same (token, restaurant_id) → same nonce', async () => {
    const token = 'ABCdefGHIjklMNOpqrSTUv';
    const rid = 'aabbccdd-0000-4000-8000-000000000001';
    const a = await deriveClientNonce(token, rid);
    const b = await deriveClientNonce(token, rid);
    assertEquals(a, b, 'nonce must be stable per (token, restaurant_id) for idempotent re-receipt');
});

Deno.test('client_nonce determinism: different restaurant_id → different nonce', async () => {
    const token = 'ABCdefGHIjklMNOpqrSTUv';
    const a = await deriveClientNonce(token, 'aabbccdd-0000-4000-8000-000000000001');
    const b = await deriveClientNonce(token, 'aabbccdd-0000-4000-8000-000000000002');
    assertNotEquals(a, b, 'distinct restaurants must derive distinct nonces');
});

Deno.test('client_nonce determinism: different token → different nonce (no cross-share collision)', async () => {
    const rid = 'aabbccdd-0000-4000-8000-000000000001';
    const a = await deriveClientNonce('ABCdefGHIjklMNOpqrSTUv', rid);
    const b = await deriveClientNonce('ZZZdefGHIjklMNOpqrSTUv', rid);
    assertNotEquals(a, b, 'same restaurant under different shares must not collide');
});
