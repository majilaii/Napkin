/**
 * Tests for useRestaurantSearch hook
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { mockSupabase } from '@/__mocks__/supabase';
import { createQueryWrapper } from '@/__mocks__/test-utils';
import { useRestaurantSearch } from '../useRestaurantSearch';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('useRestaurantSearch', () => {
    it('should not fetch when query is less than 3 characters', () => {
        const { result } = renderHook(() => useRestaurantSearch('ab'), {
            wrapper: createQueryWrapper(),
        });

        // Query should be disabled
        expect(result.current.isFetching).toBe(false);
        expect(mockSupabase.functions.invoke).not.toHaveBeenCalled();
    });

    it('should fetch when query is 3+ characters', async () => {
        const mockResults = [
            { id: 'place-1', name: 'Pizza Place', formattedAddress: '123 Main St' },
            { id: 'place-2', name: 'Pasta Palace', formattedAddress: '456 Oak Ave' },
        ];

        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { data: mockResults },
            error: null,
        });

        const { result } = renderHook(() => useRestaurantSearch('pizza'), {
            wrapper: createQueryWrapper(),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockSupabase.functions.invoke).toHaveBeenCalledWith('places-search', {
            body: { query: 'pizza', limit: 5 },
        });

        expect(result.current.data).toEqual(mockResults);
    });

    it('should return empty array when API returns no results', async () => {
        mockSupabase.functions.invoke.mockResolvedValueOnce({
            data: { data: [] },
            error: null,
        });

        const { result } = renderHook(() => useRestaurantSearch('xyz'), {
            wrapper: createQueryWrapper(),
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });
});
