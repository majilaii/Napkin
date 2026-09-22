/**
 * useLaunchRouting: the root route gate (TICKET-107, TICKET-090, TICKET-247).
 *
 * Moved out of app/_layout.tsx so the gate App Review judges is unit tested
 * (tests may not live under app/). From the auth state and the current route
 * it decides whether to send the user to /auth, to onboarding, or out of /auth
 * once a session exists. The only behaviour change is TICKET-247: a guest may
 * stay on the public routes listed in lib/guestRoutes.
 *
 * Signing in never returns to a screen below /auth: OnboardingGateBoundary
 * unmounts the whole navigator while the new session's profile is read, so the
 * stack is rebuilt from scratch afterwards (as it always was).
 */
import { useEffect } from 'react';
import { useRouter, useSegments } from 'expo-router';

import { resolveSignedOutRedirect } from '@/lib/guestRoutes';
import { useAuth } from '@/providers/AuthProvider';

export function useLaunchRouting(
    previewOnLaunch: boolean | undefined,
    previewLaunchConsumed: { current: boolean },
): void {
    const { session, isLoading, onboardedAt, isGuest } = useAuth();
    const segments = useSegments();
    const router = useRouter();

    useEffect(() => {
        // Resolve the local preview preference before any launch routing. Signed-in
        // decisions also wait for the tri-state onboarding gate below, so auth never
        // routes once to Wishlist and then again to the preview.
        if (isLoading || previewOnLaunch === undefined) return;

        const inAuthGroup = segments[0] === 'auth';
        // TICKET-090: the password-recovery deep link must survive both redirects:
        // it starts signed-out (would bounce to /auth) and setSession() flips to
        // signed-in mid-form (would bounce to Places before the new password).
        const inRecovery = segments[0] === 'reset-password';
        // TICKET-107: a pending share/handoff resume (auth.tsx redirects to these)
        // must finish BEFORE onboarding: "import resume wins."
        const inOnboarding = segments[0] === 'onboarding';
        const inResume = segments[0] === 'import' || segments[0] === 'handoff' || segments[0] === 'join-table';

        if (!session) {
            // TICKET-247: a guest may stay on the public route groups; everyone
            // else signed out goes to /auth (fail-closed allowlist in lib/guestRoutes).
            const target = resolveSignedOutRedirect(segments, isGuest);
            if (target) router.replace(target);
            return;
        }

        // TICKET-107: onboardedAt is TRI-STATE (undefined = still loading). Wait
        // for it to resolve before redirecting so a fresh signup routes straight
        // to /onboarding instead of flashing Places then bouncing. AuthProvider
        // resolves it only from a real profile read. Read errors remain undefined
        // after bounded retry, deliberately keeping this route gate fail-closed.
        if (onboardedAt === undefined) return;

        if (onboardedAt === null) {
            // Normal onboarding owns this launch. Consuming the optional preview now
            // prevents completion from immediately sending the user through it again.
            previewLaunchConsumed.current = true;
            if (!inRecovery && !inOnboarding && !inResume) {
                router.replace('/onboarding');
            }
            return;
        }

        if (
            previewOnLaunch &&
            !previewLaunchConsumed.current &&
            !inRecovery &&
            !inResume
        ) {
            previewLaunchConsumed.current = true;
            if (!inOnboarding) router.replace('/onboarding');
            return;
        }

        if (inAuthGroup) {
            router.replace('/places');
        }
    }, [session, isLoading, isGuest, onboardedAt, previewOnLaunch, previewLaunchConsumed, segments, router]);
}
