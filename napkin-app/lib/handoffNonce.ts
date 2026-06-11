/**
 * handoffNonce — client-side UUIDv5 nonce derivation for handoff receive.
 *
 * TICKET-072 §Receive pin path / ARCH-REVIEW-2 #10:
 *   import_nonce  = deriveImportNonce(share_token)
 *   client_nonce  = deriveClientNonce(share_token, restaurant_id)
 *
 * This is the EXACT mirror of supabase/functions/handoff/nonce.ts.
 * Any change here must be mirrored on the server and vice versa — divergence
 * breaks per-spot idempotency (the (user_id, client_nonce) unique in
 * fn_save_import_spot relies on both sides producing the same nonce).
 *
 * NOTE: In practice, the handoff receive screen can use the server-provided
 * `candidate_id` directly as the `client_nonce` (the server derives it via
 * deriveClientNonce and sends it in the resolve response). `deriveImportNonce`
 * is needed for the job-level import_nonce which is NOT sent by the server.
 *
 * Algorithm: UUIDv5 (SHA-1 + namespace) per RFC 4122 §4.3.
 * Namespace: a fixed UUID reserved for Napkin handoff nonces.
 * Runtime: available in Node 19+, Hermes (React Native 0.73+/Expo 50+),
 *   and browser via crypto.subtle.
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
 * Available in Deno, Hermes (Expo 50+), browsers, and Node 19+ via crypto.subtle.
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
 *
 * In practice the server sends this value as `candidate_id` in the resolve response,
 * so the receive screen uses `candidate_id` directly as the `client_nonce` without
 * re-deriving. This function is exported for testing / golden-vector validation.
 */
export async function deriveClientNonce(shareToken: string, restaurantId: string): Promise<string> {
    return uuidv5(HANDOFF_NAMESPACE, `${shareToken}:${restaurantId}`);
}
