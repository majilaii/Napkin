/**
 * Tests for useTableDetail hook
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { mockSupabase } from '@/__mocks__/supabase';
import { createQueryWrapper } from '@/__mocks__/test-utils';
import { useTableDetail } from '../useTableDetail';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('useTableDetail', () => {
    it('should not fetch when tableId is null', () => {
        const { result } = renderHook(() => useTableDetail(null), {
            wrapper: createQueryWrapper(),
        });

        expect(result.current.isFetching).toBe(false);
    });

    it('should fetch table detail with members', async () => {
        const mockTableDetail = {
            id: 'table-123',
            name: 'Sunday Roast Club',
            members: [
                {
                    user_id: 'user-1',
                    role: 'admin',
                    profiles: { display_name: 'Alice', avatar_url: null },
                },
                {
                    user_id: 'user-2',
                    role: 'member',
                    profiles: { display_name: 'Bob', avatar_url: null },
                },
            ],
        };

        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { data: mockTableDetail },
            error: null,
        });

        const { result } = renderHook(() => useTableDetail('table-123'), {
            wrapper: createQueryWrapper(),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockTableDetail);
        expect(result.current.data?.members).toHaveLength(2);
    });
});
