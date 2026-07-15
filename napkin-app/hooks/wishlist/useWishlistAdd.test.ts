/**
 * Tests for useWishlistAdd — TICKET-042.
 *
 * (a) success reconcile — wishlist.check keys flipped to true, personal list invalidated
 * (b) failure rollback  — check keys restored to previous (false)
 * (c) rapid double add  — idempotent: no corruption
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
import { useWishlistAdd, type WishlistItem } from './useWishlistAdd';
import { queryKeys } from '@/lib/queryKeys';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'test-user-id';
const RESTAURANT_ID = 'restaurant-1';
const EXTERNAL_ID = 'ext-place-1';

const SERVER_ITEM: WishlistItem = {
    id: 'wishlist-1',
    user_id: USER_ID,
    restaurant_id: RESTAURANT_ID,
    note: null,
    source: null,
    created_at: '2026-04-27T12:00:00Z',
};

describe('useWishlistAdd', () => {
    it('(a) sets wishlist.check to true and keeps it on success', async () => {
        mockEdgeFnResolves(SERVER_ITEM);

        const { result, client } = renderHookWithClient(() => useWishlistAdd(USER_ID));

        const checkKey = queryKeys.wishlist.check(USER_ID, RESTAURANT_ID);
        const peekKey = queryKeys.restaurants.peekCard(USER_ID, RESTAURANT_ID, 'saved:::');
        client.setQueryData(checkKey, false);
        client.setQueryData(peekKey, { media: [] });

        act(() => {
            result.current.mutate({ restaurant_id: RESTAURANT_ID });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Check key should be true after success
        expect(client.getQueryData<boolean>(checkKey)).toBe(true);
        expect(client.getQueryState(peekKey)?.isInvalidated).toBe(true);
    });

    it('(a) sets both persisted-id and external-id check keys on ghost restaurant', async () => {
        mockEdgeFnResolves(SERVER_ITEM);

        const { result, client } = renderHookWithClient(() => useWishlistAdd(USER_ID));

        const extKey = queryKeys.wishlist.check(USER_ID, EXTERNAL_ID);
        const idKey = queryKeys.wishlist.check(USER_ID, RESTAURANT_ID);
        client.setQueryData(extKey, false);
        client.setQueryData(idKey, false);

        act(() => {
            result.current.mutate({
                restaurant: {
                    external_id: EXTERNAL_ID,
                    name: 'Ghost Restaurant',
                },
            });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Both external-id and server-assigned id keys should be true
        expect(client.getQueryData<boolean>(extKey)).toBe(true);
        expect(client.getQueryData<boolean>(idKey)).toBe(true);
    });

    it('(b) restores check key to false on server error', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'fail' });

        const { result, client } = renderHookWithClient(() => useWishlistAdd(USER_ID));

        const checkKey = queryKeys.wishlist.check(USER_ID, RESTAURANT_ID);
        client.setQueryData(checkKey, false);

        act(() => {
            result.current.mutate({ restaurant_id: RESTAURANT_ID });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Must roll back to false
        expect(client.getQueryData<boolean>(checkKey)).toBe(false);
    });

    it('(c) rapid double add: idempotent — check key stays true, no corruption', async () => {
        mockEdgeFnResolves(SERVER_ITEM);
        mockEdgeFnResolves(SERVER_ITEM);

        const { result, client } = renderHookWithClient(() => useWishlistAdd(USER_ID));

        const checkKey = queryKeys.wishlist.check(USER_ID, RESTAURANT_ID);
        client.setQueryData(checkKey, false);

        act(() => { result.current.mutate({ restaurant_id: RESTAURANT_ID }); });
        act(() => { result.current.mutate({ restaurant_id: RESTAURANT_ID }); });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Check key must end up true (idempotent add)
        expect(client.getQueryData<boolean>(checkKey)).toBe(true);
    });
});
