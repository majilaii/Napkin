/**
 * useCompleteOnboarding — TICKET-107.
 *
 * Finishes the onboarding stack in one server call: writes display_name +
 * home_city and stamps onboarded_at (user-profile `complete_onboarding`). The
 * local route gate changes only after the server confirms success, preventing
 * a failed request from briefly releasing onboarding and racing navigation.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';

export interface CompleteOnboardingInput {
    display_name: string;
    /** Free-text home city; null/empty when skipped. */
    home_city?: string | null;
    /** Uploaded avatar public URL; null when the photo step was skipped (TICKET-126). */
    avatar_url?: string | null;
}

interface OnboardingProfileRow {
    user_id: string;
    display_name: string;
    home_city: string | null;
    onboarded_at: string | null;
    // TICKET-126: server also stamps these at completion.
    avatar_url: string | null;
    terms_accepted_at: string | null;
    account_privacy: 'private' | 'public';
}

export function useCompleteOnboarding() {
    const qc = useQueryClient();
    const { user, setOnboardedAt } = useAuth();

    return useMutation({
        mutationFn: async (input: CompleteOnboardingInput) => {
            return callEdgeFn<OnboardingProfileRow>('user-profile', {
                action: 'complete_onboarding',
                body: {
                    display_name: input.display_name,
                    home_city: input.home_city ?? null,
                    avatar_url: input.avatar_url ?? null,
                },
            });
        },

        onSuccess: (row) => {
            if (row?.onboarded_at) setOnboardedAt(row.onboarded_at);
            // Reconcile any cached profile read for this user (own profile view).
            if (user?.id) {
                qc.invalidateQueries({ queryKey: queryKeys.users.profile(user.id) });
            }
        },
    });
}
