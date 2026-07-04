/**
 * TICKET-098 — the TrendingRail double-gate, pure so it's unit-testable
 * without pulling the component's expo-router import into jest.
 *
 *   - fewer than 3 cards → [] (rail hidden entirely; the server floors at 3
 *     too, but a stale cache must never surface a one-card rail)
 *   - hard cap at 10 (finite rail, no load-more)
 */
import type { TrendingCard } from '@/hooks/feed/useTrending';

export const MAX_TRENDING_CARDS = 10;
export const MIN_TRENDING_CARDS = 3;

export function visibleTrendingCards(rows: TrendingCard[] | undefined): TrendingCard[] {
    const capped = (rows ?? []).slice(0, MAX_TRENDING_CARDS);
    return capped.length < MIN_TRENDING_CARDS ? [] : capped;
}
