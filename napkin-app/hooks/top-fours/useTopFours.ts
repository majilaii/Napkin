/**
 * useTopFours — fetches the full Top Fours payload for a given user.
 * TICKET-047
 *
 * [ARCH-8] Uses owner vs publicView key based on whether userId === auth user.
 * Owner payload includes nudge + is_owner: true. Viewer payload has nudge: null.
 */

import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';

// ── Types ──────────────────────────────────────────────────────────────────

export interface TopFourRestaurant {
    id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
}

export interface TopFourPick {
    position: 1 | 2 | 3 | 4;
    restaurant: TopFourRestaurant;
}

export interface ClaimedCity {
    city: string;
    is_home: boolean;
    claimed_at: string;
    distinct_restaurant_count: number;
    picks: TopFourPick[];
}

export interface TopFourNudge {
    city: string;
    distinct_restaurant_count: number;
    log_count: number;
}

export interface TopFoursPayload {
    user_id: string;
    is_owner: boolean;
    home_city: string | null;
    claimed_cities: ClaimedCity[];
    nudge: TopFourNudge | null;
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useTopFours(userId: string | null | undefined) {
    const { user } = useAuth();
    const isOwner = !!userId && userId === user?.id;

    const queryKey = isOwner
        ? queryKeys.topFours.owner(userId!)
        : queryKeys.topFours.publicView(userId ?? '');

    return useQuery({
        queryKey,
        queryFn: () =>
            callEdgeFn<TopFoursPayload>('top-fours', {
                method: 'GET',
                action: 'get',
                params: { user_id: userId! },
            }),
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
