/**
 * Moderated image upload pipeline (TICKET-196 B-1).
 *
 * User-selected bytes never go directly to a public bucket. The client first
 * produces a bounded JPEG, then follows the server-owned reservation saga:
 * begin_stage -> raw-byte finish_stage -> moderate. Only the approved public
 * URL returned by the final step may be handed to a sink writer.
 */
import * as ImageManipulator from 'expo-image-manipulator';
import { decode } from 'base64-arraybuffer';

import { computeCenterCrop, pickAvatarResize } from '@/lib/avatarCrop';
import { callEdgeFn } from '@/lib/edgeInvoke';

export type ImageModerationKind = 'avatar' | 'entry_photo';

export type PhotoUploadErrorCode =
    | 'compression_failed'
    | 'too_large'
    | 'upload_failed'
    | 'moderation_rejected';

export class PhotoUploadError extends Error {
    code: PhotoUploadErrorCode;

    constructor(code: PhotoUploadErrorCode, message: string, cause?: unknown) {
        super(message);
        this.name = 'PhotoUploadError';
        this.code = code;
        if (cause !== undefined) {
            (this as Error & { cause?: unknown }).cause = cause;
        }
    }
}

export interface ModeratedImage {
    approved_url: string;
    storage_path: string;
    bucket: 'avatars' | 'entry-photos';
    sha256: string;
    verdict: 'pass';
}

interface StageReservation {
    staging_path: string;
    generation: number | string;
}

interface FinishedStage extends StageReservation {
    state: 'staged';
}

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;
const MAX_BYTES_POST_COMPRESSION = 5 * 1024 * 1024;
const FINISH_STAGE_TIMEOUT_MS = 65_000;

function structuredCode(error: unknown): string | undefined {
    const candidate = error as {
        code?: unknown;
        cause?: { code?: unknown };
    };
    const value = candidate?.cause?.code ?? candidate?.code;
    return typeof value === 'string' ? value.toLowerCase() : undefined;
}

export function isModerationRejected(error: unknown): boolean {
    return error instanceof PhotoUploadError
        ? error.code === 'moderation_rejected'
        : structuredCode(error) === 'moderation_rejected';
}

async function compressEntryPhoto(uri: string): Promise<string> {
    try {
        const probe = await ImageManipulator.manipulateAsync(uri, [], {});
        const resize = probe.height > probe.width
            ? { height: MAX_DIMENSION }
            : { width: MAX_DIMENSION };
        const result = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize }],
            {
                compress: JPEG_QUALITY,
                format: ImageManipulator.SaveFormat.JPEG,
                base64: true,
            },
        );
        if (!result.base64) {
            throw new PhotoUploadError(
                'compression_failed',
                'Compressed image did not return JPEG data.',
            );
        }
        return result.base64;
    } catch (error) {
        if (error instanceof PhotoUploadError) throw error;
        throw new PhotoUploadError(
            'compression_failed',
            `Image compression failed: ${String(error)}`,
            error,
        );
    }
}

async function compressAvatar(uri: string): Promise<string> {
    try {
        const probe = await ImageManipulator.manipulateAsync(uri, [], {});
        const resized = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: pickAvatarResize(probe.width, probe.height) }],
            {},
        );
        const cropped = await ImageManipulator.manipulateAsync(
            resized.uri,
            [{ crop: computeCenterCrop(resized.width, resized.height) }],
            {
                compress: JPEG_QUALITY,
                format: ImageManipulator.SaveFormat.JPEG,
                base64: true,
            },
        );
        if (!cropped.base64) {
            throw new PhotoUploadError(
                'compression_failed',
                'Cropped avatar did not return JPEG data.',
            );
        }
        return cropped.base64;
    } catch (error) {
        if (error instanceof PhotoUploadError) throw error;
        throw new PhotoUploadError(
            'compression_failed',
            `Avatar compression failed: ${String(error)}`,
            error,
        );
    }
}

function decodeBoundedJpeg(base64: string): ArrayBuffer {
    const bytes = decode(base64);
    if (bytes.byteLength > MAX_BYTES_POST_COMPRESSION) {
        throw new PhotoUploadError(
            'too_large',
            `Photo is too large after compression (${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB). Max is 5 MB.`,
        );
    }
    return bytes;
}

function assertReservation(value: StageReservation): StageReservation {
    const generationValid = typeof value?.generation === 'number'
        ? Number.isSafeInteger(value.generation) && value.generation >= 0
        : typeof value?.generation === 'string' && /^\d+$/.test(value.generation);
    if (
        !value
        || typeof value.staging_path !== 'string'
        || value.staging_path.length === 0
        || !generationValid
    ) {
        throw new PhotoUploadError('upload_failed', 'Image staging returned an invalid reservation.');
    }
    return value;
}

function assertFinishedStage(
    value: FinishedStage,
    expected: StageReservation,
): FinishedStage {
    const reservation = assertReservation(value);
    if (
        reservation.staging_path !== expected.staging_path
        || String(reservation.generation) === String(expected.generation)
        || value.state !== 'staged'
    ) {
        throw new PhotoUploadError('upload_failed', 'Image staging did not finish safely.');
    }
    return value;
}

function assertApproved(
    value: ModeratedImage,
    kind: ImageModerationKind,
): ModeratedImage {
    const expectedBucket = kind === 'avatar' ? 'avatars' : 'entry-photos';
    if (
        !value
        || value.verdict !== 'pass'
        || value.bucket !== expectedBucket
        || typeof value.approved_url !== 'string'
        || value.approved_url.length === 0
        || typeof value.storage_path !== 'string'
        || value.storage_path.length === 0
        || typeof value.sha256 !== 'string'
        || value.sha256.length === 0
    ) {
        throw new PhotoUploadError('upload_failed', 'Image moderation returned an invalid result.');
    }
    return value;
}

/** Compress, privately stage, moderate, and return the approved object. */
export async function stageAndModerate(
    uri: string,
    kind: ImageModerationKind,
): Promise<ModeratedImage> {
    const base64 = kind === 'avatar'
        ? await compressAvatar(uri)
        : await compressEntryPhoto(uri);
    const bytes = decodeBoundedJpeg(base64);

    let reservation: StageReservation;
    try {
        reservation = assertReservation(
            await callEdgeFn<StageReservation>('moderate-image', {
                action: 'begin_stage',
                body: { kind },
            }),
        );

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FINISH_STAGE_TIMEOUT_MS);
        try {
            assertFinishedStage(
                await callEdgeFn<FinishedStage>('moderate-image', {
                    action: 'finish_stage',
                    params: {
                        staging_path: reservation.staging_path,
                        generation: reservation.generation,
                    },
                    rawBody: bytes,
                    contentType: 'image/jpeg',
                    signal: controller.signal,
                }),
                reservation,
            );
        } finally {
            clearTimeout(timeout);
        }
    } catch (error) {
        if (error instanceof PhotoUploadError) throw error;
        throw new PhotoUploadError(
            'upload_failed',
            'Could not stage that photo. Please try again.',
            error,
        );
    }

    try {
        return assertApproved(
            await callEdgeFn<ModeratedImage>('moderate-image', {
                action: 'moderate',
                body: {
                    staging_path: reservation.staging_path,
                    kind,
                },
            }),
            kind,
        );
    } catch (error) {
        if (isModerationRejected(error)) {
            throw new PhotoUploadError(
                'moderation_rejected',
                'That photo cannot be used. Please choose another one.',
                error,
            );
        }
        if (error instanceof PhotoUploadError) throw error;
        throw new PhotoUploadError(
            'upload_failed',
            'Could not check that photo. Please try again.',
            error,
        );
    }
}
