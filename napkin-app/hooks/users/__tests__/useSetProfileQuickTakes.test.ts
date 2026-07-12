jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { act, waitFor } from '@testing-library/react-native';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { useSetProfileQuickTakes } from '../useSetProfileQuickTakes';
import type { UserProfileResult } from '../useUserProfile';
import type { ProfileQuickTake } from '@/lib/profileQuickTakes';

const IDENTIFIER = 'user-1';
const USERNAME = 'jacky';

const makeTake = (name: string): ProfileQuickTake => ({
    prompt_key: 'best_value',
    position: 1,
    restaurant_id: `restaurant-${name}`,
    name,
    city: 'London',
    cuisine: 'Turkish',
    photo_url: null,
    note: null,
});

const makeProfile = (take: ProfileQuickTake): UserProfileResult => ({
    data: {
        profile: {
            user_id: IDENTIFIER,
            username: USERNAME,
            display_name: 'Jacky',
            bio: null,
            avatar_url: null,
            account_privacy: 'public',
            allow_public_replies: true,
        },
        stats: null,
        public_lists: null,
        recently_logged: null,
        tables_in_common: [],
        top_four: [],
        quick_takes: [take],
        regulars_preview: [],
        is_self: true,
        is_following_viewer: false,
        viewer_target_relationship: 'self',
    },
    isNotFound: false,
});

describe('useSetProfileQuickTakes', () => {
    it('patches and narrowly reconciles both UUID and username cache identities', async () => {
        let resolve!: (value: { ok: true }) => void;
        (callEdgeFn as jest.Mock).mockReturnValue(new Promise((done) => { resolve = done; }));
        const { result, client } = renderHookWithClient(() => useSetProfileQuickTakes(IDENTIFIER));
        const key = queryKeys.users.profile(IDENTIFIER);
        const usernameKey = queryKeys.users.profile(USERNAME);
        client.setQueryData(key, makeProfile(makeTake('Before')));
        client.setQueryData(usernameKey, makeProfile(makeTake('Before')));
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        act(() => result.current.mutate([makeTake('After')]));
        await waitFor(() => {
            expect(client.getQueryData<UserProfileResult>(key)?.data?.quick_takes?.[0].name).toBe('After');
            expect(client.getQueryData<UserProfileResult>(usernameKey)?.data?.quick_takes?.[0].name).toBe('After');
        });

        act(() => resolve({ ok: true }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(invalidate).toHaveBeenCalledWith({ queryKey: key, exact: true });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: usernameKey, exact: true });
    });

    it('restores the exact snapshot on failure', async () => {
        (callEdgeFn as jest.Mock).mockRejectedValue(new Error('nope'));
        const { result, client } = renderHookWithClient(() => useSetProfileQuickTakes(IDENTIFIER));
        const key = queryKeys.users.profile(IDENTIFIER);
        const usernameKey = queryKeys.users.profile(USERNAME);
        const previous = makeProfile(makeTake('Before'));
        const previousByUsername = makeProfile(makeTake('Username before'));
        client.setQueryData(key, previous);
        client.setQueryData(usernameKey, previousByUsername);

        act(() => result.current.mutate([makeTake('After')]));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(client.getQueryData(key)).toEqual(previous);
        expect(client.getQueryData(usernameKey)).toEqual(previousByUsername);
    });
});
