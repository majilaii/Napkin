import {
    type InfiniteData,
    useInfiniteQuery,
    useMutation,
    useQueryClient,
} from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface ExhaustedCompletenessItem {
    id: string;
    job_id: string;
    item_nonce: string;
    import_nonce: string | null;
    restaurant_id: string | null;
    restaurant_name: string | null;
    restaurant_city: string | null;
    resolution_id?: string | null;
    external_id?: string | null;
    last_error: string | null;
    created_at: string;
}

export interface ExhaustedResponse {
    items?: ExhaustedCompletenessItem[];
    next_cursor?: string | null;
    has_more?: boolean;
}

export function useExhaustedCompletenessItems(
    userId: string | null | undefined,
    { pollMs = 15_000 }: { pollMs?: number } = {},
) {
    const query = useInfiniteQuery<ExhaustedResponse, Error>({
        queryKey: queryKeys.completeness.exhausted(userId ?? 'signed-out'),
        enabled: !!userId,
        queryFn: async ({ pageParam }) => {
            const response = await callEdgeFn<ExhaustedResponse>('restaurant-completeness', {
                action: 'exhausted',
                body: pageParam ? { cursor: pageParam } : undefined,
            });
            return response ?? { items: [], next_cursor: null, has_more: false };
        },
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
        staleTime: 15_000,
        refetchInterval: pollMs,
    });
    return {
        ...query,
        data: query.data?.pages.flatMap((page) => page.items ?? []) ?? [],
    };
}

export function useRetryCompletenessItem(userId: string | null | undefined) {
    const queryClient = useQueryClient();
    const key = queryKeys.completeness.exhausted(userId ?? 'signed-out');

    return useMutation({
        mutationFn: async (itemId: string) =>
            callEdgeFn<{ item_id: string; state: 'pending' }>('restaurant-completeness', {
                action: 'retry',
                body: { item_id: itemId },
            }),
        onMutate: async (itemId) => {
            await queryClient.cancelQueries({ queryKey: key, exact: true });
            const previous = queryClient.getQueryData<InfiniteData<ExhaustedResponse>>(key);
            queryClient.setQueryData<InfiniteData<ExhaustedResponse>>(key, (current) =>
                current
                    ? {
                          ...current,
                          pages: current.pages.map((page) => ({
                              ...page,
                              items: (page.items ?? []).filter((item) => item.id !== itemId),
                          })),
                      }
                    : current,
            );
            return { previous };
        },
        onError: (_error, _itemId, context) => {
            if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: key, exact: true });
            if (userId) {
                await queryClient.invalidateQueries({
                    queryKey: queryKeys.importJobs.all(userId),
                    exact: true,
                });
            }
        },
    });
}

export function useDismissCompletenessItem(userId: string | null | undefined) {
    const queryClient = useQueryClient();
    const key = queryKeys.completeness.exhausted(userId ?? 'signed-out');

    return useMutation({
        mutationFn: async (itemId: string) =>
            callEdgeFn<{ item_id: string; state: 'exhausted'; dismissed: true }>(
                'restaurant-completeness',
                {
                    action: 'dismiss',
                    body: { item_id: itemId },
                },
            ),
        onMutate: async (itemId) => {
            await queryClient.cancelQueries({ queryKey: key, exact: true });
            const previous = queryClient.getQueryData<InfiniteData<ExhaustedResponse>>(key);
            queryClient.setQueryData<InfiniteData<ExhaustedResponse>>(key, (current) =>
                current
                    ? {
                          ...current,
                          pages: current.pages.map((page) => ({
                              ...page,
                              items: (page.items ?? []).filter((item) => item.id !== itemId),
                          })),
                      }
                    : current,
            );
            return { previous };
        },
        onError: (_error, _itemId, context) => {
            if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: key, exact: true });
            if (userId) {
                await queryClient.invalidateQueries({
                    queryKey: queryKeys.importJobs.all(userId),
                    exact: true,
                });
            }
        },
    });
}

export interface CorrectCompletenessItemInput {
    item_id: string;
    resolution_id: string;
}

export function useCorrectCompletenessItem(userId: string | null | undefined) {
    const queryClient = useQueryClient();
    const key = queryKeys.completeness.exhausted(userId ?? 'signed-out');

    return useMutation({
        mutationFn: async (input: CorrectCompletenessItemInput) =>
            callEdgeFn<Record<string, unknown>>('restaurant-completeness', {
                action: 'correct',
                body: {
                    item_id: input.item_id,
                    resolution_id: input.resolution_id,
                },
            }),
        onMutate: async (input) => {
            await queryClient.cancelQueries({ queryKey: key, exact: true });
            const previous = queryClient.getQueryData<InfiniteData<ExhaustedResponse>>(key);
            queryClient.setQueryData<InfiniteData<ExhaustedResponse>>(key, (current) =>
                current
                    ? {
                          ...current,
                          pages: current.pages.map((page) => ({
                              ...page,
                              items: (page.items ?? []).filter(
                                  (item) => item.id !== input.item_id,
                              ),
                          })),
                      }
                    : current,
            );
            return { previous };
        },
        onError: (_error, _input, context) => {
            if (context?.previous !== undefined) queryClient.setQueryData(key, context.previous);
        },
        onSettled: async () => {
            await queryClient.invalidateQueries({ queryKey: key, exact: true });
            if (userId) {
                await queryClient.invalidateQueries({
                    queryKey: queryKeys.importJobs.all(userId),
                    exact: true,
                });
            }
        },
    });
}
