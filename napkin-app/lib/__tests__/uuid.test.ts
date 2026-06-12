/**
 * Tests for lib/uuid.ts — TICKET-078 §B (proper client UUID).
 *
 * safeRandomUUID() feeds `uuid` DB columns (entries.client_nonce, import_nonce),
 * so the ONLY contract that matters is format validity: every value must match
 * the RFC-4122 v4 shape (version nibble 4, variant nibble ∈ [8,9,a,b]) so it
 * survives a `::uuid` cast. We also assert successive calls differ (it's a
 * nonce — collisions would break the (user_id, client_nonce) unique index).
 *
 * Runs in the Node test environment where crypto.randomUUID is available, so
 * this exercises the native path; the Math.random fallback shares the exact
 * same regex contract.
 */
import { safeRandomUUID } from '../uuid';

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('safeRandomUUID', () => {
    it('always returns a format-valid RFC-4122 v4 uuid (1000 iterations)', () => {
        for (let i = 0; i < 1000; i++) {
            const id = safeRandomUUID();
            expect(id).toMatch(V4_RE);
        }
    });

    it('returns a different value on two successive calls', () => {
        expect(safeRandomUUID()).not.toBe(safeRandomUUID());
    });

    it('produces a valid v4 uuid via the Math.random fallback (no native crypto.randomUUID)', () => {
        const original = globalThis.crypto?.randomUUID;
        try {
            // Force the fallback branch.
            if (globalThis.crypto) {
                // @ts-expect-error — deliberately remove for this test
                globalThis.crypto.randomUUID = undefined;
            }
            for (let i = 0; i < 1000; i++) {
                expect(safeRandomUUID()).toMatch(V4_RE);
            }
        } finally {
            if (globalThis.crypto && original) {
                globalThis.crypto.randomUUID = original;
            }
        }
    });
});
