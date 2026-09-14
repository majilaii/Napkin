/**
 * Tests for lib/onboardingName.ts — App Store Guideline 4 fix (2026-09-14).
 *
 * The rejection: "users are required to provide their name and/or email address
 * after using Sign in with Apple even though that information is already
 * provided by the Authentication Services framework." resolveProvidedName is the
 * predicate that decides whether we already have the name — a non-null result
 * means the onboarding name step must NOT be shown.
 */
import {
    displayNameForCompletion,
    resolveProvidedName,
    MAX_DISPLAY_NAME,
    SERVER_PLACEHOLDER_NAME,
} from '../onboardingName';

describe('resolveProvidedName', () => {
    it('uses the stashed credential name — the Apple first-authorization case', () => {
        expect(resolveProvidedName({ stashedFullName: 'Ada Lovelace' })).toBe('Ada Lovelace');
    });

    it('prefers the stash over user_metadata (freshest wins)', () => {
        expect(
            resolveProvidedName({
                stashedFullName: 'Ada Lovelace',
                userMetadata: { full_name: 'Stale Name' },
            }),
        ).toBe('Ada Lovelace');
    });

    it('falls back through display_name, full_name, then name', () => {
        expect(resolveProvidedName({ userMetadata: { display_name: 'Dee' } })).toBe('Dee');
        expect(resolveProvidedName({ userMetadata: { full_name: 'Eff' } })).toBe('Eff');
        expect(resolveProvidedName({ userMetadata: { name: 'Enn' } })).toBe('Enn');
        // Google supplies both; display_name is checked first, then full_name.
        expect(
            resolveProvidedName({ userMetadata: { full_name: 'Full', name: 'Nnn' } }),
        ).toBe('Full');
    });

    it('returns null on the Apple RE-AUTH path — Apple sends the name only once', () => {
        // The reviewer's Apple ID already authorized the app, so fullName is null
        // and nothing was ever persisted. The step must not block on this.
        expect(resolveProvidedName({ stashedFullName: null, userMetadata: {} })).toBeNull();
        expect(resolveProvidedName({})).toBeNull();
    });

    it("rejects the trigger's 'New User' placeholder — it is not a chosen name", () => {
        expect(
            resolveProvidedName({ userMetadata: { display_name: SERVER_PLACEHOLDER_NAME } }),
        ).toBeNull();
        expect(resolveProvidedName({ userMetadata: { full_name: 'new user' } })).toBeNull();
        // ...but it must still fall through to a real name behind it.
        expect(
            resolveProvidedName({
                userMetadata: { display_name: 'New User', full_name: 'Real Person' },
            }),
        ).toBe('Real Person');
    });

    it('ignores blanks, whitespace and non-strings', () => {
        expect(resolveProvidedName({ stashedFullName: '   ' })).toBeNull();
        expect(resolveProvidedName({ userMetadata: { full_name: '' } })).toBeNull();
        expect(resolveProvidedName({ userMetadata: { full_name: 42 } })).toBeNull();
        expect(resolveProvidedName({ userMetadata: null })).toBeNull();
    });

    it('trims and caps at the server limit', () => {
        expect(resolveProvidedName({ stashedFullName: '  Grace  ' })).toBe('Grace');
        const long = 'x'.repeat(MAX_DISPLAY_NAME + 20);
        expect(resolveProvidedName({ stashedFullName: long })).toHaveLength(MAX_DISPLAY_NAME);
    });
});

describe('displayNameForCompletion', () => {
    it('maps a skipped/blank name to NULL, never an empty string', () => {
        // fn_complete_onboarding RAISES invalid_display_name on a non-null blank
        // and leaves profiles.display_name untouched on NULL.
        expect(displayNameForCompletion('')).toBeNull();
        expect(displayNameForCompletion('   ')).toBeNull();
        expect(displayNameForCompletion(null)).toBeNull();
        expect(displayNameForCompletion(undefined)).toBeNull();
    });

    it('trims and caps a real name', () => {
        expect(displayNameForCompletion('  Ada  ')).toBe('Ada');
        expect(displayNameForCompletion('y'.repeat(200))).toHaveLength(MAX_DISPLAY_NAME);
    });
});
