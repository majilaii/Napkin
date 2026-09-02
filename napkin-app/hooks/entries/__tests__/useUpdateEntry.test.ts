import { act, waitFor } from '@testing-library/react-native';
import { QueryObserver } from '@tanstack/react-query';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useUpdateEntry } from '../useUpdateEntry';
import { mockSupabase } from '@/__mocks__/supabase';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/lib/supabase', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/__mocks__/supabase');
});

const ENTRY_ID = 'entry-1';
const PRIYA = { user_id: 'priya-id', display_name: 'Priya' };
const ORIGINAL = { user_id: 'old-id', display_name: 'Old companion' };
const DROPPED = { user_id: 'dropped-id', display_name: 'Dropped stranger' };
const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('useUpdateEntry writer routing', () => {
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
        const staleServerFetch = jest.fn().mockResolvedValue({
            id: ENTRY_ID,
            companions: [ORIGINAL],
        });
        const detailObserver = new QueryObserver(client, {
            queryKey: detailKey,
            queryFn: staleServerFetch,
            staleTime: Infinity,
        });
        const unsubscribe = detailObserver.subscribe(() => undefined);

        act(() => {
            result.current.mutate({
                companion_ids: [PRIYA.user_id],
                optimisticCompanions: [PRIYA],
            });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(client.getQueryData(detailKey)).toMatchObject({ companions: [PRIYA] });
        expect(staleServerFetch).not.toHaveBeenCalled();
        expect(detailObserver.getCurrentResult().isStale).toBe(true);
        expect(mockCallEdgeFn).toHaveBeenCalledWith('entry', {
            action: 'update-companions',
            body: { entry_id: ENTRY_ID, companion_ids: [PRIYA.user_id] },
        });
        unsubscribe();
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

    it('removes a companion the server drops from the optimistic detail cache', async () => {
        mockCallEdgeFn.mockResolvedValue({
            entry_id: ENTRY_ID,
            companion_ids: [PRIYA.user_id],
        });

        const { result, client } = renderHookWithClient(() => useUpdateEntry(ENTRY_ID));
        const detailKey = queryKeys.entries.detail(ENTRY_ID);
        client.setQueryData(detailKey, { id: ENTRY_ID, companions: [ORIGINAL] });

        act(() => {
            result.current.mutate({
                companion_ids: [PRIYA.user_id, DROPPED.user_id],
                optimisticCompanions: [PRIYA, DROPPED],
            });
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(client.getQueryData(detailKey)).toMatchObject({ companions: [PRIYA] });
    });

    it('routes hero changes through the flag-aware entry writer, never direct PATCH', async () => {
        mockCallEdgeFn.mockResolvedValue({
            id: ENTRY_ID,
            user_id: 'user-1',
            photo_url: 'https://cdn.test/approved.jpg',
        });
        const { result, client } = renderHookWithClient(() => useUpdateEntry(ENTRY_ID));
        client.setQueryData(queryKeys.entries.detail(ENTRY_ID), {
            id: ENTRY_ID,
            photo_url: 'https://cdn.test/old.jpg',
        });

        act(() => result.current.mutate({ photo_url: 'https://cdn.test/approved.jpg' }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockCallEdgeFn).toHaveBeenCalledWith('entry', {
            action: 'set_entry_hero',
            body: {
                entry_id: ENTRY_ID,
                photo_url: 'https://cdn.test/approved.jpg',
            },
        });
        expect(mockSupabase.from).not.toHaveBeenCalledWith('entries');
        expect(client.getQueryData(queryKeys.entries.detail(ENTRY_ID))).toMatchObject({
            photo_url: 'https://cdn.test/approved.jpg',
        });
    });
});
