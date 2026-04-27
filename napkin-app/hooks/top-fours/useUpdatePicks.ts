/**
 * useUpdatePicks — update the picks for an already-claimed city.
 * TICKET-047 / TICKET-036 doctrine.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { TopFoursPayload } from './useTopFours';

interface UpdatePicksInput {
    city: string;
    picks: Array<{ position: 1 | 2 | 3 | 4; restaurant_id: string }>;
}

export function useUpdatePicks() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: (input: UpdatePicksInput) =>
            callEdgeFn<TopFoursPayload>('top-fours', {
                action: 'update_picks',
                body: input,
            }),

        onMutate: async (input) => {
            if (!user?.id) return;
            const ownerKey = queryKeys.topFours.owner(user.id);
            await queryClient.cancelQueries({ queryKey: ownerKey });
            const previous = queryClient.getQueryData<TopFoursPayload>(ownerKey);
            // Picks need restaurant details from server — just snapshot for rollback,
            // don't do a deep optimistic patch on picks (restaurant shapes unknown locally).
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
