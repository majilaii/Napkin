import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { supabase } from '@/lib/supabase';
import { useDeleteAccount } from './useDeleteAccount';

jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('useDeleteAccount', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockCallEdgeFn.mockResolvedValue({
            deleted: false,
            pending: true,
            state: 'freezing',
        });
        (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });
    });

    it('signs out after the server accepts a frozen account for durable cleanup', async () => {
        const { result, client } = renderHookWithClient(() => useDeleteAccount());
        client.setQueryData(['private-user-data'], { secret: true });

        act(() => result.current.mutate());
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockCallEdgeFn).toHaveBeenCalledWith('account', {
            action: 'delete',
            body: {},
        });
        expect(client.getQueryData(['private-user-data'])).toBeUndefined();
        expect(supabase.auth.signOut).toHaveBeenCalledTimes(1);
    });
});
