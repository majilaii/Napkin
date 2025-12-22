/**
 * Tests for useTableMembers hooks
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { mockSupabase } from '@/__mocks__/supabase';
import { createQueryWrapper } from '@/__mocks__/test-utils';
import { useInviteMember, useRemoveMember, useChangeRole } from '../useTableMembers';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('useInviteMember', () => {
    it('should call invite endpoint with correct payload', async () => {
        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { data: { user_id: 'user-456', role: 'member' } },
            error: null,
        });

        const { result } = renderHook(() => useInviteMember(), {
            wrapper: createQueryWrapper(),
        });

        result.current.mutate({
            tableId: 'table-123',
            inviteUserId: 'user-456',
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('table-members/invite', {
            body: { table_id: 'table-123', invite_user_id: 'user-456', role: 'member' },
        });
    });
});

describe('useRemoveMember', () => {
    it('should call delete endpoint', async () => {
        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { success: true },
            error: null,
        });

        const { result } = renderHook(() => useRemoveMember(), {
            wrapper: createQueryWrapper(),
        });

        result.current.mutate({
            tableId: 'table-123',
            userId: 'user-456',
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});

describe('useChangeRole', () => {
    it('should call role change endpoint', async () => {
        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { data: { role: 'admin' } },
            error: null,
        });

        const { result } = renderHook(() => useChangeRole(), {
            wrapper: createQueryWrapper(),
        });

        result.current.mutate({
            tableId: 'table-123',
            userId: 'user-456',
            role: 'admin',
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });
});
