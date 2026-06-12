/**
 * uuid — client-side UUID generation for nonces (TICKET-078).
 *
 * Why this exists: several client_nonce / import_nonce values feed `uuid` DB
 * columns (e.g. entries.client_nonce). When `crypto.randomUUID` is missing on
 * the RN runtime, the old fallback `${Date.now()}-${Math.random()}` produced a
 * malformed string that the server had to coerce — and any code relying on the
 * nonce being a real uuid for dedup could silently break. This helper always
 * returns a format-valid RFC-4122 v4 uuid.
 *
 * Cryptographic strength is NOT required here — these are idempotency nonces,
 * not secrets. Format validity (so the value survives a `::uuid` cast and the
 * (user_id, client_nonce) unique index) is the only requirement.
 */

/**
 * Return a format-valid RFC-4122 v4 uuid.
 *
 * Uses native `crypto.randomUUID()` when present; otherwise builds a valid v4
 * string from `Math.random()` (version nibble = 4, variant nibble ∈ [8,9,a,b]).
 */
export function safeRandomUUID(): string {
    const native = globalThis.crypto?.randomUUID;
    if (typeof native === 'function') {
        return native.call(globalThis.crypto);
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
