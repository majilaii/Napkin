/**
 * htmlEscape.ts — HTML injection prevention for the share-page renderer.
 *
 * TICKET-072 ARCH-REVIEW-2 #10: split escapeText / escapeAttr / safeHref.
 * EVERY string interpolation in the rendered HTML passes through one of these.
 *
 * Rules:
 *   escapeText  — body text content (& < > )
 *   escapeAttr  — attribute values including og: meta content (& < > " ')
 *   safeHref    — href values; https-only whitelist; returns null for rejected URLs
 *
 * The CTA scheme link (napkin://) is GENERATED from a validated token, not
 * interpolated from external input — but escapeAttr is still applied for
 * defence-in-depth and to satisfy the "every interpolation" invariant.
 */

/** Escape body text: & < > */
export function escapeText(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Escape attribute value: & < > " ' */
export function escapeAttr(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Validate and escape a URL for use in an href attribute.
 * Only https: scheme is permitted (ARCH-REVIEW-2 #10: TESTFLIGHT_PUBLIC_URL whitelist).
 * Returns null for any non-https URL, malformed URL, or non-string input.
 *
 * Callers that receive null should fall back to plaintext or omit the link.
 */
export function safeHref(url: unknown): string | null {
    if (typeof url !== 'string') return null;
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:') return null;
    return escapeAttr(url);
}
