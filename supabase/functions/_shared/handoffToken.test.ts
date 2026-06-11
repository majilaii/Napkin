/**
 * handoffToken.test.ts — TICKET-072
 *
 * Tests for mintShareToken and toBase64url.
 * Verifies: base64url format, correct length (22 chars), no padding, entropy.
 */

import {
    assertEquals,
    assertMatch,
    assertNotEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { mintShareToken, toBase64url } from './handoffToken.ts';

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

// ── toBase64url ───────────────────────────────────────────────────────────────

Deno.test('toBase64url: produces base64url chars only (no +/=)', () => {
    for (let i = 0; i < 20; i++) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const result = toBase64url(bytes);
        assertMatch(result, BASE64URL_RE);
        assertEquals(result.includes('+'), false);
        assertEquals(result.includes('/'), false);
        assertEquals(result.includes('='), false);
    }
});

Deno.test('toBase64url: 16 bytes → 22 chars (no padding)', () => {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const result = toBase64url(bytes);
    assertEquals(result.length, 22);
});

Deno.test('toBase64url: deterministic for same input', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const a = toBase64url(bytes);
    const b = toBase64url(bytes);
    assertEquals(a, b);
});

// ── mintShareToken ────────────────────────────────────────────────────────────

Deno.test('mintShareToken: returns 22-char base64url string', () => {
    const token = mintShareToken();
    assertEquals(token.length, 22);
    assertMatch(token, BASE64URL_RE);
});

Deno.test('mintShareToken: no base64 padding', () => {
    const token = mintShareToken();
    assertEquals(token.includes('='), false);
});

Deno.test('mintShareToken: uses base64url alphabet (no + or /)', () => {
    for (let i = 0; i < 20; i++) {
        const token = mintShareToken();
        assertEquals(token.includes('+'), false, 'token must not contain +');
        assertEquals(token.includes('/'), false, 'token must not contain /');
    }
});

Deno.test('mintShareToken: two calls produce different tokens (entropy check)', () => {
    // Statistical: probability of collision in 128-bit space is negligible
    const a = mintShareToken();
    const b = mintShareToken();
    assertNotEquals(a, b, 'two consecutive tokens should differ');
});

Deno.test('mintShareToken: 128-bit entropy (16 bytes → 22 base64url chars)', () => {
    // Base64url encodes 6 bits per char; 22 chars = 132 bits (128 bits of data, 4 padding bits)
    // The actual data is 16 bytes = 128 bits — no collision risk
    const token = mintShareToken();
    assertEquals(token.length, 22);
    // A 22-char base64url string can represent 132 bits; we use 128 (the last 4 bits are 0)
    // This just confirms the length which is the measurable property
});
