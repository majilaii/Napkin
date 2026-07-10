/**
 * videoUrlKey — the SINGLE content-key authority for TICKET-156's On Socials rail.
 *
 * A cached cover frame is content-keyed by the CANONICAL video URL so every saver
 * of the same video shares one durable thumbnail (dedupe for free) and one
 * skip-marker. This module is imported by ALL THREE server contexts that ever
 * compute the key:
 *   - the `restaurant-history?action=social_clippings` READ (joins clip_thumbs)
 *   - the `resolve-url?action=cache_clip_thumb` CAPTURE (names the storage object)
 *   - the Deno `scripts/backfill-clip-thumbs.ts` BACKFILL
 * so the key can NEVER diverge between capture, read, and backfill. A mismatch
 * here would orphan every cached thumb — collapsing to one authority is the whole
 * game. There is deliberately NO React-Native mirror: capture goes through the
 * edge action, so the client never names an object or dedupes.
 *
 * canonicalizeVideoUrl is a PURE STRING function — no network, no imports beyond
 * the `crypto` global. [ARCH-REVIEW N3]: it therefore CANNOT resolve
 * vm.tiktok.com / vt.tiktok.com / instagram.com/share/… shortlinks (that would be
 * a network round-trip). A shortlink save and a full-URL save of the SAME video
 * produce TWO keys → two cached objects / two cards. ACCEPTED for v1. Do not add
 * network resolution here and do not claim shortlink collapsing.
 *
 * SHA-256 is deterministic across every runtime that computes it, so keys match
 * wherever they're derived.
 */

/**
 * Canonicalize a video URL to a stable key string.
 *
 * Strips query + fragment + trailing slash, lowercases the host (minus `www.`),
 * and folds the two recognized providers to their stable id form:
 *   - TikTok `…/@user/video/<id>` (or `…/video/<id>`) → `tiktok:<id>`
 *   - Instagram `…/(reel|reels|p|tv)/<code>`          → `instagram:<code>`
 * Everything else (incl. unresolvable tiktok short links — N3) keys off
 * `host + path` verbatim. IG shortcodes and TikTok ids keep their exact case /
 * digits (they are case-sensitive identifiers, never lowercased).
 */
export function canonicalizeVideoUrl(url: string): string {
    const raw = (url ?? '').trim();
    let u: URL;
    try {
        u = new URL(raw);
    } catch {
        // Not a parseable absolute URL — normalize the raw string so at least
        // identical raw strings still collapse to one key.
        return raw.toLowerCase().replace(/[/#?].*$/, '').replace(/\/+$/, '');
    }

    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, ''); // drop trailing slash(es)

    // TikTok — the full video URL carries a numeric id we can fold to.
    if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
        const m = path.match(/\/video\/(\d+)/);
        if (m) return `tiktok:${m[1]}`;
        // vm./vt. short links (and /t/<code>) can't be resolved without a
        // network hop (N3) → key off host+path verbatim. Shortlink-vs-full =
        // two keys — ACCEPTED.
        return `${host}${path}`.toLowerCase();
    }

    // Instagram — reel/post shortcode (optionally behind a /{username}/ prefix).
    if (host === 'instagram.com' || host.endsWith('.instagram.com') || host === 'instagr.am') {
        const m = path.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
        if (m) return `instagram:${m[1]}`;
        // Note: /share/reel/<code> DOES fold via the regex above (it matches the
        // inner /reel/ segment); only shortcode-less /share/ forms reach this
        // verbatim fallback. Keys stay consistent either way — every consumer
        // folds the SAME stored string (review NIT-2, 2026-07-10).
        return `${host}${path}`.toLowerCase();
    }

    // Everything else: host + path, no query/fragment/trailing slash.
    return `${host}${path}`.toLowerCase();
}

/**
 * SHA-256 hex of the canonical video URL. Deterministic across runtimes, so the
 * capture, read, and backfill contexts all derive the identical storage-object
 * key for the same video.
 */
export async function contentKey(url: string): Promise<string> {
    const canonical = canonicalizeVideoUrl(url);
    const bytes = new TextEncoder().encode(canonical);
    const buf = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}
