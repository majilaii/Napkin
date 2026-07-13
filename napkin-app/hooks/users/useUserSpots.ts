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
export { deriveEpithetInput, deriveTasteEmblemInput } from './epithetInput';

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

// Taste-band aggregate (top cuisines + coverage) moved to the pure sibling so
// it unit-tests without this file's supabase pull (TICKET-150 follow-up — it
// now filters JUNK_VENUE_TYPES out of the cuisine counts). Re-exported here so
// callers keep one import path.
export { deriveTaste } from '@/components/profile/tasteUtils';
