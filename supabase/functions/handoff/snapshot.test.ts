/**
 * snapshot.test.ts — TICKET-072, carried forward under live shares (TICKET-077).
 *
 * Tests for the pure builders buildSnapshotInput / buildSnapshot /
 * buildRenderContext / buildResolveCandidates. These remain the assembly layer
 * for a share's display payload — TICKET-077 only changed WHERE the rows come
 * from (loadLiveSpots reads them LIVE at view time instead of freezing them at
 * create time). The builder contracts are identical, so these assertions hold
 * unchanged. ("snapshot"/"frozen" in some names below is historical; the shape
 * and ordering they assert are exactly what the live payload carries.)
 *
 * Key invariants:
 *   - buildSnapshot emits ONLY { sharer_name, spots[{restaurant_id,name,city,cuisine,rating}] }
 *     (+ optional list_name). No email, last_name, table, other-user data
 *   - buildRenderContext strips restaurant_id (Codex #6: no uuid in HTML)
 *   - render context key allowlist exactly { sharer_name, list_name, created_at, spots }
 *   - spots in render context have exactly { name, city, cuisine, rating } (no restaurant_id)
 *   - rating is null when sharer hasn't rated (not 0, not undefined)
 *   - buildResolveCandidates marks already_wishlisted correctly
 *   - buildSnapshotInput verified-only filter + owner-rating enrichment + order
 *     preservation are the security-critical pieces loadLiveSpots delegates to
 */

import {
    assertEquals,
    assertStrictEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    buildSnapshot,
    buildSnapshotInput,
    buildRenderContext,
    buildResolveCandidates,
    listShareOrder,
    type JoinedSpotRow,
} from './snapshot.ts';

const FIXTURE_ROWS = [
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000001', name: 'Berenjak', city: 'London', cuisine: 'Persian', rating: 4.6 },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000002', name: 'Kono', city: 'New York', cuisine: 'Japanese', rating: null },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000003', name: 'Le Comptoir', city: 'Paris', cuisine: 'French', rating: 4.2 },
];

// ── buildSnapshot ─────────────────────────────────────────────────────────────

Deno.test('buildSnapshot: correct shape', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    assertEquals(snap.sharer_name, 'Jacky');
    assertEquals(snap.spots.length, 3);
});

Deno.test('buildSnapshot: spots contain restaurant_id', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    assertEquals(snap.spots[0].restaurant_id, 'aabbccdd-0000-4000-8000-000000000001');
});

Deno.test('buildSnapshot: rating null when not rated', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    assertStrictEquals(snap.spots[1].rating, null);
});

Deno.test('buildSnapshot: rating preserved when rated', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    assertEquals(snap.spots[0].rating, 4.6);
});

Deno.test('buildSnapshot: no extra keys on snapshot', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS) as unknown as Record<string, unknown>;
    const allowedKeys = new Set(['sharer_name', 'spots']);
    for (const key of Object.keys(snap)) {
        assertEquals(allowedKeys.has(key), true, `unexpected key on snapshot: ${key}`);
    }
});

Deno.test('buildSnapshot: no extra keys on spot', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const allowedSpotKeys = new Set(['restaurant_id', 'name', 'city', 'cuisine', 'rating']);
    for (const spot of snap.spots) {
        for (const key of Object.keys(spot)) {
            assertEquals(allowedSpotKeys.has(key), true, `unexpected key on spot: ${key}`);
        }
    }
});

Deno.test('buildSnapshot: city/cuisine null-coerced', () => {
    const rows = [{ restaurant_id: 'aabb-0000-0000-0000', name: 'Anon', city: null, cuisine: null, rating: null }];
    const snap = buildSnapshot('A', rows);
    assertStrictEquals(snap.spots[0].city, null);
    assertStrictEquals(snap.spots[0].cuisine, null);
});

// ── buildSnapshot — list_name (TICKET-074) ────────────────────────────────────

Deno.test('buildSnapshot: list_name frozen into the snapshot for list shares', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS, 'Tokyo trip');
    assertEquals(snap.list_name, 'Tokyo trip');
});

Deno.test('buildSnapshot: list_name key OMITTED for wishlist shares (no arg)', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS) as unknown as Record<string, unknown>;
    assertEquals('list_name' in snap, false, 'list_name must not exist on wishlist snapshots');
});

Deno.test('buildSnapshot: list_name key OMITTED when null', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS, null) as unknown as Record<string, unknown>;
    assertEquals('list_name' in snap, false);
});

Deno.test('buildSnapshot: list_name trimmed; whitespace-only is omitted', () => {
    const trimmed = buildSnapshot('Jacky', FIXTURE_ROWS, '  date spots  ');
    assertEquals(trimmed.list_name, 'date spots');
    const blank = buildSnapshot('Jacky', FIXTURE_ROWS, '   ') as unknown as Record<string, unknown>;
    assertEquals('list_name' in blank, false);
});

Deno.test('buildSnapshot: allowed keys with list_name are exactly {sharer_name, list_name, spots}', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS, 'Tokyo trip') as unknown as Record<string, unknown>;
    const allowedKeys = new Set(['sharer_name', 'list_name', 'spots']);
    for (const key of Object.keys(snap)) {
        assertEquals(allowedKeys.has(key), true, `unexpected key on list snapshot: ${key}`);
    }
});

// ── buildSnapshotInput (TICKET-074 shared enrichment) ─────────────────────────

const JOINED_ROWS: JoinedSpotRow[] = [
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000001', restaurant: { name: 'Berenjak', city: 'London', cuisine: 'Persian', verification: 'verified' } },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000002', restaurant: { name: 'Kono', city: 'New York', cuisine: 'Japanese', verification: 'verified' } },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000003', restaurant: { name: 'Ghosty', city: null, cuisine: null, verification: 'unverified' } },
];

Deno.test('buildSnapshotInput: drops non-verified rows (defence-in-depth)', () => {
    const input = buildSnapshotInput(JOINED_ROWS, new Map());
    assertEquals(input.length, 2);
    assertEquals(input.map((r) => r.name), ['Berenjak', 'Kono']);
});

Deno.test('buildSnapshotInput: owner-rating enrichment from ratingMap; misses → null', () => {
    const ratingMap = new Map([['aabbccdd-0000-4000-8000-000000000001', 4.6]]);
    const input = buildSnapshotInput(JOINED_ROWS, ratingMap);
    assertEquals(input[0].rating, 4.6);
    assertStrictEquals(input[1].rating, null);
});

Deno.test('buildSnapshotInput: city/cuisine null-coerced when absent', () => {
    const rows: JoinedSpotRow[] = [
        { restaurant_id: 'aabbccdd-0000-4000-8000-000000000009', restaurant: { name: 'Bare', verification: 'verified' } },
    ];
    const input = buildSnapshotInput(rows, new Map());
    assertStrictEquals(input[0].city, null);
    assertStrictEquals(input[0].cuisine, null);
});

Deno.test('buildSnapshotInput: missing verification dropped (never trust absent fields)', () => {
    const rows: JoinedSpotRow[] = [
        { restaurant_id: 'aabbccdd-0000-4000-8000-000000000010', restaurant: { name: 'NoFlag' } },
    ];
    assertEquals(buildSnapshotInput(rows, new Map()).length, 0);
});

Deno.test('buildSnapshotInput: feeds buildSnapshot — list_name frozen, verified-only, owner-rating', () => {
    const ratingMap = new Map([['aabbccdd-0000-4000-8000-000000000002', 3.9]]);
    const snap = buildSnapshot('Jacky', buildSnapshotInput(JOINED_ROWS, ratingMap), 'Tokyo trip');
    assertEquals(snap.list_name, 'Tokyo trip');
    assertEquals(snap.spots.length, 2);
    assertStrictEquals(snap.spots[0].rating, null);
    assertEquals(snap.spots[1].rating, 3.9);
});

// ── List-share spot order (TICKET-074 fix-pass, Codex medium) ─────────────────
//
// The DB query orders rows via listShareOrder; the pure pipeline
// (buildSnapshotInput → buildSnapshot) MUST preserve that row order so the
// frozen snapshot renders spots exactly as the list renders them.

Deno.test('listShareOrder: ranked lists order by position ASC (mirrors lists get)', () => {
    assertEquals(listShareOrder(true), { column: 'position', ascending: true });
});

Deno.test('listShareOrder: unranked lists order by created_at DESC (mirrors lists get)', () => {
    assertEquals(listShareOrder(false), { column: 'created_at', ascending: false });
});

/** Rows as the DB returns them for a RANKED list (position ASC: 1024, 2048, 3072). */
const RANKED_ORDERED_ROWS: JoinedSpotRow[] = [
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000021', restaurant: { name: 'First by rank', city: 'Tokyo', cuisine: 'Sushi', verification: 'verified' } },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000022', restaurant: { name: 'Ghost mid-rank', city: null, cuisine: null, verification: 'unverified' } },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000023', restaurant: { name: 'Second by rank', city: 'Tokyo', cuisine: 'Ramen', verification: 'verified' } },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000024', restaurant: { name: 'Third by rank', city: 'Kyoto', cuisine: 'Kaiseki', verification: 'verified' } },
];

Deno.test('snapshot spot order: ranked fixture — rank order preserved end-to-end, unverified dropped without reshuffling', () => {
    const snap = buildSnapshot('Jacky', buildSnapshotInput(RANKED_ORDERED_ROWS, new Map()), 'Tokyo trip');
    assertEquals(
        snap.spots.map((s) => s.name),
        ['First by rank', 'Second by rank', 'Third by rank'],
    );
});

/** Rows as the DB returns them for an UNRANKED list (created_at DESC: newest pin first). */
const UNRANKED_ORDERED_ROWS: JoinedSpotRow[] = [
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000031', restaurant: { name: 'Newest pin', city: 'London', cuisine: 'Persian', verification: 'verified' } },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000032', restaurant: { name: 'Middle pin', city: 'Paris', cuisine: 'French', verification: 'verified' } },
    { restaurant_id: 'aabbccdd-0000-4000-8000-000000000033', restaurant: { name: 'Oldest pin', city: 'New York', cuisine: 'Japanese', verification: 'verified' } },
];

Deno.test('snapshot spot order: unranked fixture — reverse-chron order preserved end-to-end', () => {
    const snap = buildSnapshot('Jacky', buildSnapshotInput(UNRANKED_ORDERED_ROWS, new Map()), 'date spots');
    assertEquals(
        snap.spots.map((s) => s.name),
        ['Newest pin', 'Middle pin', 'Oldest pin'],
    );
});

// ── buildRenderContext ────────────────────────────────────────────────────────

Deno.test('buildRenderContext: strips restaurant_id from spots', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const ctx = buildRenderContext(snap, '2026-06-11T00:00:00Z');
    for (const spot of ctx.spots) {
        assertEquals('restaurant_id' in spot, false, 'restaurant_id must not be in render context');
    }
});

Deno.test('buildRenderContext: key allowlist on ctx', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const ctx = buildRenderContext(snap, '2026-06-11T00:00:00Z') as unknown as Record<string, unknown>;
    // TICKET-074: list_name joined the allowlist (null for wishlist shares).
    const allowed = new Set(['sharer_name', 'list_name', 'created_at', 'spots']);
    for (const key of Object.keys(ctx)) {
        assertEquals(allowed.has(key), true, `unexpected key on ctx: ${key}`);
    }
});

Deno.test('buildRenderContext: list_name null for wishlist + pre-074 snapshots', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const ctx = buildRenderContext(snap, '2026-06-11T00:00:00Z');
    assertStrictEquals(ctx.list_name, null);
});

Deno.test('buildRenderContext: list_name passes through for list shares', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS, 'Tokyo trip');
    const ctx = buildRenderContext(snap, '2026-06-11T00:00:00Z');
    assertEquals(ctx.list_name, 'Tokyo trip');
});

Deno.test('buildRenderContext: spot key allowlist (no uuid)', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const ctx = buildRenderContext(snap, '2026-06-11T00:00:00Z');
    const allowedSpotKeys = new Set(['name', 'city', 'cuisine', 'rating']);
    for (const spot of ctx.spots) {
        for (const key of Object.keys(spot)) {
            assertEquals(allowedSpotKeys.has(key), true, `unexpected key on render spot: ${key}`);
        }
    }
});

Deno.test('buildRenderContext: uuid-absence in spot values (Codex #6)', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const ctx = buildRenderContext(snap, '2026-06-11T00:00:00Z');
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    // Spot field values (name, city, cuisine) must not contain UUIDs
    for (const spot of ctx.spots) {
        for (const val of [spot.name, spot.city, spot.cuisine]) {
            if (typeof val === 'string') {
                assertEquals(uuidRe.test(val), false, `uuid in render ctx spot value: ${val}`);
            }
        }
    }
});

Deno.test('buildRenderContext: uuid-absence check on serialized page', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const ctx = buildRenderContext(snap, '2026-06-11T00:00:00Z');
    const serialized = JSON.stringify(ctx);
    // The render context serialization should not contain any UUID from the snapshot
    // (restaurant_ids are stripped)
    for (const row of FIXTURE_ROWS) {
        assertEquals(serialized.includes(row.restaurant_id), false,
            `restaurant_id ${row.restaurant_id} leaked into render context`);
    }
});

// ── buildResolveCandidates ────────────────────────────────────────────────────

Deno.test('buildResolveCandidates: marks already_wishlisted correctly', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const alreadyIds = new Set(['aabbccdd-0000-4000-8000-000000000001']);
    const candidateIds = new Map([
        ['aabbccdd-0000-4000-8000-000000000001', 'nonce-1'],
        ['aabbccdd-0000-4000-8000-000000000002', 'nonce-2'],
        ['aabbccdd-0000-4000-8000-000000000003', 'nonce-3'],
    ]);
    const spots = buildResolveCandidates(snap, alreadyIds, candidateIds);
    assertEquals(spots[0].already_wishlisted, true);
    assertEquals(spots[1].already_wishlisted, false);
    assertEquals(spots[2].already_wishlisted, false);
});

Deno.test('buildResolveCandidates: candidate_id from map', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const alreadyIds = new Set<string>();
    const candidateIds = new Map([
        ['aabbccdd-0000-4000-8000-000000000001', 'derived-nonce-abc'],
    ]);
    const spots = buildResolveCandidates(snap, alreadyIds, candidateIds);
    assertEquals(spots[0].candidate_id, 'derived-nonce-abc');
});

Deno.test('buildResolveCandidates: sharer_rating preserved', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const alreadyIds = new Set<string>();
    const candidateIds = new Map<string, string>();
    const spots = buildResolveCandidates(snap, alreadyIds, candidateIds);
    assertEquals(spots[0].sharer_rating, 4.6);
    assertStrictEquals(spots[1].sharer_rating, null);
});

Deno.test('buildResolveCandidates: confidence always high', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const spots = buildResolveCandidates(snap, new Set(), new Map());
    for (const s of spots) {
        assertEquals(s.confidence, 'high');
    }
});

Deno.test('buildResolveCandidates: external_id always null', () => {
    const snap = buildSnapshot('Jacky', FIXTURE_ROWS);
    const spots = buildResolveCandidates(snap, new Set(), new Map());
    for (const s of spots) {
        assertStrictEquals(s.restaurant.external_id, null);
    }
});
