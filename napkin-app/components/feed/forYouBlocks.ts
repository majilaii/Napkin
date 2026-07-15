/**
 * TICKET-125 → TICKET-189 — the For You block model + visibility arbiter, pure
 * so block composition is verified in a unit test, not eyeballed in the
 * simulator.
 *
 * For You is a fixed, ordered stack of discovery blocks — NOT a ranked mixed
 * feed. Each block self-hides when its source is empty; this arbiter decides,
 * centrally, WHICH blocks appear so the "everything empty" case has one clean
 * answer: `visibleForYouBlocks(flags)` returns `[]` ⇒ the whole-surface state
 * branches (spinner / retry / invite — the §6 empty-vs-error contract in
 * ForYouFeed). Blocks still self-guard defensively inside their components.
 *
 * TICKET-189 roster: `on_socials → public_lists → people` — freshest community
 * momentum first, authored curation next, people last. Trending is GONE from
 * the stack (killed §5 — the socials module is the same "what's being saved"
 * intent expressed honestly and visually; the feed-trending BACKEND stays
 * intact for future staged modules).
 *
 * `hasSocials` is already ANDed with the FOR_YOU_SOCIALS flag upstream in
 * ForYouFeed (people-v2 selection likewise with FOR_YOU_PEOPLE_V2) — the
 * arbiter stays pure and flag-free.
 *
 * IMPORTANT: For You renders NO `entry` cards — only list-, restaurant-, and
 * person-level rows. It therefore introduces no public-scope reaction/comment
 * patch path; the `queryKeys.feed.friendsAll` walkers in usePostInteractions
 * stay owned by Following alone. If a future block ever renders an `entry`, it
 * MUST reuse the friendsAll key shape or extend the shared walkers.
 */

export type ForYouBlock =
    | { _type: 'on_socials' }
    | { _type: 'public_lists' }
    | { _type: 'people' };

export interface ForYouFlags {
    /** socials cards > 0 AND the FOR_YOU_SOCIALS flag is on (ANDed upstream). */
    hasSocials: boolean;
    /** browse rows > 0 */
    hasPublicLists: boolean;
    /** people candidates > 0 (v2 mixed rail, or co-diners when the flag is off) */
    hasPeople: boolean;
}

export interface ForYouModuleQueryState {
    isLoading: boolean;
    isError: boolean;
    data: unknown;
}

export type ForYouZeroVisibleState = 'loading' | 'retry' | 'empty';

/** Fixed order; only visible blocks are included. Empty array ⇒ §6 branch. */
export function visibleForYouBlocks(f: ForYouFlags): ForYouBlock[] {
    const out: ForYouBlock[] = [];
    if (f.hasSocials) out.push({ _type: 'on_socials' });
    if (f.hasPublicLists) out.push({ _type: 'public_lists' });
    if (f.hasPeople) out.push({ _type: 'people' });
    return out;
}

/** §6 whole-surface state, evaluated only when no discovery block is visible. */
export function resolveForYouZeroVisibleState(
    queries: ForYouModuleQueryState[],
): ForYouZeroVisibleState {
    if (queries.some((query) => query.isLoading)) return 'loading';
    if (queries.some((query) => query.isError)) return 'retry';
    return 'empty';
}
