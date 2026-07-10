/**
 * useSetProfileTopFour — replace (or clear) the owner's curated profile Top 4.
 * An empty picks array clears the override and reverts to the auto-derived list.
 *
 * The profile payload (user-profile `profile` action) carries top_four, so we
 * invalidate the profile namespace on success to refetch. Picks need server-side
 * restaurant detail, so there's no deep optimistic patch — just refetch.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';

export interface ProfileTopFourPickInput {
    position: 1 | 2 | 3 | 4;
    restaurant_id: string;
    /**
     * TICKET-144 pt2: per-slot chosen-memory hero photo (the owner's OWN entry
     * photo at this restaurant). null/omitted → typographic plate. The edge RPC
     * validates ownership; choosing it publishes it on the profile.
     */
    hero_entry_photo_id?: string | null;
}

export function useSetProfileTopFour() {
    const queryClient = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: (picks: ProfileTopFourPickInput[]) =>
            callEdgeFn<{ ok: boolean }>('top-fours', {
                action: 'set_profile_picks',
                body: { picks },
            }),
        onSuccess: () => {
            // Only the owner's own profile changed — narrow-invalidate it (the
            // profile tab is keyed by the user's id). Avoids refetching every
            // cached public profile (CLAUDE.md mutation rule #2).
            if (user?.id) {
                queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(user.id) });
            }
        },
    });
}
