/**
 * useRemoveShare — author retracts their own shared_save card(s) from a Table feed.
 *
 * Calls the table-shares `remove_share` action (author-only soft-delete; the server
 * gate is authoritative). Accepts a single `shareId` or a `shareIds` batch — the
 * "dropped N spots" digest retract sends all its child ids at once. Optimistically
 * prunes the shared_save rows AND patches/removes affected share_digest rows in the
 * Table activity cache so cards disappear immediately; rolls back on error.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface RemoveShareInput {
    shareId?: string;
    shareIds?: string[];
}

function inputIds(input: RemoveShareInput): string[] {
    if (input.shareIds && input.shareIds.length > 0) return input.shareIds;
    return input.shareId ? [input.shareId] : [];
}

/** Drop removed shared_save rows and patch share_digest rows in an infinite
 *  { pages:[{rows}] } table-activity cache. A digest whose children are ALL
 *  removed disappears; a partially-removed digest keeps its remaining children
 *  with corrected count (the onSettled refetch reconciles server-side buckets). */
function pruneSharesFromInfinite(data: any, ids: Set<string>): any {
    if (!data?.pages) return data;
    return {
        ...data,
        pages: data.pages.map((p: any) => {
            if (!p?.rows) return p;
            const rows = p.rows
                .map((r: any) => {
                    if (r?.type === 'shared_save' && (ids.has(r?.shareId) || ids.has(r?.id))) {
                        return null;
                    }
                    if (r?.type === 'share_digest' && Array.isArray(r?.child_ids)) {
                        const remaining = r.child_ids.filter((cid: string) => !ids.has(cid));
                        if (remaining.length === r.child_ids.length) return r;
                        if (remaining.length === 0) return null;
                        return {
                            ...r,
                            child_ids: remaining,
                            share_count: remaining.length,
                            childShares: Array.isArray(r.childShares)
                                ? r.childShares.filter((c: any) => !ids.has(c?.shareId))
                                : r.childShares,
                        };
                    }
                    return r;
                })
                .filter(Boolean);
            return { ...p, rows };
        }),
    };
}

export function useRemoveShare() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async (input: RemoveShareInput) => {
            const ids = inputIds(input);
            if (ids.length === 0) throw new Error('shareId or shareIds is required');
            return callEdgeFn('table-shares', {
                action: 'remove_share',
                // Single-id calls keep the legacy share_id body for deploy skew.
                body: ids.length === 1 ? { share_id: ids[0] } : { share_ids: ids },
            });
        },

        onMutate: async (input: RemoveShareInput) => {
            const ids = new Set(inputIds(input));
            const activityKey = queryKeys.tables.activityAll();
            await qc.cancelQueries({ queryKey: activityKey });
            const prev = qc.getQueriesData({ queryKey: activityKey });
            qc.setQueriesData<any>({ queryKey: activityKey }, (d: any) =>
                pruneSharesFromInfinite(d, ids),
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
