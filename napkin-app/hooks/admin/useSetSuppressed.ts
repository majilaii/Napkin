/**
 * useSetSuppressed — toggles the suppressed flag on a critic review.
 * TICKET-033 / TICKET-036 mutation doctrine.
 *
 * Optimistic patch (P1-7 ARCH-REVIEW):
 *   useCursorPagedQuery produces InfiniteData<Page<CriticAdminRow>>.
 *   onMutate must walk data.pages[].rows to flip the matched row.
 *   Snapshot the full InfiniteData for rollback on error.
 *
 * Calls critics-admin?action=set_suppressed.
 * After success, reconciles the row in-place with the server's authoritative
 * audit timestamps — no full invalidation (TICKET-036 rule 4).
 */

import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { CriticAdminRow, SetSuppressedResult } from '@/types/admin';
import type { Page } from '@/lib/pagination';

export interface SetSuppressedInput {
    review_id: string;
    suppressed: boolean;
    reason?: string;
}

type CriticsInfiniteData = InfiniteData<Page<CriticAdminRow>>;

export function useSetSuppressed() {
    const queryClient = useQueryClient();
    const listKey = queryKeys.admin.criticsList();

    return useMutation({
        mutationFn: (input: SetSuppressedInput) =>
            callEdgeFn<SetSuppressedResult>('critics-admin', {
                action: 'set_suppressed',
                body: input,
            }),

        onMutate: async (input) => {
            await queryClient.cancelQueries({ queryKey: listKey });
            const previous = queryClient.getQueryData<CriticsInfiniteData>(listKey);

            if (previous) {
                const optimistic: CriticsInfiniteData = {
                    ...previous,
                    pages: previous.pages.map((page) => ({
                        ...page,
                        rows: page.rows.map((row) => {
                            if (row.id !== input.review_id) return row;
                            if (input.suppressed) {
                                return {
                                    ...row,
                                    suppressed: true,
                                    suppression_reason: input.reason ?? null,
                                    // Optimistic timestamps — server will correct on success
                                    suppressed_at: new Date().toISOString(),
                                    suppressed_by: null,
                                };
                            } else {
                                return {
                                    ...row,
                                    suppressed: false,
                                    suppression_reason: null,
                                    suppressed_at: null,
                                    suppressed_by: null,
                                };
                            }
                        }),
                    })),
                };
                queryClient.setQueryData(listKey, optimistic);
            }

            return { previous };
        },

        onError: (_err, _input, ctx) => {
            // Restore previous cache state on any error
            if (ctx?.previous !== undefined) {
                queryClient.setQueryData(listKey, ctx.previous);
            }
        },

        onSuccess: (result, input) => {
            // Reconcile with the server's authoritative audit timestamps.
            // Walk pages and patch only the affected row — no full invalidation.
            queryClient.setQueryData<CriticsInfiniteData>(listKey, (old) => {
                if (!old) return old;
                return {
                    ...old,
                    pages: old.pages.map((page) => ({
                        ...page,
                        rows: page.rows.map((row) => {
                            if (row.id !== input.review_id) return row;
                            return {
                                ...row,
                                suppressed: result.suppressed,
                                suppressed_by: result.suppressed_by,
                                suppressed_at: result.suppressed_at,
                                suppression_reason: result.suppression_reason,
                            };
                        }),
                    })),
                };
            });
        },
    });
}
