/**
 * UUID coercion for client-supplied idempotency keys.
 *
 * Why this exists: some React Native runtimes lack `crypto.randomUUID`, so the
 * client's nonce fallback was `${Date.now()}-${Math.random()}` — NOT a valid
 * uuid. The `entries.client_nonce` column is `uuid`, so every such log threw
 * `22P02 invalid input syntax for type uuid` → HTTP 500 → "non-2xx" on EVERY
 * entry create from an affected device. This coerces any malformed nonce to a
 * deterministic uuid so old/affected builds keep working without an app update.
 */

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_RE.test(value);
}

// Fixed namespace for deriving uuids from non-uuid nonce strings.
const NONCE_NAMESPACE = '6f3b1d2e-4a5c-5e6f-8a9b-0c1d2e3f4a5b';

function uuidToBytes(uuid: string): Uint8Array {
    const hex = uuid.replace(/-/g, '');
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
}

function bytesToUuid(bytes: Uint8Array): string {
    const hex: string[] = [];
    for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
    return (
        hex.slice(0, 4).join('') + '-' +
        hex.slice(4, 6).join('') + '-' +
        hex.slice(6, 8).join('') + '-' +
        hex.slice(8, 10).join('') + '-' +
        hex.slice(10, 16).join('')
    );
}

async function uuidv5(name: string): Promise<string> {
    const nsBytes = uuidToBytes(NONCE_NAMESPACE);
    const nameBytes = new TextEncoder().encode(name);
    const input = new Uint8Array(nsBytes.length + nameBytes.length);
    input.set(nsBytes);
    input.set(nameBytes, nsBytes.length);
    const hashBuffer = await crypto.subtle.digest('SHA-1', input.buffer as ArrayBuffer);
    const hash = new Uint8Array(hashBuffer).slice(0, 16);
    hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
    hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
    return bytesToUuid(hash);
}

/**
 * Coerce a client-supplied nonce to a valid uuid (or null).
 * - valid uuid → returned as-is.
 * - empty/nullish → null (RPC treats as no-dedup).
 * - any other string (e.g. the broken `Date.now()-Math.random()` form) →
 *   a DETERMINISTIC uuidv5 of that string, so a retry carrying the same
 *   stashed nonce still dedups correctly.
 */
export async function coerceClientNonce(value: unknown): Promise<string | null> {
    if (value === null || value === undefined || value === '') return null;
    if (isUuid(value)) return value;
    if (typeof value !== 'string') return null;
    return uuidv5(value);
}
