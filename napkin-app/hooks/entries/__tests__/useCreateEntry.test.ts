/**
 * Tests for useCreateEntry hook
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { mockSupabase } from '@/__mocks__/supabase';
import { createQueryWrapper } from '@/__mocks__/test-utils';
import { useCreateEntry } from '../useCreateEntry';

// Reset mocks before each test
beforeEach(() => {
    jest.clearAllMocks();
});

describe('useCreateEntry', () => {
    it('should call supabase.functions.invoke with correct payload', async () => {
        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { data: { id: 'new-entry-123' } },
            error: null,
        });

        const { result } = renderHook(() => useCreateEntry(), {
            wrapper: createQueryWrapper(),
        });

        // Trigger the mutation
        result.current.mutate({
            userId: 'user-123',
            locationId: 'place-abc',
            restaurant: {
                external_id: 'place-abc',
                name: 'Test Restaurant',
            },
            rating: 4.5,
            content: 'Great food!',
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        // Verify the edge function was called
        expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('entry', {
            body: expect.objectContaining({
                restaurant: expect.objectContaining({
                    external_id: 'place-abc',
                    name: 'Test Restaurant',
                }),
                rating: 4.5,
                content: 'Great food!',
            }),
        });
    });

    it('should handle errors correctly', async () => {
        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: null,
            error: new Error('API Error'),
        });

        const { result } = renderHook(() => useCreateEntry(), {
            wrapper: createQueryWrapper(),
        });

        result.current.mutate({
            userId: 'user-123',
            rating: 4,
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(result.current.error).toBeTruthy();
    });
});
