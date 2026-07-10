/**
 * Tests for lib/oauth.ts (TICKET-110).
 *
 * The native provider libs are lazy-imported INSIDE the functions, so we mock
 * them and exercise the pure logic: name parsing, token extraction, and the
 * cancel-error → OAuthCancelledError mapping (auth.tsx swallows that silently).
 */
import { appleIdToken, googleIdToken, OAuthCancelledError } from '../oauth';

// ── Apple mock ────────────────────────────────────────────────────────────────
const mockAppleSignIn = jest.fn();
jest.mock('expo-apple-authentication', () => ({
    signInAsync: (...args: unknown[]) => mockAppleSignIn(...args),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

// ── Google mock ───────────────────────────────────────────────────────────────
const mockGoogleSignIn = jest.fn();
const mockHasPlayServices = jest.fn().mockResolvedValue(true);
const mockConfigure = jest.fn();
jest.mock('@react-native-google-signin/google-signin', () => ({
    GoogleSignin: {
        configure: (...args: unknown[]) => mockConfigure(...args),
        hasPlayServices: (...args: unknown[]) => mockHasPlayServices(...args),
        signIn: (...args: unknown[]) => mockGoogleSignIn(...args),
    },
    statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));

beforeEach(() => {
    jest.clearAllMocks();
    mockHasPlayServices.mockResolvedValue(true);
});

describe('appleIdToken', () => {
    it('returns the identity token and joins the parsed full name', async () => {
        mockAppleSignIn.mockResolvedValue({
            identityToken: 'apple.jwt.token',
            fullName: { givenName: 'Ada', familyName: 'Lovelace' },
        });
        const cred = await appleIdToken();
        expect(cred.identityToken).toBe('apple.jwt.token');
        expect(cred.fullName).toBe('Ada Lovelace');
    });

    it('yields fullName null on re-auth (Apple omits the name)', async () => {
        mockAppleSignIn.mockResolvedValue({
            identityToken: 'apple.jwt.token',
            fullName: null,
        });
        const cred = await appleIdToken();
        expect(cred.fullName).toBeNull();
    });

    it('uses only the present name part (given OR family)', async () => {
        mockAppleSignIn.mockResolvedValue({
            identityToken: 'apple.jwt.token',
            fullName: { givenName: 'Grace', familyName: null },
        });
        const cred = await appleIdToken();
        expect(cred.fullName).toBe('Grace');
    });

    it('throws when Apple returns no identity token', async () => {
        mockAppleSignIn.mockResolvedValue({ identityToken: null, fullName: null });
        await expect(appleIdToken()).rejects.toThrow(/no identity token/);
    });

    it('maps a user cancel to OAuthCancelledError', async () => {
        mockAppleSignIn.mockRejectedValue({ code: 'ERR_REQUEST_CANCELED' });
        await expect(appleIdToken()).rejects.toBeInstanceOf(OAuthCancelledError);
    });

    it('rethrows non-cancel errors unchanged', async () => {
        mockAppleSignIn.mockRejectedValue(new Error('network down'));
        await expect(appleIdToken()).rejects.toThrow('network down');
    });
});

describe('googleIdToken', () => {
    // First test: googleConfigured is module-level and configure() runs ONCE, so
    // this must run before any other googleIdToken() call to observe the call.
    it('configures GoogleSignin with the ios + web client ids from env (once)', async () => {
        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client-123.apps.googleusercontent.com';
        process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-client-456.apps.googleusercontent.com';
        mockGoogleSignIn.mockResolvedValue({ data: { idToken: 'google.jwt' } });
        await googleIdToken();
        // iosClientId is REQUIRED on iOS — configure() throws without it (or a
        // GoogleService-Info.plist), which is what broke Google sign-in.
        expect(mockConfigure).toHaveBeenCalledWith({
            iosClientId: 'ios-client-456.apps.googleusercontent.com',
            webClientId: 'web-client-123.apps.googleusercontent.com',
        });
    });

    it('returns the id token from the wrapped v13+ payload', async () => {
        mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: 'google.jwt' } });
        await expect(googleIdToken()).resolves.toBe('google.jwt');
    });

    it('falls back to a top-level idToken (older shape)', async () => {
        mockGoogleSignIn.mockResolvedValue({ idToken: 'legacy.jwt' });
        await expect(googleIdToken()).resolves.toBe('legacy.jwt');
    });

    it('throws when Google returns no id token', async () => {
        mockGoogleSignIn.mockResolvedValue({ data: { idToken: null } });
        await expect(googleIdToken()).rejects.toThrow(/no ID token/);
    });

    it('maps a v16 resolved cancel ({type:"cancelled"}) to OAuthCancelledError', async () => {
        // google-signin v13+ RESOLVES on cancel — it does NOT reject with
        // SIGN_IN_CANCELLED. This is the path a real user cancel takes.
        mockGoogleSignIn.mockResolvedValue({ type: 'cancelled', data: null });
        await expect(googleIdToken()).rejects.toBeInstanceOf(OAuthCancelledError);
    });

    it('maps a legacy SIGN_IN_CANCELLED rejection to OAuthCancelledError', async () => {
        mockGoogleSignIn.mockRejectedValue({ code: 'SIGN_IN_CANCELLED' });
        await expect(googleIdToken()).rejects.toBeInstanceOf(OAuthCancelledError);
    });
});
