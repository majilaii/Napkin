/**
 * Rate-limit bucket id for a signed-out guest (TICKET-247).
 *
 * check_and_increment_rate_limit keys buckets by a uuid. A guest has no user
 * id, so the key is sha256(day | client ip) folded into uuid form. The daily
 * salt keeps the stored key from becoming a stable per-IP identifier, and the
 * raw address is never persisted anywhere.
 *
 * Which header: Supabase fronts edge functions with Cloudflare, which sets
 * cf-connecting-ip itself and overwrites any client-sent value, so it is the
 * one source a caller cannot forge. The first x-forwarded-for hop is the
 * fallback: forgeable (a client can prepend its own value), but never shared
 * across callers. x-real-ip comes last because a proxy may fill it with its own
 * peer address, which would put every guest into one bucket and rate-limit
 * them all together.
 */
export type ClientIpSource = 'cf-connecting-ip' | 'x-forwarded-for' | 'x-real-ip' | 'unknown';

export function clientIp(headers: Headers): { ip: string; source: ClientIpSource } {
    const cf = headers.get('cf-connecting-ip')?.trim();
    if (cf) return { ip: cf, source: 'cf-connecting-ip' };
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return { ip: forwarded, source: 'x-forwarded-for' };
    const real = headers.get('x-real-ip')?.trim();
    if (real) return { ip: real, source: 'x-real-ip' };
    return { ip: 'unknown', source: 'unknown' };
}

export async function guestBucketId(headers: Headers, now = new Date()): Promise<string> {
    const day = now.toISOString().slice(0, 10);
    const digest = new Uint8Array(
        await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(`${day}|${clientIp(headers).ip}`),
        ),
    );
    const hex = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
