/**
 * instagramPerception — on-device perception for Instagram Reel/post LINK imports.
 *
 * Mirrors tiktokPerception (TICKET-086): fetches Instagram the way Safari
 * would — ON-DEVICE, user-initiated. NEVER move this to an edge function:
 * datacenter IPs get walled and the ToS posture is far worse server-side.
 * The server's resolve-url Instagram branch (TICKET-060) is a dead end by
 * design — login-walled from a datacenter, it returns zero candidates + an
 * ig_nudge. This module is why a shared Reel no longer dies there.
 *
 * Source: the PUBLIC embed page — instagram.com/p/{code}/embed/captioned/ —
 * which is served logged-out (it exists to be iframed into third-party sites)
 * and carries:
 *
 *   - the full caption (`.Caption` markup — hashtags/handles keep the city
 *     signal Places needs)
 *   - `video_url` — a signed fbcdn mp4, double-JSON-escaped inside the page's
 *     contextJSON blob. Signed URLs expire in hours: use immediately, NEVER
 *     persist. Feeds the media-extract OCR + speech tier (Reels print names
 *     on-screen and speak them; the caption alone usually carries neither).
 *
 * Instagram has no public ASR transcript (unlike TikTok's subtitleInfos), so
 * hasTranscript is always false — callers transcribe on-device.
 *
 * Every failure returns null and callers fall through to the server caption
 * tier — Instagram reshapes markup periodically, so degradation (never
 * breakage) is the contract. Verified live 2026-07-07 against
 * reel/DGaQ0R0sbQ0 (topjaw): embed 200 logged-out, caption parsed, mp4
 * downloaded (15MB).
 */

const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Bound the text we ship to the extraction endpoint (same cap as TikTok). */
const CAPTION_CAP = 8000;

export interface InstagramPerception {
    /** Caption text — ready to fuse into resolve-url `extracted_text`. */
    text: string;
    /** Always false: Instagram exposes no ASR transcript — transcribe on-device. */
    hasTranscript: boolean;
    /** Signed fbcdn mp4 URL for the media-extract tier. Use now, never store. */
    playAddr: string | null;
    /** Referer to send when downloading playAddr (the embed page seeds the session). */
    refererUrl: string;
}

export function isInstagramUrl(url: string | null | undefined): boolean {
    return !!url && /instagram\.com|instagr\.am/i.test(url);
}

/**
 * Shortcode from any post-shaped path: /reel/ /reels/ /p/ /tv/, with or
 * without a leading /{username}/. Share-sheet links (?igsh=…) included.
 * Returns null for /share/… indirection links — resolve those by following
 * the redirect (fetchInstagramPerception does).
 */
export function extractInstagramShortcode(url: string): string | null {
    // /share/reel/{token} tokens are NOT shortcodes — force the redirect path.
    if (/(instagram\.com|instagr\.am)\/share\//i.test(url)) return null;
    const m = url.match(/\/(?:reels?|p|tv)\/([A-Za-z0-9_-]{5,})/);
    return m ? m[1] : null;
}

/**
 * Undo N layers of JSON string escaping (`\\/` → `/`, `\\\\` → `\\` …).
 * The embed page nests the media JSON inside contextJSON inside a script
 * literal, so video_url arrives double-escaped.
 */
function unescapeJsonLayers(raw: string): string | null {
    let cur = raw;
    for (let i = 0; i < 3; i++) {
        try {
            cur = JSON.parse(`"${cur}"`);
        } catch {
            return i === 0 ? null : cur;
        }
        if (!cur.includes('\\')) break;
    }
    return cur;
}

/** Decode the handful of HTML entities Instagram markup actually emits. */
function decodeEntities(s: string): string {
    // Clamp to the valid code-point range — fromCodePoint THROWS past 0x10FFFF
    // and a hostile caption must degrade, not take the whole perception down.
    const cp = (n: number) => (n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => cp(parseInt(d, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}

/** Strip tags from a caption markup fragment, keeping anchor text + line breaks. */
function captionMarkupToText(fragment: string): string {
    const text = fragment
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    return decodeEntities(text)
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
}

/**
 * Pure parse of the embed/captioned HTML → { caption, videoUrl }.
 * Exported for unit tests (real-markup fixtures in instagramPerception.test.ts).
 */
export function parseInstagramEmbed(html: string): {
    caption: string | null;
    videoUrl: string | null;
} {
    // video_url sits inside the escaped contextJSON blob: boundaries are
    // backslash-escaped quotes (`\"video_url\":\"…\"`, verified against a live
    // page 2026-07-07); keep a plain-JSON fallback in case Instagram flattens
    // the nesting. unescapeJsonLayers then peels however many layers remain.
    let videoUrl: string | null = null;
    const esc = html.match(/\\"video_url\\":\\"(.*?)\\"/);
    const plain = esc ? null : html.match(/"video_url":"(.*?)"/);
    const rawUrl = esc?.[1] ?? plain?.[1] ?? null;
    if (rawUrl) {
        const decoded = unescapeJsonLayers(rawUrl);
        if (decoded && decoded.startsWith('http')) videoUrl = decoded;
    }

    // Caption: the .Caption div's inner markup — slice from AFTER the opening
    // tag's '>' and cut BEFORE the next block's opening '<div' so neither tag
    // remnant survives the strip. Keep the username anchor's text — the handle
    // can carry the city signal.
    let caption: string | null = null;
    const capTag = html.indexOf('class="Caption"');
    const capOpen = capTag >= 0 ? html.indexOf('>', capTag) : -1;
    if (capOpen >= 0) {
        const inner = html.slice(capOpen + 1);
        const endRel = inner.search(/<div[^>]*class="(CaptionComments|Footer)"/);
        const fragment = endRel >= 0 ? inner.slice(0, endRel) : inner.slice(0, 4000);
        caption = captionMarkupToText(fragment) || null;
    }

    return { caption, videoUrl };
}

/**
 * Caption from a reel/post page's og:description — the fallback when the
 * embed markup yields nothing. Shape: `14K likes, 126 comments - topjaw on
 * February 22, 2026: "the caption…"`. Exported for unit tests.
 */
export function parseOgDescriptionCaption(html: string): string | null {
    const m = html.match(/property="og:description"\s+content="([^"]*)"/);
    if (!m?.[1]) return null;
    const decoded = decodeEntities(m[1]);
    // Strip the engagement prefix; fall back to the whole string (still signal).
    const quoted = decoded.match(/:\s*[""](.*)[""]?\s*$/s);
    const text = (quoted?.[1] ?? decoded).replace(/[""]$/, '').trim();
    return text || null;
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
    // Deadline per fetch: the interactive resolver runs this behind a spinner,
    // and iOS's 60s default would hold "reading the post…" hostage on a stall.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': MOBILE_UA,
                Accept: 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-GB,en;q=0.9',
            },
            signal: controller.signal,
        });
        if (!res.ok) return null;
        return { html: await res.text(), finalUrl: res.url || url };
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchInstagramPerception(
    url: string,
): Promise<InstagramPerception | null> {
    try {
        let code = extractInstagramShortcode(url);
        let pageHtml: string | null = null;

        // /share/… indirection links hide the shortcode — follow the redirect
        // to the canonical /reel/{code}/ URL (also seeds session cookies).
        if (!code) {
            const page = await fetchHtml(url);
            if (!page) return null;
            pageHtml = page.html;
            code =
                extractInstagramShortcode(page.finalUrl) ??
                extractInstagramShortcode(page.html.match(/property="og:url"\s+content="([^"]*)"/)?.[1] ?? '');
        }
        if (!code) return null;

        const embedUrl = `https://www.instagram.com/p/${code}/embed/captioned/`;
        const embed = await fetchHtml(embedUrl);
        let caption: string | null = null;
        let videoUrl: string | null = null;
        if (embed) {
            const parsed = parseInstagramEmbed(embed.html);
            caption = parsed.caption;
            videoUrl = parsed.videoUrl;
        }

        // Caption fallback: the post page's og:description (served logged-out
        // even when the embed markup shifts).
        if (!caption) {
            if (!pageHtml) pageHtml = (await fetchHtml(`https://www.instagram.com/reel/${code}/`))?.html ?? null;
            if (pageHtml) caption = parseOgDescriptionCaption(pageHtml);
        }

        const text = (caption ?? '').trim().slice(0, CAPTION_CAP);
        if (!text && !videoUrl) {
            console.log('[instagramPerception] no caption or video_url (walled or shape changed?)');
            return null;
        }
        return { text, hasTranscript: false, playAddr: videoUrl, refererUrl: embedUrl };
    } catch {
        return null;
    }
}
