import { useMutation, useQueryClient } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import {
    patchProfileQuickTakes,
    toProfileQuickTakeInputs,
    type ProfileQuickTake,
} from '@/lib/profileQuickTakes';
import type { UserProfileResult } from './useUserProfile';

type MutationContext = {
    snapshots: {
        identifier: string;
        previous: UserProfileResult | undefined;
    }[];
};

/**
 * Replaces the owner's ordered quick takes. The displayed profile is patched
 * immediately, rolled back exactly on failure, then narrowly reconciled because
 * the write endpoint deliberately returns no duplicated restaurant hydration.
 */
export function useSetProfileQuickTakes(profileIdentifier: string) {
    const queryClient = useQueryClient();
    const profileKey = queryKeys.users.profile(profileIdentifier);

    return useMutation<{ ok: true }, Error, ProfileQuickTake[], MutationContext>({
        mutationFn: (takes: ProfileQuickTake[]) =>
            callEdgeFn<{ ok: true }>('top-fours', {
                action: 'set_profile_takes',
                body: { takes: toProfileQuickTakeInputs(takes) },
            }),
        onMutate: async (takes) => {
            const displayed = queryClient.getQueryData<UserProfileResult>(profileKey);
            const identifiers = [...new Set([
                profileIdentifier,
                displayed?.data?.profile.user_id,
                displayed?.data?.profile.username,
            ].filter((value): value is string => !!value))];

            await Promise.all(identifiers.map((identifier) =>
                queryClient.cancelQueries({
                    queryKey: queryKeys.users.profile(identifier),
                    exact: true,
                }),
            ));

            const snapshots = identifiers.map((identifier) => ({
                identifier,
                previous: queryClient.getQueryData<UserProfileResult>(
                    queryKeys.users.profile(identifier),
                ),
            }));
            for (const { identifier } of snapshots) {
                queryClient.setQueryData<UserProfileResult>(
                    queryKeys.users.profile(identifier),
                    (old) => patchProfileQuickTakes(old, takes),
                );
            }
            return { snapshots };
        },
        onError: (_error, _takes, context) => {
            for (const snapshot of context?.snapshots ?? []) {
                if (snapshot.previous !== undefined) {
                    queryClient.setQueryData(
                        queryKeys.users.profile(snapshot.identifier),
                        snapshot.previous,
                    );
                }
            }
        },
        onSuccess: (_data, _takes, context) => {
            // The server is authoritative for safe Places photos and canonical
            // restaurant metadata. Reconcile both UUID- and username-keyed
            // versions of this same profile without widening to other users.
            for (const { identifier } of context.snapshots) {
                queryClient.invalidateQueries({
                    queryKey: queryKeys.users.profile(identifier),
                    exact: true,
                });
            }
        },
    });
}
