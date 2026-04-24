/**
 * useAddEntryPhoto / useRemoveEntryPhoto
 *
 * Photo add/remove for existing entries (flesh-out flow on entry-detail).
 * Uses the existing compressAndUpload pipeline + append_entry_photo RPC via
 * the entry edge function (server-side sort_order computation — TICKET-037 P1-1).
 * No reorder in v1 (sort_order is immutable per migration comment).
 *
 * Hero denorm: entries.photo_url is kept in sync via useUpdateEntry PATCH
 * after the entry_photos write — photo write first, then hero sync, so
 * the carousel is always correct even if the hero patch fails.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { compressAndUpload, removeUploadedPhoto } from '@/lib/imageUpload';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { useUpdateEntry } from './useUpdateEntry';

// Local query key for the entry-photos list (mirrors entry-detail's useEntryPhotos)
export const entryPhotosKey = (entryId: string) => ['entry-photos', entryId] as const;

// ── Add photo ─────────────────────────────────────────────────────────────────

interface AddPhotoInput {
    localUri: string;
    userId: string;
}

export function useAddEntryPhoto(entryId: string) {
    const qc = useQueryClient();
    const updateEntry = useUpdateEntry(entryId);

    return useMutation({
        mutationFn: async ({ localUri, userId }: AddPhotoInput) => {
            // 1. Compress + upload to storage
            const publicUrl = await compressAndUpload(localUri, userId);

            // 2. Delegate sort_order computation to the server RPC via edge function
            try {
                const row = await callEdgeFn<{ sort_order: number; photo_url: string } | null>(
                    'entry',
                    {
                        action: 'append_entry_photo',
                        body: { entry_id: entryId, photo_url: publicUrl },
                    },
                );
                return { publicUrl, sortOrder: row?.sort_order ?? 0 };
            } catch (err) {
                // Clean up orphaned storage on insert failure
                removeUploadedPhoto(publicUrl).catch(() => { });
                throw err;
            }
        },

        onSuccess: async ({ publicUrl, sortOrder }) => {
            // Invalidate the entry-photos cache so carousel refreshes
            await qc.invalidateQueries({ queryKey: entryPhotosKey(entryId) });

            // If this is the first photo (sort_order = 0), sync entries.photo_url hero
            if (sortOrder === 0) {
                updateEntry.mutate({ photo_url: publicUrl });
            }
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
    const updateEntry = useUpdateEntry(entryId);

    return useMutation({
        mutationFn: async ({ photoId, photoUrl }: RemovePhotoInput) => {
            // 1. Delete entry_photos row
            const { error } = await supabase
                .from('entry_photos')
                .delete()
                .eq('id', photoId);

            if (error) throw error;

            // 2. Clean up storage (best-effort; ignore errors)
            removeUploadedPhoto(photoUrl).catch(() => {});

            return { removedUrl: photoUrl };
        },

        onSuccess: async (_result, { isHero }) => {
            // Invalidate entry-photos cache so carousel reflects removal
            await qc.invalidateQueries({ queryKey: entryPhotosKey(entryId) });

            if (isHero) {
                // Fetch the new first photo (if any) to update hero denorm
                const { data: remaining } = await supabase
                    .from('entry_photos')
                    .select('photo_url')
                    .eq('entry_id', entryId)
                    .order('sort_order', { ascending: true })
                    .limit(1);

                const newHero = remaining && remaining.length > 0 ? remaining[0].photo_url : null;
                updateEntry.mutate({ photo_url: newHero });
            }
        },
    });
}
