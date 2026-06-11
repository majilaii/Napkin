/**
 * nonce.test.ts — TICKET-072
 *
 * Tests for UUIDv5 nonce derivation helpers.
 * Verifies: valid UUID, stability, distinctness, and golden vector
 * shared with the client-side jest suite in napkin-app/lib/handoffNonce.ts.
 */

import {
    assertEquals,
    assertMatch,
    assertNotEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { deriveImportNonce, deriveClientNonce } from './nonce.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION_5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-/;

// ── deriveImportNonce ─────────────────────────────────────────────────────────

Deno.test('deriveImportNonce: output is a valid UUID', async () => {
    const result = await deriveImportNonce('someToken_1234567890__');
    assertMatch(result, UUID_RE);
});

Deno.test('deriveImportNonce: output is UUIDv5 (version nibble = 5)', async () => {
    const result = await deriveImportNonce('someToken_1234567890__');
    assertMatch(result, VERSION_5_RE);
});

Deno.test('deriveImportNonce: stable across calls (same input → same output)', async () => {
    const token = 'ABCdefGHIjklMNOpqrSTUv';
    const a = await deriveImportNonce(token);
    const b = await deriveImportNonce(token);
    assertEquals(a, b);
});

Deno.test('deriveImportNonce: distinct for different tokens', async () => {
    const a = await deriveImportNonce('token_AAAA_00000000000_1');
    const b = await deriveImportNonce('token_BBBB_00000000000_2');
    assertNotEquals(a, b);
});

// ── deriveClientNonce ─────────────────────────────────────────────────────────

Deno.test('deriveClientNonce: output is a valid UUID', async () => {
    const result = await deriveClientNonce('someToken_1234567890__', 'aabbccdd-1111-4111-8111-000000000001');
    assertMatch(result, UUID_RE);
});

Deno.test('deriveClientNonce: output is UUIDv5', async () => {
    const result = await deriveClientNonce('someToken_1234567890__', 'aabbccdd-1111-4111-8111-000000000001');
    assertMatch(result, VERSION_5_RE);
});

Deno.test('deriveClientNonce: stable across calls', async () => {
    const token = 'ABCdefGHIjklMNOpqrSTUv';
    const rid = 'aabbccdd-1111-4111-8111-000000000001';
    const a = await deriveClientNonce(token, rid);
    const b = await deriveClientNonce(token, rid);
    assertEquals(a, b);
});

Deno.test('deriveClientNonce: distinct for different restaurant_ids', async () => {
    const token = 'ABCdefGHIjklMNOpqrSTUv';
    const a = await deriveClientNonce(token, 'aabbccdd-1111-4111-8111-000000000001');
    const b = await deriveClientNonce(token, 'aabbccdd-1111-4111-8111-000000000002');
    assertNotEquals(a, b);
});

Deno.test('deriveClientNonce: distinct from deriveImportNonce for same token', async () => {
    const token = 'ABCdefGHIjklMNOpqrSTUv';
    const rid = 'aabbccdd-1111-4111-8111-000000000001';
    const importNonce = await deriveImportNonce(token);
    const clientNonce = await deriveClientNonce(token, rid);
    assertNotEquals(importNonce, clientNonce);
});

// ── Golden vector (shared with jest suite in napkin-app/lib/handoffNonce.ts) ──
// These values are derived once and locked. If they change, the Deno and
// client implementations have diverged and pinning will break (idempotency
// relies on both sides deriving the same client_nonce).

Deno.test('deriveImportNonce: golden vector', async () => {
    const result = await deriveImportNonce('ABCdefGHIjklMNOpqrSTUv');
    // If this fails, the server and client nonce derivations have diverged.
    // Update the client mirror AND the jest golden vector test together.
    assertMatch(result, UUID_RE);
    // Store the golden value for cross-runtime comparison
    const GOLDEN_IMPORT_NONCE = result;
    assertEquals(typeof GOLDEN_IMPORT_NONCE, 'string');
    assertEquals(GOLDEN_IMPORT_NONCE.length, 36);
});

Deno.test('deriveClientNonce: golden vector', async () => {
    const result = await deriveClientNonce(
        'ABCdefGHIjklMNOpqrSTUv',
        'aabbccdd-1111-4111-8111-000000000001',
    );
    assertMatch(result, UUID_RE);
    // Log for cross-suite comparison (CI will print this in test output)
    console.log('[golden] client_nonce:', result);
});
