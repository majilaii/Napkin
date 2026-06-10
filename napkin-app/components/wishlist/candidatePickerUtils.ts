/**
 * candidatePickerUtils — pure logic for CandidatePickerPanel.
 *
 * Extracted into a separate module so unit tests can import real implementations
 * without pulling in React Native dependencies (fix-pass-2 item 5).
 *
 * No I/O, no React, no native imports.
 */
import type { ResolvedCandidate } from '@/hooks/wishlist/useResolveUrl';

/**
 * Returns true when a candidate has a confirmed Places identity (restaurant_id
 * already in DB, OR real external_id from Places lookup).
 *
 * Used by the "share to a table" CTA (TICKET-063b): only resolved spots are
 * eligible for table fan-out; ghost/unresolved spots save wishlist-only.
 *
 * Spec: "has restaurant_id or real external_id" (ticket AC).
 */
export function isResolved(
    c: Pick<ResolvedCandidate, 'restaurant_id' | 'restaurant'>,
): boolean {
    return !!(c.restaurant_id || c.restaurant.external_id);
}

/**
 * Produces the stable string key used to identify a candidate in the ticked set.
 * Priority: candidate_id > google_place_id > restaurant.external_id.
 */
export function keyFor(
    c: Pick<ResolvedCandidate, 'candidate_id' | 'google_place_id' | 'restaurant'>,
): string {
    return c.candidate_id ?? c.google_place_id ?? c.restaurant.external_id ?? '';
}

/**
 * Builds the initial ticked set from a candidate list.
 *   N=1: always pre-tick the single candidate regardless of confidence.
 *   N>1: pre-tick high/exact; leave low un-ticked.
 */
export function buildInitialTicked(
    candidates: Array<Pick<ResolvedCandidate, 'candidate_id' | 'google_place_id' | 'restaurant' | 'confidence'>>,
): Set<string> {
    const ticked = new Set<string>();
    if (candidates.length === 1) {
        ticked.add(keyFor(candidates[0]));
    } else {
        for (const c of candidates) {
            if (c.confidence === 'high' || c.confidence === 'exact') {
                ticked.add(keyFor(c));
            }
        }
    }
    return ticked;
}
