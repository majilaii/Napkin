/**
 * clipThumbCapture — on-device capture of a clipped video's cover frame for the
 * On Socials rail (TICKET-156).
 *
 * The import pipeline already fetched the provider page on a residential IP, so
 * the cover URL (TikTok `video.cover` / IG `og:image`) is fresh and unexpired
 * RIGHT NOW. We download its bytes on-device and POST them to
 * `resolve-url?action=cache_clip_thumb`, which validates + uploads a durable
 * JPEG to the public `clip-thumbs` bucket keyed by the canonical video URL. The
 * rail then renders that durable copy — NEVER the provider CDN link, which rots
 * in hours.
 *
 * Pure JS: no native media-extract change, no video-frame grab. Every failure is
 * swallowed — capture is best-effort and must NEVER block or fail the underlying
 * save (AC). Only `tiktok` + `instagram` (the two providers that render a photo
 * card) ever capture; `video`-type saves never render a photo, so never capture.
 */
import { callEdgeFn } from '@/lib/edgeInvoke';
import { fetchInstagramPerception } from '@/lib/instagramPerception';

export type ClipThumbSourceType = 'tiktok' | 'instagram';

/** Match the server's cache_clip_thumb decoded cap — a courteous client guard. */
const MAX_THUMB_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 8000;

/**
 * Download the fresh provider cover frame and cache it durably. `thumbUrl` is the
 * provider's (expiring) cover URL surfaced by perception; `videoUrl` is the
 * canonical video URL the server keys the durable copy by. No-op on any failure.
 */
export async function captureClipThumbFromUrl(
    videoUrl: string,
    thumbUrl: string | null | undefined,
    sourceType: ClipThumbSourceType,
): Promise<void> {
    if (!videoUrl || !thumbUrl) return;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let blob: Blob;
        try {
            const res = await fetch(thumbUrl, { signal: controller.signal });
            if (!res.ok) return;
            const contentType = res.headers.get('content-type') ?? '';
            if (contentType && !contentType.startsWith('image/')) return;
            blob = await res.blob();
        } finally {
            clearTimeout(timer);
        }
        // Provider cover frames are tiny (~30–50KB). Skip anything over the
        // server cap rather than have the edge reject it.
        if (!blob || blob.size === 0 || blob.size > MAX_THUMB_BYTES) return;

        // Same base64 read pattern as downloadTikTokVideo (strip the data: prefix).
        const base64 = await new Promise<string | null>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const s = typeof reader.result === 'string' ? reader.result : null;
                resolve(s ? s.slice(s.indexOf(',') + 1) : null);
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
        if (!base64) return;

        await callEdgeFn('resolve-url', {
            action: 'cache_clip_thumb',
            body: { video_url: videoUrl, image_base64: base64, source_type: sourceType },
        });
    } catch {
        // Swallow ALL failures — best-effort, never blocks or fails the save.
    }
}

/**
 * Opportunistic on-device backfill for the viewer's OWN Instagram clip whose
 * durable thumb is still missing (TICKET-156 — IG can't be fetched server-side).
 * Re-fetches IG perception → og:image → cache. Best-effort; caller defers it off
 * the paint path and dedupes attempts so a permanently-gone clip isn't retried.
 */
export async function backfillOwnInstagramThumb(videoUrl: string): Promise<void> {
    if (!videoUrl) return;
    try {
        const perception = await fetchInstagramPerception(videoUrl);
        if (perception?.thumbnailUrl) {
            await captureClipThumbFromUrl(videoUrl, perception.thumbnailUrl, 'instagram');
        }
    } catch {
        // best-effort
    }
}
