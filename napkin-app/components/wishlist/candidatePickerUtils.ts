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
