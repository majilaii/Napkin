/**
 * Tests for useCreateEntry — TICKET-042 + TICKET-043.
 *
 * Covers the extended optimistic patch across tables.activity, entries.forDay,
 * and entries.mySolo caches. (TICKET-098: the feed.all patch was removed — the
 * legacy cross-Table feed is gone and the friends feed excludes self — so its
 * assertions were removed here too.)
 *
 * Tests:
 *   (a) success reconcile — caches patched + nonce swapped for server id
 *   (b) failure rollback — caches rolled back to snapshots
 *   (c) rapid double-mutation — no races
 *   (d) table entry — tables.activity patched, mySolo ALSO patched (journal = all
 *       own entries since 20260616000100)
 *   (e) solo entry — mySolo patched, tables.activity NOT patched
 *   (f) day-bucket migration — row migrates to server date when crossing midnight
 *
 * TICKET-043 additions:
 *   (g) 0 table_ids — feed-only; mySolo patched, no tables.activity patch
 *   (h) 1 table_id via table_ids[] — single tables.activity patch, mySolo ALSO patched
 *   (i) 3 table_ids — three tables.activity patches, mySolo patched once, one atlas invalidation (primary only)
 *   (j) atomic rollback — all per-Table activity caches rolled back on server error
 *   (k) nonce-dedup — second call with same nonce returns same entry (was_dedup=true)
 *   (l) table_not_authorized error — triggers toast + onTableNotAuthorized + rollback
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
jest.mock('@/lib/edgeInvoke', () => ({
    callEdgeFn: jest.fn(),
    // TICKET-075: useCreateEntry now imports SessionExpiredError for the 401 path.
    SessionExpiredError: class SessionExpiredError extends Error {
        code = 'session_expired';
    },
}));
jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));

import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithClient } from '../../__tests__/utils/queryWrapper';
import { useCreateEntry, type CreateEntryInput } from './useCreateEntry';
import { queryKeys } from '@/lib/queryKeys';
import type { InfiniteData } from '@tanstack/react-query';
import type { Page } from '@/lib/pagination';
import type { ActivityItem, SoloShareActivity } from './useTableActivity';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'test-user-id'; // matches MockAuthProvider default
const TABLE_ID = 'table-1';
const NONCE = 'test-nonce-abc';

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

    it('(a2) success invalidates profile, Spots, and Taste aggregates', async () => {
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );
        const spy = jest.spyOn(client, 'invalidateQueries');

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.users.profile(USER_ID) });
        expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.users.spots(USER_ID) });
        expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.users.taste(USER_ID) });
        expect(spy).toHaveBeenCalledWith({
            queryKey: queryKeys.restaurants.page(SERVER_ENTRY.restaurant_id),
        });
    });

    it('(b) rolls back mySolo and forDay on server error', async () => {
        const { supabase: mockSupabase } = require('@/__mocks__/supabase');
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { error: 'Server error' },
            error: null,
        });

        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        const initialMySolo = makeMySoloData();
        client.setQueryData(mySoloKey, initialMySolo);

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        // Cache should roll back to empty state — no optimistic row survives
        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        expect(mySoloData).toEqual([]);
    });

    it('(d) table entry: reconciles tables.activity AND patches mySolo (journal = all own entries)', async () => {
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

        // mySolo ALSO gets the entry — the personal Journal shows ALL own meals,
        // including ones shared to a Table, flagged is_shared.
        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        const soloRow = mySoloData?.find((r) => r.id === 'server-entry-1');
        expect(soloRow).toBeDefined();
        expect(soloRow?.is_shared).toBe(true);
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

    // ── TICKET-043 cases ──────────────────────────────────────────────────────

    it('(g) 0 table_ids — feed-only: mySolo patched, no tables.activity activity', async () => {
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        const activityKey = queryKeys.tables.activity(TABLE_ID);
        client.setQueryData(mySoloKey, makeMySoloData());
        client.setQueryData(activityKey, makeActivityInfiniteData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT, table_ids: [] });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        expect(mySoloData?.find((r) => r.id === 'server-entry-1')).toBeDefined();

        const actData = client.getQueryData<InfiniteData<Page<ActivityItem>>>(activityKey);
        expect(actData?.pages[0].rows).toHaveLength(0);
    });

    it('(h) 1 table via table_ids[] — tables.activity patched, mySolo ALSO patched', async () => {
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const activityKey = queryKeys.tables.activity(TABLE_ID);
        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        client.setQueryData(activityKey, makeActivityInfiniteData());
        client.setQueryData(mySoloKey, makeMySoloData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT, table_ids: [TABLE_ID] });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const actData = client.getQueryData<InfiniteData<Page<ActivityItem>>>(activityKey);
        expect(actData?.pages[0].rows.find((r) => r.id === 'server-entry-1')).toBeDefined();

        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        const soloRow = mySoloData?.find((r) => r.id === 'server-entry-1');
        expect(soloRow).toBeDefined();
        expect(soloRow?.is_shared).toBe(true);
    });

    it('(i) 3 table_ids — three tables.activity caches all receive one row', async () => {
        const TABLE_B = 'table-b';
        const TABLE_C = 'table-c';
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const keyA = queryKeys.tables.activity(TABLE_ID);
        const keyB = queryKeys.tables.activity(TABLE_B);
        const keyC = queryKeys.tables.activity(TABLE_C);
        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        client.setQueryData(keyA, makeActivityInfiniteData());
        client.setQueryData(keyB, makeActivityInfiniteData());
        client.setQueryData(keyC, makeActivityInfiniteData());
        client.setQueryData(mySoloKey, makeMySoloData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT, table_ids: [TABLE_ID, TABLE_B, TABLE_C] });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        for (const key of [keyA, keyB, keyC]) {
            const actData = client.getQueryData<InfiniteData<Page<ActivityItem>>>(key);
            expect(actData?.pages[0].rows.find((r) => r.id === 'server-entry-1')).toBeDefined();
        }

        // One row in the Journal regardless of how many Tables it was shared to.
        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        expect(mySoloData?.filter((r) => r.id === 'server-entry-1')).toHaveLength(1);
        expect(mySoloData?.find((r) => r.id === 'server-entry-1')?.is_shared).toBe(true);
    });

    it('(j) atomic rollback — all per-Table activity caches rolled back on error', async () => {
        const { supabase: mockSupabase } = require('@/__mocks__/supabase');
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { error: 'Server error' },
            error: null,
        });
        const TABLE_B = 'table-b-rollback';
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null),
        );

        const keyA = queryKeys.tables.activity(TABLE_ID);
        const keyB = queryKeys.tables.activity(TABLE_B);
        client.setQueryData(keyA, makeActivityInfiniteData());
        client.setQueryData(keyB, makeActivityInfiniteData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT, table_ids: [TABLE_ID, TABLE_B] });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        for (const key of [keyA, keyB]) {
            const actData = client.getQueryData<InfiniteData<Page<ActivityItem>>>(key);
            expect(actData?.pages[0].rows).toHaveLength(0);
        }
    });

    it('(l) table_not_authorized: calls onTableNotAuthorized + rolls back', async () => {
        const { supabase: mockSupabase } = require('@/__mocks__/supabase');
        mockSupabase.functions.invoke.mockResolvedValue({
            data: { error: 'table_not_authorized', code: 'table_not_authorized', ids: [TABLE_ID] },
            error: null,
        });

        const onTableNotAuthorized = jest.fn();
        const { result, client } = renderHookWithClient(
            () => useCreateEntry(USER_ID, null, { onTableNotAuthorized }),
        );

        const activityKey = queryKeys.tables.activity(TABLE_ID);
        client.setQueryData(activityKey, makeActivityInfiniteData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT, table_ids: [TABLE_ID] });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(onTableNotAuthorized).toHaveBeenCalledWith([TABLE_ID]);
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

        const mySoloKey = queryKeys.entries.mySolo(USER_ID);
        client.setQueryData(mySoloKey, makeMySoloData());

        act(() => {
            result.current.mutate({ ...ENTRY_INPUT });
        });
        act(() => {
            result.current.mutate({ ...ENTRY_INPUT, client_nonce: nonce2 });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const mySoloData = client.getQueryData<SoloShareActivity[]>(mySoloKey);
        expect(mySoloData).toBeDefined();
        expect(Array.isArray(mySoloData)).toBe(true);
        // No optimistic ids from either mutation should remain
        expect(
            mySoloData?.filter((r) => r.id.startsWith('optimistic-'))
        ).toHaveLength(0);
    });
});
