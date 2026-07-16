import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { queryKeys } from '@/lib/queryKeys';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { useDeleteEntry } from '../useDeleteEntry';

jest.mock('@/lib/supabase', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/__mocks__/supabase');
});
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

const USER_ID = 'test-user-id';
const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('useDeleteEntry', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCallEdgeFn.mockResolvedValue({ deleted: true, entry_id: 'entry-1' });
    });

    it('invalidates profile, Spots, and Taste aggregates after deletion', async () => {
        const { result, client } = renderHookWithClient(() => useDeleteEntry());
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        act(() => result.current.mutate({ entryId: 'entry-1', userId: USER_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.users.profile(USER_ID) });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.users.spots(USER_ID) });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.users.taste(USER_ID) });
    });

    it('deletes through the entry lifecycle writer', async () => {
        const { result } = renderHookWithClient(() => useDeleteEntry());

        act(() => result.current.mutate({ entryId: 'entry-1', userId: USER_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockCallEdgeFn).toHaveBeenCalledWith('entry', {
            action: 'delete_entry',
            body: { entry_id: 'entry-1' },
        });
    });
});
