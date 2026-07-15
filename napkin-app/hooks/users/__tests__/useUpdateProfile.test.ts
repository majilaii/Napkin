/**
 * Tests for useUpdateProfile — the "two realities" dual-key patch.
 *
 * useUserProfile keys by IDENTIFIER, so the same profile can be cached twice:
 * once under the uuid (settings / profile tab) and once under the username
 * (a /u/<username> view). The optimistic patch must hit BOTH, and roll BOTH
 * back on failure — otherwise a fresh avatar lingers on the second reality.
 *
 * The hook takes userId as a prop (no useAuth), so only callEdgeFn is mocked.
 */
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { mockEdgeFnResolves } from '@/__tests__/utils/mockEdgeFn';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useUpdateProfile } from '../useUpdateProfile';
import type { UserProfileResult, UserProfileRow } from '../useUserProfile';

const USER_ID = 'user-1';
const USERNAME = 'clara';
const OLD_AVATAR_URL = 'https://cdn/old.jpg';
const NEW_AVATAR_URL = 'https://cdn/new.jpg';

function makeRow(over: Partial<UserProfileRow> = {}): UserProfileRow {
    return {
        user_id: USER_ID,
        username: USERNAME,
        display_name: 'Clara',
        bio: null,
        avatar_url: null,
        account_privacy: 'public',
        allow_public_replies: true,
        ...over,
    };
}

function makeProfile(over: Partial<UserProfileRow> = {}): UserProfileResult {
    return {
        data: {
            profile: makeRow(over),
            stats: null,
            public_lists: null,
            recently_logged: null,
            tables_in_common: [],
            top_four: [],
            regulars_preview: [],
            is_self: true,
            is_following_viewer: false,
            follows_viewer: false,
            viewer_target_relationship: 'self',
        },
        isNotFound: false,
    };
}

const idKey = queryKeys.users.profile(USER_ID);
const nameKey = queryKeys.users.profile(USERNAME);

describe('useUpdateProfile', () => {
    it('(a) patches BOTH the uuid- and username-keyed caches, then reconciles', async () => {
        mockEdgeFnResolves(makeRow({ avatar_url: NEW_AVATAR_URL }));

        const { result, client } = renderHookWithClient(() => useUpdateProfile(USER_ID));
        client.setQueryData(idKey, makeProfile());
        client.setQueryData(nameKey, makeProfile());

        act(() => {
            result.current.mutate({ avatar_url: NEW_AVATAR_URL });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(client.getQueryData<UserProfileResult>(idKey)?.data?.profile.avatar_url).toBe(
            NEW_AVATAR_URL,
        );
        expect(client.getQueryData<UserProfileResult>(nameKey)?.data?.profile.avatar_url).toBe(
            NEW_AVATAR_URL,
        );
    });

    it('(b) optimistically swaps, then rolls BOTH caches back to the previous avatar', async () => {
        let rejectRequest!: (error: Error) => void;
        (callEdgeFn as jest.Mock).mockImplementationOnce(
            () =>
                new Promise((_resolve, reject) => {
                    rejectRequest = reject;
                }),
        );

        const { result, client } = renderHookWithClient(() => useUpdateProfile(USER_ID));
        client.setQueryData(idKey, makeProfile({ avatar_url: OLD_AVATAR_URL }));
        client.setQueryData(nameKey, makeProfile({ avatar_url: OLD_AVATAR_URL }));

        act(() => {
            result.current.mutate({ avatar_url: NEW_AVATAR_URL });
        });

        await waitFor(() => {
            expect(callEdgeFn).toHaveBeenCalledTimes(1);
            expect(
                client.getQueryData<UserProfileResult>(idKey)?.data?.profile.avatar_url,
            ).toBe(NEW_AVATAR_URL);
            expect(
                client.getQueryData<UserProfileResult>(nameKey)?.data?.profile.avatar_url,
            ).toBe(NEW_AVATAR_URL);
        });

        act(() => rejectRequest(new Error('save failed')));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(
            client.getQueryData<UserProfileResult>(idKey)?.data?.profile.avatar_url,
        ).toBe(OLD_AVATAR_URL);
        expect(
            client.getQueryData<UserProfileResult>(nameKey)?.data?.profile.avatar_url,
        ).toBe(OLD_AVATAR_URL);
    });

    it('(c) works when only the uuid-keyed cache exists (no second reality)', async () => {
        mockEdgeFnResolves(makeRow({ display_name: 'Clara B' }));

        const { result, client } = renderHookWithClient(() => useUpdateProfile(USER_ID));
        client.setQueryData(idKey, makeProfile());

        act(() => {
            result.current.mutate({ display_name: 'Clara B' });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(
            client.getQueryData<UserProfileResult>(idKey)?.data?.profile.display_name,
        ).toBe('Clara B');
        // Never fabricated a username-keyed profile no view was reading.
        expect(client.getQueryData<UserProfileResult>(nameKey)?.data?.profile).toBeUndefined();
    });
});
