/**
 * Tests for useCreateTable hook
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { mockSupabase } from '@/__mocks__/supabase';
import { createQueryWrapper } from '@/__mocks__/test-utils';
import { useCreateTable } from '../useCreateTable';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('useCreateTable', () => {
    it('should call supabase.functions.invoke with correct payload', async () => {
        const mockTable = {
            id: 'new-table-123',
            name: 'Pizza Pals',
            avatar_url: null,
            created_by: 'user-123',
        };

        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { data: mockTable },
            error: null,
        });

        const { result } = renderHook(() => useCreateTable('user-123'), {
            wrapper: createQueryWrapper(),
        });

        result.current.mutate({ name: 'Pizza Pals' });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('table-management', {
            body: { name: 'Pizza Pals' },
            headers: {
                Authorization: 'Bearer mock-access-token',
            },
        });
    });

    it('should handle errors correctly', async () => {
        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { error: 'Name is required' },
            error: null,
        });

        const { result } = renderHook(() => useCreateTable('user-123'), {
            wrapper: createQueryWrapper(),
        });

        result.current.mutate({ name: '' });

        await waitFor(() => expect(result.current.isError).toBe(true));
    });
});
