/**
 * useNetworkMapPins — restaurants logged by people you FOLLOW, as map pins
 * (TICKET-124).
 *
 * The follow-graph fan-out of useUserSpots: instead of one user's logged
 * restaurants, this returns one pin per restaurant across the viewer's whole
 * follow set (resolved server-side, so no following_list 50-cap), each carrying
 * the most-recent followee's log — author, rating, note snippet, entry_id — plus
 * a count of the other followees who also logged it. Feeds the /dining-map
 * "network" layer toggle.
 *
 * Caller-scoped: the edge action takes no identifier (p_viewer = the JWT sub).
 * Block exclusion + public-account gate + the diary/spots visibility predicate
 * all live inside the SECURITY DEFINER RPC. Capped at 500 pins server-side.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface NetworkMapItem {
    restaurant_id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
    /** RPC guarantees non-null coords (filtered lat/lng NOT NULL). */
    lat: number;
    lng: number;
    /** Whose log this pin surfaces. `name` falls back to 'Someone'. */
    author: { id: string; name: string; avatar: string | null };
    /** → entry-detail (viewAs:'public'). */
    entry_id: string;
    rating: number | null;
    /** Short note snippet; may be null — the peek card degrades gracefully. */
    note: string | null;
    /**
     * True iff the primary entry clears the public-engagement gate (rating +
     * >=20-char content). Routes the peek tap: true → the followee's review
     * (entry-detail, viewAs public); false → the restaurant page — so a thin log
     * the looser network predicate includes never dead-ends on a review screen
     * that can't render it.
     */
    has_review: boolean;
    /** Other distinct followees who also logged here; ≥0 → "+N others". */
    others_count: number;
}

async function fetchNetworkMapPins(): Promise<NetworkMapItem[]> {
    const data = await callEdgeFn<{ pins?: NetworkMapItem[] }>('user-profile', {
        action: 'network_map_pins',
        body: {},
    });
    return (data?.pins ?? []) as NetworkMapItem[];
}

export function useNetworkMapPins(userId: string | null | undefined) {
    return useQuery<NetworkMapItem[], Error>({
        // Keyed by the caller's own id (the endpoint is caller-scoped).
        queryKey: queryKeys.users.networkMapPins(userId ?? ''),
        queryFn: fetchNetworkMapPins,
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
