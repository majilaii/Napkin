/**
 * Tests for useEntryHistory hook
 */
import { renderHook, waitFor } from '@testing-library/react-native';
import { mockSupabase } from '@/__mocks__/supabase';
import { createQueryWrapper } from '@/__mocks__/test-utils';
import { useEntryHistory, useLatestEntry } from '../useEntryHistory';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('useEntryHistory', () => {
    it('should not fetch when userId is null', () => {
        const { result } = renderHook(
            () => useEntryHistory(null, 'place-123', 'restaurant'),
            { wrapper: createQueryWrapper() }
        );

        expect(result.current.isFetching).toBe(false);
    });

    it('should not fetch when locationId is null', () => {
        const { result } = renderHook(
            () => useEntryHistory('user-123', null, 'restaurant'),
            { wrapper: createQueryWrapper() }
        );

        expect(result.current.isFetching).toBe(false);
    });

    it('should return empty array when restaurant not found', async () => {
        // Mock restaurant lookup returning nothing
        mockSupabase.from.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
        });

        const { result } = renderHook(
            () => useEntryHistory('user-123', 'nonexistent-place', 'restaurant'),
            { wrapper: createQueryWrapper() }
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual([]);
    });
});

describe('useLatestEntry', () => {
    it('should return null when no entries exist', async () => {
        // Mock returning empty entries
        mockSupabase.from.mockReturnValue({
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
        });

        const { result } = renderHook(
            () => useLatestEntry('user-123', 'place-abc', 'restaurant'),
            { wrapper: createQueryWrapper() }
        );

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toBeNull();
    });
});
