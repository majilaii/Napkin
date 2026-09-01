/**
 * Pure feed-routing predicates, kept out of the component so they're
 * unit-testable without dragging expo-router / react-native into jest (mirrors
 * feedEmptyStateGate.ts).
 *
 *   - feedWeight(row): the ONE routing rule. Bare ratings → ledger; prose or a
 *     single photo → compact note row; two or more photos → compressed card.
 *   - isNoteCard(row): backwards-compatible alias for every non-ledger entry.
 *   - shouldShowSparseTail({...}): the single deterministic gate for the
 *     "· you're caught up ·" mark on a thin feed.
 *
 * (shouldShowDiscoveryLedger + the DiscoveryLedger/railMode machinery were
 * reaped in TICKET-189 §7 — the TICKET-102 fallback rail was deliberately
 * unrendered and its plumbing is gone; the feed-trending BACKEND wire stays
 * intact for future staged modules.)
 */
import type { FriendFeedRow } from '@/hooks/feed/useFriendsFeed';

export type FeedWeight = 'ledger' | 'note' | 'card';

/**
 * TICKET-226 density ladder. The two-photo boundary is intentionally literal:
 * one photo stays a thumbnail in the compact row; two photos earn a card.
 */
export function feedWeight(row: Pick<FriendFeedRow, 'content' | 'photos'>): FeedWeight {
    if (row.photos.length >= 2) return 'card';
    if (row.content?.trim() || row.photos.length === 1) return 'note';
    return 'ledger';
}

/** Backwards-compatible alias for callers that only distinguish rich/bare. */
export function isNoteCard(row: Pick<FriendFeedRow, 'content' | 'photos'>): boolean {
    return feedWeight(row) !== 'ledger';
}

/** Number of loaded rows below which a fully-loaded feed counts as "sparse". */
export const SPARSE_TAIL_ROW_CEILING = 8;

export interface SparseTailInput {
    rows: unknown[];
    hasNextPage: boolean;
    isLoading: boolean;
}

/**
 * Show the caught-up mark + discovery ledger tail iff the friends feed has
 * reached true end-of-list (`!hasNextPage`) with a small number of rows loaded.
 * Reuses pagination's own `hasNextPage` signal + a fixed ceiling — no new
 * "is this sparse" heuristic. Guarded by `!isLoading` so it never appears while
 * the first page is still resolving.
 */
export function shouldShowSparseTail({ rows, hasNextPage, isLoading }: SparseTailInput): boolean {
    return !isLoading && rows.length > 0 && !hasNextPage && rows.length < SPARSE_TAIL_ROW_CEILING;
}
