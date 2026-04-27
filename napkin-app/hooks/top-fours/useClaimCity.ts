/**
 * useClaimCity — claims a city with initial picks.
 * TICKET-047 / TICKET-036 mutation doctrine.
 *
 * Optimistic patch: appends the new city to claimed_cities + drops the nudge
 * if nudge.city === input.city + flips is_home if first claim.
 * Snapshot + rollback on error. onSuccess replaces cache with server payload.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { TopFoursPayload, ClaimedCity } from './useTopFours';

interface ClaimCityInput {
    city: string;
    picks: Array<{ position: 1 | 2 | 3 | 4; restaurant_id: string }>;
}

export function useClaimCity() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: (input: ClaimCityInput) =>
            callEdgeFn<TopFoursPayload>('top-fours', {
                action: 'claim',
                body: input,
            }),

        onMutate: async (input) => {
            if (!user?.id) return;
            const ownerKey = queryKeys.topFours.owner(user.id);

            await queryClient.cancelQueries({ queryKey: ownerKey });
            const previous = queryClient.getQueryData<TopFoursPayload>(ownerKey);

            if (previous) {
                const isFirstClaim = previous.claimed_cities.length === 0;
                const optimisticCity: ClaimedCity = {
                    city: input.city,
                    is_home: isFirstClaim,
                    claimed_at: new Date().toISOString(),
                    distinct_restaurant_count: 0,
                    picks: [], // server will fill in restaurant details
                };
                const updated: TopFoursPayload = {
                    ...previous,
                    home_city: isFirstClaim ? input.city : previous.home_city,
                    claimed_cities: [
                        // HOME first — if first claim, new city goes to front
                        ...(isFirstClaim
                            ? [optimisticCity, ...previous.claimed_cities]
                            : [...previous.claimed_cities, optimisticCity]),
                    ],
                    nudge:
                        previous.nudge?.city === input.city ? null : previous.nudge,
                };
                queryClient.setQueryData(ownerKey, updated);
            }

            return { previous };
        },

        onError: (_err, _input, ctx) => {
            if (!user?.id || ctx?.previous === undefined) return;
            queryClient.setQueryData(queryKeys.topFours.owner(user.id), ctx.previous);
        },

        onSuccess: (serverPayload) => {
            if (!user?.id) return;
            // Replace with authoritative server payload (has real restaurant details)
            queryClient.setQueryData(queryKeys.topFours.owner(user.id), serverPayload);
            // Claiming removes a city from available — invalidate that list
            queryClient.invalidateQueries({
                queryKey: queryKeys.topFours.availableCities(user.id),
            });
        },
    });
}
