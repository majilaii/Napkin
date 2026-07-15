import { chooseAvatarAsset } from '@/lib/avatarPicker';
import { compressAndUploadAvatar, removeUploadedAvatar } from '@/lib/imageUpload';
import type { ConnectivityStatus } from '@/lib/connectivity';

interface SaveProfilePhotoOptions {
    userId: string;
    previousAvatarUrl: string | null;
    onSourceChosen: () => void;
    saveAvatarUrl: (url: string) => Promise<unknown>;
}

const ORPHAN_CLEANUP_TIMEOUT_MS = 1_500;

async function removeOrphanBestEffort(url: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
        await Promise.race([
            removeUploadedAvatar(url).catch(() => {}),
            new Promise<void>((resolve) => {
                timeout = setTimeout(resolve, ORPHAN_CLEANUP_TIMEOUT_MS);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

export function shouldBlockProfilePhotoPicker(status: ConnectivityStatus): boolean {
    return status === 'offline';
}

/**
 * Shared transaction for the Profile-tab shortcut: pick → crop/upload → save.
 * Returns false for a harmless picker cancellation. A successful replacement
 * removes the previous upload best-effort. If the profile save fails after
 * upload, only the fresh orphan is removed before the error is handed back to
 * the UI, leaving the previous avatar untouched for the mutation rollback.
 */
export async function chooseAndSaveNewProfilePhoto({
    userId,
    previousAvatarUrl,
    onSourceChosen,
    saveAvatarUrl,
}: SaveProfilePhotoOptions): Promise<boolean> {
    const asset = await chooseAvatarAsset(onSourceChosen);
    if (!asset) return false;

    let uploaded: string | null = null;
    try {
        uploaded = await compressAndUploadAvatar(asset.uri, userId);
        await saveAvatarUrl(uploaded);
        if (previousAvatarUrl && previousAvatarUrl !== uploaded) {
            void removeUploadedAvatar(previousAvatarUrl).catch(() => {});
        }
        return true;
    } catch (error) {
        if (uploaded) await removeOrphanBestEffort(uploaded);
        throw error;
    }
}
