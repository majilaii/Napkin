/**
 * useResolveUrl — calls resolve-url edge function with AbortController + requestId guard.
 *
 * Architecture decisions [M1] + [ARCH-REVIEW-M2]:
 * - Two cancel layers:
 *   1. currentRequestIdRef guard: late responses after cancel() don't write state
 *   2. AbortController: real network abort via callEdgeFn's abortable POST path
 * - signal is passed to callEdgeFn which routes to postWithFetch() for real abort
 */
import { useRef, useCallback, useState } from 'react';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { fetchTikTokPerception, isTikTokUrl } from '@/lib/tiktokPerception';
import { fetchInstagramPerception, isInstagramUrl } from '@/lib/instagramPerception';
import type { WishlistSourceTikTok } from '@/lib/types/wishlistSource';

// ── Types ─────────────────────────────────────────────────────────────────────

// TICKET-079: reddit/substack widen the union. They route through the same 'web'
// extraction path server-side but carry a finer label so copy can say "from reddit" /
// "from substack" and pick the right noun (post / page).
type SourceType = 'tiktok' | 'google_maps' | 'web' | 'instagram' | 'reddit' | 'substack' | 'screenshot' | 'vision' | 'video';
type Confidence = 'exact' | 'high' | 'low';

export interface ResolvedCandidate {
    /** TICKET-063: stable sha256-derived id for this candidate (used as key + save nonce). */
    candidate_id?: string;
    /** TICKET-195: authoritative, caller-bound evidence id minted by the resolver. */
    resolution_id?: string | null;
    restaurant: {
        id: string;
        name: string | null;
        formattedAddress: string | null;
        city: string | null;
        country: string | null;
        latitude: number | null;
        longitude: number | null;
        categories: string[];
        cuisine: string | null;
        googleRating: number | null;
        googleRatingCount: number | null;
        priceLevel: number | null;
        photoReference: string | null;
        website: string | null;
        link: string | null;
        /** null for unresolved ghost candidates (RPC mints external_id at save time). */
        external_id: string | null;
        location?: {
            address?: string;
            locality?: string;
            country?: string;
        };
    };
    confidence: Confidence;
    /** null for unresolved ghost candidates (no confirmed Places id). */
    google_place_id: string | null;
    restaurant_id: string | null;
    already_wishlisted: boolean;
    /** TICKET-063: true when city was inferred from hashtags/handle/context. */
    city_inferred?: boolean;
    /** Structured extracted neighborhood/district for edit-match search. */
    area?: string | null;
    /** TICKET-086c: 'warned' = the creator warned AGAINST this spot ("most
     * overrated…"). Never auto-saved; review surfaces it unticked. */
    stance?: 'recommended' | 'warned' | 'neutral' | null;
    /**
     * TICKET-072: the sharer's rating for this spot, frozen at share time.
     * Only present on handoff-receive candidates; undefined for import flows.
     */
    sharer_rating?: number | null;
}

export interface ResolveUrlData {
    source_type: SourceType;
    best_query: string | null;
    note_prefill: string;
    candidates: ResolvedCandidate[];
    partial_source: Omit<WishlistSourceTikTok, 'type' | 'url'> | null;
    /** TICKET-060: true when the URL is Instagram-walled; client shows screenshot nudge. */
    ig_nudge?: boolean;
    /** TICKET-060: extraction confidence from vision path. */
    extracted_confidence?: 'exact' | 'high' | 'low';
    /** TICKET-060: whether this result needs confirmation. */
    needs_confirm?: boolean;
    /** TICKET-063: advertised list count. Only truthful for google_maps LISTS
     * (true item count; candidates capped at 20). All other sources: a caption
     * heuristic clamped to ≤6 — never render it as a denominator (TICKET-151). */
    list_count?: number | null;
    /** TICKET-164: the UNCLAMPED, caption-first list count for the import fast-path
     * count gate (handleVideoText only). ABSENT (undefined) = an old server →
     * escalate; null = no marker → the count gate passes. Never a denominator. */
    list_count_raw?: number | null;
    /** TICKET-195: candidates dropped by the import-only Places type backstop. */
    type_rejected?: number;
    /** TICKET-209 follow-up: caption-derived cap that governed a video-text
     * extraction (handleVideoText only). null = no cap fired; ABSENT = old
     * server or a non-video-text response. Diagnostic only — never gate on it. */
    caption_cap?: number | null;
}

export type ResolveUrlState = 'idle' | 'loading' | 'success' | 'error';

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns { resolve, cancel, state, data, error }.
 * resolve(url): fires the resolver, sets state to 'loading' then 'success'/'error'.
 * cancel(): increments requestId ref + aborts in-flight fetch. Sheet resets to idle.
 */
export function useResolveUrl() {
    const [state, setState] = useState<ResolveUrlState>('idle');
    const [data, setData] = useState<ResolveUrlData | null>(null);
    const [error, setError] = useState<Error | null>(null);

    // [M1]: incremented on each new call; late responses close over their id
    // and write state only if id === currentRequestIdRef.current
    const currentRequestIdRef = useRef<number>(0);
    const abortControllerRef = useRef<AbortController | null>(null);

    const resolve = useCallback(async (
        url: string,
        /** TICKET-060: optional image_path for screenshot/vision path */
        imagePath?: string,
        caption?: string,
        /** TICKET-082: on-device video OCR + transcript text (URL-less path). */
        extractedText?: string,
    ) => {
        // Abort any in-flight request
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Increment request id — any previous in-flight callback won't write state
        const myId = ++currentRequestIdRef.current;

        setState('loading');
        setData(null);
        setError(null);

        try {
            // TICKET-086: TikTok links first try on-device perception — TikTok's
            // own ASR transcript of the voiceover (listicle captions carry no
            // names). Failure of any kind falls through to the caption resolve.
            let tierText = extractedText;
            if (!tierText && !imagePath && url && isTikTokUrl(url)) {
                const perception = await fetchTikTokPerception(url);
                if (myId !== currentRequestIdRef.current) return;
                if (perception?.hasTranscript) tierText = perception.text;
            }
            // Instagram: the server branch is login-walled by design (returns
            // only an ig_nudge), so the on-device caption IS the resolve tier.
            // Carousel/photo listicles carry the list in the caption; zero
            // candidates still falls through to the url tier → ig_nudge, the
            // pre-existing behavior. (The heavy video-OCR tier stays in the
            // background queue — too slow for a spinner.)
            if (!tierText && !imagePath && url && isInstagramUrl(url)) {
                const perception = await fetchInstagramPerception(url);
                if (myId !== currentRequestIdRef.current) return;
                if (perception?.text) tierText = perception.text;
            }

            // Proven contract (video path): extracted_text rides alone.
            const result = await callEdgeFn<ResolveUrlData>('resolve-url', {
                body: {
                    url: tierText ? undefined : url || undefined,
                    ...(imagePath ? { image_path: imagePath } : {}),
                    ...(caption ? { caption } : {}),
                    ...(tierText ? { extracted_text: tierText } : {}),
                },
                signal: controller.signal,
            });

            // Only write state if this is still the current request
            if (myId !== currentRequestIdRef.current) return;

            // Transcript tier produced nothing actionable → retry the plain
            // caption tier (never worse than the pre-086 behavior).
            if (
                tierText &&
                !extractedText &&
                url &&
                (result?.candidates?.length ?? 0) === 0
            ) {
                const fallback = await callEdgeFn<ResolveUrlData>('resolve-url', {
                    body: { url },
                    signal: controller.signal,
                });
                if (myId !== currentRequestIdRef.current) return;
                setData(fallback);
                setState('success');
                return;
            }

            setData(result);
            setState('success');
        } catch (err) {
            // Only write state if this is still the current request
            if (myId !== currentRequestIdRef.current) return;
            // AbortError = user cancelled; don't update error state
            if (err instanceof Error && err.name === 'AbortError') return;
            setError(err instanceof Error ? err : new Error(String(err)));
            setState('error');
        }
    }, []);

    const cancel = useCallback(() => {
        // Increment ref first — any in-flight callback will see mismatch and bail
        currentRequestIdRef.current++;
        // Then abort the actual network request
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setState('idle');
        setData(null);
        setError(null);
    }, []);

    const reset = useCallback(() => {
        currentRequestIdRef.current++;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setState('idle');
        setData(null);
        setError(null);
    }, []);

    return { resolve, cancel, reset, state, data, error };
}
