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
 * Fixed order: authored lists → actual Napkin momentum → people. This is an
 * intentionally small editorial mix, not an endless ranked inventory. Generic
 * Google-rated fallback results do not belong in a surface called "For You".
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
    | { _type: 'people' };

export interface ForYouFlags {
    /** browse rows > 0 */
    hasPublicLists: boolean;
    /** at least three genuine trending cards */
    railVisible: boolean;
    /** useCoDiners length > 0 */
    hasCoDiners: boolean;
}

/** Fixed order; only visible blocks are included. Empty array ⇒ For You empty. */
export function visibleForYouBlocks(f: ForYouFlags): ForYouBlock[] {
    const out: ForYouBlock[] = [];
    if (f.hasPublicLists) out.push({ _type: 'public_lists' });
    if (f.railVisible) out.push({ _type: 'trending' });
    if (f.hasCoDiners) out.push({ _type: 'people' });
    return out;
}
