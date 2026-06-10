/**
 * Tests for imageResize.ts — resizeImageToLimit.
 * TICKET-063 Step 1.
 *
 * These tests verify:
 *   - Aborted signal → returns null immediately (no ImageScript load)
 *   - Non-image bytes → returns null (fail-soft decode failure)
 *   - Empty bytes → returns null
 *
 * NOTE: Actual resize-to-768px and JPEG encode tests require ImageScript which
 * dynamically imports from deno.land/x. Those tests are skipped in CI (no network)
 * and documented below as integration-only.
 *
 * Run with: deno test supabase/functions/_shared/imageResize.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { resizeImageToLimit } from './imageResize.ts';

// ── Abort signal ──────────────────────────────────────────────────────────────

Deno.test('resizeImageToLimit: already-aborted signal → returns null immediately', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await resizeImageToLimit(new Uint8Array([1, 2, 3]), controller.signal);
    assertEquals(result, null);
});

// ── Empty / invalid bytes ─────────────────────────────────────────────────────

Deno.test('resizeImageToLimit: empty bytes → returns null (fail-soft)', async () => {
    const result = await resizeImageToLimit(new Uint8Array(0));
    assertEquals(result, null);
});

Deno.test('resizeImageToLimit: random non-image bytes → returns null (fail-soft)', async () => {
    // Not a valid JPEG/PNG/GIF — ImageScript will fail to decode
    const garbage = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0xde, 0xad, 0xbe, 0xef]);
    const result = await resizeImageToLimit(garbage);
    assertEquals(result, null);
});

Deno.test('resizeImageToLimit: plain text bytes → returns null (fail-soft)', async () => {
    const text = new TextEncoder().encode('hello world, this is not an image');
    const result = await resizeImageToLimit(text);
    assertEquals(result, null);
});

// ── Return shape contract ─────────────────────────────────────────────────────

// Integration note: a real 1×1 JPEG test would require ImageScript to load from
// deno.land/x. That is an integration test only (network access required).
// The shape contract is: { data: Uint8Array; mimeType: 'image/jpeg' } | null.
// The null path is comprehensively tested above.

Deno.test('resizeImageToLimit: return type is Promise (always)', () => {
    const p = resizeImageToLimit(new Uint8Array([0xff, 0xd8, 0xff])); // JPEG magic bytes, incomplete
    assertEquals(typeof p.then, 'function');
    return p.then((r) => {
        // Either null (decode failed) or { data, mimeType } — both are valid; just check shape if non-null
        if (r !== null) {
            assertEquals(r.mimeType, 'image/jpeg');
            assertEquals(r.data instanceof Uint8Array, true);
        }
        // null is also acceptable for this truncated JPEG
    });
});
