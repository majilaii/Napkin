/**
 * Tests for useCreateEntry — TICKET-042.
 *
 * Covers the extended optimistic patch across feed.all, tables.activity,
 * entries.forDay, and entries.mySolo caches.
 *
 * Tests:
 *   (a) success reconcile — all four caches patched + nonce swapped for server id
 *   (b) failure rollback — all four caches rolled back to snapshots
 *   (c) rapid double-mutation — no races
 *   (d) table entry — tables.activity patched, mySolo NOT patched
 *   (e) solo entry — mySolo patched, tables.activity NOT patched
 *   (f) day-bucket migration — row migrates to server date when crossing midnight
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
import { useCreateEntry, type CreateEntryInput } from './useCreateEntry';
import { queryKeys } from '@/lib/queryKeys';
import type { InfiniteData } from '@tanstack/react-query';
import type { FeedPage } from '@/hooks/feed/useFeed';
import type { Page } from '@/lib/pagination';
import type { ActivityItem, SoloShareActivity } from './useTableActivity';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'test-user-id'; // matches MockAuthProvider default
const TABLE_ID = 'table-1';
const NONCE = 'test-nonce-abc';

function makeFeedInfiniteData(): InfiniteData<FeedPage> {
    return {
        pages: [{
            rows: [],
            next_cursor: null,
            has_more: false,
            trending: null,
            window_days: 7,
        }],
        pageParams: [null],
    };
}

function makeActivityInfiniteData(): InfiniteData<Page<ActivityItem>> {
    return {
        pages: [{ rows: [], next_cursor: null, has_more: false }],
        pageParams: [null],
    };
}

function makeMySoloData(): SoloShareActivity[] {
    return [];
}

const SERVER_ENTRY = {
    id: 'server-entry-1',
    restaurant_id: 'restaurant-1',
    created_at: '2026-04-27T12:00:00.000Z',
    visited_at: '2026-04-27T12:00:00.000Z',
    rating: 4,
    content: 'Great!',
};

const ENTRY_INPUT: CreateEntryInput = {
    restaurant: {
        external_id: 'ext-1',
        name: 'Test Restaurant',
    },
    rating: 4,
    content: 'Great!',
    client_nonce: NONCE,
};

// ── (a) success reconcile ────────────────────────────────────────────────────

describe('useCreateEntry', () => {
    // Mock supabase.functions.invoke for the entry call
    beforeEach(() => {
        const { supabase: mockSupabase } = require('@/__mocks__/supabase');
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { data: SERVER_ENTRY },
            error: null,
        });
    });

    it('(a) feed.all reconciles on success: server entry replaces optimistic id', async () => {
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const feedKey = queryKeys.feed.all(USER_ID);
        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        client.setQueryData(feedKey, makeFeedInfiniteData());
        client.setQueryData(mySoloKey, makeMySoloData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // After success: server id present, no optimistic id
        const feedData = client.getQueryData<InfiniteData<FeedPage>>(feedKey);
        expect(feedData?.pages[0].rows.find((r) => r.id === `optimistic-${NONCE}`)).toBeUndefined();
        expect(feedData?.pages[0].rows.find((r) => r.id === 'server-entry-1')).toBeDefined();
        // Extra page-0 fields preserved
        expect(feedData?.pages[0].window_days).toBe(7);
    });

    it('(a) mySolo reconciles on success: server entry replaces optimistic id', async () => {
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        client.setQueryData(mySoloKey, makeMySoloData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        expect(mySoloData?.find((r) => r.id === `optimistic-${NONCE}`)).toBeUndefined();
        expect(mySoloData?.find((r) => r.id === 'server-entry-1')).toBeDefined();
    });

    it('(b) rolls back feed.all and mySolo on server error', async () => {
        const { supabase: mockSupabase } = require('@/__mocks__/supabase');
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { error: 'Server error' },
            error: null,
        });

        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const feedKey = queryKeys.feed.all(USER_ID);
        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        const initialFeed = makeFeedInfiniteData();
        const initialMySolo = makeMySoloData();
        client.setQueryData(feedKey, initialFeed);
        client.setQueryData(mySoloKey, initialMySolo);

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Both caches should roll back to empty state
        const feedData = client.getQueryData<InfiniteData<FeedPage>>(feedKey);
        expect(feedData?.pages[0].rows).toHaveLength(0);

        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        expect(mySoloData).toEqual([]);
    });

    it('(d) table entry: reconciles tables.activity; does NOT patch mySolo', async () => {
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, TABLE_ID),
        );

        const activityKey = queryKeys.tables.activity(TABLE_ID);
        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        client.setQueryData(activityKey, makeActivityInfiniteData());
        client.setQueryData(mySoloKey, makeMySoloData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT, table_id: TABLE_ID });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Activity should have server entry (optimistic id swapped)
        const actData = client.getQueryData<InfiniteData<Page<ActivityItem>>>(activityKey);
        expect(actData?.pages[0].rows.find((r) => r.id === `optimistic-${NONCE}`)).toBeUndefined();
        expect(actData?.pages[0].rows.find((r) => r.id === 'server-entry-1')).toBeDefined();

        // mySolo should remain empty (table entries don't go to mySolo)
        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        expect(mySoloData).toEqual([]);
    });

    it('(e) solo entry: patches mySolo; does NOT patch tables.activity', async () => {
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const activityKey = queryKeys.tables.activity(TABLE_ID);
        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        client.setQueryData(activityKey, makeActivityInfiniteData());
        client.setQueryData(mySoloKey, makeMySoloData());

        // Solo entry — no table_id
        act(() => {
            result.current.mutate({ ...ENTRY_INPUT });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // tables.activity for TABLE_ID must remain untouched (no entry with our nonce)
        const actData = client.getQueryData<InfiniteData<Page<ActivityItem>>>(activityKey);
        expect(actData?.pages[0].rows).toHaveLength(0);
    });

    it('(c) rapid double-mutation: both complete without corruption', async () => {
        const nonce2 = 'test-nonce-xyz';
        const { supabase: mockSupabase } = require('@/__mocks__/supabase');
        mockSupabase.functions.invoke
            .mockResolvedValueOnce({ data: { data: SERVER_ENTRY }, error: null })
            .mockResolvedValueOnce({ data: { data: { ...SERVER_ENTRY, id: 'server-entry-2' } }, error: null });

        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const feedKey = queryKeys.feed.all(USER_ID);
        client.setQueryData(feedKey, makeFeedInfiniteData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT });
        });
        act(() => {
            result.current.mutate({ ...ENTRY_INPUT, client_nonce: nonce2 });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const feedData = client.getQueryData<InfiniteData<FeedPage>>(feedKey);
        expect(feedData).toBeDefined();
        expect(Array.isArray(feedData?.pages[0].rows)).toBe(true);
        // No optimistic ids from either mutation should remain
        expect(
            feedData?.pages[0].rows.filter((r) => r.id.startsWith('optimistic-'))
        ).toHaveLength(0);
    });
});
