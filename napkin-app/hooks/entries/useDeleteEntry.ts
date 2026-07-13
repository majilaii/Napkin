/**
 * useDeleteEntry — delete the viewer's own review (entry).
 *
 * Authorization + child cleanup are already in the DB: the `entries_delete_own`
 * RLS policy (auth.uid() = user_id) gates the delete, and every entry-child table
 * (entry_photos, entry_companions, entry_participants, entry_tables, round_entries,
 * post_reactions/comments via trigger) is ON DELETE CASCADE. So this is a direct
 * supabase-js delete — no edge function needed.
 *
 * Two things the DB cascade does NOT handle, done here:
 *  1. Storage objects — entry_photos ROWS cascade, but the uploaded image files in
 *     the Storage bucket do not. We read the urls and best-effort remove them
 *     before the row delete (mirrors useEntryPhotoMutations).
 *  2. Client caches — optimistically remove the entry from every list it can appear
 *     in (feed, table activity, personal journal), snapshot for rollback, and
 *     reconcile dependent surfaces (restaurant page who's-been, supper detail) on
 *     success. (TICKET-036 lifecycle; envelope-safe — pages are { rows }, never
 *     mapped as arrays — see 5bb6c6d.)
 *
 * supper_id is ON DELETE SET NULL, so deleting one take just drops it from the
 * cluster; the supper + other members' takes are untouched.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import { removeFromArray } from '@/lib/optimistic';
import { removeUploadedPhoto } from '@/lib/imageUpload';
import { invalidateEntryTasteCaches } from './invalidateEntryTaste';

export interface DeleteEntryInput {
    entryId: string;
    /** Author id — used for the personal-journal cache key (== viewer.id). */
    userId: string;
    restaurantId?: string | null;
    supperId?: string | null;
}

/** Remove an entry id from an infinite-query cache, handling both the canonical
 *  { pages: [{ rows }] } envelope and the legacy { entries } shape. */
function removeEntryFromInfinite(data: any, entryId: string): any {
    if (!data) return data;
    if (data.pages) {
        return {
            ...data,
            pages: data.pages.map((p: any) =>
                p?.rows
                    ? { ...p, rows: p.rows.filter((r: any) => r?.id !== entryId) }
                    : p?.entries
                    ? { ...p, entries: p.entries.filter((r: any) => r?.id !== entryId) }
                    : p,
            ),
        };
    }
    if (data.entries) return { ...data, entries: data.entries.filter((r: any) => r?.id !== entryId) };
    return data;
}

export function useDeleteEntry() {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: async ({ entryId }: DeleteEntryInput) => {
            // Best-effort Storage cleanup before the cascade drops the rows.
            try {
                const { data: photos } = await supabase
                    .from('entry_photos')
                    .select('photo_url')
                    .eq('entry_id', entryId);
                await Promise.all(
                    (photos ?? [])
                        .map((p: any) => p.photo_url)
                        .filter(Boolean)
                        .map((url: string) => removeUploadedPhoto(url).catch(() => {})),
                );
            } catch {
                // Non-fatal — orphaned Storage objects are tolerable; the delete must proceed.
            }

            const { error } = await supabase.from('entries').delete().eq('id', entryId);
            if (error) throw error;
            return { entryId };
        },

        onMutate: async ({ entryId, userId }: DeleteEntryInput) => {
            const feedKey = queryKeys.feed.rootAll();
            const activityKey = queryKeys.tables.activityAll();
            const mySoloKey = queryKeys.entries.mySolo(userId);

            await Promise.all([
                qc.cancelQueries({ queryKey: feedKey }),
                qc.cancelQueries({ queryKey: activityKey }),
                qc.cancelQueries({ queryKey: mySoloKey }),
            ]);

            const prevFeed = qc.getQueriesData({ queryKey: feedKey });
            const prevActivity = qc.getQueriesData({ queryKey: activityKey });
            const prevMySolo = qc.getQueryData<any[]>(mySoloKey);

            qc.setQueriesData<any>({ queryKey: feedKey }, (d: any) => removeEntryFromInfinite(d, entryId));
            qc.setQueriesData<any>({ queryKey: activityKey }, (d: any) => removeEntryFromInfinite(d, entryId));
            qc.setQueryData<any[]>(mySoloKey, (arr) =>
                arr ? removeFromArray(arr, (r) => r?.id === entryId) : arr,
            );

            return { prevFeed, prevActivity, prevMySolo, mySoloKey };
        },

        onError: (_err, _input, ctx) => {
            ctx?.prevFeed?.forEach(([k, d]: any) => qc.setQueryData(k, d));
            ctx?.prevActivity?.forEach(([k, d]: any) => qc.setQueryData(k, d));
            if (ctx?.prevMySolo !== undefined) qc.setQueryData(ctx.mySoloKey, ctx.prevMySolo);
        },

        onSuccess: ({ entryId }, { userId, restaurantId, supperId }) => {
            qc.removeQueries({ queryKey: queryKeys.entries.detail(entryId) });
            qc.invalidateQueries({ queryKey: queryKeys.entries.mySolo(userId) });
            // Sibling surfaces the deleted entry also appears on (the optimistic
            // patch above only covers feed/activity/mySolo): the Diary scroll-back,
            // own-profile recents, and this user's restaurant history.
            qc.invalidateQueries({ queryKey: queryKeys.users.diary(userId) });
            invalidateEntryTasteCaches(qc, userId);
            if (restaurantId) {
                qc.invalidateQueries({ queryKey: queryKeys.restaurants.page(restaurantId) });
                qc.invalidateQueries({ queryKey: queryKeys.restaurants.userHistory(restaurantId, userId) });
            }
            if (supperId) {
                qc.invalidateQueries({ queryKey: queryKeys.suppers.detail(supperId) });
            }
        },
    });
}
