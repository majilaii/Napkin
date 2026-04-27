/**
 * useDismissNudge — snoozes the claim-nudge for a city for 30 days.
 * Server returns { success: true }; nudge disappears from the next get.
 * TICKET-047 / TICKET-036 doctrine.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';
import type { TopFoursPayload } from './useTopFours';

interface DismissNudgeInput {
    city: string;
}

export function useDismissNudge() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: (input: DismissNudgeInput) =>
            callEdgeFn<{ success: boolean }>('top-fours', {
                action: 'dismiss_nudge',
                body: input,
            }),

        onMutate: async (input) => {
            if (!user?.id) return;
            const ownerKey = queryKeys.topFours.owner(user.id);
            await queryClient.cancelQueries({ queryKey: ownerKey });
            const previous = queryClient.getQueryData<TopFoursPayload>(ownerKey);

            if (previous && previous.nudge?.city === input.city) {
                queryClient.setQueryData(ownerKey, {
                    ...previous,
                    nudge: null,
                });
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

        // Server returns { success: true } — leave cache as-is optimistically patched.
        // On next stale-time expiry, get will confirm nudge is gone.
        onSuccess: () => {},
    });
}
