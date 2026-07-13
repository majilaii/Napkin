/**
 * tasteUtils — pure client-side derivations for the taste drill-in (TICKET-112).
 *
 * Extracted so histogram, coverage, cuisine and repeat behaviour can be tested
 * without importing the screen (no React / native). No I/O or native imports.
 */
import type { HistogramBucket } from '@/hooks/users/useUserTaste';
import type { SpotSummary } from '@/hooks/users/useUserSpots';

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

/** A concise spoken equivalent of the chart; empty bins add no useful signal. */
export function ratingDistributionAccessibilityLabel(counts: number[]): string {
    const bins = HISTOGRAM_BINS.flatMap((bin, index) => {
        const count = counts[index] ?? 0;
        if (count <= 0) return [];
        const stars = bin === 1 ? 'star' : 'stars';
        const ratings = count === 1 ? 'rating' : 'ratings';
        return [`${bin} ${stars}, ${count} ${ratings}`];
    });
    return `Rating distribution: ${bins.length > 0 ? bins.join('; ') : 'no ratings'}`;
}

/** Unrated logs still carry geography and repeat-pattern Taste information. */
export function hasTasteDrillInContent(ratedMealCount: number, spotCount: number): boolean {
    return ratedMealCount > 0 || spotCount > 0;
}

/** The Taste route accepts only a canonical user id; no param means self. */
export function resolveTasteRouteTarget(
    routeUserId: string | undefined,
    viewerUserId: string | undefined,
): { targetUserId: string | undefined; isSelf: boolean } {
    const targetUserId = routeUserId ?? viewerUserId;
    return {
        targetUserId,
        isSelf: !!viewerUserId && targetUserId === viewerUserId,
    };
}

export function cuisineStatAccessibilityLabel(
    cuisine: string,
    average: number,
    ratingCount: number,
): string {
    return `${cuisine}, ${average.toFixed(1)} average from ${ratingCount} ${ratingCount === 1 ? 'rating' : 'ratings'}`;
}

export function cityStatAccessibilityLabel(city: string, mealCount: number): string {
    return `${city}, ${mealCount} ${mealCount === 1 ? 'meal' : 'meals'}`;
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
