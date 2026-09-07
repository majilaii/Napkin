import * as FileSystem from 'expo-file-system/legacy';
import { enqueueVideoImport } from './importQueue';
import { requireActiveImportOwner } from './importOwnerGuard';
import { safeRandomUUID } from './uuid';

export class PickedVideoCancelledError extends Error {
    constructor() {
        super('Video capture was cancelled');
        this.name = 'PickedVideoCancelledError';
    }
}

/**
 * Photos returns a disposable cache URI. Own a durable copy before handing the
 * video to the root queue, which expects an absolute path and deletes it only
 * after save/discard. Capture failure may delete our copy, never the picker file.
 */
export async function queuePickedVideo(
    sourceUri: string,
    ownerId: string | null | undefined,
    readActiveOwner: () => string | null | undefined,
    isCaptureActive: () => boolean,
) {
    const requireCapture = () => {
        if (!isCaptureActive()) throw new PickedVideoCancelledError();
        return requireActiveImportOwner(ownerId, readActiveOwner());
    };
    const expectedOwner = requireCapture();
    if (!sourceUri.startsWith('file://') || !FileSystem.documentDirectory) {
        throw new Error('No durable video location is available');
    }
    const directory = `${FileSystem.documentDirectory}video-imports/`;
    const extension = /\.(mp4|mov|m4v)(?:\?|$)/i.exec(sourceUri)?.[1]?.toLowerCase() ?? 'mov';
    const ownedUri = `${directory}${safeRandomUUID()}.${extension}`;
    try {
        await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
        requireCapture();
        await FileSystem.copyAsync({ from: sourceUri, to: ownedUri });
        requireCapture();
        const info = await FileSystem.getInfoAsync(ownedUri);
        if (!info.exists || info.isDirectory || info.size <= 0) {
            throw new Error('The captured video is empty');
        }
        requireCapture();
        // appGroupFileInfo/deleteAppGroupFile take a filesystem path, not a URI.
        const absolutePath = decodeURIComponent(new URL(ownedUri).pathname);
        return await enqueueVideoImport(absolutePath, expectedOwner, requireCapture, 'ready');
    } catch (error) {
        await FileSystem.deleteAsync(ownedUri, { idempotent: true }).catch(() => {});
        throw error;
    }
}
