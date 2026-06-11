/**
 * handoffToken.ts — mint unguessable share tokens.
 *
 * Specification (TICKET-072 ARCH-REVIEW-2 #9):
 *   - 16 random bytes via crypto.getRandomValues (≥128 bits entropy)
 *   - base64url encoding, NO padding (22 chars output)
 *   - Never crypto.randomUUID(): hyphens and version bits reduce effective entropy
 *
 * The INSERT retry loop (≤3 on unique violation) lives in the edge function,
 * not here — this module only handles the generation of one candidate token.
 */

/**
 * Encode a Uint8Array as base64url without padding.
 * Safe characters: A-Z a-z 0-9 _ - (RFC 4648 §5)
 */
export function toBase64url(bytes: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...bytes));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Mint a single 16-byte base64url share token (22 chars, 128 bits).
 * Callers must wrap in a ≤3-retry loop and catch `23505` unique violations.
 */
export function mintShareToken(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return toBase64url(bytes);
}
