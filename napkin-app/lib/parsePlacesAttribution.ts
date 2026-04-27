/**
 * parsePlacesAttribution — parse a Places attribution HTML string into a
 * { label, href } tuple for rendering in RestaurantHero.
 *
 * Input is server-synthesized HTML from a sanitized authorAttributions response.
 * Do NOT call this on raw user input. The capture path in places-search/index.ts
 * escapes both displayName and uri before HTML synthesis, so this parser only
 * ever sees markup we wrote — the regex approach is safe for this constrained input.
 *
 * TICKET-057 AC 8a + [ARCH-REVIEW] #3.
 */

/** Maximum input length — defense-in-depth against malformed column values. */
const MAX_INPUT_LENGTH = 1024;

/**
 * Parse the first anchor (or plain text) from a Places attribution HTML string.
 *
 * Returns:
 *   { label: string; href: string | null } — label to display, href to open on tap
 *                                             (null when no safe link is present).
 *   null — when input is empty, whitespace-only, or yields an empty label.
 */
export function parsePlacesAttribution(
    html: string | null | undefined,
): { label: string; href: string | null } | null {
    if (!html) return null;
    // Defense-in-depth: reject oversized inputs (should not happen with server-synthesized HTML).
    if (html.length > MAX_INPUT_LENGTH) return null;
    const trimmed = html.trim();
    if (!trimmed) return null;

    // Match the FIRST <a href="..."> anchor (per AC 13 first-wins).
    // Tolerates single or double quotes, optional attributes before/after href.
    const anchorRe = /<a\s+[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/i;
    const m = trimmed.match(anchorRe);
    if (m) {
        // Decode HTML entities (e.g. &amp; → &) before scheme validation so the
        // href passed to Linking.openURL is the real URL, not the escaped form.
        const rawHref = decodeEntities(m[1]).trim();
        const innerText = stripTags(m[2]);
        const label = decodeEntities(innerText).trim();
        if (!label) return null; // empty label → treat as empty attribution per AC 8a
        const safeHref = isSafeUrl(rawHref) ? rawHref : null;
        if (!safeHref && rawHref) {
            // AC 8: non-http(s) scheme — log and render non-tappable.
            console.warn('[parsePlacesAttribution] rejecting non-http(s) href', rawHref);
        }
        return { label, href: safeHref };
    }

    // No anchor — fall back to plain decoded label.
    const label = decodeEntities(stripTags(trimmed)).trim();
    if (!label) return null;
    return { label, href: null };
}

function stripTags(s: string): string {
    return s.replace(/<[^>]*>/g, '');
}

function decodeEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function isSafeUrl(href: string): boolean {
    // AC 8 — only http(s). Reject javascript:, data:, file:, custom schemes.
    return /^https?:\/\//i.test(href.trim());
}
