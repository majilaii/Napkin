/**
 * Tests for useRestaurantStatus hook
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { mockSupabase } from '@/__mocks__/supabase';
import { createQueryWrapper } from '@/__mocks__/test-utils';
import { useRestaurantStatus } from '../useRestaurantStatus';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('useRestaurantStatus', () => {
    it('should not fetch when userId or placeId is null', () => {
        const { result } = renderHook(() => useRestaurantStatus(null, 'place-123'), {
            wrapper: createQueryWrapper(),
        });

        expect(result.current.isFetching).toBe(false);
    });

    it('should return null when restaurant not found', async () => {
        // Mock restaurant lookup returning nothing
        mockSupabase.from.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
        });

        const { result } = renderHook(
            () => useRestaurantStatus('user-123', 'nonexistent-place'),
            { wrapper: createQueryWrapper() }
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBeNull();
    });

    it('should return status when restaurant and status exist', async () => {
        const mockStatus = { been: true, liked: true, want_to_try: false };

        // First call: restaurant lookup
        const restaurantMock = {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: { id: 'rest-123' }, error: null }),
        };

        // Second call: status lookup
        const statusMock = {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: mockStatus, error: null }),
        };

        mockSupabase.from
            .mockReturnValueOnce(restaurantMock)
            .mockReturnValueOnce(statusMock);

        const { result } = renderHook(
            () => useRestaurantStatus('user-123', 'place-abc'),
            { wrapper: createQueryWrapper() }
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(mockStatus);
    });
});
