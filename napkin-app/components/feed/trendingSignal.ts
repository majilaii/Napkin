/**
 * TICKET-114 — the trending card's terracotta signal line, pure so the
 * omit-zero / max-two-terms rules are unit-testable without pulling the
 * component's expo-router import into jest (mirrors trendingRailGate.ts).
 *
 * Imports lead (the headline intake signal); saves + list adds fold into one
 * "saved" count. Zero terms are dropped; at most two terms survive.
 *   imports 7, saves 9, list_adds 3 → "7 imported · 12 saved"
 *   imports 0, saves 4, list_adds 0 → "4 saved"
 *   imports 5, saves 0, list_adds 0 → "5 imported"
 *   all zero                        → ""
 */
export interface TrendingCounts {
    imports_30d: number;
    saves_30d: number;
    list_adds_30d: number;
}

export function trendingSignal(card: TrendingCounts): string {
    const savedCount = card.saves_30d + card.list_adds_30d;
    const terms: string[] = [];
    if (card.imports_30d > 0) terms.push(`${card.imports_30d} imported`);
    if (savedCount > 0) terms.push(`${savedCount} saved`);
    return terms.slice(0, 2).join(' · ');
}
