/**
 * imageDownscale.ts — client-side image normalization for multimodal import.
 * TICKET-060 R9/M1.
 *
 * Downscales an image to ≤768px long edge, normalizes to JPEG at fixed quality.
 * Used before upload to the import-uploads Storage bucket.
 * Server also re-clamps server-side (defense-in-depth M1).
 *
 * Returns: { uri, base64 } — uri for display; base64 for the Storage upload.
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';
import { supabase } from '@/lib/supabase';

export const IMPORT_MAX_DIMENSION = 768;  // ≤768px long edge per TICKET-060 spec
const IMPORT_JPEG_QUALITY = 0.85;
const IMPORT_BUCKET = 'import-uploads';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DownscaleResult {
    uri: string;
    base64: string;
    width: number;
    height: number;
}

export interface UploadResult {
    storagePath: string;   // e.g. "userId/uuid.jpg" — relative path within the bucket
}

// ── Downscale ─────────────────────────────────────────────────────────────────

/**
 * Downscale and normalize an image to ≤768px long edge, JPEG output.
 * Returns uri + base64 for the normalized image.
 */
export async function downscaleImage(uri: string): Promise<DownscaleResult> {
    // First probe the original dimensions
    const probe = await ImageManipulator.manipulateAsync(uri, [], {});
    const isPortrait = probe.height > probe.width;
    const longestEdge = Math.max(probe.width, probe.height);

    // Only resize if needed (don't upscale)
    const actions: ImageManipulator.Action[] = [];
    if (longestEdge > IMPORT_MAX_DIMENSION) {
        const resize = isPortrait
            ? { height: IMPORT_MAX_DIMENSION }
            : { width: IMPORT_MAX_DIMENSION };
        actions.push({ resize });
    }

    const result = await ImageManipulator.manipulateAsync(uri, actions, {
        compress: IMPORT_JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
    });

    if (!result.base64) {
        throw new Error('Image downscale failed: no base64 output');
    }

    return {
        uri: result.uri,
        base64: result.base64,
        width: result.width,
        height: result.height,
    };
}

// ── Upload ────────────────────────────────────────────────────────────────────

/**
 * Upload a downscaled JPEG to the import-uploads Storage bucket.
 * Returns the storage path (relative to bucket root).
 * Path: "{userId}/{timestamp}-{random}.jpg"
 */
export async function uploadImportImage(
    base64: string,
    userId: string,
): Promise<UploadResult> {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const storagePath = `${userId}/${timestamp}-${rand}.jpg`;
    const arrayBuffer = decode(base64);

    const { error: uploadError } = await supabase.storage
        .from(IMPORT_BUCKET)
        .upload(storagePath, arrayBuffer, {
            contentType: 'image/jpeg',
            upsert: false,
        });

    if (uploadError) {
        throw new Error(`Import image upload failed: ${uploadError.message}`);
    }

    return { storagePath };
}

/**
 * Convenience: downscale + upload in one call.
 * Returns the storage path for use in create_import body.
 */
export async function downscaleAndUpload(
    uri: string,
    userId: string,
): Promise<{ storagePath: string; uri: string }> {
    const downscaled = await downscaleImage(uri);
    const { storagePath } = await uploadImportImage(downscaled.base64, userId);
    return { storagePath, uri: downscaled.uri };
}
