/**
 * contentHash.ts — Explicit content-hash inputs + HASH_VERSION.
 * TICKET-060 R13.
 *
 * Two named hashers with explicit normalization, both storing hash_version alongside
 * the cache row so a future normalization change can invalidate cleanly.
 *
 * hashImage(bytes) — sha256 over normalized JPEG bytes (after server re-decode/clamp
 *   to 768px long edge, EXIF stripped, re-encoded at fixed quality). Keyed as image_hash.
 *
 * hashTextSource(url, caption) — sha256 over canonicalized "${url}\n${caption}".
 *   url: lowercased host + path, stripped tracking params.
 *   caption: trimmed, whitespace-collapsed, lowercased.
 *   Keyed as url+caption_hash.
 *
 * HASH_VERSION: bump when normalization logic changes to invalidate old cache entries.
 */

/**
 * Current hash normalization version.
 * TICKET-063: bumped 1→2 to invalidate pre-overhaul single-object cache rows.
 * All v1 rows are a guaranteed miss; the cache re-fills with the new array shape.
 */
export const HASH_VERSION = 2;

// ── sha256 helper ─────────────────────────────────────────────────────────────

async function sha256Hex(data: Uint8Array | string): Promise<string> {
    const bytes = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data;
    // Cast to ArrayBuffer to satisfy Deno's strict SubtleCrypto overload
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Image hash ────────────────────────────────────────────────────────────────

/**
 * Hash normalized JPEG bytes (post server re-decode/clamp/EXIF-strip).
 * The caller is responsible for providing the normalized bytes (not raw upload bytes).
 * This ensures the hash is stable across different upload formats of the same image.
 */
export async function hashImage(normalizedJpegBytes: Uint8Array): Promise<string> {
    return sha256Hex(normalizedJpegBytes);
}

// ── Tracking param strip list ─────────────────────────────────────────────────

/** Query params that are pure tracking noise (never affect content). */
const TRACKING_PARAMS = new Set([
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'fbclid', 'gclid', 'gad_source', 'ref', 'igsh', 'igshid',
    's', 'si',   // TikTok share params
]);

/**
 * Canonicalize a URL for hashing:
 * - Lowercase the scheme + host
 * - Keep path (case-sensitive — restaurant pages differ by path)
 * - Remove tracking query params; keep remaining params sorted
 * - Remove fragment
 */
function canonicalizeUrl(rawUrl: string): string {
    try {
        const u = new URL(rawUrl);
        const canonical = new URL(rawUrl);
        canonical.protocol = u.protocol.toLowerCase();
        canonical.hostname = u.hostname.toLowerCase();
        canonical.hash = '';

        // Filter tracking params; keep the rest sorted for stable ordering
        const kept: [string, string][] = [];
        for (const [k, v] of u.searchParams.entries()) {
            if (!TRACKING_PARAMS.has(k.toLowerCase())) {
                kept.push([k, v]);
            }
        }
        kept.sort((a, b) => a[0].localeCompare(b[0]));
        canonical.search = '';
        for (const [k, v] of kept) {
            canonical.searchParams.set(k, v);
        }

        return canonical.toString();
    } catch {
        // Not a valid URL — normalize as bare string
        return rawUrl.trim().toLowerCase();
    }
}

/**
 * Normalize caption for hashing: trim, collapse whitespace, lowercase.
 * Empty/null normalizes to empty string.
 */
function normalizeCaption(caption: string | null | undefined): string {
    if (!caption) return '';
    return caption
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

/**
 * Hash a URL + optional caption for text-sourced extractions.
 * Returns a stable sha256 over `canonicalized_url\nnormalized_caption`.
 * An empty/null caption produces the same key as omitting it.
 */
export async function hashTextSource(
    url: string,
    caption?: string | null,
): Promise<string> {
    const canonUrl = canonicalizeUrl(url);
    const normCaption = normalizeCaption(caption);
    return sha256Hex(`${canonUrl}\n${normCaption}`);
}
