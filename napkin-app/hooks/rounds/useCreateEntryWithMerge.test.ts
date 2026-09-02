import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { queryKeys } from '@/lib/queryKeys';
import { callMergeWith } from './mergeRequest';
import { useCreateEntryWithMerge } from './useCreateEntryWithMerge';

jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'viewer-user-id' } }),
}));
jest.mock('@/providers/ToastProvider', () => ({
    useToast: () => ({ show: jest.fn() }),
}));
jest.mock('./mergeRequest', () => ({ callMergeWith: jest.fn() }));

const mockCallMergeWith = callMergeWith as jest.MockedFunction<typeof callMergeWith>;

describe('useCreateEntryWithMerge', () => {
    it('invalidates the restaurant page after the entry is created', async () => {
        mockCallMergeWith.mockResolvedValue({
            merge_outcome: 'solo',
            entry_id: 'entry-b',
            round_id: null,
            entry_a_id: 'entry-a',
            restaurant_id: 'restaurant-1',
            visited_at: '2026-09-02T12:00:00.000Z',
            created_at: '2026-09-02T12:00:00.000Z',
            rating: 4.5,
            content: null,
            average_rating: 4.5,
            restaurant: null,
        });
        const { result, client } = renderHookWithClient(() => useCreateEntryWithMerge());
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        act(() => result.current.mutate({
            entry_a_id: 'entry-a',
            table_id: 'table-1',
            restaurant_id: 'restaurant-1',
            visited_at: '2026-09-02T12:00:00.000Z',
            client_nonce: 'nonce-1',
            rating: 4.5,
        }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.restaurants.page('restaurant-1'),
        });
    });
});
