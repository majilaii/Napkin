/**
 * TICKET-103 — pure feed-routing predicates, kept out of the component so they're
 * unit-testable without dragging expo-router / react-native into jest (mirrors
 * railMode.ts / feedEmptyStateGate.ts).
 *
 *   - isNoteCard(row): the ONE routing rule. Prose or photos → note card;
 *     a bare rating → ledger line. No thresholds, no engagement scoring — the
 *     author's own effort decides how loud the entry is.
 *   - shouldShowSparseTail({...}): the single deterministic gate for the
 *     "· you're caught up ·" mark + discovery ledger tail on a thin feed.
 *   - shouldShowDiscoveryLedger(mode): the vertical ledger self-gate — false
 *     whenever the horizontal rail is showing (TICKET-104), so discovery never
 *     renders twice on one screen.
 */
import type { FriendFeedRow } from '@/hooks/feed/useFriendsFeed';
import type { RailMode } from './railMode';

/** True when the entry has something to say — prose or photos. */
export function isNoteCard(row: Pick<FriendFeedRow, 'content' | 'photos'>): boolean {
    return !!row.content?.trim() || row.photos.length > 0;
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

/**
 * The vertical DiscoveryLedger renders ONLY when the horizontal rail is hidden —
 * i.e. when the shared `pickRailMode` (same inputs TrendingRail uses) returns
 * `'hidden'`. Any other mode means the rail owns discovery for this screen, so
 * the ledger stands down and discovery never appears twice (TICKET-104).
 */
export function shouldShowDiscoveryLedger(mode: RailMode['mode']): boolean {
    return mode === 'hidden';
}
