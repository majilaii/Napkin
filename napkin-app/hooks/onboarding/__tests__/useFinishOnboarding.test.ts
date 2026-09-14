/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/devPrefs', () => ({
    getPreviewOnboardingOnLaunchCached: jest.fn(),
}));
jest.mock('@/hooks/onboarding/useCompleteOnboarding', () => ({
    useCompleteOnboarding: jest.fn(),
}));
jest.mock('@/app/onboarding/OnboardingDraftContext', () => ({
    useOnboardingDraft: jest.fn(),
}));

import { act, renderHook } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { useCompleteOnboarding } from '@/hooks/onboarding/useCompleteOnboarding';
import { getPreviewOnboardingOnLaunchCached } from '@/lib/devPrefs';
import { useAuth } from '@/providers/AuthProvider';
import { useOnboardingDraft } from '@/app/onboarding/OnboardingDraftContext';
import { useFinishOnboarding } from '../useFinishOnboarding';

const replace = jest.fn();
const mutate = jest.fn();

function mockCompleteState({
    isPending = false,
    isError = false,
}: {
    isPending?: boolean;
    isError?: boolean;
} = {}) {
    jest.mocked(useCompleteOnboarding).mockReturnValue({
        mutate,
        isPending,
        isError,
    } as unknown as ReturnType<typeof useCompleteOnboarding>);
}

describe('useFinishOnboarding', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useRouter).mockReturnValue({
            replace,
        } as unknown as ReturnType<typeof useRouter>);
        jest.mocked(useAuth).mockReturnValue({
            user: {
                id: 'onboarding-user',
                user_metadata: { display_name: 'Account Name' },
            },
            onboardedAt: null,
        } as unknown as ReturnType<typeof useAuth>);
        jest.mocked(useOnboardingDraft).mockReturnValue({
            draft: {
                display_name: '  Jacky  ',
                home_city: '  London  ',
                avatar_url: 'https://example.com/avatar.jpg',
            },
            patch: jest.fn(),
        });
        jest.mocked(getPreviewOnboardingOnLaunchCached).mockReturnValue(false);
        mockCompleteState();
    });

    it('submits the normalized draft and navigates only after success', () => {
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).toHaveBeenCalledWith(
            {
                display_name: 'Jacky',
                home_city: 'London',
                avatar_url: 'https://example.com/avatar.jpg',
            },
            { onSuccess: expect.any(Function) },
        );
        expect(replace).not.toHaveBeenCalled();

        const options = mutate.mock.calls[0][1] as { onSuccess: () => void };
        act(() => options.onSuccess());
        expect(replace).toHaveBeenCalledWith('/welcome?intro=1');
    });

    it('uses the submitted city override before the draft context rerenders', () => {
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish({ home_city: '  Paris  ' }));

        expect(mutate).toHaveBeenCalledWith(
            expect.objectContaining({ home_city: 'Paris' }),
            expect.any(Object),
        );
    });

    it('falls back to account metadata and normalizes an empty city to null', () => {
        jest.mocked(useOnboardingDraft).mockReturnValue({
            draft: {
                display_name: '   ',
                home_city: '   ',
                avatar_url: null,
            },
            patch: jest.fn(),
        });
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).toHaveBeenCalledWith(
            {
                display_name: 'Account Name',
                home_city: null,
                avatar_url: null,
            },
            expect.any(Object),
        );
    });

    // App Store Guideline 4 (2026-09-14): the name step is optional now, so a
    // user can finish onboarding without ever supplying one. That must reach the
    // server as NULL — fn_complete_onboarding leaves profiles.display_name alone
    // on NULL and RAISES invalid_display_name on a non-null blank. Asserting the
    // old hardcoded 'New User' would re-plant the placeholder from the client.
    it('sends display_name NULL when the name step was skipped and nothing is derivable', () => {
        jest.mocked(useAuth).mockReturnValue({
            // A Hide My Email relay: no metadata name and nothing derivable, so the
            // trigger's placeholder is deliberately left in place.
            user: {
                id: 'onboarding-user',
                email: 'x7k2m9p4qr@privaterelay.appleid.com',
                user_metadata: {},
            },
            onboardedAt: null,
        } as unknown as ReturnType<typeof useAuth>);
        jest.mocked(useOnboardingDraft).mockReturnValue({
            draft: { display_name: '', home_city: null, avatar_url: null },
            patch: jest.fn(),
        });
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).toHaveBeenCalledWith(
            { display_name: null, home_city: null, avatar_url: null },
            expect.any(Object),
        );
    });

    // Without this the user finishes setup named 'New User' — the literal
    // placeholder handle_new_user writes — which then renders as their name and
    // as a "NU" avatar monogram everywhere.
    it('derives a name from the email when the optional step was skipped', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: {
                id: 'onboarding-user',
                email: 'ada.lovelace@example.com',
                user_metadata: {},
            },
            onboardedAt: null,
        } as unknown as ReturnType<typeof useAuth>);
        jest.mocked(useOnboardingDraft).mockReturnValue({
            draft: { display_name: '', home_city: null, avatar_url: null },
            patch: jest.fn(),
        });
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).toHaveBeenCalledWith(
            expect.objectContaining({ display_name: 'Ada Lovelace' }),
            expect.any(Object),
        );
    });

    it('prefers a real provider name over the email-derived one', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: {
                id: 'onboarding-user',
                email: 'ada.lovelace@example.com',
                user_metadata: { full_name: 'Grace Hopper' },
            },
            onboardedAt: null,
        } as unknown as ReturnType<typeof useAuth>);
        jest.mocked(useOnboardingDraft).mockReturnValue({
            draft: { display_name: '', home_city: null, avatar_url: null },
            patch: jest.fn(),
        });
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).toHaveBeenCalledWith(
            expect.objectContaining({ display_name: 'Grace Hopper' }),
            expect.any(Object),
        );
    });

    it("ignores the trigger's 'New User' placeholder in metadata", () => {
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 'onboarding-user', user_metadata: { display_name: 'New User' } },
            onboardedAt: null,
        } as unknown as ReturnType<typeof useAuth>);
        jest.mocked(useOnboardingDraft).mockReturnValue({
            draft: { display_name: '   ', home_city: null, avatar_url: null },
            patch: jest.fn(),
        });
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).toHaveBeenCalledWith(
            expect.objectContaining({ display_name: null }),
            expect.any(Object),
        );
    });

    // Apple's name reaches this path through user_metadata.full_name, which
    // auth.tsx writes back with updateUser after the native credential hands it over.
    it('uses the Apple name written into metadata as full_name', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 'onboarding-user', user_metadata: { full_name: 'Ada Lovelace' } },
            onboardedAt: null,
        } as unknown as ReturnType<typeof useAuth>);
        jest.mocked(useOnboardingDraft).mockReturnValue({
            draft: { display_name: '', home_city: null, avatar_url: null },
            patch: jest.fn(),
        });
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).toHaveBeenCalledWith(
            expect.objectContaining({ display_name: 'Ada Lovelace' }),
            expect.any(Object),
        );
    });

    it('skips the mutation for an onboarded preview run', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 'onboarding-user' },
            onboardedAt: '2026-07-16T10:00:00.000Z',
        } as unknown as ReturnType<typeof useAuth>);
        jest.mocked(getPreviewOnboardingOnLaunchCached).mockReturnValue(true);
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).not.toHaveBeenCalled();
        expect(replace).toHaveBeenCalledWith('/welcome?preview=1');
    });

    it('keeps a first-run user on the real completion path even if preview is enabled', () => {
        jest.mocked(getPreviewOnboardingOnLaunchCached).mockReturnValue(true);
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).toHaveBeenCalledTimes(1);
        expect(replace).not.toHaveBeenCalled();
    });

    it('ignores another finish action while completion is pending', () => {
        mockCompleteState({ isPending: true });
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).not.toHaveBeenCalled();
        expect(replace).not.toHaveBeenCalled();
    });

    it('surfaces the existing retry error after a failed completion', () => {
        mockCompleteState({ isError: true });
        const { result } = renderHook(() => useFinishOnboarding());

        expect(result.current.completionError).toBe(
            "We couldn't finish setup. Check your connection and try again.",
        );
    });
});
