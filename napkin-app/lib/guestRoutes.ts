/**
 * Signed-out routing decision (TICKET-247).
 *
 * Pure so RootLayoutNav's redirect can be tested without a router. The
 * allowlist is fail-closed: any route group not named here bounces to /auth,
 * whether or not the user is a guest.
 */

/** Route groups a guest (signed out, guest flag on) may stay on. */
export const GUEST_ROUTE_GROUPS: ReadonlySet<string> = new Set([
    '(tabs)',
    'restaurant',
    'auth',
    'reset-password',
]);

/** Route groups a plain signed-out user may stay on (matches the pre-247 gate). */
const SIGNED_OUT_ROUTE_GROUPS: ReadonlySet<string> = new Set(['auth', 'reset-password']);

/**
 * '/auth' when the signed-out user must be redirected, null when the current
 * route may stay. `segment0` is `useSegments()[0]`; undefined is the root index,
 * which redirects itself to /(tabs)/places, so a guest may sit on it.
 */
export function resolveSignedOutRedirect(
    segment0: string | undefined,
    isGuest: boolean,
): '/auth' | null {
    if (isGuest) {
        if (segment0 === undefined) return null;
        return GUEST_ROUTE_GROUPS.has(segment0) ? null : '/auth';
    }
    if (segment0 === undefined) return '/auth';
    return SIGNED_OUT_ROUTE_GROUPS.has(segment0) ? null : '/auth';
}
