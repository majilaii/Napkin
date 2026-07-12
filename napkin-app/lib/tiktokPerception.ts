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

import { VIDEO_DOWNLOAD_TIMEOUT_MS } from './importBudgets';

const MOBILE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Bound the text we ship to the extraction endpoint. */
const TRANSCRIPT_CAP = 8000;

/**
 * TICKET-176: cap the slides we download + OCR on-device. A photo list can carry
 * dozens of images; the on-device OCR budget bounds the work, and a >12-slide
 * list still resolves its first 12 (the extraction cap is 12 anyway).
 */
const PHOTO_SLIDE_CAP = 12;

/**
 * TICKET-164 [R8]: bound each perception fetch — the page + VTT requests had NO
 * timeout, so a stalled TikTok CDN hung the import behind a spinner-less drain.
 */
const PAGE_FETCH_TIMEOUT_MS = 12_000;

/** fetch with a hard abort deadline (never hangs). Throws on timeout → caller nulls. */
async function fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs: number,
): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export interface TikTokPerception {
    /** desc + transcript, joined — ready to be resolve-url `extracted_text`. */
    text: string;
    /**
     * TICKET-164: the caption ALONE (the fast path sends this as `caption`, never
     * fused with the transcript — R6). Empty when the clip has no caption.
     */
    desc: string;
    /**
     * TICKET-164: TikTok's OWN ASR voiceover ALONE (the fast path sends this as
     * `extracted_text`). Empty when no subtitleInfos track was found.
     * (Its char count no longer gates anything — TICKET-175 made the TikTok
     * fast path single-candidate-only.)
     */
    transcript: string;
    /** True when TikTok's ASR transcript was fetched (tier 1 is GO). */
    hasTranscript: boolean;
    /**
     * TICKET-175: true when the RESOLVED page URL is a photo-mode post
     * (/photo/{id}). Photo posts have no video and no ASR — the queue skips the
     * cheap tier + video ladder and resolves {url} (server thumbnail vision).
     * URL-derived, never blob-shape-derived (the blob differs for photos).
     */
    isPhotoPost: boolean;
    /** Signed mp4 URL for the tier-2 video fallback. Use now, never store. */
    playAddr: string | null;
    /**
     * TICKET-156: cover-frame image URL (from the universal-data blob's
     * video.cover / originCover / dynamicCover) for the On Socials rail thumbnail
     * cache. Fresh at fetch time; the capture path downloads its bytes immediately
     * and caches them durably (this URL itself expires — never persist it).
     */
    thumbnailUrl: string | null;
    /**
     * TICKET-180: creator handle (@user) parsed from the RESOLVED page URL — the
     * same Response.url foundation as isPhotoPost (see extractTikTokHandle). Powers
     * the review card / hub @handle row so you know WHOSE clip you're approving.
     * Null when the resolved URL carries no /@handle segment (unusual redirect
     * shape) — the row simply doesn't render (parity with IG's null-handle path).
     */
    authorHandle: string | null;
    /**
     * TICKET-176: photo-mode slide image URLs
     * (imagePost.images[].imageURL.urlList[0]), capped at PHOTO_SLIDE_CAP. The
     * spots on a caption-less photo list are rendered ON the slides, so the queue
     * downloads these + OCRs them on-device. Populated ONLY on the has-itemStruct
     * photo marker; the no-blob / no-itemStruct photo markers keep it empty.
     * Signed CDN URLs — download immediately (session-bound), NEVER persist.
     */
    slideUrls?: string[];
}

export function isTikTokUrl(url: string | null | undefined): boolean {
    return !!url && /tiktok\.com/i.test(url);
}

/**
 * TICKET-175: photo-mode detection from a RESOLVED page URL (/photo/{id}).
 * Runs on Response.url (final, post-redirect — verified RN 0.81 populates it
 * from the native response), NEVER the share link (vm.tiktok.com says nothing).
 * Pure + exported for tests: this exact URL-shape assumption silently broke
 * photo imports once already.
 */
export function isTikTokPhotoUrl(url: string | null | undefined): boolean {
    return !!url && /\/photo\//.test(url);
}

/**
 * TICKET-180: creator handle from a RESOLVED TikTok page URL (`/@handle/…`).
 * Runs on Response.url (final, post-redirect — same foundation as isTikTokPhotoUrl),
 * NEVER the share link (vm.tiktok.com carries no handle → null). Pure + exported for
 * tests: the @handle URL-shape assumption is load-bearing for the review card, so it
 * gets pinned. TikTok handles are letters/digits/underscore/period; the match stops
 * at the next '/' so `/@user/video/…` and `/@user/photo/…` both yield `user`. Returns
 * null for a handle-less URL or null/empty input (degrade, never throw).
 */
export function extractTikTokHandle(url: string | null | undefined): string | null {
    if (!url) return null;
    const m = url.match(/\/@([A-Za-z0-9_.]+)/);
    return m ? m[1] : null;
}

/**
 * TICKET-176: pull the signed CDN slide URLs from a photo-mode itemStruct's
 * `imagePost.images[].imageURL.urlList[0]`, capped at PHOTO_SLIDE_CAP. Pure +
 * exported for tests — the blob shape drifts, so degradation (an empty list, not
 * a throw) is the contract. Tolerant of any/missing shape (`item` is untyped blob
 * JSON): a non-array `images`, a missing `imageURL`, or a non-http entry all just
 * drop from the result.
 */
export function extractSlideUrls(item: any): string[] {
    const images = item?.imagePost?.images;
    if (!Array.isArray(images)) return [];
    const urls: string[] = [];
    for (const im of images) {
        const u = im?.imageURL?.urlList?.[0];
        if (typeof u === 'string' && u.startsWith('http')) urls.push(u);
        if (urls.length >= PHOTO_SLIDE_CAP) break;
    }
    return urls;
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

/**
 * `deadlineAt` (epoch ms, optional): caps each internal fetch at the REMAINING
 * time to that deadline — the escalation retry threads its shared stage budget
 * here so a refetch can never stack fresh 12s timeouts past it (R8). An already-
 * spent deadline aborts immediately (→ null). Omitted = the plain per-fetch caps.
 */
export async function fetchTikTokPerception(
    url: string,
    deadlineAt?: number,
): Promise<TikTokPerception | null> {
    const budget = (cap: number) =>
        deadlineAt !== undefined ? Math.max(1, Math.min(cap, deadlineAt - Date.now())) : cap;
    try {
        const pageRes = await fetchWithTimeout(url, {
            headers: {
                'User-Agent': MOBILE_UA,
                Accept: 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-GB,en;q=0.9',
            },
        }, budget(PAGE_FETCH_TIMEOUT_MS));
        if (!pageRes.ok) return null;
        // TICKET-175: vm.tiktok.com share links redirect; the FINAL url tells us
        // photo-mode (/photo/{id}) regardless of how the blob is shaped. A photo
        // post must reach the queue as a marker (never null) so it routes to the
        // server url tier instead of dying in the video ladder.
        const isPhotoPost = isTikTokPhotoUrl(pageRes.url);
        // TICKET-180: the creator handle rides the RESOLVED url for BOTH photo and
        // video posts (same Response.url foundation as isPhotoPost). Captured once
        // here and threaded onto every return below.
        const authorHandle = extractTikTokHandle(pageRes.url);
        // TICKET-176: the base marker (no-blob / no-itemStruct sites) keeps EMPTY
        // desc + slideUrls — only the has-itemStruct site below can populate them
        // (that's where imagePost lives). All three keep isPhotoPost:true so the
        // queue routes past the video ladder.
        const photoMarker: TikTokPerception = {
            text: '',
            desc: '',
            transcript: '',
            hasTranscript: false,
            isPhotoPost: true,
            playAddr: null,
            thumbnailUrl: null,
            authorHandle,
            slideUrls: [],
        };
        const html = await pageRes.text();

        const m = html.match(
            /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
        );
        if (!m) {
            if (isPhotoPost) return photoMarker;
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
            if (isPhotoPost) return photoMarker;
            console.log('[tiktokPerception] blob present but no itemStruct — shape changed');
            return null;
        }
        // Photo-mode posts sometimes DO carry an itemStruct (desc, imagePost) —
        // still a photo: no video, no ASR. TICKET-176: the spots live ON the
        // slides (the caption is name-free), so this marker carries the REAL
        // caption + the signed slide URLs for on-device OCR. Still routes past the
        // video ladder (playAddr null, isPhotoPost true).
        if (isPhotoPost) {
            return {
                ...photoMarker,
                desc: typeof item.desc === 'string' ? item.desc.trim() : '',
                slideUrls: extractSlideUrls(item),
            };
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
                const vttRes = await fetchWithTimeout(
                    chosen.Url,
                    { headers: { 'User-Agent': MOBILE_UA } },
                    budget(PAGE_FETCH_TIMEOUT_MS),
                );
                if (vttRes.ok) transcript = parseVtt(await vttRes.text());
            } catch {
                // transcript is optional — playAddr may still enable tier 2
            }
        }

        const text = [desc, transcript].filter(Boolean).join('\n').trim().slice(0, TRANSCRIPT_CAP);
        if (!text && !playAddr) return null;
        // (video posts from here — photo posts returned the marker above)
        // TICKET-164 [R6]: expose desc + transcript SEPARATELY so the fast path can
        // send them as caption + extracted_text without re-fusing. Each capped
        // independently; the server slices the fused fullText to 8000 regardless.
        return {
            text,
            isPhotoPost: false,
            desc: desc.slice(0, TRANSCRIPT_CAP),
            transcript: transcript.slice(0, TRANSCRIPT_CAP),
            hasTranscript: transcript.length > 0,
            playAddr,
            thumbnailUrl,
            authorHandle,
        };
    } catch {
        return null;
    }
}

/**
 * Download the playAddr mp4 to the app cache for on-device OCR (TICKET-086b).
 *
 * TICKET-164 [R8]: streams STRAIGHT TO DISK via createDownloadResumable — no
 * blob→FileReader→base64 detour (that path held the whole file as a ~1.4×-sized
 * base64 STRING in JS memory, minutes + memory pressure on a long clip). Raced
 * against a hard deadline (`timeoutMs`, the REMAINING shared stage budget so two
 * retry attempts + a re-fetch never sum to 2×): on expiry the task is cancelled
 * and the partial file deleted. Returns null on timeout/failure.
 *
 * The CDN binds the signed URL to the page-session cookies — iOS shares the
 * native cookie store across requests, so call this AFTER fetchTikTokPerception
 * (which seeds the session). Returns a file:// URI the caller MUST delete
 * (deleteCachedTikTokVideo) after extraction.
 */
export async function downloadTikTokVideo(
    playAddr: string,
    pageUrl: string,
    timeoutMs: number = VIDEO_DOWNLOAD_TIMEOUT_MS,
): Promise<string | null> {
    if (timeoutMs <= 0) return null; // stage budget already spent → skip
    try {
        const FileSystem = await import('expo-file-system/legacy');
        const dir = FileSystem.cacheDirectory;
        if (!dir) return null;
        const uri = `${dir}tiktok-import-${Date.now()}.mp4`;

        const task = FileSystem.createDownloadResumable(playAddr, uri, {
            headers: { 'User-Agent': MOBILE_UA, Referer: pageUrl },
        });

        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => {
                timedOut = true;
                // Cancel the in-flight download; the raced downloadAsync then
                // resolves undefined and we clean the partial below.
                task.cancelAsync().catch(() => {});
                resolve(null);
            }, timeoutMs);
        });

        try {
            // .catch guard (R8): a cancelled/failed download must not surface as an
            // unhandled rejection into the race.
            const download = task.downloadAsync().catch(() => null);
            const result = await Promise.race([download, timeout]);
            // status >= 400 = an expired/forbidden signed URL wrote an error body to
            // disk — never feed that to OCR (mirrors the old `!res.ok` guard).
            if (timedOut || !result || !result.uri || result.status >= 400) {
                await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
                return null;
            }
            return result.uri;
        } finally {
            if (timer) clearTimeout(timer);
        }
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

/**
 * TICKET-176: download ONE photo-mode slide image to the app cache for on-device
 * OCR. Mirrors downloadTikTokVideo (streamed straight to disk via
 * createDownloadResumable, UA + page Referer for the signed CDN, hard deadline)
 * but for a small JPEG — so the caller shares ONE stage deadline across every
 * slide instead of one-per-file. Returns a file:// URI the caller MUST delete
 * (deleteCachedSlide) after extraction; null on timeout/expiry/failure (a missing
 * slide just drops from the OCR set — never fails the import). A unique random
 * suffix avoids collisions when several slides download inside the same ms.
 */
export async function downloadSlideImage(
    url: string,
    referer: string,
    timeoutMs: number,
): Promise<string | null> {
    if (timeoutMs <= 0) return null; // stage budget already spent → skip
    try {
        const FileSystem = await import('expo-file-system/legacy');
        const dir = FileSystem.cacheDirectory;
        if (!dir) return null;
        const rand = Math.random().toString(36).slice(2, 10);
        const uri = `${dir}tiktok-slide-${Date.now()}-${rand}.jpg`;

        const task = FileSystem.createDownloadResumable(url, uri, {
            headers: { 'User-Agent': MOBILE_UA, Referer: referer },
        });

        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const timeout = new Promise<null>((resolve) => {
            timer = setTimeout(() => {
                timedOut = true;
                task.cancelAsync().catch(() => {});
                resolve(null);
            }, timeoutMs);
        });

        try {
            const download = task.downloadAsync().catch(() => null);
            const result = await Promise.race([download, timeout]);
            // status >= 400 = an expired/forbidden signed URL wrote an error body to
            // disk — never feed that to OCR (mirrors downloadTikTokVideo).
            if (timedOut || !result || !result.uri || result.status >= 400) {
                await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
                return null;
            }
            return result.uri;
        } finally {
            if (timer) clearTimeout(timer);
        }
    } catch {
        return null;
    }
}

/** Best-effort cleanup of a downloadSlideImage file. */
export async function deleteCachedSlide(uri: string): Promise<void> {
    try {
        const FileSystem = await import('expo-file-system/legacy');
        await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
        /* best-effort */
    }
}
