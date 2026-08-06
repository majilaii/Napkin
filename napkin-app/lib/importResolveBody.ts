/**
 * importResolveBody — TICKET-209.
 *
 * The escalation tier's resolve-url body, extracted from useProcessImportQueue
 * as a pure decision (same doctrine as importFastPath.ts / photoImportFusion.ts:
 * the hook is untestable, the decision must not be).
 *
 * Why it exists: the caption is GROUND TRUTH for an enumerated listicle, and it
 * used to be buried — fused into `extracted_text` AFTER the OCR text, unlabeled,
 * and on the no-transcript branch it was the ONLY thing sent yet still arrived
 * as `extracted_text`. It now rides as its own `caption` field so the server can
 * label it, budget it, and derive a real candidate ceiling from it.
 */
import type { PhotoImportContext } from './photoImportFusion';

export interface VideoTextResolveInput {
    /** Fused on-device perception: video/slide OCR + on-device transcript. */
    extractedText: string | null;
    /** Caption/description, merged across the initial fetch and any refresh. */
    mergedDesc: string;
    /** Non-null only for a photo carousel with at least one downloaded slide. */
    photoImportContext: PhotoImportContext | null;
    /** True for TikTok photo-mode posts (no playAddr, spots live on slides). */
    photoPost: boolean;
    /** The share URL — used only by the last-resort generic fallback. */
    url: string;
}

export interface VideoTextResolveBody {
    body: Record<string, unknown>;
    /**
     * True when the PRIMARY body was a video-text body (fused text and/or
     * caption) rather than the generic `{url}` tier.
     *
     * TICKET-175 R5: the zero-candidate `{url}` recovery used to be guarded on
     * `extractedText &&`. With a caption-only body `extractedText` is empty, so
     * that guard would silently kill the recovery tier (oEmbed + thumbnail
     * vision the client never had) for a failed-download TikTok. This flag is
     * the replacement guard term.
     */
    sentVideoTextResolve: boolean;
}

/**
 * Build the escalation resolve body.
 *
 *  1. Any fused perception text → `{extracted_text, caption?}`. The caption is
 *     NO LONGER concatenated into extracted_text. A photo carousel is the one
 *     exception: fusePhotoSlideText already embeds a labeled `[caption]`
 *     section, so adding the field would double-fuse it (photo path stays
 *     byte-identical, TICKET-195/209 A.5).
 *  2. No perception text at all but a caption → caption-only body. This is what
 *     makes the caption authority rule reachable for Instagram (never any
 *     transcript) and for a TikTok whose download flaked. Never `{url}` here:
 *     Instagram's url tier is a login-walled no-op. Photo posts are excluded —
 *     their zero-slide degenerate case has always resolved through the url tier
 *     (oEmbed + thumbnail vision), which is strictly richer than their caption.
 *  3. Nothing at all → today's `{url}` fallback, unchanged.
 */
export function buildVideoTextResolveBody(
    input: VideoTextResolveInput,
): VideoTextResolveBody {
    const { extractedText, mergedDesc, photoImportContext, photoPost, url } = input;

    if (extractedText) {
        return {
            body: photoImportContext
                ? { extracted_text: extractedText, ...photoImportContext }
                : {
                      extracted_text: extractedText,
                      // undefined keys are dropped by JSON.stringify — an empty
                      // caption is never sent as an empty string.
                      caption: mergedDesc || undefined,
                  },
            sentVideoTextResolve: true,
        };
    }

    if (mergedDesc && !photoPost) {
        return { body: { caption: mergedDesc }, sentVideoTextResolve: true };
    }

    return {
        body: { url, supports_large_lists: true },
        sentVideoTextResolve: false,
    };
}
