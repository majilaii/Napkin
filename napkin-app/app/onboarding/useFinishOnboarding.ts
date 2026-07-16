/**
 * Shared terminal action for every onboarding branch (TICKET-204).
 *
 * UI routes own when onboarding ends; useCompleteOnboarding owns the server
 * write and route-gate update. Keeping this bridge here gives city and follows
 * identical preview, pending, error, and success-navigation behaviour.
 */
import { useCallback } from 'react';
import { useRouter } from 'expo-router';

import { useCompleteOnboarding } from '@/hooks/onboarding/useCompleteOnboarding';
import { getPreviewOnboardingOnLaunchCached } from '@/lib/devPrefs';
import { useAuth } from '@/providers/AuthProvider';
import { type OnboardingDraft, useOnboardingDraft } from './OnboardingDraftContext';

const COMPLETION_ERROR =
    "We couldn't finish setup. Check your connection and try again.";

export function useFinishOnboarding() {
    const router = useRouter();
    const { user, onboardedAt } = useAuth();
    const { draft } = useOnboardingDraft();
    const { mutate, isPending, isError } = useCompleteOnboarding();

    const finish = useCallback((overrides: Partial<OnboardingDraft> = {}) => {
        if (
            typeof onboardedAt === 'string' &&
            getPreviewOnboardingOnLaunchCached()
        ) {
            router.replace('/wishlist');
            return;
        }
        if (isPending) return;

        // City can patch and finish in the same event. Merge its submitted value
        // synchronously so React's next context render cannot lose that final edit.
        const finalDraft = { ...draft, ...overrides };
        const display_name =
            (finalDraft.display_name && finalDraft.display_name.trim()) ||
            (user?.user_metadata?.display_name as string | undefined) ||
            'New User';
        mutate(
            {
                display_name,
                home_city:
                    finalDraft.home_city && finalDraft.home_city.trim()
                        ? finalDraft.home_city.trim()
                        : null,
                avatar_url: finalDraft.avatar_url,
            },
            {
                // Navigate only after the server confirms onboarding. Using
                // onSettled here also navigates on failure and races the route
                // gate rollback, which can strand the user between screens.
                onSuccess: () => router.replace('/wishlist'),
            },
        );
    }, [draft, isPending, mutate, onboardedAt, router, user?.user_metadata?.display_name]);

    return {
        finish,
        isPending,
        completionError: isError ? COMPLETION_ERROR : null,
    };
}
