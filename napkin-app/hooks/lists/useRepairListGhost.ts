import { useMutation, useQueryClient } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { FetchResult } from './useList';

export interface RepairListGhostInput {
    entry_id: string;
    list_id: string;
    replacement_external_id: string;
    expected_version: number;
}

export interface RepairListGhostResult {
    restaurant_id: string;
    entry_id: string;
}

export function useRepairListGhost() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (input: RepairListGhostInput) =>
            callEdgeFn<RepairListGhostResult>('lists', {
                action: 'repair_ghost',
                body: input,
            }),
        onMutate: async ({ list_id }) => {
            const detailKey = queryKeys.lists.detail(list_id);
            await queryClient.cancelQueries({ queryKey: detailKey, exact: true });
            const previous = queryClient.getQueryData<FetchResult>(detailKey);
            return { detailKey, previous };
        },
        onError: (_error, _input, context) => {
            if (context?.previous) {
                queryClient.setQueryData(context.detailKey, context.previous);
            }
        },
        onSettled: async (_result, _error, input) => {
            await queryClient.invalidateQueries({
                queryKey: queryKeys.lists.detail(input.list_id),
                exact: true,
            });
        },
    });
}
