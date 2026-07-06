/**
 * useCompleteOnboarding — TICKET-107.
 *
 * Finishes the onboarding stack in one server call: writes display_name +
 * home_city and stamps onboarded_at (user-profile `complete_onboarding`). On
 * mutate it optimistically flips AuthProvider's `onboardedAt` so RootLayoutNav
 * stops routing to /onboarding instantly; on error it rolls the gate back to
 * null so the user stays in onboarding (snapshot → patch → rollback per
 * lib/mutations.md). onSuccess reconciles from the server's returned row.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';

export interface CompleteOnboardingInput {
    display_name: string;
    /** Free-text home city; null/empty when skipped. */
    home_city?: string | null;
}

interface OnboardingProfileRow {
    user_id: string;
    display_name: string;
    home_city: string | null;
    onboarded_at: string | null;
}

export function useCompleteOnboarding() {
    const qc = useQueryClient();
    const { user, onboardedAt, setOnboardedAt } = useAuth();

    return useMutation({
        mutationFn: async (input: CompleteOnboardingInput) => {
            return callEdgeFn<OnboardingProfileRow>('user-profile', {
                action: 'complete_onboarding',
                body: {
                    display_name: input.display_name,
                    home_city: input.home_city ?? null,
                },
            });
        },

        onMutate: (_input) => {
            // Snapshot the tri-state gate, then release it optimistically so the
            // redirect away from /onboarding is instant.
            const previous = onboardedAt;
            setOnboardedAt(new Date().toISOString());
            return { previous };
        },

        onError: (_err, _input, ctx) => {
            // Roll the gate back to whatever it was (null → stay in onboarding).
            setOnboardedAt(ctx?.previous ?? null);
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
