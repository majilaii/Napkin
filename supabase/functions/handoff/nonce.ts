/**
 * nonce.ts — deterministic UUIDv5 derivation for handoff receive nonces.
 *
 * TICKET-072 ARCH-REVIEW-2 #10 / Tech Design §Receive pin path:
 *   import_nonce  = deriveImportNonce(share_token)
 *   client_nonce  = deriveClientNonce(share_token, restaurant_id)
 *
 * These must match the client-side mirror in napkin-app/lib/handoffNonce.ts.
 * Golden test vectors in nonce.test.ts are shared with the jest suite.
 *
 * Algorithm: UUIDv5 (SHA-1 + namespace) per RFC 4122 §4.3.
 * Namespace: a fixed UUID reserved for Napkin handoff nonces.
 */

/** Napkin handoff nonce namespace UUID (fixed, never change after deploy). */
const HANDOFF_NAMESPACE = '5c8d4f2a-1b3e-5a7c-9d0f-2e4b6c8a0d1f';

/** Parse a UUID string to its 16-byte representation. */
function uuidToBytes(uuid: string): Uint8Array {
    const hex = uuid.replace(/-/g, '');
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

/** Format 16 bytes as a UUID string. */
function bytesToUuid(bytes: Uint8Array): string {
    const h = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * UUIDv5: SHA-1(namespace || name), version + variant bits set per RFC 4122.
 * Available in Deno, browsers, and Node 19+ via crypto.subtle.
 */
async function uuidv5(namespace: string, name: string): Promise<string> {
    const nsBytes = uuidToBytes(namespace);
    const nameBytes = new TextEncoder().encode(name);

    const input = new Uint8Array(nsBytes.length + nameBytes.length);
    input.set(nsBytes);
    input.set(nameBytes, nsBytes.length);

    const hashBuffer = await crypto.subtle.digest('SHA-1', input.buffer as ArrayBuffer);
    const hash = new Uint8Array(hashBuffer).slice(0, 16);

    // Version 5 (0101 in top nibble of byte 6)
    hash[6] = (hash[6] & 0x0f) | 0x50;
    // RFC 4122 variant (10xx in top two bits of byte 8)
    hash[8] = (hash[8] & 0x3f) | 0x80;

    return bytesToUuid(hash);
}

/**
 * Derive the import_nonce for a whole handoff receive job.
 * Stable per (token) → same nonce on retry.
 */
export async function deriveImportNonce(shareToken: string): Promise<string> {
    return uuidv5(HANDOFF_NAMESPACE, shareToken);
}

/**
 * Derive the client_nonce for a single spot in a handoff receive.
 * Stable per (token, restaurant_id) → same nonce on re-receipt → already_pinned.
 * Rides the existing (user_id, client_nonce) UNIQUE in fn_save_import_spot.
 */
export async function deriveClientNonce(shareToken: string, restaurantId: string): Promise<string> {
    return uuidv5(HANDOFF_NAMESPACE, `${shareToken}:${restaurantId}`);
}
