/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { mockEdgeFnRejects, mockEdgeFnResolves } from '@/__tests__/utils/mockEdgeFn';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { useAuth } from '@/providers/AuthProvider';
import { useCompleteOnboarding } from './useCompleteOnboarding';

const USER_ID = 'onboarding-user';
const ONBOARDED_AT = '2026-07-13T09:39:28.264Z';
const setOnboardedAt = jest.fn();

const PROFILE_ROW = {
    user_id: USER_ID,
    display_name: 'Jacky',
    home_city: 'London',
    onboarded_at: ONBOARDED_AT,
    avatar_url: null,
    terms_accepted_at: ONBOARDED_AT,
    account_privacy: 'public' as const,
};

describe('useCompleteOnboarding', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(useAuth).mockReturnValue({
            user: { id: USER_ID },
            setOnboardedAt,
        } as unknown as ReturnType<typeof useAuth>);
    });

    it('releases the onboarding gate only after the server confirms success', async () => {
        mockEdgeFnResolves(PROFILE_ROW);
        const { result } = renderHookWithClient(() => useCompleteOnboarding());

        act(() => {
            result.current.mutate({ display_name: ' Jacky ', home_city: 'London' });
        });

        expect(setOnboardedAt).not.toHaveBeenCalled();
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(callEdgeFn).toHaveBeenCalledWith('user-profile', {
            action: 'complete_onboarding',
            body: {
                display_name: ' Jacky ',
                home_city: 'London',
                avatar_url: null,
            },
        });
        expect(setOnboardedAt).toHaveBeenCalledTimes(1);
        expect(setOnboardedAt).toHaveBeenCalledWith(ONBOARDED_AT);
    });

    it('keeps the onboarding gate closed after a failed completion request', async () => {
        mockEdgeFnRejects({ code: 'NETWORK', message: 'offline' });
        const { result } = renderHookWithClient(() => useCompleteOnboarding());

        act(() => {
            result.current.mutate({ display_name: 'Jacky' });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(setOnboardedAt).not.toHaveBeenCalled();
    });
});
