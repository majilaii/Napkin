/**
 * useAddEntryPhoto / useRemoveEntryPhoto
 *
 * Photo add/remove for existing entries (flesh-out flow on entry-detail).
 * Uses the existing compressAndUpload pipeline + append_entry_photo RPC via
 * the entry edge function (server-side sort_order computation — TICKET-037 P1-1).
 * No reorder in v1 (sort_order is immutable per migration comment).
 *
 * The rewritten append/delete RPCs update entries.photo_url and bind/unbind the
 * entry_photo + entry_hero refs in the same transaction.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { compressAndUpload } from '@/lib/imageUpload';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/providers/AuthProvider';

// Local query key for the entry-photos list (mirrors entry-detail's useEntryPhotos)
export const entryPhotosKey = (entryId: string) => ['entry-photos', entryId] as const;

function patchEntryHeroCaches(
    qc: ReturnType<typeof useQueryClient>,
    entryId: string,
    heroUrl: string | null,
): void {
    qc.setQueryData<any>(queryKeys.entries.detail(entryId), (old: any) =>
        old ? { ...old, photo_url: heroUrl } : old,
    );
    const patchHero = (row: any) =>
        row?.id === entryId ? { ...row, photo_url: heroUrl } : row;
    qc.setQueriesData<any>({ queryKey: queryKeys.feed.rootAll() }, (data: any) => {
        if (!data) return data;
        if (data.pages) {
            return {
                ...data,
                pages: data.pages.map((page: any) => ({
                    ...page,
                    rows: (page.rows ?? []).map(patchHero),
                })),
            };
        }
        return data.entries
            ? { ...data, entries: data.entries.map(patchHero) }
            : data;
    });
    qc.setQueriesData<any>(
        { queryKey: queryKeys.tables.activityAll() },
        (data: any) => !data?.pages ? data : {
            ...data,
            pages: data.pages.map((page: any) => ({
                ...page,
                rows: (page.rows ?? []).map(patchHero),
            })),
        },
    );
}

// ── Add photo ─────────────────────────────────────────────────────────────────

interface AddPhotoInput {
    localUri: string;
    userId: string;
}

export interface AppendedEntryPhoto {
    publicUrl: string;
    sortOrder: number;
    heroUrl: string | null;
}

/** Shared B-1 writer used by entry detail and the Round photo pool. */
export async function appendModeratedEntryPhoto(
    entryId: string,
    localUri: string,
    userId: string,
): Promise<AppendedEntryPhoto> {
    const publicUrl = await compressAndUpload(localUri, userId);
    const row = await callEdgeFn<{
        sort_order: number;
        photo_url: string;
        hero_url: string | null;
    } | null>(
        'entry',
        {
            action: 'append_entry_photo',
            body: { entry_id: entryId, photo_url: publicUrl },
        },
    );
    if (
        !row
        || typeof row.photo_url !== 'string'
        || !Number.isInteger(row.sort_order)
        || (row.hero_url !== null && typeof row.hero_url !== 'string')
    ) {
        throw new Error('append_entry_photo returned an invalid result');
    }
    return {
        publicUrl: row.photo_url,
        sortOrder: row.sort_order,
        heroUrl: row.hero_url,
    };
}

export function useAddEntryPhoto(entryId: string) {
    const qc = useQueryClient();

    return useMutation({
        mutationFn: ({ localUri, userId }: AddPhotoInput) =>
            appendModeratedEntryPhoto(entryId, localUri, userId),

        onMutate: async () => {
            const key = entryPhotosKey(entryId);
            await qc.cancelQueries({ queryKey: key });
            return { previous: qc.getQueryData(key) };
        },

        onError: (_error, _input, context) => {
            if (context?.previous !== undefined) {
                qc.setQueryData(entryPhotosKey(entryId), context.previous);
            }
        },

        onSuccess: async ({ heroUrl }) => {
            // Invalidate the entry-photos cache so carousel refreshes
            await qc.invalidateQueries({ queryKey: entryPhotosKey(entryId) });
            // The writer returns the authoritative hero. This also covers an
            // entry whose hero was null despite already having photo rows.
            patchEntryHeroCaches(qc, entryId, heroUrl);
        },
    });
}

// ── Remove photo ──────────────────────────────────────────────────────────────

interface RemovePhotoInput {
    photoId: string;
    photoUrl: string;
    /** Whether this photo is the current hero (entries.photo_url matches) */
    isHero: boolean;
}

export function useRemoveEntryPhoto(entryId: string) {
    const qc = useQueryClient();
    const { user } = useAuth();

    return useMutation({
        mutationFn: async ({ photoId, photoUrl }: RemovePhotoInput) => {
            const result = await callEdgeFn<{
                deleted: boolean;
                entry_id: string;
                hero_url: string | null;
            } | null>('entry', {
                action: 'delete_entry_photo',
                body: { photo_id: photoId },
            });
            if (
                !result
                || result.deleted !== true
                || result.entry_id !== entryId
                || (result.hero_url !== null && typeof result.hero_url !== 'string')
            ) {
                throw new Error('delete_entry_photo returned an invalid result');
            }
            return { removedUrl: photoUrl, heroUrl: result.hero_url };
        },

        onMutate: async ({ photoId }) => {
            const key = entryPhotosKey(entryId);
            await qc.cancelQueries({ queryKey: key });
            const previous = qc.getQueryData<any[]>(key);
            qc.setQueryData<any[]>(key, (rows) =>
                rows ? rows.filter((row) => row?.id !== photoId) : rows,
            );
            return { previous };
        },

        onError: (_error, _input, context) => {
            if (context?.previous !== undefined) {
                qc.setQueryData(entryPhotosKey(entryId), context.previous);
            }
        },

        onSuccess: async ({ heroUrl }) => {
            // Invalidate entry-photos cache so carousel reflects removal
            await qc.invalidateQueries({ queryKey: entryPhotosKey(entryId) });

            // TICKET-144 review fix (P2): the deleted photo may have been a Top-4
            // chosen-memory hero — the FK already SET NULLed it server-side, so
            // refetch the own profile to drop the dangling hero_entry_photo_id
            // from the Top-4 editor's seed (a stale id re-sent on the next save
            // would otherwise fail it). Self profile cache is keyed by user id
            // (same narrow invalidation as useSetProfileTopFour / useDeleteEntry).
            if (user?.id) {
                qc.invalidateQueries({ queryKey: queryKeys.users.profile(user.id) });
            }

            // The delete RPC returns the authoritative hero whether or not the
            // caller's stale `isHero` hint was right.
            patchEntryHeroCaches(qc, entryId, heroUrl);
        },
    });
}
