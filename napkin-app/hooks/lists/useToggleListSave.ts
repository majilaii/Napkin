/**
 * Optimistically save or unsave one public list.
 *
 * Cache contract:
 *   - snapshot the exact detail + caller's saved-list collection
 *   - patch both immediately
 *   - restore both on failure
 *   - reconcile the server-owned saved flag/count on success
 *
 * This never mutates wishlist caches: saving an authored list and pinning its
 * individual restaurants are separate user decisions.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { FetchResult, ListDetailData } from './useList';
import type { SavedList } from './useSavedLists';

export interface ToggleListSaveInput {
    list_id: string;
    /** Desired state, not the current state. */
    next_saved: boolean;
}

export interface ToggleListSaveResult {
    list_id: string;
    saved: boolean;
    /** Privacy-safe unsaves may omit the aggregate after deleting the row. */
    save_count?: number;
}

interface ToggleContext {
    detailKey: ReturnType<typeof queryKeys.lists.detail>;
    savedKey: ReturnType<typeof queryKeys.lists.saved>;
    previousDetail: FetchResult | undefined;
    previousSaved: SavedList[] | undefined;
}

async function toggleListSave(input: ToggleListSaveInput): Promise<ToggleListSaveResult> {
    return callEdgeFn<ToggleListSaveResult>('lists', {
        action: input.next_saved ? 'save_list' : 'unsave_list',
        body: { list_id: input.list_id },
    });
}

function optimisticSaveCount(detail: ListDetailData, nextSaved: boolean): number {
    if (detail.viewer_has_saved === nextSaved) return detail.save_count;
    return Math.max(0, detail.save_count + (nextSaved ? 1 : -1));
}

function toSavedList(detail: ListDetailData, savedAt: string): SavedList | null {
    if (detail.list.privacy !== 'public') return null;

    return {
        id: detail.list.id,
        owner_id: detail.list.owner_id,
        title: detail.list.title,
        description: detail.list.description,
        ranked: detail.list.ranked,
        privacy: 'public',
        emoji: detail.list.emoji,
        created_at: detail.list.created_at,
        updated_at: detail.list.updated_at,
        saved_at: savedAt,
        entry_count: detail.entries.length,
        save_count: optimisticSaveCount(detail, true),
        cover_photo_url:
            detail.entries.find((entry) => !!entry.restaurant.photo_url)?.restaurant.photo_url ?? null,
        owner_display_name: detail.owner_profile.display_name,
        owner_avatar_url: detail.owner_profile.avatar_url,
        owner_username: detail.owner_profile.username,
    };
}

function patchDetail(
    previous: FetchResult | undefined,
    saved: boolean,
    authoritativeCount?: number,
): FetchResult | undefined {
    if (!previous?.data) return previous;

    return {
        ...previous,
        data: {
            ...previous.data,
            viewer_has_saved: saved,
            save_count:
                authoritativeCount ?? optimisticSaveCount(previous.data, saved),
        },
    };
}

function patchSavedCollection(
    previous: SavedList[] | undefined,
    listId: string,
    saved: boolean,
    optimisticRow: SavedList | null,
    authoritativeCount?: number,
): SavedList[] | undefined {
    if (!saved) return previous?.filter((list) => list.id !== listId) ?? [];

    const existing = previous?.find((list) => list.id === listId);
    const row = existing ?? optimisticRow;
    if (!row) return previous;

    const reconciled = authoritativeCount === undefined
        ? row
        : { ...row, save_count: authoritativeCount };
    const remaining = previous?.filter((list) => list.id !== listId) ?? [];
    return [reconciled, ...remaining];
}

export function useToggleListSave(userId: string | null | undefined) {
    const queryClient = useQueryClient();

    return useMutation<ToggleListSaveResult, Error, ToggleListSaveInput, ToggleContext>({
        mutationFn: toggleListSave,

        onMutate: async ({ list_id, next_saved }) => {
            const detailKey = queryKeys.lists.detail(list_id);
            const savedKey = queryKeys.lists.saved(userId ?? '');

            await Promise.all([
                queryClient.cancelQueries({ queryKey: detailKey }),
                queryClient.cancelQueries({ queryKey: savedKey }),
            ]);

            const previousDetail = queryClient.getQueryData<FetchResult>(detailKey);
            const previousSaved = queryClient.getQueryData<SavedList[]>(savedKey);
            const optimisticRow = previousDetail?.data
                ? toSavedList(previousDetail.data, new Date().toISOString())
                : null;

            queryClient.setQueryData<FetchResult>(
                detailKey,
                (previous) => patchDetail(previous, next_saved),
            );
            queryClient.setQueryData<SavedList[]>(
                savedKey,
                (previous) => patchSavedCollection(
                    previous,
                    list_id,
                    next_saved,
                    optimisticRow,
                ),
            );

            return { detailKey, savedKey, previousDetail, previousSaved };
        },

        onError: (_error, _input, context) => {
            if (!context) return;

            if (context.previousDetail === undefined) {
                queryClient.removeQueries({ queryKey: context.detailKey, exact: true });
            } else {
                queryClient.setQueryData(context.detailKey, context.previousDetail);
            }

            if (context.previousSaved === undefined) {
                queryClient.removeQueries({ queryKey: context.savedKey, exact: true });
            } else {
                queryClient.setQueryData(context.savedKey, context.previousSaved);
            }
        },

        onSuccess: (result, _input, context) => {
            if (!context) return;

            queryClient.setQueryData<FetchResult>(
                context.detailKey,
                (previous) => patchDetail(previous, result.saved, result.save_count),
            );

            const detail = queryClient.getQueryData<FetchResult>(context.detailKey)?.data;
            const reconciledRow = detail
                ? toSavedList(detail, new Date().toISOString())
                : null;
            let couldReconcileSaved = false;
            queryClient.setQueryData<SavedList[]>(context.savedKey, (previous) => {
                couldReconcileSaved = !result.saved
                    || !!previous?.some((list) => list.id === result.list_id)
                    || !!reconciledRow;
                return patchSavedCollection(
                    previous,
                    result.list_id,
                    result.saved,
                    reconciledRow,
                    result.save_count,
                );
            });

            // Saving from a surface without a cached detail cannot synthesize
            // the authored-list row. Refetch only this caller's collection.
            if (!couldReconcileSaved) {
                queryClient.invalidateQueries({ queryKey: context.savedKey });
            }
        },
    });
}
