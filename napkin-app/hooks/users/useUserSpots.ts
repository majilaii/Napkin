/**
 * useUserSpots — every distinct restaurant a user has logged (TICKET-092).
 *
 * The profile's "Spots" ledger (Letterboxd Films), the taste band's raw
 * material, and the dining map's pins — one fetch feeds all three.
 * Gated server-side: self always; stranger requires public profile.
 * Single fetch, capped at 500 server-side, sorted last-visited desc.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

// TICKET-145: the epithet input reducer lives in a pure sibling (test-safe —
// this file pulls supabase). Re-exported so callers import it from here.
export { deriveEpithetInput } from './epithetInput';

export interface SpotSummary {
    restaurant_id: string;
    name: string;
    city: string | null;
    country: string | null;
    cuisine: string | null;
    price_level: number | null;
    lat: number | null;
    lng: number | null;
    photo_url: string | null;
    visit_count: number;
    avg_rating: number | null;
    last_visited_at: string | null;
}

async function fetchUserSpots(identifier: string): Promise<SpotSummary[]> {
    const data = await callEdgeFn<{ spots?: SpotSummary[] }>('user-profile', {
        action: 'spots',
        body: { identifier },
    });
    return (data?.spots ?? []) as SpotSummary[];
}

export function useUserSpots(identifier: string | null | undefined) {
    return useQuery<SpotSummary[], Error>({
        queryKey: queryKeys.users.spots(identifier ?? ''),
        queryFn: () => fetchUserSpots(identifier!),
        enabled: !!identifier,
        staleTime: 1000 * 60 * 5,
    });
}

/** Aggregate for the taste band: top cuisines + city/country coverage. */
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
            if (c) cuisineCounts.set(c, (cuisineCounts.get(c) ?? 0) + s.visit_count);
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
