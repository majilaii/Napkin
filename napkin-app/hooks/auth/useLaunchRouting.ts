/**
 * useLaunchRouting: the root route gate (TICKET-107, TICKET-090, TICKET-247).
 *
 * Moved out of app/_layout.tsx unchanged so the gate App Review judges is unit
 * tested (tests may not live under app/). From the auth state and the current
 * route group it decides whether to send the user to /auth, to onboarding, or
 * out of /auth once a session exists. Guests (TICKET-247) may stay on the
 * public route groups listed in lib/guestRoutes.
 */
import { useEffect, useRef } from 'react';
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

    // TICKET-247: leaving /auth may now be `router.back()`, which is not
    // idempotent. One exit per visit; re-armed once the route leaves auth.
    // Declared before the gate so it runs first on the same commit.
    const authExitRequested = useRef(false);
    useEffect(() => {
        if (segments[0] !== 'auth') authExitRequested.current = false;
    }, [segments]);

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
            const target = resolveSignedOutRedirect(segments[0], isGuest);
            if (target) router.replace(target);
            return;
        }

        // TICKET-107: onboardedAt is TRI-STATE (undefined = still loading). Wait
        // for it to resolve before redirecting so a fresh signup routes straight
        // to /onboarding instead of flashing Places then bouncing. AuthProvider
        // resolves it only from a real profile read. Read errors remain undefined
        // after bounded retry, deliberately keeping this route gate fail-closed.
        if (onboardedAt === undefined) return;

        // TICKET-247: /auth can sit ON TOP of a live stack: a guest pushed it from
        // a sign-in plate or a restaurant page, or an expired session replaced the
        // screen the user was on. Cold-launch /auth is the lone root and cannot go
        // back. `replace` would leave a second (tabs) shell beneath the new route.
        const authOverStack = inAuthGroup && router.canGoBack();

        if (onboardedAt === null) {
            // Normal onboarding owns this launch. Consuming the optional preview now
            // prevents completion from immediately sending the user through it again.
            previewLaunchConsumed.current = true;
            if (!inRecovery && !inOnboarding && !inResume) {
                // A new account starts onboarding from a clean root, never above
                // the guest shell it signed up from.
                if (authOverStack) router.dismissAll();
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
            if (!inOnboarding) {
                if (authOverStack) router.dismissAll();
                router.replace('/onboarding');
            }
            return;
        }

        if (inAuthGroup && !authExitRequested.current) {
            // Returning account: go back one level to where sign-in was asked for
            // (that screen re-renders signed in). Lone-root /auth goes to Places.
            authExitRequested.current = true;
            if (authOverStack) router.back();
            else router.replace('/places');
        }
    }, [session, isLoading, isGuest, onboardedAt, previewOnLaunch, previewLaunchConsumed, segments, router]);
}
