/**
 * restaurantSignal.ts — pure helpers for the restaurant page signal strip.
 *
 * These are extracted from `app/restaurant/[id].tsx` so that:
 *   1. The lens-default logic and collapse decision are jest-covered.
 *   2. The components import and use the same logic (no parallel re-implementations).
 *
 * No React or component imports — safe to unit-test in a Node environment.
 */

/** Interactive tier identifiers (Google is always inert, excluded from SignalTier). */
export type SignalTier = 'you' | 'your_table' | 'napkin';

/** Which siblings have real data. */
export interface PopulatedFlags {
    you: boolean;
    table: boolean;
    napkin: boolean;
    google: boolean;
}

/**
 * Returns the richest populated interactive tier to use as the default active lens.
 *
 * Priority order: napkin > you > your_table.
 * Falls back to 'napkin' (empty/canonical) when nothing is populated; callers should
 * collapse the strip in that case rather than drawing an underline under a "—" cell.
 */
export function pickDefaultTier(flags: PopulatedFlags): SignalTier {
    if (flags.napkin) return 'napkin';
    if (flags.you) return 'you';
    if (flags.table) return 'your_table';
    return 'napkin'; // all empty — strip should collapse; underline suppressed in SigCell
}

/**
 * Returns the names of populated siblings (interactive + Google).
 *
 * Usage: the four-cell strip renders in full when `.length >= 2`.
 * When `.length < 2` the strip collapses to populated-only cells.
 * Omitting empty siblings ≠ merging tiers — doctrine intact.
 */
export function populatedTiers(flags: PopulatedFlags): Array<SignalTier | 'google'> {
    const result: Array<SignalTier | 'google'> = [];
    if (flags.you) result.push('you');
    if (flags.table) result.push('your_table');
    if (flags.napkin) result.push('napkin');
    if (flags.google) result.push('google');
    return result;
}
