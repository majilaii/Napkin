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
    /** TICKET-063: advertised list count from the listicle heuristic (≤6). */
    list_count?: number | null;
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
            const result = await callEdgeFn<ResolveUrlData>('resolve-url', {
                body: {
                    url: url || undefined,
                    ...(imagePath ? { image_path: imagePath } : {}),
                    ...(caption ? { caption } : {}),
                    ...(extractedText ? { extracted_text: extractedText } : {}),
                },
                signal: controller.signal,
            });

            // Only write state if this is still the current request
            if (myId !== currentRequestIdRef.current) return;
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
