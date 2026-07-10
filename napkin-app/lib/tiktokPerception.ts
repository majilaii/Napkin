/**
 * tiktokPerception — TICKET-086 tier-1 perception for TikTok LINK imports.
 *
 * Fetches the video page the way Safari would — ON-DEVICE, user-initiated.
 * NEVER move this to an edge function: datacenter IPs get blocked and the
 * ToS posture is far worse server-side. Parses the
 * __UNIVERSAL_DATA_FOR_REHYDRATION__ blob and pulls:
 *
 *   - `desc` — the full caption (richer than oEmbed's truncated title)
 *   - TikTok's OWN ASR transcript via video.subtitleInfos (webvtt): the
 *     entire voiceover as text — no download, no audio processing, $0
 *   - `playAddr` — signed mp4 URL for the tier-2 media-extract fallback.
 *     Signed URLs expire in hours: use immediately, NEVER persist.
 *
 * Every failure returns null and callers fall through to the server caption
 * tier — TikTok reshapes this blob periodically, so degradation (never
 * breakage) is the contract. A fingerprint line is logged when the expected
 * path is missing so breakage shows up in dev/telemetry, not user reports.
 *
 * Spike evidence (2026-07-02): @topjaw/video/7623328701794520342 — caption
 * carries zero names; subtitleInfos (eng-US, Source=ASR) yielded the full
 * spoken listicle. See .kanban/ready/TICKET-086.
 */

const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Bound the text we ship to the extraction endpoint. */
const TRANSCRIPT_CAP = 8000;

export interface TikTokPerception {
    /** desc + transcript, joined — ready to be resolve-url `extracted_text`. */
    text: string;
    /** True when TikTok's ASR transcript was fetched (tier 1 is GO). */
    hasTranscript: boolean;
    /** Signed mp4 URL for the tier-2 video fallback. Use now, never store. */
    playAddr: string | null;
    /**
     * TICKET-156: cover-frame image URL (from the universal-data blob's
     * video.cover / originCover / dynamicCover) for the On Socials rail thumbnail
     * cache. Fresh at fetch time; the capture path downloads its bytes immediately
     * and caches them durably (this URL itself expires — never persist it).
     */
    thumbnailUrl: string | null;
}

export function isTikTokUrl(url: string | null | undefined): boolean {
    return !!url && /tiktok\.com/i.test(url);
}

/** Strip a webvtt file to its spoken text (ASR cues repeat — dedupe them). */
function parseVtt(vtt: string): string {
    const out: string[] = [];
    for (const raw of vtt.split(/\r?\n/)) {
        const line = raw.trim();
        if (
            !line ||
            line === 'WEBVTT' ||
            line.includes('-->') ||
            /^\d+$/.test(line) ||
            /^(NOTE|STYLE|REGION)\b/.test(line)
        ) continue;
        if (out[out.length - 1] === line) continue;
        out.push(line);
    }
    return out.join(' ');
}

export async function fetchTikTokPerception(url: string): Promise<TikTokPerception | null> {
    try {
        const pageRes = await fetch(url, {
            headers: {
                'User-Agent': MOBILE_UA,
                Accept: 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-GB,en;q=0.9',
            },
        });
        if (!pageRes.ok) return null;
        const html = await pageRes.text();

        const m = html.match(
            /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
        );
        if (!m) {
            console.log('[tiktokPerception] no universal-data blob (page shape changed?)');
            return null;
        }

        const scope = (JSON.parse(m[1]) ?? {}).__DEFAULT_SCOPE__ ?? {};
        // Reflow scope is what logged-out mobile-web gets today; the older
        // webapp.video-detail shape is kept as a second chance.
        const item =
            scope['webapp.reflow.video.detail']?.itemInfo?.itemStruct ??
            scope['webapp.video-detail']?.itemInfo?.itemStruct ??
            null;
        if (!item) {
            console.log('[tiktokPerception] blob present but no itemStruct — shape changed');
            return null;
        }

        const desc = typeof item.desc === 'string' ? item.desc.trim() : '';
        const video = item.video ?? {};
        const playAddr =
            typeof video.playAddr === 'string' && video.playAddr.startsWith('http')
                ? video.playAddr
                : null;

        // TICKET-156: the cover frame for the On Socials rail thumbnail cache —
        // first http candidate among cover / originCover / dynamicCover.
        const thumbnailUrl =
            [video.cover, video.originCover, video.dynamicCover].find(
                (c) => typeof c === 'string' && c.startsWith('http'),
            ) ?? null;

        // Prefer English captions; fall back to whatever exists.
        const subs: any[] = Array.isArray(video.subtitleInfos) ? video.subtitleInfos : [];
        const chosen =
            subs.find((s) => /^eng/i.test(String(s?.LanguageCodeName ?? ''))) ?? subs[0] ?? null;

        let transcript = '';
        if (chosen && typeof chosen.Url === 'string' && chosen.Url.startsWith('http')) {
            try {
                const vttRes = await fetch(chosen.Url, { headers: { 'User-Agent': MOBILE_UA } });
                if (vttRes.ok) transcript = parseVtt(await vttRes.text());
            } catch {
                // transcript is optional — playAddr may still enable tier 2
            }
        }

        const text = [desc, transcript].filter(Boolean).join('\n').trim().slice(0, TRANSCRIPT_CAP);
        if (!text && !playAddr) return null;
        return { text, hasTranscript: transcript.length > 0, playAddr, thumbnailUrl };
    } catch {
        return null;
    }
}

/**
 * Download the playAddr mp4 to the app cache for on-device OCR (TICKET-086b).
 *
 * The CDN binds the signed URL to the page-session cookies — iOS shares the
 * native cookie store across fetches, so call this AFTER fetchTikTokPerception
 * (which seeds the session). Returns a file:// URI the caller MUST delete
 * (deleteCachedTikTokVideo) after extraction; null on any failure.
 */
export async function downloadTikTokVideo(playAddr: string, pageUrl: string): Promise<string | null> {
    try {
        const FileSystem = await import('expo-file-system/legacy');
        const dir = FileSystem.cacheDirectory;
        if (!dir) return null;
        const res = await fetch(playAddr, {
            headers: { 'User-Agent': MOBILE_UA, Referer: pageUrl },
        });
        if (!res.ok) return null;
        const blob = await res.blob();
        // ~12MB videos → ~17MB base64 string; acceptable for a background import.
        const base64 = await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const s = typeof reader.result === 'string' ? reader.result : null;
                resolve(s ? s.slice(s.indexOf(',') + 1) : null);
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
        if (!base64) return null;
        const uri = `${dir}tiktok-import-${Date.now()}.mp4`;
        await FileSystem.writeAsStringAsync(uri, base64, {
            encoding: FileSystem.EncodingType.Base64,
        });
        return uri;
    } catch {
        return null;
    }
}

/** Best-effort cleanup of a downloadTikTokVideo file. */
export async function deleteCachedTikTokVideo(uri: string): Promise<void> {
    try {
        const FileSystem = await import('expo-file-system/legacy');
        await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
        /* best-effort */
    }
}
