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
        expect(replace).toHaveBeenCalledWith('/(tabs)/places?view=list&layer=pinned');
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

    it('skips the mutation for an onboarded preview run', () => {
        jest.mocked(useAuth).mockReturnValue({
            user: { id: 'onboarding-user' },
            onboardedAt: '2026-07-16T10:00:00.000Z',
        } as unknown as ReturnType<typeof useAuth>);
        jest.mocked(getPreviewOnboardingOnLaunchCached).mockReturnValue(true);
        const { result } = renderHook(() => useFinishOnboarding());

        act(() => result.current.finish());

        expect(mutate).not.toHaveBeenCalled();
        expect(replace).toHaveBeenCalledWith('/(tabs)/places?view=list&layer=pinned');
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
