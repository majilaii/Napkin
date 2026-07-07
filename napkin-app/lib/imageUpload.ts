/**
 * imageUpload.ts
 *
 * Client-side image compression + Supabase Storage upload. All binary data stays
 * on device — the edge function only receives a URL string.
 *
 * Two callers, two buckets (different visibility models, never shared):
 *   - compressAndUpload       → entry-photos/{userId}/{ts}.jpg — meal photos,
 *                               longest edge ≤ 1024.
 *   - compressAndUploadAvatar → avatars/{userId}/{ts}.jpg — profile photos,
 *                               square-cropped to 512² (TICKET-126).
 * Both share the upload tail (size guard → decode → upload → public URL) via
 * uploadJpegBase64; the compression strategy is the only difference.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';
import { pickAvatarResize, computeCenterCrop } from '@/lib/avatarCrop';

const BUCKET = 'entry-photos';
const AVATAR_BUCKET = 'avatars';
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

// ── Shared upload tail ──────────────────────────────────────────────────────

/**
 * Size-guard a compressed base64 JPEG, decode it, upload to `{bucket}/{userId}/{ts}.jpg`
 * (own-folder RLS), and return the public URL. Shared by both compression paths.
 */
async function uploadJpegBase64(
    base64: string,
    bucket: string,
    userId: string,
): Promise<string> {
    // ── Size guard ────────────────────────────────────────────────────────
    const byteLength = (base64.length * 3) / 4; // approximate
    if (byteLength > MAX_BYTES_POST_COMPRESSION) {
        throw new PhotoUploadError(
            'too_large',
            `Photo is too large after compression (${(byteLength / (1024 * 1024)).toFixed(1)} MB). Max is 5 MB.`
        );
    }

    // ── Upload ────────────────────────────────────────────────────────────
    const filename = `${userId}/${Date.now()}.jpg`;
    const arrayBuffer = decode(base64);

    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filename, arrayBuffer, {
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
    const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
    return data.publicUrl;
}

// ── Entry photos ────────────────────────────────────────────────────────────

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
                base64: true,
            }
        );
    } catch (err) {
        throw new PhotoUploadError(
            'compression_failed',
            `Image compression failed: ${String(err)}`
        );
    }

    if (!compressed.base64) {
        throw new PhotoUploadError(
            'compression_failed',
            'Compressed image did not return base64 data'
        );
    }

    return uploadJpegBase64(compressed.base64, BUCKET, userId);
}

// ── Avatars (TICKET-126) ─────────────────────────────────────────────────────

/**
 * Compress + square-crop a local image URI to AVATAR_SIZE² JPEG, then upload to
 * the `avatars` bucket. Resizes the shortest edge to AVATAR_SIZE first (native,
 * aspect-preserving), reads the ACTUAL result dimensions, then centre-crops off
 * those (see avatarCrop.ts) so a native rounding drift can't crop past the edge.
 *
 * @param uri      Local file URI (e.g. from expo-image-picker)
 * @param userId   The authenticated user's UUID — determines storage path
 * @returns        Public URL of the uploaded avatar
 */
export async function compressAndUploadAvatar(uri: string, userId: string): Promise<string> {
    let cropped: ImageManipulator.ImageResult;
    try {
        const probe = await ImageManipulator.manipulateAsync(uri, [], {});
        // 1) Resize shortest edge → AVATAR_SIZE (aspect preserved).
        const resized = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: pickAvatarResize(probe.width, probe.height) }],
            {}
        );
        // 2) Centre-crop a square off the REAL resized dimensions.
        const crop = computeCenterCrop(resized.width, resized.height);
        cropped = await ImageManipulator.manipulateAsync(
            resized.uri,
            [{ crop }],
            {
                compress: JPEG_QUALITY,
                format: ImageManipulator.SaveFormat.JPEG,
                base64: true,
            }
        );
    } catch (err) {
        throw new PhotoUploadError(
            'compression_failed',
            `Avatar compression failed: ${String(err)}`
        );
    }

    if (!cropped.base64) {
        throw new PhotoUploadError(
            'compression_failed',
            'Cropped avatar did not return base64 data'
        );
    }

    return uploadJpegBase64(cropped.base64, AVATAR_BUCKET, userId);
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

    await supabase.storage.from(bucket).remove([storagePath]);
}
