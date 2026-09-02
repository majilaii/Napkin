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
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        const targetKey = queryKeys.users.profile(TARGET_ID);
        client.setQueryData(targetKey, makeProfile(TARGET_ID, false, 5));

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const profile = client.getQueryData<UserProfileResult>(targetKey);
        expect(profile?.data?.is_following_viewer).toBe(true);
        expect(profile?.data?.stats?.followers_count).toBe(6);
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.restaurants.pageAll(),
        });
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

// ── TICKET-189: candidate-cache lifecycle (For You people block) ──────────────

describe('useFollow candidate caches (TICKET-189)', () => {
    const candidatesKey = queryKeys.feed.followCandidates(VIEWER_ID);
    const coDinersKey = queryKeys.feed.coDiners(VIEWER_ID);

    const followCandidates = [
        { user_id: TARGET_ID, display_name: 'Target', avatar_url: null, kind: 'public' as const, logs_30d: 4 },
        { user_id: 'user-other', display_name: 'Other', avatar_url: null, kind: 'co_diner' as const, meals_together: 2 },
    ];
    const coDiners = [
        { user_id: TARGET_ID, display_name: 'Target', avatar_url: null, meals_together: 3 },
        { user_id: 'user-other', display_name: 'Other', avatar_url: null, meals_together: 2 },
    ];

    it('(a) optimistically removes the target from BOTH candidate caches; patches stand on success', async () => {
        mockEdgeFnResolves({ following: true });

        const { result, client } = renderHookWithClient(() => useFollow());
        client.setQueryData(candidatesKey, followCandidates);
        client.setQueryData(coDinersKey, coDiners);

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });

        // Optimistic: removed synchronously in onMutate, before settle.
        await waitFor(() => {
            const cands = client.getQueryData<typeof followCandidates>(candidatesKey);
            expect(cands?.map((c) => c.user_id)).toEqual(['user-other']);
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // The card must not return: both caches stay patched after success.
        expect(
            client.getQueryData<typeof followCandidates>(candidatesKey)?.map((c) => c.user_id),
        ).toEqual(['user-other']);
        expect(
            client.getQueryData<typeof coDiners>(coDinersKey)?.map((c) => c.user_id),
        ).toEqual(['user-other']);
    });

    it('(b) restores BOTH candidate caches on mutation error (the card returns)', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'fail' });

        const { result, client } = renderHookWithClient(() => useFollow());
        client.setQueryData(candidatesKey, followCandidates);
        client.setQueryData(coDinersKey, coDiners);

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(client.getQueryData(candidatesKey)).toEqual(followCandidates);
        expect(client.getQueryData(coDinersKey)).toEqual(coDiners);
    });

    it('(c) untouched when the candidate caches are cold (no spurious writes)', async () => {
        mockEdgeFnResolves({ following: true });

        const { result, client } = renderHookWithClient(() => useFollow());

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(client.getQueryData(candidatesKey)).toBeUndefined();
        expect(client.getQueryData(coDinersKey)).toBeUndefined();
    });

    it('(d) A fails after concurrent B succeeds: only A returns to both caches', async () => {
        let rejectA!: (error: Error) => void;
        let resolveB!: (value: { following: boolean }) => void;
        const requestA = new Promise<never>((_resolve, reject) => {
            rejectA = reject;
        });
        const requestB = new Promise<{ following: boolean }>((resolve) => {
            resolveB = resolve;
        });
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const edgeMock = require('@/lib/edgeInvoke').callEdgeFn as jest.Mock;
        edgeMock
            .mockImplementationOnce(() => requestA)
            .mockImplementationOnce(() => requestB);

        const targetB = 'user-target-2';
        const { result, client } = renderHookWithClient(() => useFollow());
        client.setQueryData(candidatesKey, [
            followCandidates[0],
            { user_id: targetB, display_name: 'Target B', avatar_url: null, kind: 'public', logs_30d: 2 },
            followCandidates[1],
        ]);
        client.setQueryData(coDinersKey, [
            coDiners[0],
            { user_id: targetB, display_name: 'Target B', avatar_url: null, meals_together: 4 },
            coDiners[1],
        ]);

        act(() => result.current.mutate({ targetUserId: TARGET_ID }));
        await waitFor(() => {
            expect(client.getQueryData<typeof followCandidates>(candidatesKey)?.map((c) => c.user_id))
                .toEqual([targetB, 'user-other']);
        });

        act(() => result.current.mutate({ targetUserId: targetB }));
        await waitFor(() => {
            expect(client.getQueryData<typeof followCandidates>(candidatesKey)?.map((c) => c.user_id))
                .toEqual(['user-other']);
        });

        await act(async () => {
            resolveB({ following: true });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        await act(async () => {
            rejectA(new Error('follow A failed'));
        });
        await waitFor(() => {
            expect(client.getQueryData<typeof followCandidates>(candidatesKey)?.map((c) => c.user_id))
                .toEqual([TARGET_ID, 'user-other']);
            expect(client.getQueryData<typeof coDiners>(coDinersKey)?.map((c) => c.user_id))
                .toEqual([TARGET_ID, 'user-other']);
        });
        edgeMock.mockReset();
    });
});

// ── useUnfollow ───────────────────────────────────────────────────────────────

describe('useUnfollow', () => {
    it('(a) flips is_following to false and decrements followers_count', async () => {
        mockEdgeFnResolves({ following: false });

        const { result, client } = renderHookWithClient(() => useUnfollow());
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        const targetKey = queryKeys.users.profile(TARGET_ID);
        client.setQueryData(targetKey, makeProfile(TARGET_ID, true, 6));

        act(() => {
            result.current.mutate({ targetUserId: TARGET_ID });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const profile = client.getQueryData<UserProfileResult>(targetKey);
        expect(profile?.data?.is_following_viewer).toBe(false);
        expect(profile?.data?.stats?.followers_count).toBe(5);
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.restaurants.pageAll(),
        });
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
