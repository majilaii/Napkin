/**
 * Tests for useFollow and useUnfollow — TICKET-042.
 *
 * Each hook gets 3 it() blocks:
 *   (a) success reconcile
 *   (b) failure rollback
 *   (c) rapid double-mutation
 */

jest.mock('@/providers/AuthProvider', () => ({
    useAuth: jest.fn(() => ({
        user: { id: 'test-user-id' },
        session: null,
        isLoading: false,
        signOut: jest.fn(),
    })),
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));

import React from 'react';

import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithClient } from '../../__tests__/utils/queryWrapper';
import { mockEdgeFnResolves, mockEdgeFnRejects } from '../../__tests__/utils/mockEdgeFn';
import { useFollow, useUnfollow } from './useFollow';
import { queryKeys } from '@/lib/queryKeys';
import type { UserProfileResult } from './useUserProfile';
import type { UserSearchResult } from './useUserSearch';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const VIEWER_ID = 'test-user-id'; // matches MockAuthProvider default
const TARGET_ID = 'user-target-1';

function makeProfile(userId: string, isFollowing: boolean, followersCount: number): UserProfileResult {
    return {
        data: {
            profile: {
                user_id: userId,
                username: null,
                display_name: 'Test User',
                bio: null,
                avatar_url: null,
                account_privacy: 'public',
                allow_public_replies: true,
            },
            stats: {
                total_logs: 0,
                total_restaurants: 0,
                average_rating: null,
                followers_count: followersCount,
                following_count: 0,
            },
            public_lists: null,
            recently_logged: null,
            tables_in_common: [],
            top_four: [],
            regulars_preview: [],
            is_self: false,
            is_following_viewer: isFollowing,
            follows_viewer: false,
            viewer_target_relationship: 'public_only',
        },
        isNotFound: false,
    };
}

function makeSearchResult(userId: string, isFollowing: boolean): UserSearchResult {
    return {
        user_id: userId,
        display_name: 'Test User',
        avatar_url: null,
        is_following: isFollowing,
    };
}

// ── useFollow ─────────────────────────────────────────────────────────────────

describe('useFollow', () => {
    it('(a) flips is_following in target profile and increments followers_count', async () => {
        mockEdgeFnResolves({ following: true });

        const { result, client } = renderHookWithClient(() => useFollow());

        const targetKey = queryKeys.users.profile(TARGET_ID);
        client.setQueryData(targetKey, makeProfile(TARGET_ID, false, 5));

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const profile = client.getQueryData<UserProfileResult>(targetKey);
        expect(profile?.data?.is_following_viewer).toBe(true);
        expect(profile?.data?.stats?.followers_count).toBe(6);
    });

    it('(b) restores target profile on server error', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'fail' });

        const { result, client } = renderHookWithClient(() => useFollow());

        const targetKey = queryKeys.users.profile(TARGET_ID);
        const initialProfile = makeProfile(TARGET_ID, false, 5);
        client.setQueryData(targetKey, initialProfile);

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const profile = client.getQueryData<UserProfileResult>(targetKey);
        expect(profile?.data?.is_following_viewer).toBe(false);
        expect(profile?.data?.stats?.followers_count).toBe(5);
    });

    it('(c) rapid double follow: cache remains in valid state', async () => {
        mockEdgeFnResolves({ following: true });
        mockEdgeFnResolves({ following: true });

        const { result, client } = renderHookWithClient(() => useFollow());

        const targetKey = queryKeys.users.profile(TARGET_ID);
        client.setQueryData(targetKey, makeProfile(TARGET_ID, false, 5));

        act(() => result.current.mutate({ targetUserId: TARGET_ID }));
        act(() => result.current.mutate({ targetUserId: TARGET_ID }));

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const profile = client.getQueryData<UserProfileResult>(targetKey);
        // Cache must be defined and consistent
        expect(profile).toBeDefined();
        expect(typeof profile?.data?.stats?.followers_count).toBe('number');
        expect(profile!.data!.stats!.followers_count).toBeGreaterThanOrEqual(5);
    });
});

// ── useUnfollow ───────────────────────────────────────────────────────────────

describe('useUnfollow', () => {
    it('(a) flips is_following to false and decrements followers_count', async () => {
        mockEdgeFnResolves({ following: false });

        const { result, client } = renderHookWithClient(() => useUnfollow());

        const targetKey = queryKeys.users.profile(TARGET_ID);
        client.setQueryData(targetKey, makeProfile(TARGET_ID, true, 6));

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const profile = client.getQueryData<UserProfileResult>(targetKey);
        expect(profile?.data?.is_following_viewer).toBe(false);
        expect(profile?.data?.stats?.followers_count).toBe(5);
    });

    it('(b) restores profile on server error', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'fail' });

        const { result, client } = renderHookWithClient(() => useUnfollow());

        const targetKey = queryKeys.users.profile(TARGET_ID);
        const initialProfile = makeProfile(TARGET_ID, true, 6);
        client.setQueryData(targetKey, initialProfile);

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const profile = client.getQueryData<UserProfileResult>(targetKey);
        expect(profile?.data?.is_following_viewer).toBe(true);
        expect(profile?.data?.stats?.followers_count).toBe(6);
    });

    it('(c) rapid double unfollow: count never goes below 0', async () => {
        mockEdgeFnResolves({ following: false });
        mockEdgeFnResolves({ following: false });

        const { result, client } = renderHookWithClient(() => useUnfollow());

        const targetKey = queryKeys.users.profile(TARGET_ID);
        client.setQueryData(targetKey, makeProfile(TARGET_ID, true, 1));

        act(() => result.current.mutate({ targetUserId: TARGET_ID }));
        act(() => result.current.mutate({ targetUserId: TARGET_ID }));

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const profile = client.getQueryData<UserProfileResult>(targetKey);
        expect(profile).toBeDefined();
        // The Math.max(0, ...) guard ensures count never goes negative
        expect(profile!.data!.stats!.followers_count).toBeGreaterThanOrEqual(0);
    });
});
