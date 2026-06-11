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
// These literals are the canonical cross-runtime constants.
// If EITHER test fails, the server and client nonce derivations have diverged
// and per-spot idempotency is broken — update BOTH suites together.
//
// Derived from:
//   HANDOFF_NAMESPACE = '5c8d4f2a-1b3e-5a7c-9d0f-2e4b6c8a0d1f'
//   TOKEN             = 'ABCdefGHIjklMNOpqrSTUv'
//   RID               = 'aabbccdd-1111-4111-8111-000000000001'
//   importNonce  = UUIDv5(NAMESPACE, TOKEN)
//   clientNonce  = UUIDv5(NAMESPACE, `${TOKEN}:${RID}`)
const GOLDEN_IMPORT_NONCE = 'b9c66a05-6132-5288-8757-6020d0c687f1';
const GOLDEN_CLIENT_NONCE = '4fde7b73-7ca3-549e-ba42-f964ebf54f63';

Deno.test('deriveImportNonce: golden vector matches hardcoded cross-runtime literal', async () => {
    const result = await deriveImportNonce('ABCdefGHIjklMNOpqrSTUv');
    // Divergence here means the Deno and client implementations differ —
    // update napkin-app/lib/__tests__/handoffNonce.test.ts simultaneously.
    assertEquals(result, GOLDEN_IMPORT_NONCE);
});

Deno.test('deriveClientNonce: golden vector matches hardcoded cross-runtime literal', async () => {
    const result = await deriveClientNonce(
        'ABCdefGHIjklMNOpqrSTUv',
        'aabbccdd-1111-4111-8111-000000000001',
    );
    // Divergence here means the Deno and client implementations differ —
    // update napkin-app/lib/__tests__/handoffNonce.test.ts simultaneously.
    assertEquals(result, GOLDEN_CLIENT_NONCE);
});
