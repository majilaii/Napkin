/**
 * TICKET-102 — the rail mode arbiter, pure so mode exclusivity is verified in a
 * unit test, not eyeballed in the simulator (mirrors trendingRailGate.ts).
 *
 * All-or-nothing, never mixed:
 *   - trending  iff >= 3 visible trending cards (the mode-1 k-floor, unchanged)
 *   - fallback  else, iff any fallback cards survive the client dedup/floor
 *   - hidden    else
 *
 * The title switches with the mode: mode-1 says 'trending right now' (TICKET-114);
 * mode-2 says 'nearby, well rated' (lowercase — never claims a popularity it
 * lacks). Cards are a union type; the component branches on `mode` to pick the
 * meta formatter, so a fallback card is never rendered with a trending signal line.
 */
import type { TrendingCard, FallbackCard } from '@/hooks/feed/useTrending';
import { visibleTrendingCards } from './trendingRailGate';
import { visibleFallbackCards } from './fallbackRailGate';

export const TRENDING_TITLE = 'trending right now';
export const FALLBACK_TITLE = 'nearby, well rated';

export type RailMode =
    | { mode: 'trending'; cards: TrendingCard[]; title: typeof TRENDING_TITLE }
    | { mode: 'fallback'; cards: FallbackCard[]; title: typeof FALLBACK_TITLE }
    | { mode: 'hidden'; cards: []; title: null };

export function pickRailMode(
    trending: TrendingCard[] | undefined,
    fallback: FallbackCard[] | undefined,
    savedIds: Set<string>,
): RailMode {
    // Mode 1 owns the rail whenever it clears its own k-floor (>= 3 cards).
    const trendingCards = visibleTrendingCards(trending);
    if (trendingCards.length > 0) {
        return { mode: 'trending', cards: trendingCards, title: TRENDING_TITLE };
    }

    // Mode 2 only when mode 1 is below the floor — never evaluated alongside it.
    const fallbackCards = visibleFallbackCards(fallback, savedIds);
    if (fallbackCards.length > 0) {
        return { mode: 'fallback', cards: fallbackCards, title: FALLBACK_TITLE };
    }

    return { mode: 'hidden', cards: [], title: null };
}
