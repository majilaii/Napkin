/**
 * useUnclaimCity — removes a claimed city (calls unclaim_city RPC via edge fn).
 * If the city was HOME and another claimed city exists, the server promotes
 * the next-most-recent city to HOME.
 * TICKET-047 / TICKET-036 doctrine.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { TopFoursPayload } from './useTopFours';

interface UnclaimCityInput {
    city: string;
}

export function useUnclaimCity() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: (input: UnclaimCityInput) =>
            callEdgeFn<TopFoursPayload>('top-fours', {
                action: 'unclaim',
                body: input,
            }),

        onMutate: async (input) => {
            if (!user?.id) return;
            const ownerKey = queryKeys.topFours.owner(user.id);
            await queryClient.cancelQueries({ queryKey: ownerKey });
            const previous = queryClient.getQueryData<TopFoursPayload>(ownerKey);

            if (previous) {
                const wasHome = previous.claimed_cities.find(c => c.city === input.city)?.is_home ?? false;
                const remaining = previous.claimed_cities.filter(c => c.city !== input.city);

                // Optimistically assign HOME to next-most-recent if needed
                let newHomeCity = previous.home_city;
                if (wasHome && remaining.length > 0) {
                    const nextHome = remaining[0];
                    newHomeCity = nextHome.city;
                    remaining[0] = { ...nextHome, is_home: true };
                } else if (wasHome) {
                    newHomeCity = null;
                }

                const updated: TopFoursPayload = {
                    ...previous,
                    home_city: newHomeCity,
                    claimed_cities: remaining,
                };
                queryClient.setQueryData(ownerKey, updated);
            }

            return { previous };
        },

        onError: (_err, _input, ctx) => {
            if (!user?.id) return;
            const ownerKey = queryKeys.topFours.owner(user.id);
            if (ctx?.previous !== undefined) {
                queryClient.setQueryData(ownerKey, ctx.previous);
            }
        },

        onSuccess: (serverPayload) => {
            if (!user?.id) return;
            queryClient.setQueryData(queryKeys.topFours.owner(user.id), serverPayload);
            // Available cities changes after unclaim
            queryClient.invalidateQueries({
                queryKey: queryKeys.topFours.availableCities(user.id),
            });
        },
    });
}
