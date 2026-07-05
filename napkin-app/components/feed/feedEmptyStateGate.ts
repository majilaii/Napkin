/**
 * TICKET-101 — the feed empty-state tier resolver, pure so it's unit-testable
 * without pulling the component's expo-router import into jest.
 *
 * Binary rule (no hybrid, no "in-between"):
 *   ≥1 co-diner candidate → tier 1 (up to MAX_CODINER_CARDS follow cards)
 *   else                  → tier 2 (ghost card + invite)
 *
 * Mixing a real person with a placeholder in one screen breaks the
 * "never fake-real" rule by proximity — hence the hard split.
 */
import type { CoDinerCandidate } from '@/hooks/feed/useCoDiners';

/** Cap tier-1 at 3 cards even if more candidates qualify (Empty-State Slab restraint). */
export const MAX_CODINER_CARDS = 3;

export type EmptyStateResolution =
    | { tier: 1; cards: CoDinerCandidate[] }
    | { tier: 2 };

export function resolveEmptyState(
    candidates: CoDinerCandidate[] | undefined,
): EmptyStateResolution {
    const list = candidates ?? [];
    if (list.length === 0) return { tier: 2 };
    return { tier: 1, cards: list.slice(0, MAX_CODINER_CARDS) };
}
