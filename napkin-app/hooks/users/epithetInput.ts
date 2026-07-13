/**
 * deriveEpithetInput — TICKET-145. Reduces the already-fetched `spots` payload
 * into the `EpithetInput` the epithet generator consumes. Pure + dependency-free
 * (type-only imports), so it is unit-testable without pulling react-query /
 * supabase (which `useUserSpots` does) — the same extraction pattern as
 * tasteUtils.ts. Re-exported from useUserSpots so callers import it there.
 *
 * ZERO server change: every field (meal sum, place count, price mode, city /
 * country coverage) is derived client-side from SpotSummary[].
 */
import type { SpotSummary } from './useUserSpots';
import type { EpithetInput } from '@/lib/engraving';
import type { TasteEmblemInput } from '@/lib/tasteEmblem';

/**
 * The emblem only needs journal size, repeat behaviour, and geographic range.
 * Keep this reducer deliberately narrower than the engraving reducer so the
 * Taste screen does not derive cuisine or price data it never displays.
 */
export function deriveTasteEmblemInput(spots: SpotSummary[]): TasteEmblemInput {
    let totalMeals = 0;
    const cities = new Set<string>();
    const countries = new Set<string>();

    for (const spot of spots) {
        totalMeals += spot.visit_count;

        const city = spot.city?.trim().toLowerCase();
        if (city) cities.add(city);

        const country = spot.country?.trim().toLowerCase();
        if (country) countries.add(country);
    }

    return {
        totalMeals,
        totalPlaces: spots.length,
        cityCount: cities.size,
        countryCount: countries.size,
    };
}

export function deriveEpithetInput(spots: SpotSummary[], topCuisine: string | null): EpithetInput {
    let meals = 0;
    const priceCounts = new Map<number, number>();
    const cities = new Set<string>();
    const countries = new Set<string>();
    for (const s of spots) {
        meals += s.visit_count;
        if (s.price_level != null) priceCounts.set(s.price_level, (priceCounts.get(s.price_level) ?? 0) + 1);
        if (s.city) cities.add(s.city.trim().toLowerCase());
        if (s.country) countries.add(s.country.trim().toLowerCase());
    }
    let priceMode: number | null = null;
    let best = 0;
    for (const [p, n] of priceCounts) if (n > best) { best = n; priceMode = p; }
    return {
        totalMeals: meals,
        totalPlaces: spots.length,
        dominantCuisine: topCuisine,
        cityCount: cities.size,
        countryCount: countries.size,
        priceMode,
    };
}
