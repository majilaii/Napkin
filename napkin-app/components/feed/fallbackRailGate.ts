/**
 * TICKET-102 — the fallback rail's client-side dedup + floor, pure so it's
 * unit-testable without pulling the component's expo-router import into jest
 * (mirrors trendingRailGate.ts).
 *
 *   - filter out restaurants already in the viewer's local wishlist/journal
 *     caches (new-to-me, not redundant)
 *   - if the filtered count would drop below MIN_FALLBACK_UNHIDE, show the
 *     UNFILTERED list instead — a near-empty "usefully filtered" rail is worse
 *     than a slightly redundant one
 *   - hard cap at MAX_FALLBACK_CARDS (finite rail, no load-more)
 *   - if even the unfiltered list is empty, return [] (absolute floor → hide)
 *
 * Display-only: NEVER mutates the cached payload.
 */
import type { FallbackCard } from '@/hooks/feed/useTrending';

export const MIN_FALLBACK_UNHIDE = 3;
export const MAX_FALLBACK_CARDS = 10;

export function visibleFallbackCards(
    cards: FallbackCard[] | undefined,
    savedIds: Set<string>,
): FallbackCard[] {
    const all = cards ?? [];
    if (all.length === 0) return [];

    const filtered = all.filter((c) => !savedIds.has(c.restaurant_id));
    // Below the unhide floor → fall back to the unfiltered (still-capped) list.
    const chosen = filtered.length < MIN_FALLBACK_UNHIDE ? all : filtered;
    return chosen.slice(0, MAX_FALLBACK_CARDS);
}
