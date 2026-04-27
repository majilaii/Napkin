/**
 * Tests for useLeaveTable — TICKET-042.
 *
 * (a) success reconcile — table removed from tables.list
 * (b) failure rollback  — tables.list restored
 * (c) rapid double-mutation — no corruption
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
import { useLeaveTable } from './useLeaveTable';
import { queryKeys } from '@/lib/queryKeys';
import type { TableMembership } from './useTables';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'test-user-id';
const TABLE_ID = 'table-1';

const INITIAL_LIST: TableMembership[] = [
    {
        role: 'member',
        joined_at: '2026-01-01T00:00:00Z',
        tables: {
            id: TABLE_ID,
            name: 'Test Table',
            avatar_url: null,
            owner_id: 'owner-1',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
        },
    },
    {
        role: 'member',
        joined_at: '2026-01-01T00:00:00Z',
        tables: {
            id: 'table-2',
            name: 'Another Table',
            avatar_url: null,
            owner_id: 'owner-2',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
        },
    },
];

describe('useLeaveTable', () => {
    it('(a) removes table from tables.list on success', async () => {
        mockEdgeFnResolves({ left: true });

        const { result, client } = renderHookWithClient(
            () => useLeaveTable(USER_ID),
        );

        const listKey = queryKeys.tables.list(USER_ID);
        client.setQueryData(listKey, INITIAL_LIST);

        act(() => {
            result.current.mutate({ tableId: TABLE_ID });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const list = client.getQueryData<TableMembership[]>(listKey);
        expect(list?.find((m) => m.tables.id === TABLE_ID)).toBeUndefined();
        expect(list?.find((m) => m.tables.id === 'table-2')).toBeDefined();
    });

    it('(b) restores tables.list on server error', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'fail' });

        const { result, client } = renderHookWithClient(
            () => useLeaveTable(USER_ID),
        );

        const listKey = queryKeys.tables.list(USER_ID);
        client.setQueryData(listKey, INITIAL_LIST);

        act(() => {
            result.current.mutate({ tableId: TABLE_ID });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));

        const list = client.getQueryData<TableMembership[]>(listKey);
        expect(list).toEqual(INITIAL_LIST);
    });

    it('(c) rapid double leave: second mutation no-ops on already-removed table', async () => {
        mockEdgeFnResolves({ left: true });
        mockEdgeFnResolves({ left: false }); // idempotent: already left

        const { result, client } = renderHookWithClient(
            () => useLeaveTable(USER_ID),
        );

        const listKey = queryKeys.tables.list(USER_ID);
        client.setQueryData(listKey, INITIAL_LIST);

        act(() => {
            result.current.mutate({ tableId: TABLE_ID });
        });
        act(() => {
            result.current.mutate({ tableId: TABLE_ID });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Table must be gone
        const list = client.getQueryData<TableMembership[]>(listKey);
        expect(list?.filter((m) => m.tables.id === TABLE_ID)).toHaveLength(0);
        // Cache is valid
        expect(Array.isArray(list)).toBe(true);
    });
});
