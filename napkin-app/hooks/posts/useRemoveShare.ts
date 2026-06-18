/**
 * useRemoveShare — author retracts their own shared_save card from a Table feed.
 *
 * Calls the table-shares `remove_share` action (author-only soft-delete; the server
 * gate is authoritative). Optimistically removes the shared_save row from the Table
 * activity cache so the card disappears immediately; rolls back on error.
 *
 * This is the orphaned-share fix: a share posted from a wishlist import had no
 * un-share path, so delisting left the card forever. Now the author can remove it.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface RemoveShareInput {
    shareId: string;
}

/** Drop a shared_save row (matched by shareId) from an infinite { pages:[{rows}] }
 *  table-activity cache. */
function removeShareFromInfinite(data: any, shareId: string): any {
    if (!data?.pages) return data;
    return {
        ...data,
        pages: data.pages.map((p: any) =>
            p?.rows
                ? {
                      ...p,
                      // Only prune the single-share card. A share_digest may contain
                      // OTHER live children, so removing one child must not drop the
                      // whole digest — the onSettled refetch reconciles it correctly.
                      rows: p.rows.filter(
                          (r: any) =>
                              !(
                                  r?.type === 'shared_save' &&
                                  (r?.shareId === shareId || r?.id === shareId)
                              ),
                      ),
                  }
                : p,
        ),
    };
}

export function useRemoveShare() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ shareId }: RemoveShareInput) => {
            return callEdgeFn('table-shares', {
                action: 'remove_share',
                body: { share_id: shareId },
            });
        },

        onMutate: async ({ shareId }: RemoveShareInput) => {
            const activityKey = queryKeys.tables.activityAll();
            await qc.cancelQueries({ queryKey: activityKey });
            const prev = qc.getQueriesData({ queryKey: activityKey });
            qc.setQueriesData<any>({ queryKey: activityKey }, (d: any) =>
                removeShareFromInfinite(d, shareId),
            );
            return { prev };
        },

        onError: (_err, _input, ctx) => {
            ctx?.prev?.forEach(([k, d]: any) => qc.setQueryData(k, d));
        },

        onSettled: () => {
            qc.invalidateQueries({ queryKey: queryKeys.tables.activityAll() });
        },
    });
}
