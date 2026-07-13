import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { queryKeys } from '@/lib/queryKeys';
import { useDeleteEntry } from '../useDeleteEntry';

jest.mock('@/lib/supabase', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/__mocks__/supabase');
});
jest.mock('@/lib/imageUpload', () => ({ removeUploadedPhoto: jest.fn() }));

const USER_ID = 'test-user-id';

describe('useDeleteEntry', () => {
    it('invalidates profile, Spots, and Taste aggregates after deletion', async () => {
        const { result, client } = renderHookWithClient(() => useDeleteEntry());
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        act(() => result.current.mutate({ entryId: 'entry-1', userId: USER_ID }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.users.profile(USER_ID) });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.users.spots(USER_ID) });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.users.taste(USER_ID) });
    });
});
