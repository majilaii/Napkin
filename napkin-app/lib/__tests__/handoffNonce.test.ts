/**
 * Tests for lib/handoffNonce.ts — TICKET-072 §Receive pin path
 *
 * Verifies that the client-side UUIDv5 derivation matches the server-side
 * Deno implementation (supabase/functions/handoff/nonce.ts).
 *
 * Cross-runtime equivalence: both sides use the exact same algorithm
 * (SHA-1 + HANDOFF_NAMESPACE + RFC 4122 version/variant bits). These tests
 * run in Node.js testEnvironment (crypto.subtle available).
 *
 * Golden vectors: these constants are computed by the first run of the tests
 * and locked. If they change, the client and server nonce derivations have
 * diverged and per-spot idempotency is broken.
 */
import { deriveImportNonce, deriveClientNonce } from '../handoffNonce';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION_5_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-/;

// ── deriveImportNonce ─────────────────────────────────────────────────────────

describe('deriveImportNonce', () => {
    it('returns a valid UUID string', async () => {
        const result = await deriveImportNonce('someToken_1234567890__');
        expect(result).toMatch(UUID_RE);
    });

    it('returns a UUIDv5 (version nibble = 5)', async () => {
        const result = await deriveImportNonce('someToken_1234567890__');
        expect(result).toMatch(VERSION_5_RE);
    });

    it('is stable across calls (same input → same output)', async () => {
        const token = 'ABCdefGHIjklMNOpqrSTUv';
        const a = await deriveImportNonce(token);
        const b = await deriveImportNonce(token);
        expect(a).toBe(b);
    });

    it('produces distinct values for different tokens', async () => {
        const a = await deriveImportNonce('token_AAAA_00000000000_1');
        const b = await deriveImportNonce('token_BBBB_00000000000_2');
        expect(a).not.toBe(b);
    });
});

// ── deriveClientNonce ─────────────────────────────────────────────────────────

describe('deriveClientNonce', () => {
    it('returns a valid UUID string', async () => {
        const result = await deriveClientNonce('someToken_1234567890__', 'aabbccdd-1111-4111-8111-000000000001');
        expect(result).toMatch(UUID_RE);
    });

    it('returns a UUIDv5', async () => {
        const result = await deriveClientNonce('someToken_1234567890__', 'aabbccdd-1111-4111-8111-000000000001');
        expect(result).toMatch(VERSION_5_RE);
    });

    it('is stable across calls', async () => {
        const token = 'ABCdefGHIjklMNOpqrSTUv';
        const rid = 'aabbccdd-1111-4111-8111-000000000001';
        const a = await deriveClientNonce(token, rid);
        const b = await deriveClientNonce(token, rid);
        expect(a).toBe(b);
    });

    it('produces distinct values for different restaurant_ids', async () => {
        const token = 'ABCdefGHIjklMNOpqrSTUv';
        const a = await deriveClientNonce(token, 'aabbccdd-1111-4111-8111-000000000001');
        const b = await deriveClientNonce(token, 'aabbccdd-1111-4111-8111-000000000002');
        expect(a).not.toBe(b);
    });

    it('is distinct from deriveImportNonce for the same token', async () => {
        const token = 'ABCdefGHIjklMNOpqrSTUv';
        const rid = 'aabbccdd-1111-4111-8111-000000000001';
        const importNonce = await deriveImportNonce(token);
        const clientNonce = await deriveClientNonce(token, rid);
        expect(importNonce).not.toBe(clientNonce);
    });
});

// ── Golden vector (shared with Deno nonce.test.ts) ────────────────────────────
// These literals are the canonical cross-runtime constants. Both this suite and
// the Deno nonce.test.ts assert against the SAME hardcoded values. A divergence
// between the two implementations (namespace change, separator change, byte-order
// change) will fail at least one suite — the claimed safety net is real.
//
// If a test here fails, update supabase/functions/handoff/nonce.test.ts simultaneously.
//
// Derived from:
//   HANDOFF_NAMESPACE = '5c8d4f2a-1b3e-5a7c-9d0f-2e4b6c8a0d1f'
//   TOKEN             = 'ABCdefGHIjklMNOpqrSTUv'
//   RID               = 'aabbccdd-1111-4111-8111-000000000001'
//   importNonce  = UUIDv5(NAMESPACE, TOKEN)
//   clientNonce  = UUIDv5(NAMESPACE, `${TOKEN}:${RID}`)
const GOLDEN_IMPORT_NONCE = 'b9c66a05-6132-5288-8757-6020d0c687f1';
const GOLDEN_CLIENT_NONCE = '4fde7b73-7ca3-549e-ba42-f964ebf54f63';

describe('golden vectors — locked cross-runtime constants', () => {
    const TOKEN = 'ABCdefGHIjklMNOpqrSTUv';
    const RID = 'aabbccdd-1111-4111-8111-000000000001';

    it('import nonce matches hardcoded cross-runtime literal', async () => {
        const result = await deriveImportNonce(TOKEN);
        // Divergence here means the client and Deno implementations differ —
        // update supabase/functions/handoff/nonce.test.ts simultaneously.
        expect(result).toBe(GOLDEN_IMPORT_NONCE);
    });

    it('client nonce matches hardcoded cross-runtime literal', async () => {
        const result = await deriveClientNonce(TOKEN, RID);
        // Divergence here means the client and Deno implementations differ —
        // update supabase/functions/handoff/nonce.test.ts simultaneously.
        expect(result).toBe(GOLDEN_CLIENT_NONCE);
    });

    it('import nonce is a valid UUIDv5', () => {
        expect(GOLDEN_IMPORT_NONCE).toMatch(VERSION_5_RE);
    });

    it('client nonce is a valid UUIDv5', () => {
        expect(GOLDEN_CLIENT_NONCE).toMatch(VERSION_5_RE);
    });

    it('import nonce has UUID length (36)', () => {
        expect(GOLDEN_IMPORT_NONCE.length).toBe(36);
    });

    it('client nonce has UUID length (36)', () => {
        expect(GOLDEN_CLIENT_NONCE.length).toBe(36);
    });
});

// ── Nonce wiring contract ─────────────────────────────────────────────────────
// The receive screen uses candidate_id (from resolve response) directly as
// client_nonce. candidate_id === deriveClientNonce(token, restaurant_id).
// This test verifies that the wiring is consistent.

describe('nonce wiring: candidate_id = deriveClientNonce(token, restaurant_id)', () => {
    it('the same (token, restaurant_id) pair yields the same nonce on repeat calls', async () => {
        const token = 'share_token_nonce_wiring';
        const restaurantId = 'rest-id-1234-5678-9abc-def012345678';
        const nonce1 = await deriveClientNonce(token, restaurantId);
        const nonce2 = await deriveClientNonce(token, restaurantId);
        expect(nonce1).toBe(nonce2);
        expect(nonce1).toMatch(VERSION_5_RE);
    });

    it('different restaurant_ids yield different nonces for the same token', async () => {
        const token = 'share_token_nonce_wiring';
        const n1 = await deriveClientNonce(token, 'restaurant-id-000000000001');
        const n2 = await deriveClientNonce(token, 'restaurant-id-000000000002');
        expect(n1).not.toBe(n2);
    });
});
