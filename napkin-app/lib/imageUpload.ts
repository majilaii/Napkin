/**
 * imageUpload.ts
 *
 * Compatibility wrappers around the mandatory moderated staging flow.
 *
 * Existing callers keep their string-returning API, but bytes now travel only
 * through image-staging and the returned URL is always a moderated approved
 * object. `userId` remains in the signature for source compatibility; ownership
 * is derived from the JWT by the server, never from this argument.
 */

import { supabase } from '@/lib/supabase';
import { stageAndModerate } from '@/lib/imageStaging';

export {
    PhotoUploadError,
    isModerationRejected,
} from '@/lib/imageStaging';
export type { PhotoUploadErrorCode } from '@/lib/imageStaging';

const BUCKET = 'entry-photos';
const AVATAR_BUCKET = 'avatars';
// ── Entry photos ────────────────────────────────────────────────────────────

/**
 * Compress a local image URI to a bounded JPEG, stage it privately, and return
 * the approved entry-photo URL after moderation.
 *
 * @param uri      Local file URI (e.g. from expo-image-picker)
 * @param userId   Kept for caller compatibility; the server derives ownership.
 * @returns        Public URL of the approved object
 */
export async function compressAndUpload(uri: string, userId: string): Promise<string> {
    void userId;
    const result = await stageAndModerate(uri, 'entry_photo');
    return result.approved_url;
}

// ── Avatars (TICKET-126) ─────────────────────────────────────────────────────

/**
 * Compress + square-crop a local image URI to AVATAR_SIZE² JPEG, then stage and
 * moderate it for the `avatars` bucket. Resizes the shortest edge first (native,
 * aspect-preserving), reads the ACTUAL result dimensions, then centre-crops off
 * those (see avatarCrop.ts) so a native rounding drift can't crop past the edge.
 *
 * @param uri      Local file URI (e.g. from expo-image-picker)
 * @param userId   Kept for caller compatibility; the server derives ownership.
 * @returns        Public URL of the approved avatar
 */
export async function compressAndUploadAvatar(uri: string, userId: string): Promise<string> {
    void userId;
    const result = await stageAndModerate(uri, 'avatar');
    return result.approved_url;
}

/**
 * Remove a previously uploaded photo from Supabase Storage.
 * Extracts the storage path from the public URL.
 * Silently no-ops if the URL is not in the expected format.
 */
export async function removeUploadedPhoto(publicUrl: string): Promise<void> {
    return removeFromBucket(publicUrl, BUCKET);
}

/** Avatar variant of removeUploadedPhoto — same URL parsing, avatars bucket. */
export async function removeUploadedAvatar(publicUrl: string): Promise<void> {
    return removeFromBucket(publicUrl, AVATAR_BUCKET);
}

async function removeFromBucket(publicUrl: string, bucket: string): Promise<void> {
    // Public URL shape: {supabaseUrl}/storage/v1/object/public/{bucket}/{path}
    const marker = `/object/public/${bucket}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return;

    const storagePath = publicUrl.slice(idx + marker.length);
    if (!storagePath) return;

    // Approved objects are service-owned. Sink writers unbind them and the
    // fenced GC saga removes bytes after the last ref; clients must not race it.
    if (storagePath.startsWith('approved/')) return;

    await supabase.storage.from(bucket).remove([storagePath]);
}
