/**
 * imageUpload.ts
 *
 * Client-side image compression + Supabase Storage upload for entry photos.
 * All binary data stays on device — the edge function only receives a URL string.
 *
 * Storage path: entry-photos/{userId}/{timestamp}.jpg
 * Bucket: entry-photos (public read, authenticated write to own folder)
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';

const BUCKET = 'entry-photos';
const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;
const MAX_BYTES_POST_COMPRESSION = 5 * 1024 * 1024; // 5 MB

// ── Error class ───────────────────────────────────────────────────────────────

export type PhotoUploadErrorCode = 'compression_failed' | 'too_large' | 'upload_failed';

export class PhotoUploadError extends Error {
    code: PhotoUploadErrorCode;

    constructor(code: PhotoUploadErrorCode, message: string) {
        super(message);
        this.name = 'PhotoUploadError';
        this.code = code;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compress a local image URI to at most MAX_DIMENSION on its longest edge,
 * at JPEG_QUALITY, then upload to Supabase Storage.
 *
 * @param uri      Local file URI (e.g. from expo-image-picker)
 * @param userId   The authenticated user's UUID — determines storage path
 * @returns        Public URL of the uploaded file
 */
export async function compressAndUpload(uri: string, userId: string): Promise<string> {
    // ── Compress ──────────────────────────────────────────────────────────
    // Determine which axis to constrain so the longest edge is MAX_DIMENSION.
    // First pass: get original dimensions without resizing.
    let compressed: ImageManipulator.ImageResult;
    try {
        const probe = await ImageManipulator.manipulateAsync(uri, [], {});
        const isPortrait = probe.height > probe.width;
        const resize = isPortrait
            ? { height: MAX_DIMENSION }
            : { width: MAX_DIMENSION };

        compressed = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize }],
            {
                compress: JPEG_QUALITY,
                format: ImageManipulator.SaveFormat.JPEG,
            }
        );
    } catch (err) {
        throw new PhotoUploadError(
            'compression_failed',
            `Image compression failed: ${String(err)}`
        );
    }

    // ── Fetch as blob ─────────────────────────────────────────────────────
    let blob: Blob;
    try {
        const response = await fetch(compressed.uri);
        blob = await response.blob();
    } catch (err) {
        throw new PhotoUploadError(
            'compression_failed',
            `Could not read compressed image: ${String(err)}`
        );
    }

    // ── Size guard ────────────────────────────────────────────────────────
    if (blob.size > MAX_BYTES_POST_COMPRESSION) {
        throw new PhotoUploadError(
            'too_large',
            `Photo is too large after compression (${(blob.size / (1024 * 1024)).toFixed(1)} MB). Max is 5 MB.`
        );
    }

    // ── Upload ────────────────────────────────────────────────────────────
    const filename = `${userId}/${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filename, blob, {
            contentType: 'image/jpeg',
            upsert: false,
        });

    if (uploadError) {
        throw new PhotoUploadError(
            'upload_failed',
            `Upload failed: ${uploadError.message}`
        );
    }

    // ── Return public URL ─────────────────────────────────────────────────
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
    return data.publicUrl;
}

/**
 * Remove a previously uploaded photo from Supabase Storage.
 * Extracts the storage path from the public URL.
 * Silently no-ops if the URL is not in the expected format.
 */
export async function removeUploadedPhoto(publicUrl: string): Promise<void> {
    // Public URL shape: {supabaseUrl}/storage/v1/object/public/{bucket}/{path}
    const marker = `/object/public/${BUCKET}/`;
    const idx = publicUrl.indexOf(marker);
    if (idx === -1) return;

    const storagePath = publicUrl.slice(idx + marker.length);
    if (!storagePath) return;

    await supabase.storage.from(BUCKET).remove([storagePath]);
}
