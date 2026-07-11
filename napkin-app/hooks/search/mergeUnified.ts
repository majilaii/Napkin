/**
 * mergeUnified — pure ranking for the unified search list (TICKET-167).
 *
 * Collapses the tiered `SearchResults` into ONE deterministically-ranked flat
 * list (no tier headers). search.tsx consumes this; TopFourSearchScreen /
 * EditTop4Sheet stay on the tiers.
 *
 * Rank each row by, in order:
 *   1. name-match strength vs the query — exact > prefix > substring
 *      (case- and diacritic-insensitive; NFD strip needs no dependency)
 *   2. tier boost — visited > onNapkin > ghost (familiarity bias survives the
 *      header removal: a persisted-but-unvisited row still outranks a ghost at
 *      equal match strength)
 *   3. within visited — most_recent_activity_at desc
 *   4. otherwise stable — preserve incoming order (Google relevance for ghosts)
 *
 * Stable across engines: the original index is the final tiebreaker.
 *
 * Lives in its own module (no React / supabase imports) so it stays
 * jest-importable — value-importing useRestaurantSearch pulls in the
 * react-native-url-polyfill that the CJS jest runner can't transform.
 */
import type { SearchResults, SearchResultRow, SearchTier } from './useRestaurantSearch';

/** Trim + lowercase + strip combining diacritics (built-in, no dependency). */
function normalizeForMatch(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

/** 0 = exact, 1 = prefix, 2 = substring, 3 = no match (lower is better). */
function nameMatchRank(name: string, query: string): number {
    const n = normalizeForMatch(name);
    const q = normalizeForMatch(query);
    if (!q) return 3;
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.includes(q)) return 2;
    return 3;
}

const TIER_ORDER: Record<SearchTier, number> = {
    visited: 0,
    onNapkin: 1,
    morePlaces: 2,
};

export function mergeUnified(results: SearchResults, query: string): SearchResultRow[] {
    const all = [...results.visited, ...results.onNapkin, ...results.morePlaces];
    return all
        .map((row, index) => ({ row, index, match: nameMatchRank(row.name, query) }))
        .sort((a, b) => {
            if (a.match !== b.match) return a.match - b.match;
            const at = TIER_ORDER[a.row.tier];
            const bt = TIER_ORDER[b.row.tier];
            if (at !== bt) return at - bt;
            // Within visited: most recent Table activity first.
            if (a.row.tier === 'visited' && b.row.tier === 'visited') {
                const ar = a.row.mostRecentActivityAt ?? '';
                const br = b.row.mostRecentActivityAt ?? '';
                if (ar !== br) return ar < br ? 1 : -1; // desc
            }
            return a.index - b.index; // stable: preserve incoming order
        })
        .map((d) => d.row);
}
