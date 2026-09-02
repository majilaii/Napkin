import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useBlockUser, useUnblockUser } from '../useBlocking';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'viewer-id' } }),
}));

const TARGET_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('useBlockUser', () => {
    it('invalidates the cached public Taste drill-in after a block', async () => {
        (callEdgeFn as jest.Mock).mockResolvedValue({ ok: true });
        const { result, client } = renderHookWithClient(() => useBlockUser());
        const invalidate = jest.spyOn(client, 'invalidateQueries');
        const remove = jest.spyOn(client, 'removeQueries');

        act(() => result.current.mutate(TARGET_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.users.taste(TARGET_ID),
        });
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.restaurants.pageAll(),
        });
        expect(remove).toHaveBeenCalledWith({
            queryKey: queryKeys.users.taste(TARGET_ID),
            exact: true,
        });
    });

    it('invalidates every cached restaurant crown after an unblock', async () => {
        (callEdgeFn as jest.Mock).mockResolvedValue({ ok: true });
        const { result, client } = renderHookWithClient(() => useUnblockUser());
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        act(() => result.current.mutate(TARGET_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.restaurants.pageAll(),
        });
    });
});
