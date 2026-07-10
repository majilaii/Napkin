/**
 * tasteUtils — pure client-side derivations for the taste drill-in (TICKET-112).
 *
 * Extracted so the editorial-line gate can be unit-tested without importing the
 * screen (no React / native). No I/O, no React, no native imports.
 */
import type { TasteData, CategoryStat, HistogramBucket } from '@/hooks/users/useUserTaste';
import type { SpotSummary } from '@/hooks/users/useUserSpots';

/** The four axes, in display order. "flavor" is the founder's "taste". */
export const TASTE_AXES: { key: keyof TasteData['categories']; label: string }[] = [
    { key: 'flavor', label: 'Taste' },
    { key: 'service', label: 'Service' },
    { key: 'value', label: 'Value' },
    { key: 'vibe', label: 'Vibe' },
];

/**
 * "you rate {axis} the hardest" — the lowest-mean axis label, but ONLY when the
 * signal is real: spread (max − min mean) ≥ 0.4 AND every axis has n ≥ 5. Thin
 * or flat data → null (no editorial line). Returns the display label (e.g.
 * "Value"), or null.
 */
export function deriveHardestAxis(cats: TasteData['categories']): string | null {
    const scored = TASTE_AXES
        .map((a) => ({ label: a.label, stat: cats[a.key] }))
        .filter((x): x is { label: string; stat: CategoryStat & { avg: number } } => x.stat.avg != null);
    if (scored.length < 2) return null;
    // Every axis must be well-sampled — thin data never fires the line.
    if (TASTE_AXES.some((a) => cats[a.key].n < 5)) return null;
    const avgs = scored.map((s) => s.stat.avg);
    const spread = Math.max(...avgs) - Math.min(...avgs);
    if (spread < 0.4) return null;
    const hardest = scored.reduce((lo, s) => (s.stat.avg < lo.stat.avg ? s : lo), scored[0]);
    return hardest.label;
}

/**
 * Generic Google Places venue types that leak into `restaurants.cuisine`
 * (humanized primaryType) but are not cuisines. Client-side mirror of the
 * NOT IN list in fn_user_taste v2 (20260710120000) — keep the two in sync.
 * Compare lowercased + trimmed.
 */
export const JUNK_VENUE_TYPES = new Set([
    'restaurant',
    'food',
    'hotel',
    'lodging',
    'resort hotel',
    'meal takeaway',
    'meal delivery',
    'point of interest',
    'establishment',
    'store',
    'food court',
    'event venue',
    'tourist attraction',
    'market',
    'shopping mall',
]);

/**
 * Aggregate for the profile taste band: top cuisines + city/country coverage.
 * Junk venue types never count as cuisines (TICKET-150 follow-up); coverage
 * counts are unaffected. Lives here (pure, no I/O) so it unit-tests without
 * pulling supabase; `useUserSpots` re-exports it for callers.
 */
export function deriveTaste(spots: SpotSummary[]): {
    topCuisines: string[];
    cityCount: number;
    countryCount: number;
} {
    const cuisineCounts = new Map<string, number>();
    const cities = new Set<string>();
    const countries = new Set<string>();
    for (const s of spots) {
        if (s.cuisine) {
            const c = s.cuisine.trim().toLowerCase();
            if (c && !JUNK_VENUE_TYPES.has(c)) {
                cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + s.visit_count);
            }
        }
        if (s.city) cities.add(s.city.trim().toLowerCase());
        if (s.country) countries.add(s.country.trim().toLowerCase());
    }
    const topCuisines = [...cuisineCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([c]) => c);
    return { topCuisines, cityCount: cities.size, countryCount: countries.size };
}

/** The ten half-star bins, ascending. Shared by the histogram fill + render. */
export const HISTOGRAM_BINS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];

/**
 * Expand the server's sparse `[{r, n}]` histogram into ten dense counts, one
 * per HISTOGRAM_BINS slot. Unknown / off-grid r values are dropped (server
 * snaps to the same grid, so this only guards against garbage).
 */
export function fillHistogram(sparse: HistogramBucket[] | undefined): number[] {
    const counts = new Array<number>(HISTOGRAM_BINS.length).fill(0);
    for (const b of sparse ?? []) {
        const idx = HISTOGRAM_BINS.indexOf(b.r);
        if (idx !== -1 && Number.isFinite(b.n) && b.n > 0) counts[idx] += b.n;
    }
    return counts;
}

export interface CityStat {
    /** Display name — first-seen casing. */
    city: string;
    /** Logged meals in that city (sum of visit_count). */
    meals: number;
}

export interface CityLedger {
    rows: CityStat[];
    cityCount: number;
    countryCount: number;
}

/**
 * "Where you've eaten" — top cities by logged meals, plus total coverage.
 * Cities keyed case-insensitively; display uses the first-seen casing.
 */
export function deriveCityLedger(spots: SpotSummary[], max = 4): CityLedger {
    const byCity = new Map<string, CityStat>();
    const countries = new Set<string>();
    for (const s of spots) {
        const city = s.city?.trim();
        if (city) {
            const key = city.toLowerCase();
            const cur = byCity.get(key);
            const meals = Math.max(1, s.visit_count || 0);
            if (cur) cur.meals += meals;
            else byCity.set(key, { city, meals });
        }
        const country = s.country?.trim();
        if (country) countries.add(country.toLowerCase());
    }
    const rows = [...byCity.values()]
        .sort((a, b) => b.meals - a.meals || a.city.localeCompare(b.city))
        .slice(0, max);
    return { rows, cityCount: byCity.size, countryCount: countries.size };
}

/**
 * "You keep going back to {name}" — the most-returned-to spot, only when the
 * habit is real (>= 3 visits). Ties break to the most recently visited.
 */
export function deriveRegular(spots: SpotSummary[]): { name: string; visits: number } | null {
    let best: SpotSummary | null = null;
    for (const s of spots) {
        if (s.visit_count < 3) continue;
        if (
            !best ||
            s.visit_count > best.visit_count ||
            (s.visit_count === best.visit_count &&
                (s.last_visited_at ?? '') > (best.last_visited_at ?? ''))
        ) {
            best = s;
        }
    }
    return best ? { name: best.name, visits: best.visit_count } : null;
}
