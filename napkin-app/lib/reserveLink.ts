/**
 * reserveLink — find a restaurant's direct booking-page URL.
 *
 * Google Places exposes no reservation link (Reserve with Google is
 * partner-only), but nearly every reservable restaurant links its booking
 * platform from its own website. These patterns match the platforms'
 * venue-page URL shapes, in confidence order — first hit wins.
 *
 * Client uses this for the tier-0 case (the stored `website` itself being a
 * booking page — instant, works for ghosts). The server mirror additionally
 * fetches the website HTML and scans it with the same patterns.
 *
 * Mirrored in supabase/functions/_shared/reserveLink.ts (Deno) — keep the
 * pattern lists byte-identical (same precedent as lib/pagination.ts).
 */

interface BookingPattern {
    platform: string;
    re: RegExp;
    /** Rebuild a canonical URL from the match (e.g. widget rid → restref link). */
    normalize?: (m: RegExpExecArray) => string;
}

export const BOOKING_PATTERNS: BookingPattern[] = [
    {
        // Canonical venue page: opentable.com/r/<slug> (any country TLD).
        platform: 'opentable',
        re: /https?:\/\/(?:www\.)?opentable\.[a-z.]{2,11}\/r\/[a-z0-9][\w-]*[^\s"'<>]*/i,
    },
    {
        // Widget/restref embeds carry the numeric restaurant id (often
        // protocol-relative in embed snippets).
        platform: 'opentable',
        re: /(?:https?:)?\/\/(?:www\.)?opentable\.[a-z.]{2,11}\/(?:restref\/client\/?|widget\/reservation\/loader)[^\s"'<>]*?[?&]rid=(\d+)/i,
        normalize: (m) => `https://www.opentable.com/restref/client/?rid=${m[1]}`,
    },
    {
        platform: 'resy',
        re: /https?:\/\/(?:www\.)?resy\.com\/cities\/[\w-]+\/(?:venues\/)?[\w-]+[^\s"'<>]*/i,
    },
    {
        // Resy embed widget — openable standalone; keep as matched.
        platform: 'resy',
        re: /(?:https?:)?\/\/widgets\.resy\.com\/[^\s"'<>]*?[?&]venueId=\d+[^\s"'<>]*/i,
    },
    {
        platform: 'sevenrooms',
        // `(?!embed\b)` — the widget loader script (reservations/embed.js) is
        // not a venue page; skipping it lets the real experiences/explore
        // hrefs further down the document match instead.
        re: /https?:\/\/(?:www\.)?sevenrooms\.com\/(?:reservations|explore|experiences|events)\/(?!embed\b)[^\s"'<>]+/i,
    },
    {
        platform: 'tock',
        re: /https?:\/\/(?:www\.)?(?:exploretock|tock)\.com\/(?!(?:join|business|pricing|blog|careers|legal|privacy|terms|support|city|how-it-works|sitemap|gift-cards|giftcards|faq|about|contact)\b)[a-z0-9][\w-]*(?:\/[^\s"'<>]*)?/i,
    },
    {
        platform: 'thefork',
        re: /https?:\/\/(?:www\.)?(?:thefork|lafourchette)\.[a-z.]{2,11}\/restaurant[^\s"'<>]+/i,
    },
    {
        platform: 'tablecheck',
        re: /https?:\/\/(?:www\.)?tablecheck\.com\/(?:[a-z]{2}\/)?shops\/[\w-]+[^\s"'<>]*/i,
    },
    {
        platform: 'chope',
        re: /https?:\/\/book\.chope\.co\/[^\s"'<>]+/i,
    },
    {
        platform: 'inline',
        re: /https?:\/\/inline\.app\/booking\/[^\s"'<>]+/i,
    },
    {
        platform: 'quandoo',
        re: /https?:\/\/(?:www\.)?quandoo\.[a-z.]{2,11}\/(?:[a-z]{2}\/)?place\/[^\s"'<>]+/i,
    },
    {
        // Legacy opentable.com/<slug> venue pages — last (loosest shape).
        // Denylist covers search ("/s"), marketing, and region-index segments.
        platform: 'opentable',
        re: /https?:\/\/(?:www\.)?opentable\.[a-z.]{2,11}\/(?!(?:s|r|start|restref|widget|about|blog|promo|legal|privacy|terms|careers|help|features|lists|cuisine|dev|m|c|b|g|landmark|neighborhood|metro|region)(?:[/?#"'\s<>]|$))(?![\w-]*-restaurants(?:[/?#"'\s<>]|$))[a-z0-9][\w-]{2,}\/?(?=[?#"'\s<>]|$)/i,
    },
];

/** Trailing junk regexes swallow when a URL sits in prose or escaped markup. */
function trimUrl(url: string): string {
    return url.replace(/[)\]},.;\\]+$/, '');
}

/**
 * Scan text (a bare URL or a blob of HTML) for a booking-platform venue URL.
 * Returns the highest-confidence match, or null.
 */
export function findBookingUrl(text: string | null | undefined): string | null {
    if (!text) return null;
    // Unescape the shapes booking links hide in: JSON-escaped slashes
    // (`https:\/\/…` in embedded JSON/JSON-LD), HTML entities (named and
    // numeric — `&#34;` closing quotes otherwise ride along in the match), &.
    const haystack = text
        .replace(/\\\//g, '/')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#34;?/g, '"')
        .replace(/&#39;?/g, "'")
        .replace(/&#38;?/g, '&')
        .replace(/\\u0026/gi, '&');
    for (const { re, normalize } of BOOKING_PATTERNS) {
        const m = re.exec(haystack);
        if (!m) continue;
        const raw = normalize ? normalize(m) : m[0];
        const absolute = raw.startsWith('//') ? `https:${raw}` : raw;
        const url = trimUrl(absolute);
        if (url) return url;
    }
    return null;
}
