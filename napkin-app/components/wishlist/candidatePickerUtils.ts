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
 * Builds the initial ticked set from a candidate list — pre-ticks ALL candidates
 * EXCEPT warned ones (TICKET-086c).
 *
 * The user imported this list to save it; a confidence-gated default (pre-tick
 * only high/exact) silently dropped low-confidence spots — e.g. 5 of an 11-spot
 * listicle — unless the user noticed and ticked them (TICKET-082 partial-save).
 * Save-all + let them untick the duds matches the import intent.
 *
 * stance === 'warned' ("most overrated spot…") is the one exception: an
 * anti-recommendation never saves by default, on ANY entry point — the user
 * can still tick it deliberately.
 */
export function buildInitialTicked(
    candidates: Array<
        Pick<ResolvedCandidate, 'candidate_id' | 'google_place_id' | 'restaurant' | 'confidence' | 'stance'>
    >,
): Set<string> {
    const ticked = new Set<string>();
    for (const c of candidates) {
        if (c.stance === 'warned') continue;
        ticked.add(keyFor(c));
    }
    return ticked;
}
