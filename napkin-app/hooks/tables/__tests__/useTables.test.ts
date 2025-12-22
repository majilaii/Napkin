/**
 * Tests for useTables hook
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { mockSupabase } from '@/__mocks__/supabase';
import { createQueryWrapper } from '@/__mocks__/test-utils';
import { useTables } from '../useTables';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('useTables', () => {
    it('should not fetch when userId is null', () => {
        const { result } = renderHook(() => useTables(null), {
            wrapper: createQueryWrapper(),
        });

        expect(result.current.isFetching).toBe(false);
    });

    it('should fetch tables when userId is provided', async () => {
        const mockTables = [
            {
                role: 'admin',
                joined_at: '2024-01-01T00:00:00Z',
                tables: {
                    id: 'table-1',
                    name: 'Sunday Roast Club',
                    avatar_url: null,
                    created_by: 'user-123',
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z',
                },
            },
        ];

        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { data: mockTables },
            error: null,
        });

        const { result } = renderHook(() => useTables('user-123'), {
            wrapper: createQueryWrapper(),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockTables);
    });
});
