/**
 * reserveLink (server) — resolve a restaurant's direct booking-page URL.
 *
 * Google Places exposes no reservation link (Reserve with Google is
 * partner-only), but nearly every reservable restaurant links its booking
 * platform from its own website. `resolveReserveUrl` checks the stored
 * website URL itself (tier 0), then fetches the page and scans the HTML
 * with the same patterns.
 *
 * Mirrored in napkin-app/lib/reserveLink.ts (client tier-0 for ghosts) —
 * keep the pattern lists byte-identical (same precedent as pagination.ts).
 */
import { validateUrl } from './urlValidation.ts';

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

const FETCH_TIMEOUT_MS = 5000;
/** Hard wall for the whole resolve (homepage + redirects + hops). */
const OVERALL_BUDGET_MS = 12_000;
const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

/**
 * SSRF guard for the website fetch. Delegates to the shared strict pre-flight
 * (scheme allowlist, 2048 cap, localhost/private/link-local/metadata ranges,
 * ALL bare IPv4) and adds internal-suffix hostnames. Re-applied to every
 * redirect target — the URL comes from our own DB (Places-sourced), but a
 * venue site can 3xx anywhere.
 */
function isSafeFetchUrl(raw: string): boolean {
    const v = validateUrl(raw);
    if (!v.ok) return false;
    const host = v.url.hostname.toLowerCase();
    return !host.endsWith('.local') && !host.endsWith('.internal');
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return out;
}

/**
 * Guarded, size-capped page fetch. Null on any failure — never throws.
 *
 * Redirects are followed MANUALLY so every hop re-passes the SSRF guard —
 * `redirect: 'follow'` would happily chase a venue site's 302 into private
 * address space. If a redirect lands on a booking platform, we return it
 * without fetching (that IS the answer, and booking sites often bot-block).
 * `deadlineAt` is a hard wall across all redirects of this page.
 */
async function fetchPage(
    url: string,
    deadlineAt: number,
): Promise<{ finalUrl: string; html: string } | null> {
    let current = url;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
        if (!isSafeFetchUrl(current)) return null;
        const budget = Math.min(FETCH_TIMEOUT_MS, deadlineAt - Date.now());
        if (budget <= 0) return null;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), budget);
        try {
            const res = await fetch(current, {
                signal: controller.signal,
                redirect: 'manual',
                headers: {
                    // Some venue sites bot-block default runtime UAs; a plain
                    // browser UA keeps this an ordinary page view.
                    'User-Agent':
                        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                    Accept: 'text/html,application/xhtml+xml',
                },
            });

            if (res.status >= 300 && res.status < 400) {
                const loc = res.headers.get('location');
                await res.body?.cancel().catch(() => {});
                if (!loc) return null;
                current = new URL(loc, current).toString();
                // Redirect straight onto a booking platform — done, don't fetch it.
                if (findBookingUrl(current)) return { finalUrl: current, html: '' };
                continue;
            }

            if (!res.ok || !res.body) {
                await res.body?.cancel().catch(() => {});
                return null;
            }

            const reader = res.body.getReader();
            const chunks: Uint8Array[] = [];
            let total = 0;
            while (total < MAX_HTML_BYTES) {
                const { done, value } = await reader.read();
                if (done) break;
                // Hard cap: slice the final chunk to the remaining budget so a
                // single large chunk can't push the buffer past MAX_HTML_BYTES.
                const remaining = MAX_HTML_BYTES - total;
                const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
                chunks.push(chunk);
                total += chunk.byteLength;
            }
            await reader.cancel().catch(() => {});

            return {
                finalUrl: current,
                html: new TextDecoder('utf-8', { fatal: false }).decode(concatChunks(chunks, total)),
            };
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }
    return null; // redirect loop exceeded MAX_REDIRECTS
}

/**
 * Same-host pages worth one follow-up fetch when the homepage itself carries
 * no booking link: a JSON-LD ReserveAction target (explicit "reserve here"
 * semantic) and internal links whose path reads as a reservations page
 * (`/reservation`, `/book-now`, …). Path match is segment-anchored so
 * "facebook"/"cookbook" never qualify.
 */
function reservationHopCandidates(html: string, baseUrl: string): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    let baseHost: string;
    try {
        baseHost = new URL(baseUrl).hostname.replace(/^www\./, '');
    } catch {
        return out;
    }

    // Normalize the base the same way candidates are (hash-stripped
    // toString) so the homepage can't sneak back in as a "hop".
    const baseNorm = new URL(baseUrl);
    baseNorm.hash = '';
    const baseKey = baseNorm.toString();

    const push = (raw: string) => {
        try {
            const u = new URL(raw, baseUrl);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
            if (u.hostname.replace(/^www\./, '') !== baseHost) return;
            u.hash = '';
            const key = u.toString();
            if (seen.has(key) || key === baseKey) return;
            seen.add(key);
            out.push(key);
        } catch {
            // unparsable href — skip
        }
    };

    if (/ReserveAction/i.test(html)) {
        const m = /"target"\s*:\s*"(https?:[^"]+)"/i.exec(html);
        if (m) push(m[1].replace(/\\\//g, '/'));
    }

    const hrefRe = /href\s*=\s*["']([^"']+)["']/gi;
    let h: RegExpExecArray | null;
    while ((h = hrefRe.exec(html)) !== null) {
        const raw = h[1];
        let path: string;
        try {
            path = new URL(raw, baseUrl).pathname;
        } catch {
            continue;
        }
        if (/(?:^|[/_-])(?:reserv[a-z]*|book(?:ing)?s?|book-?(?:now|a-table))(?:$|[/._?-])/i.test(path)) {
            push(raw);
        }
    }
    return out;
}

/**
 * Resolve a venue's booking-page URL from its website. Never throws — any
 * fetch failure degrades to null (the Reserve pill simply doesn't render).
 *
 * Tiers: the stored URL itself → the homepage HTML (and its post-redirect
 * URL) → up to two same-host "reservations" pages one hop deep. The whole
 * resolve shares one OVERALL_BUDGET_MS wall so a slow venue site can't pin
 * the request (or the deploy smoke) for fetch-count × timeout.
 */
export async function resolveReserveUrl(website: string | null): Promise<string | null> {
    if (!website || website.trim() === '') return null;
    const site = website.startsWith('http') ? website.trim() : `https://${website.trim()}`;

    // Tier 0 — the stored website itself IS a booking page.
    const direct = findBookingUrl(site);
    if (direct) return direct;

    const deadlineAt = Date.now() + OVERALL_BUDGET_MS;
    const first = await fetchPage(site, deadlineAt);
    if (!first) return null;

    // Sites sometimes point their "website" straight at their booking
    // platform via a redirect — the landed URL is the answer.
    const hit =
        findBookingUrl(first.finalUrl) ?? findBookingUrl(first.html);
    if (hit) return hit;

    for (const hop of reservationHopCandidates(first.html, first.finalUrl).slice(0, 2)) {
        const page = await fetchPage(hop, deadlineAt);
        if (!page) continue;
        // An internal /reservation route often 302s straight to the platform.
        const hopHit = findBookingUrl(page.finalUrl) ?? findBookingUrl(page.html);
        if (hopHit) return hopHit;
    }
    return null;
}
