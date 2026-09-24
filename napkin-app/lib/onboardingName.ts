/**
 * onboardingName — resolve the display name an identity provider already gave us.
 *
 * App Store Guideline 4 (rejection 2026-09-14): "users are required to provide
 * their name and/or email address after using Sign in with Apple even though
 * that information is already provided by the Authentication Services
 * framework." Two separate rules are in play, and the fix needs both:
 *
 *   • Apple DOES supply the name — once. Use it, never re-ask. That is what
 *     `resolveProvidedName` is for: when it returns a name, the onboarding name
 *     step is skipped outright.
 *   • Apple only supplies it on the FIRST authorization. An App Review reviewer
 *     whose Apple ID already authorized Napkin in an earlier round gets
 *     fullName: null, and no amount of persistence can recover it. So the step
 *     must ALSO stop being a precondition — App Review Guideline 5.1.1(x) allows
 *     asking for a name "so long as the request is optional for the user,
 *     features and services are not conditional on providing the information".
 *     The old `canContinue = name.trim().length > 0` hard block was the defect.
 *
 * Lives in lib/ rather than beside the screen because scripts/check-route-tree.mjs
 * fails CI on any test file under napkin-app/app/ — this is the testable half.
 */

/**
 * What `handle_new_user` writes when no provider metadata carries a name
 * (every Apple signup, since the Apple identity JWT has no name claim — the
 * name travels out-of-band in the native credential). It is a placeholder, not
 * something a user chose, so it must never satisfy "we already have a name".
 */
export const SERVER_PLACEHOLDER_NAME = 'New User';

/**
 * True for the trigger's placeholder. A user who skipped the optional name step
 * keeps it, so surfaces render a neutral fallback instead of printing
 * "New User" and an "NU" monogram (TICKET-250).
 */
export function isPlaceholderName(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.trim().toLowerCase() === SERVER_PLACEHOLDER_NAME.toLowerCase();
}

/** Matches the server cap in fn_complete_onboarding (1–80 chars after trim). */
export const MAX_DISPLAY_NAME = 80;

/** Trim, drop blanks, reject the server placeholder, cap at the server's limit. */
function usable(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === SERVER_PLACEHOLDER_NAME.toLowerCase()) return null;
    return trimmed.slice(0, MAX_DISPLAY_NAME);
}

export interface ProvidedNameSources {
    /**
     * Name from THIS sign-in's native credential (lib/pendingIdentity). Highest
     * precedence: it is the freshest, and for Apple it is the only time the name
     * is ever offered.
     */
    stashedFullName?: string | null;
    /**
     * supabase `user.user_metadata`. Google populates full_name/name from its ID
     * token; Apple gets full_name only because auth.tsx writes it back with
     * updateUser after the native credential hands it over.
     */
    userMetadata?: Record<string, unknown> | null;
}

/**
 * The name a provider already gave us, or null when none did.
 *
 * A non-null result means the user must NOT be asked — the onboarding name step
 * skips itself. Null means we genuinely do not know the name (email/password
 * signup, or an Apple re-authorization), and the step may ask — optionally.
 */
export function resolveProvidedName({
    stashedFullName,
    userMetadata,
}: ProvidedNameSources): string | null {
    const fromStash = usable(stashedFullName);
    if (fromStash) return fromStash;

    const meta = userMetadata ?? {};
    return (
        usable(meta.display_name) ??
        usable(meta.full_name) ??
        usable(meta.name) ??
        null
    );
}

/**
 * Normalise a name for `complete_onboarding`.
 *
 * NULL is meaningful on the wire: fn_complete_onboarding leaves
 * profiles.display_name untouched when p_display_name IS NULL, and RAISES on a
 * non-null blank. So a skipped/empty name step must send null, never ''.
 */
export function displayNameForCompletion(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, MAX_DISPLAY_NAME);
}
