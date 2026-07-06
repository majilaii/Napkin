/**
 * oauth — native ID-token sign-in helpers for Apple and Google (TICKET-110).
 *
 * Each provider runs its own native credential dance and returns an ID token that
 * auth.tsx hands to `supabase.auth.signInWithIdToken({ provider, token })` — never
 * the web `signInWithOAuth` browser redirect (no Safari hop, no custom URL-scheme
 * return leg colliding with our napkin:// scheme).
 *
 * LAZY native imports: the provider libs are required INSIDE the functions (same
 * pattern as modules/media-extract/index.ts). A mis-linked lib then fails at CALL
 * time with a catchable error instead of crashing auth.tsx at module load.
 */

/** Raised when the user cancels the Apple/Google sheet. Callers swallow silently. */
export class OAuthCancelledError extends Error {
    constructor() {
        super('oauth_cancelled');
        this.name = 'OAuthCancelledError';
    }
}

export interface AppleCredential {
    /** The JWT to verify against Supabase's Apple provider. */
    identityToken: string;
    /**
     * Full name — Apple returns it ONLY on the first authorization and only when
     * the name scope is requested. Absent on re-auth. auth.tsx does not depend on
     * it (the trigger falls to 'New User' and onboarding captures the name), but
     * it is threaded through in case a future name round-trip wants it.
     */
    fullName: string | null;
}

/**
 * Run the native Sign in with Apple sheet (FULL_NAME + EMAIL scopes) and return
 * the identity token + parsed name. Throws OAuthCancelledError on user cancel.
 */
export async function appleIdToken(): Promise<AppleCredential> {
    // Lazy require — a mis-linked native lib throws HERE, not at auth.tsx load
    // (same lazy-on-first-call pattern as modules/media-extract/index.ts, which
    // resolves its native binding on demand rather than at import time). A static
    // import would run at auth.tsx module load and crash the sign-in screen.
    const AppleAuthentication =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('expo-apple-authentication') as typeof import('expo-apple-authentication');

    try {
        const credential = await AppleAuthentication.signInAsync({
            requestedScopes: [
                AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
                AppleAuthentication.AppleAuthenticationScope.EMAIL,
            ],
        });

        if (!credential.identityToken) {
            throw new Error('Apple sign-in returned no identity token.');
        }

        const name = credential.fullName;
        const parts = [name?.givenName, name?.familyName].filter(
            (p): p is string => !!p && p.trim().length > 0,
        );
        const fullName = parts.length > 0 ? parts.join(' ') : null;

        return { identityToken: credential.identityToken, fullName };
    } catch (err) {
        // ERR_REQUEST_CANCELED = user dismissed the sheet.
        if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code?: string }).code === 'ERR_REQUEST_CANCELED'
        ) {
            throw new OAuthCancelledError();
        }
        throw err;
    }
}

let googleConfigured = false;

/**
 * Configure GoogleSignin once and run the native account picker. Returns the ID
 * token. Throws OAuthCancelledError on cancel.
 *
 * BOTH client ids are required on iOS:
 *   - `iosClientId` — the native library MUST have this (or a GoogleService-Info
 *     .plist) or `configure()` throws "failed to determine clientID" and the
 *     Google sheet never opens (RNGoogleSignin.mm). The reversed form is also the
 *     iosUrlScheme in app.config.ts, but that only wires the OAuth *redirect* —
 *     it does NOT give the library the client id.
 *   - `webClientId` — becomes the token's `serverClientID`/`aud`, which Supabase's
 *     Google provider verifies against. Without it the token won't exchange.
 *
 * Both MUST be EXPO_PUBLIC_-prefixed: Metro only inlines those into the JS bundle;
 * a bare process.env var is undefined on-device.
 */
export async function googleIdToken(): Promise<string> {
    // Lazy require — a mis-linked native lib throws HERE, not at auth.tsx load
    // (same lazy-on-first-call pattern as modules/media-extract/index.ts).
    const { GoogleSignin, statusCodes } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');

    if (!googleConfigured) {
        GoogleSignin.configure({
            iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
            webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
        });
        googleConfigured = true;
    }

    try {
        await GoogleSignin.hasPlayServices();
        const response = await GoogleSignin.signIn();
        // google-signin v13+ wraps the payload: { type, data: { idToken, ... } }.
        const idToken =
            (response as { data?: { idToken?: string | null } }).data?.idToken ??
            (response as { idToken?: string | null }).idToken;
        if (!idToken) {
            throw new Error('Google sign-in returned no ID token.');
        }
        return idToken;
    } catch (err) {
        if (
            err &&
            typeof err === 'object' &&
            'code' in err &&
            (err as { code?: string }).code === statusCodes.SIGN_IN_CANCELLED
        ) {
            throw new OAuthCancelledError();
        }
        throw err;
    }
}
