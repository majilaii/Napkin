/**
 * useSetHomeCity — designates a city as HOME.
 * At most one HOME per user (enforced by partial unique index).
 * TICKET-047 / TICKET-036 doctrine.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { TopFoursPayload } from './useTopFours';

interface SetHomeCityInput {
    city: string;
}

export function useSetHomeCity() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: (input: SetHomeCityInput) =>
            callEdgeFn<TopFoursPayload>('top-fours', {
                action: 'set_home',
                body: input,
            }),

        onMutate: async (input) => {
            if (!user?.id) return;
            const ownerKey = queryKeys.topFours.owner(user.id);
            await queryClient.cancelQueries({ queryKey: ownerKey });
            const previous = queryClient.getQueryData<TopFoursPayload>(ownerKey);

            if (previous) {
                const updated: TopFoursPayload = {
                    ...previous,
                    home_city: input.city,
                    claimed_cities: previous.claimed_cities.map(c => ({
                        ...c,
                        is_home: c.city === input.city,
                    })),
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
        },
    });
}
