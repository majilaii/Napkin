import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useUpdateEntry } from '../useUpdateEntry';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/lib/supabase', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/__mocks__/supabase');
});

const ENTRY_ID = 'entry-1';
const PRIYA = { user_id: 'priya-id', display_name: 'Priya' };
const ORIGINAL = { user_id: 'old-id', display_name: 'Old companion' };
const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('useUpdateEntry companion edits', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('shows the selected companions immediately and sends only their ids', async () => {
        mockCallEdgeFn.mockResolvedValue({
            entry_id: ENTRY_ID,
            companion_ids: [PRIYA.user_id],
        });

        const { result, client } = renderHookWithClient(() => useUpdateEntry(ENTRY_ID));
        const detailKey = queryKeys.entries.detail(ENTRY_ID);
        client.setQueryData(detailKey, { id: ENTRY_ID, companions: [ORIGINAL] });

        act(() => {
            result.current.mutate({
                companion_ids: [PRIYA.user_id],
                optimisticCompanions: [PRIYA],
            });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(client.getQueryData(detailKey)).toMatchObject({ companions: [PRIYA] });
        expect(mockCallEdgeFn).toHaveBeenCalledWith('entry', {
            action: 'update-companions',
            body: { entry_id: ENTRY_ID, companion_ids: [PRIYA.user_id] },
        });
    });

    it('restores the previous companions when persistence fails', async () => {
        mockCallEdgeFn.mockRejectedValue(new Error('save failed'));

        const { result, client } = renderHookWithClient(() => useUpdateEntry(ENTRY_ID));
        const detailKey = queryKeys.entries.detail(ENTRY_ID);
        client.setQueryData(detailKey, { id: ENTRY_ID, companions: [ORIGINAL] });

        act(() => {
            result.current.mutate({
                companion_ids: [PRIYA.user_id],
                optimisticCompanions: [PRIYA],
            });
        });

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(client.getQueryData(detailKey)).toMatchObject({ companions: [ORIGINAL] });
    });
});
