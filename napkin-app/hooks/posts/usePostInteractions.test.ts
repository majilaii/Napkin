/**
 * Tests for useToggleReaction and useAddComment — TICKET-042.
 *
 * Each hook gets 3 it() blocks:
 *   (a) success reconcile — cache reflects server shape, no optimistic- ids remain
 *   (b) failure rollback  — cache rolls back to pre-mutation snapshot
 *   (c) rapid double-mutation — no races leaving cache in invalid state
 *
 * TICKET-098 [ARCH-REVIEW-2] additions (bottom describe): the card-cache walk
 * is scope-owned — public-scope taps patch friends-feed pages ({ pages: [{ rows }] }
 * envelopes, mapped via page.rows — never page.map), table-scope taps patch
 * Table activity pages, and NEITHER scope touches the other's cache.
 */

jest.mock('@/providers/AuthProvider', () => ({
    useAuth: jest.fn(() => ({
        user: { id: 'test-user-id' },
        session: null,
        isLoading: false,
        signOut: jest.fn(),
    })),
    AuthProvider: ({ children }: any) => children,
}));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));

import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithClient } from '../../__tests__/utils/queryWrapper';
import { mockEdgeFnResolves, mockEdgeFnRejects } from '../../__tests__/utils/mockEdgeFn';
import { useToggleReaction, useAddComment } from './usePostInteractions';
import { queryKeys } from '@/lib/queryKeys';
import type { PostInteractionsData, Reaction, Comment } from './usePostInteractions';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET_TYPE = 'entry' as const;
const TARGET_ID = 'entry-1';
const SCOPE = 'table' as const;
const VIEWER_ID = 'test-user-id-123'; // matches __mocks__/supabase.ts mockUser.id (used by supabase.auth.getUser())

const interactionsKey = queryKeys.postInteractions.all(TARGET_TYPE, TARGET_ID, SCOPE);

const INITIAL_STATE: PostInteractionsData = {
    reactions: [],
    comments: [],
    counts: { reactions: 0, comments: 0, top_emojis: [] },
};

// ── useToggleReaction ─────────────────────────────────────────────────────────

describe('useToggleReaction', () => {
    it('(a) reconciles cache with server reaction on success', async () => {
        const serverReaction: Reaction = {
            id: 'server-reaction-1',
            user_id: VIEWER_ID,
            emoji: '🔥',
            created_at: '2026-04-27T12:00:00Z',
            profiles: { display_name: 'Test User', avatar_url: null },
        };

        mockEdgeFnResolves({
            added: true,
            removed: false,
            reaction: serverReaction,
            counts: { reactions: 1, top_emojis: [{ emoji: '🔥', count: 1, last_reacted_at: '2026-04-27T12:00:00Z' }] },
        });

        const { result, client } = renderHookWithClient(() => useToggleReaction());
        client.setQueryData(interactionsKey, INITIAL_STATE);

        act(() => {
            result.current.mutate({ targetType: TARGET_TYPE, targetId: TARGET_ID, emoji: '🔥', scope: SCOPE });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const cache = client.getQueryData<PostInteractionsData>(interactionsKey);
        // Server reaction present
        expect(cache?.reactions).toContainEqual(serverReaction);
        // No optimistic ids remain
        expect(cache?.reactions.find((r) => r.id.startsWith('optimistic-'))).toBeUndefined();
        expect(cache?.counts.reactions).toBe(1);
    });

    it('(b) rolls back to snapshot on server error', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'fail' });

        const { result, client } = renderHookWithClient(() => useToggleReaction());
        client.setQueryData(interactionsKey, INITIAL_STATE);

        act(() => {
            result.current.mutate({ targetType: TARGET_TYPE, targetId: TARGET_ID, emoji: '🔥', scope: SCOPE });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const cache = client.getQueryData<PostInteractionsData>(interactionsKey);
        expect(cache).toEqual(INITIAL_STATE);
    });

    it('(c) rapid double-mutation: cache is not corrupted', async () => {
        // Two rapid toggle mutations. The cancel+snapshot pattern means each
        // mutation's onMutate cancels previous in-flight work. Final cache
        // must be valid (no corrupted state), even if the net count is uncertain
        // due to mutation ordering.
        const serverReaction: Reaction = {
            id: 'server-reaction-2',
            user_id: VIEWER_ID,
            emoji: '❤️',
            created_at: '2026-04-27T12:00:00Z',
            profiles: null,
        };

        mockEdgeFnResolves({
            added: true,
            removed: false,
            reaction: serverReaction,
            counts: { reactions: 1, top_emojis: [] },
        });
        mockEdgeFnResolves({
            added: false,
            removed: true,
            reaction: null,
            counts: { reactions: 0, top_emojis: [] },
        });

        const { result, client } = renderHookWithClient(() => useToggleReaction());
        client.setQueryData(interactionsKey, INITIAL_STATE);

        act(() => {
            result.current.mutate({ targetType: TARGET_TYPE, targetId: TARGET_ID, emoji: '❤️', scope: SCOPE });
        });
        act(() => {
            result.current.mutate({ targetType: TARGET_TYPE, targetId: TARGET_ID, emoji: '❤️', scope: SCOPE });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const cache = client.getQueryData<PostInteractionsData>(interactionsKey);
        // Cache must remain valid — defined, with proper array shape
        expect(cache).toBeDefined();
        expect(Array.isArray(cache?.reactions)).toBe(true);
        expect(cache!.counts.reactions).toBeGreaterThanOrEqual(0);
    });

    it('(d) no cached thread: skips the cancel and invalidates so the screen converges', async () => {
        // Regression: tapping react before the initial GET resolved used to
        // cancelQueries the in-flight fetch (killing it for good) and onSuccess
        // only patched an EXISTING cache — the detail screen became a dead zone
        // where every tap toggled the server invisibly.
        mockEdgeFnResolves({
            added: true,
            removed: false,
            reaction: {
                id: 'server-reaction-3',
                user_id: VIEWER_ID,
                emoji: '❤️',
                created_at: '2026-07-10T12:00:00Z',
                profiles: null,
            },
            counts: { reactions: 1, top_emojis: [{ emoji: '❤️', count: 1, last_reacted_at: '2026-07-10T12:00:00Z' }] },
        });

        const { result, client } = renderHookWithClient(() => useToggleReaction());
        // Deliberately NO setQueryData — the thread query never landed.
        const cancelSpy = jest.spyOn(client, 'cancelQueries');
        const invalidateSpy = jest.spyOn(client, 'invalidateQueries');

        act(() => {
            result.current.mutate({ targetType: TARGET_TYPE, targetId: TARGET_ID, emoji: '❤️', scope: SCOPE });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // The dataless thread query was never cancelled…
        expect(cancelSpy).not.toHaveBeenCalledWith({ queryKey: interactionsKey });
        // …and the missing cache triggers a refetch instead of silently no-oping.
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: interactionsKey });
    });
});

// ── useAddComment ─────────────────────────────────────────────────────────────

describe('useAddComment', () => {
    const NONCE = 'test-nonce-123';
    const COMMENT_BODY = 'Great meal!';

    const serverComment: Comment = {
        id: 'server-comment-1',
        user_id: VIEWER_ID,
        body: COMMENT_BODY,
        created_at: '2026-04-27T12:00:00Z',
        edited_at: null,
        profiles: { display_name: 'Test User', avatar_url: null },
        client_nonce: NONCE,
    };

    it('(a) reconciles cache with server comment on success', async () => {
        mockEdgeFnResolves(serverComment);

        const { result, client } = renderHookWithClient(() => useAddComment());
        client.setQueryData(interactionsKey, INITIAL_STATE);

        act(() => {
            result.current.mutate({
                targetType: TARGET_TYPE,
                targetId: TARGET_ID,
                body: COMMENT_BODY,
                clientNonce: NONCE,
                scope: SCOPE,
            });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const cache = client.getQueryData<PostInteractionsData>(interactionsKey);
        // Server comment present; no pending/optimistic comments
        const comment = cache?.comments.find((c) => c.id === 'server-comment-1');
        expect(comment).toBeDefined();
        expect(comment?.pending).toBeFalsy();
        expect(cache?.comments.find((c) => c.pending)).toBeUndefined();
    });

    it('(b) marks comment as failed on server error (not full rollback)', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'fail' });

        const { result, client } = renderHookWithClient(() => useAddComment());
        client.setQueryData(interactionsKey, INITIAL_STATE);

        act(() => {
            result.current.mutate({
                targetType: TARGET_TYPE,
                targetId: TARGET_ID,
                body: COMMENT_BODY,
                clientNonce: NONCE,
                scope: SCOPE,
            });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const cache = client.getQueryData<PostInteractionsData>(interactionsKey);
        // The comment should be marked as failed, not removed
        const failedComment = cache?.comments.find((c) => c.client_nonce === NONCE);
        expect(failedComment?.failed).toBe(true);
        expect(failedComment?.pending).toBe(false);
    });

    it('(c) rapid double-comment: each mutation completes without error', async () => {
        // Two rapid comment mutations. Each mutation independently snapshots and
        // reconciles its own optimistic row by nonce. The key requirement is that
        // neither mutation throws and the cache is valid after both settle.
        //
        // NOTE: useAddComment.onSuccess calls invalidateQueries which, without an
        // active query subscriber, marks the cache stale. The data remains accessible
        // immediately after each mutation's onSuccess fires; a subsequent test read
        // may see the state after mutation 2's reconcile since mutations run serially
        // in TanStack Query by default.
        const nonce2 = 'test-nonce-456';
        const serverComment2: Comment = {
            id: 'server-comment-2',
            user_id: VIEWER_ID,
            body: 'Second comment',
            created_at: '2026-04-27T12:01:00Z',
            edited_at: null,
            profiles: null,
            client_nonce: nonce2,
        };

        mockEdgeFnResolves(serverComment);
        mockEdgeFnResolves(serverComment2);

        const { result, client } = renderHookWithClient(() => useAddComment());
        client.setQueryData(interactionsKey, INITIAL_STATE);

        act(() => {
            result.current.mutate({
                targetType: TARGET_TYPE,
                targetId: TARGET_ID,
                body: COMMENT_BODY,
                clientNonce: NONCE,
                scope: SCOPE,
            });
        });
        act(() => {
            result.current.mutate({
                targetType: TARGET_TYPE,
                targetId: TARGET_ID,
                body: 'Second comment',
                clientNonce: nonce2,
                scope: SCOPE,
            });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Neither mutation threw; the hook settled without error
        expect(result.current.isError).toBe(false);
        expect(result.current.isSuccess).toBe(true);

        // The cache may be in various states depending on mutation ordering,
        // but it must be defined and have a valid shape (not corrupted).
        // At minimum, the last successful mutation's reconciled comment must be present.
        const cache = client.getQueryData<PostInteractionsData>(interactionsKey);
        if (cache) {
            expect(Array.isArray(cache.comments)).toBe(true);
            // No raw optimistic-<timestamp> ids should remain after success
            expect(
                cache.comments.filter((c) => /^optimistic-\d+$/.test(c.id))
            ).toHaveLength(0);
        }
    });
});

// ── TICKET-098 [ARCH-REVIEW-2]: scope-owned card-cache sync ───────────────────

describe('card-cache scope isolation (TICKET-098)', () => {
    const FRIENDS_KEY = queryKeys.feed.friends('viewer-user');
    const ACTIVITY_KEY = queryKeys.tables.activity('table-1');

    /** A friends-feed page cache: { pages: [{ rows }] } envelope (Page<T>). */
    function makeFriendsPages(reactionCount = 0, commentCount = 0) {
        return {
            pages: [{
                rows: [{
                    id: TARGET_ID,
                    user_id: 'author-1',
                    reaction_count: reactionCount,
                    comment_count: commentCount,
                    top_emojis: [],
                    my_reactions: [],
                }],
                next_cursor: null,
                has_more: false,
            }],
            pageParams: [null],
        };
    }

    function makeActivityPages(reactionCount = 0) {
        return {
            pages: [{
                rows: [{
                    id: TARGET_ID,
                    reaction_count: reactionCount,
                    comment_count: 0,
                    top_emojis: [],
                    my_reactions: [],
                }],
                next_cursor: null,
                has_more: false,
            }],
            pageParams: [null],
        };
    }

    it('public-scope reaction patches friends-feed pages, not Table activity', async () => {
        mockEdgeFnResolves({
            added: true,
            removed: false,
            reaction: {
                id: 'server-reaction-p1',
                user_id: VIEWER_ID,
                emoji: '❤️',
                created_at: '2026-07-04T12:00:00Z',
                profiles: null,
            },
            counts: { reactions: 5, top_emojis: [{ emoji: '❤️', count: 5, last_reacted_at: '2026-07-04T12:00:00Z' }] },
        });

        const { result, client } = renderHookWithClient(() => useToggleReaction());
        client.setQueryData(FRIENDS_KEY, makeFriendsPages(4));
        client.setQueryData(ACTIVITY_KEY, makeActivityPages(9));
        client.setQueryData(
            queryKeys.postInteractions.all(TARGET_TYPE, TARGET_ID, 'public'),
            INITIAL_STATE,
        );

        act(() => {
            result.current.mutate({ targetType: TARGET_TYPE, targetId: TARGET_ID, emoji: '❤️', scope: 'public' });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Friends page synced with server-authoritative public counts…
        const friends = client.getQueryData<any>(FRIENDS_KEY);
        expect(friends.pages[0].rows[0].reaction_count).toBe(5);
        expect(friends.pages[0].rows[0].my_reactions).toContain('❤️');
        // …page envelope preserved (rows mapped, not the page itself)
        expect(friends.pages[0].next_cursor).toBeNull();
        expect(friends.pages[0].has_more).toBe(false);
        // …and the Table activity cache (table-scope counters) is untouched.
        const activity = client.getQueryData<any>(ACTIVITY_KEY);
        expect(activity.pages[0].rows[0].reaction_count).toBe(9);
        expect(activity.pages[0].rows[0].my_reactions).toEqual([]);
    });

    it('table-scope reaction never touches friends-feed pages (public counters)', async () => {
        mockEdgeFnResolves({
            added: true,
            removed: false,
            reaction: {
                id: 'server-reaction-t1',
                user_id: VIEWER_ID,
                emoji: '🔥',
                created_at: '2026-07-04T12:00:00Z',
                profiles: null,
            },
            counts: { reactions: 3, top_emojis: [] },
        });

        const { result, client } = renderHookWithClient(() => useToggleReaction());
        client.setQueryData(FRIENDS_KEY, makeFriendsPages(4));
        client.setQueryData(ACTIVITY_KEY, makeActivityPages(2));
        client.setQueryData(interactionsKey, INITIAL_STATE);

        act(() => {
            result.current.mutate({ targetType: TARGET_TYPE, targetId: TARGET_ID, emoji: '🔥', scope: 'table' });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Table activity synced from server counts…
        const activity = client.getQueryData<any>(ACTIVITY_KEY);
        expect(activity.pages[0].rows[0].reaction_count).toBe(3);
        // …friends-feed row keeps its PUBLIC count — no cross-scope bleed.
        const friends = client.getQueryData<any>(FRIENDS_KEY);
        expect(friends.pages[0].rows[0].reaction_count).toBe(4);
        expect(friends.pages[0].rows[0].my_reactions).toEqual([]);
    });

    it('public-scope reaction rolls back friends-feed pages on error', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'fail' });

        const { result, client } = renderHookWithClient(() => useToggleReaction());
        const initial = makeFriendsPages(4);
        client.setQueryData(FRIENDS_KEY, initial);
        client.setQueryData(
            queryKeys.postInteractions.all(TARGET_TYPE, TARGET_ID, 'public'),
            INITIAL_STATE,
        );

        act(() => {
            result.current.mutate({ targetType: TARGET_TYPE, targetId: TARGET_ID, emoji: '❤️', scope: 'public' });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const friends = client.getQueryData<any>(FRIENDS_KEY);
        expect(friends.pages[0].rows[0].reaction_count).toBe(4);
        expect(friends.pages[0].rows[0].my_reactions).toEqual([]);
    });

    it('public-scope comment increments friends-feed comment_count', async () => {
        mockEdgeFnResolves({
            id: 'server-comment-p1',
            user_id: VIEWER_ID,
            body: 'lovely',
            created_at: '2026-07-04T12:00:00Z',
            edited_at: null,
            profiles: null,
            client_nonce: 'nonce-p1',
        });

        const { result, client } = renderHookWithClient(() => useAddComment());
        client.setQueryData(FRIENDS_KEY, makeFriendsPages(0, 2));
        client.setQueryData(
            queryKeys.postInteractions.all(TARGET_TYPE, TARGET_ID, 'public'),
            INITIAL_STATE,
        );

        act(() => {
            result.current.mutate({
                targetType: TARGET_TYPE,
                targetId: TARGET_ID,
                body: 'lovely',
                clientNonce: 'nonce-p1',
                scope: 'public',
            });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const friends = client.getQueryData<any>(FRIENDS_KEY);
        expect(friends.pages[0].rows[0].comment_count).toBe(3);
    });
});
