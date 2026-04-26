/**
 * URL validation helper — shared between the resolve-url edge function (server)
 * and the RN app (client via shim at napkin-app/lib/urlValidation.ts).
 *
 * Architecture decision [M2]: strict pre-flight.
 * - Scheme allowlist: https:, http: only
 * - Max length: 2048
 * - Reject localhost / private IP ranges / bare IPv4
 *
 * Dependency-free: uses globals only (URL constructor is available everywhere).
 */

export type ValidateUrlResult =
    | { ok: true; url: URL }
    | { ok: false; reason: 'length' | 'parse' | 'scheme' | 'host' };

// SSRF guard — block local + private + link-local + unique-local + cloud-metadata.
// IPv4: 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 (link-local + AWS metadata 169.254.169.254),
// 172.16.0.0/12 (RFC1918 second range), 192.168.0.0/16, 0.0.0.0
// IPv6: ::1 (loopback), fe80::/10 (link-local), fc00::/7 (unique-local)
const PRIVATE_HOST_RE = new RegExp(
    '^(' +
        'localhost' +
        '|127\\.' +
        '|10\\.' +
        '|169\\.254\\.' +
        '|192\\.168\\.' +
        // 172.16.0.0/12 → 172.16.x – 172.31.x
        '|172\\.(1[6-9]|2[0-9]|3[0-1])\\.' +
        '|0\\.0\\.0\\.0' +
        '|::1$' +
        '|\\[?::1\\]?' +
        // IPv6 link-local fe80::/10
        '|\\[?fe[89ab][0-9a-f]:' +
        // IPv6 unique-local fc00::/7
        '|\\[?f[cd][0-9a-f]{2}:' +
    ')',
    'i',
);
// Bare IPv4: four octets with dots (no further path / port distinction needed at this level)
const BARE_IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

export function validateUrl(input: string): ValidateUrlResult {
    if (typeof input !== 'string' || input.length > 2048) {
        return { ok: false, reason: 'length' };
    }

    let parsed: URL;
    try {
        parsed = new URL(input);
    } catch {
        return { ok: false, reason: 'parse' };
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { ok: false, reason: 'scheme' };
    }

    const host = parsed.hostname;
    if (PRIVATE_HOST_RE.test(host) || BARE_IPV4_RE.test(host)) {
        return { ok: false, reason: 'host' };
    }

    return { ok: true, url: parsed };
}
