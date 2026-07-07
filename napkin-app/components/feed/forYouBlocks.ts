/**
 * TICKET-125 — the For You block model + visibility arbiter, pure so block
 * composition is verified in a unit test, not eyeballed in the simulator
 * (mirrors railMode.ts / feedEmptyStateGate.ts).
 *
 * For You is a fixed, ordered stack of discovery blocks — NOT a ranked mixed
 * feed. Each block self-hides when its source is empty; this arbiter decides,
 * centrally, WHICH blocks appear so the "everything empty" case has one clean
 * answer: `visibleForYouBlocks(flags)` returns `[]` ⇒ the For You empty
 * fallback renders. Blocks still self-guard defensively inside their components.
 *
 * Fixed order (TICKET-130 Gazette mix): trending → public lists → people →
 * discovery. Trending and discovery are MUTUALLY EXCLUSIVE (the existing
 * pickRailMode arbiter owns that split): `railVisible` and `hasDiscovery` are
 * never both true for one render.
 *
 * IMPORTANT: For You renders NO `entry` cards — only list-, restaurant-, and
 * person-level rows. It therefore introduces no public-scope reaction/comment
 * patch path; the `queryKeys.feed.friendsAll` walkers in usePostInteractions
 * stay owned by Following alone. If a future block ever renders an `entry`, it
 * MUST reuse the friendsAll key shape or extend the shared walkers.
 */

export type ForYouBlock =
    | { _type: 'public_lists' }
    | { _type: 'trending' }
    | { _type: 'people' }
    | { _type: 'discovery' };

export interface ForYouFlags {
    /** browse rows > 0 */
    hasPublicLists: boolean;
    /** pickRailMode(...).mode !== 'hidden' */
    railVisible: boolean;
    /** useCoDiners length > 0 */
    hasCoDiners: boolean;
    /** railMode === 'hidden' && visibleFallbackCards > 0 */
    hasDiscovery: boolean;
}

/** Fixed order; only visible blocks are included. Empty array ⇒ For You empty. */
export function visibleForYouBlocks(f: ForYouFlags): ForYouBlock[] {
    const out: ForYouBlock[] = [];
    if (f.railVisible) out.push({ _type: 'trending' });
    if (f.hasPublicLists) out.push({ _type: 'public_lists' });
    if (f.hasCoDiners) out.push({ _type: 'people' });
    if (f.hasDiscovery) out.push({ _type: 'discovery' });
    return out;
}
