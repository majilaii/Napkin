/**
 * Signed-out routing decision (TICKET-247).
 *
 * Pure so the route gate's redirect can be tested without a router. The
 * allowlist is fail-closed: any route not named here bounces to /auth,
 * whether or not the user is a guest.
 */

/** Top-level route groups a guest (signed out, guest flag on) may stay on. */
export const GUEST_ROUTE_GROUPS: ReadonlySet<string> = new Set([
    '(tabs)',
    'restaurant',
    'auth',
    'reset-password',
]);

/**
 * Inside (tabs), the four visible tabs plus the legacy /search redirect. The
 * hidden /journal and /log tabs are account screens, so a deep link to them
 * bounces to /auth like any other account route.
 */
export const GUEST_TAB_ROUTES: ReadonlySet<string> = new Set([
    'feed',
    'tables',
    'places',
    'profile',
    'search',
]);

/** Route groups a plain signed-out user may stay on (matches the pre-247 gate). */
const SIGNED_OUT_ROUTE_GROUPS: ReadonlySet<string> = new Set(['auth', 'reset-password']);

/**
 * '/auth' when the signed-out user must be redirected, null when the current
 * route may stay. `segments` is `useSegments()`; an empty array is the root
 * index, which redirects itself to /(tabs)/places, so a guest may sit on it.
 */
export function resolveSignedOutRedirect(
    segments: readonly (string | undefined)[],
    isGuest: boolean,
): '/auth' | null {
    const [group, child] = segments;
    if (isGuest) {
        if (group === undefined) return null;
        if (!GUEST_ROUTE_GROUPS.has(group)) return '/auth';
        if (group === '(tabs)' && child !== undefined && !GUEST_TAB_ROUTES.has(child)) return '/auth';
        return null;
    }
    if (group === undefined) return '/auth';
    return SIGNED_OUT_ROUTE_GROUPS.has(group) ? null : '/auth';
}
