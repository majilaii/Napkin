/**
 * useProvidedDisplayName — "did an identity provider already tell us the name?"
 *
 * Resolves, in precedence order, from lib/pendingIdentity (this sign-in's native
 * credential) and then supabase user_metadata. A non-null name means the
 * onboarding name step must NOT be shown: Apple already provided it, and asking
 * again is the App Store Guideline 4 defect of 2026-09-14.
 *
 * TRI-STATE, deliberately:
 *   string    — we have a name; skip the step.
 *   null      — nobody gave us one; the step may ask, optionally.
 *   undefined — STILL READING. The screen renders nothing, so it never flashes a
 *               name form it is about to skip past.
 *
 * `undefined` is only ever transient. The synchronous memo in pendingIdentity
 * answers on the FIRST render for the normal path (sign-in seconds ago, same app
 * session); the AsyncStorage read behind it only matters when the app was killed
 * between sign-in and onboarding. Once auth has settled, a missing user resolves
 * to null rather than waiting forever — a permanently blank step would be a
 * worse failure than asking.
 */
import { useEffect, useState } from 'react';
import * as pendingIdentity from '@/lib/pendingIdentity';
import { resolveProvidedName } from '@/lib/onboardingName';
import { useAuth } from '@/providers/AuthProvider';

export function useProvidedDisplayName(): string | null | undefined {
    const { user, isLoading } = useAuth();
    const userId = user?.id;
    const metadata = user?.user_metadata as Record<string, unknown> | undefined;

    /** Resolved from the AsyncStorage fallback; undefined until that read lands. */
    const [stored, setStored] = useState<string | null | undefined>(undefined);

    // Cheap (in-memory memo + a couple of property reads), so recompute rather
    // than snapshot — a snapshot would go stale when the session refreshes and
    // user_metadata arrives a beat after the first render.
    const immediate = userId
        ? resolveProvidedName({
              stashedFullName: pendingIdentity.peekSync(userId)?.fullName,
              userMetadata: metadata,
          })
        : null;

    useEffect(() => {
        if (!userId || immediate) return;
        let cancelled = false;
        (async () => {
            const stashed = await pendingIdentity.peek(userId);
            if (cancelled) return;
            setStored(
                resolveProvidedName({
                    stashedFullName: stashed?.fullName,
                    userMetadata: metadata,
                }),
            );
        })();
        return () => {
            cancelled = true;
        };
        // `metadata` is a fresh object identity on every session refresh; keying
        // the effect on it would re-run this read on every token refresh. userId
        // is the identity that matters, and `immediate` already covers the case
        // where metadata later gains the name.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId, immediate]);

    if (immediate) return immediate;
    if (isLoading) return undefined;
    if (!userId) return null;
    return stored;
}
