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
import { displayNameForCompletion, resolveProvidedName } from '@/lib/onboardingName';
import { getPreviewOnboardingOnLaunchCached } from '@/lib/devPrefs';
import { useAuth } from '@/providers/AuthProvider';
import { type OnboardingDraft, useOnboardingDraft } from '@/app/onboarding/OnboardingDraftContext';

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
            router.replace('/welcome?preview=1');
            return;
        }
        if (isPending) return;

        // City can patch and finish in the same event. Merge its submitted value
        // synchronously so React's next context render cannot lose that final edit.
        const finalDraft = { ...draft, ...overrides };
        // NULL, never 'New User'. The name step is optional (App Store
        // Guideline 5.1.1(x) — see app/onboarding/index.tsx), so a user can
        // legitimately arrive here without one. fn_complete_onboarding leaves
        // profiles.display_name untouched on NULL and RAISES on a non-null
        // blank, so null is the correct "nothing to write" signal; hardcoding
        // the trigger's placeholder here would just re-assert it client-side.
        const display_name =
            displayNameForCompletion(finalDraft.display_name) ??
            resolveProvidedName({
                userMetadata: user?.user_metadata as Record<string, unknown> | undefined,
            });
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
                onSuccess: () => router.replace('/welcome?intro=1'),
            },
        );
    }, [draft, isPending, mutate, onboardedAt, router, user?.user_metadata]);

    return {
        finish,
        isPending,
        completionError: isError ? COMPLETION_ERROR : null,
    };
}
