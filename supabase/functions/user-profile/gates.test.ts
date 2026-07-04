/**
 * gates.test.ts — pins the TICKET-090 block matrix and the TICKET-093(a)
 * audience decision for every user-profile palate surface
 * (diary / regulars / spots / reviews).
 *
 * These are the semantics the founder locked 2026-07-04:
 *   • table-shared entries ARE public-eligible (only Table context is sacred)
 *   • sharing a Table grants the Table feed, never profile surfaces
 *   • a block in either direction reads as not-found
 */
import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    computeRelationship,
    fetchBlockState,
    strangerCanReadPalate,
    type BlockState,
    type ViewerRelationship,
} from './gates.ts';

const VIEWER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TARGET = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// ── computeRelationship ──────────────────────────────────────────────────────

Deno.test('computeRelationship: public + shared tables → public_and_tables', () => {
    assertEquals(computeRelationship(VIEWER, 'public', ['t1']), 'public_and_tables');
});

Deno.test('computeRelationship: public, no shared tables → public_only', () => {
    assertEquals(computeRelationship(VIEWER, 'public', []), 'public_only');
});

Deno.test('computeRelationship: private + shared tables → tables_in_common', () => {
    assertEquals(computeRelationship(VIEWER, 'private', ['t1', 't2']), 'tables_in_common');
});

Deno.test('computeRelationship: private, no shared tables → none', () => {
    assertEquals(computeRelationship(VIEWER, 'private', []), 'none');
});

// ── strangerCanReadPalate — the full matrix ──────────────────────────────────

const RELATIONSHIPS: ViewerRelationship[] = [
    'tables_in_common',
    'public_only',
    'public_and_tables',
    'none',
];

Deno.test('strangerCanReadPalate: any block denies regardless of relationship', () => {
    for (const rel of RELATIONSHIPS) {
        assertEquals(strangerCanReadPalate('viewer_blocked_target', rel), false, `viewer-block × ${rel}`);
        assertEquals(strangerCanReadPalate('target_blocked_viewer', rel), false, `target-block × ${rel}`);
    }
});

Deno.test('strangerCanReadPalate: TICKET-093(a) — public profiles read, incl. table-shared palate', () => {
    assertEquals(strangerCanReadPalate('none', 'public_only'), true);
    assertEquals(strangerCanReadPalate('none', 'public_and_tables'), true);
});

Deno.test('strangerCanReadPalate: a shared Table alone grants NOTHING on profile surfaces', () => {
    assertEquals(strangerCanReadPalate('none', 'tables_in_common'), false);
});

Deno.test('strangerCanReadPalate: no relationship → not found', () => {
    assertEquals(strangerCanReadPalate('none', 'none'), false);
});

// ── fetchBlockState ──────────────────────────────────────────────────────────

function fakeClient(rows: Array<{ blocker_id: string }> | null, error: unknown = null) {
    return {
        from: () => ({
            select: () => ({
                or: () => Promise.resolve({ data: rows, error }),
            }),
        }),
    };
}

Deno.test('fetchBlockState: no rows → none', async () => {
    assertEquals(await fetchBlockState(fakeClient([]), VIEWER, TARGET), 'none' as BlockState);
});

Deno.test('fetchBlockState: viewer blocked target', async () => {
    assertEquals(
        await fetchBlockState(fakeClient([{ blocker_id: VIEWER }]), VIEWER, TARGET),
        'viewer_blocked_target',
    );
});

Deno.test('fetchBlockState: target blocked viewer', async () => {
    assertEquals(
        await fetchBlockState(fakeClient([{ blocker_id: TARGET }]), VIEWER, TARGET),
        'target_blocked_viewer',
    );
});

Deno.test('fetchBlockState: mutual block → viewer wins (unblock stub, no existence leak)', async () => {
    assertEquals(
        await fetchBlockState(
            fakeClient([{ blocker_id: TARGET }, { blocker_id: VIEWER }]),
            VIEWER,
            TARGET,
        ),
        'viewer_blocked_target',
    );
});

Deno.test('fetchBlockState: query error throws (fail closed, no silent allow)', async () => {
    await assertRejects(() =>
        fetchBlockState(fakeClient(null, new Error('boom')), VIEWER, TARGET),
    );
});
