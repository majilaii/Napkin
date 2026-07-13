import { chooseAvatarAsset } from '@/lib/avatarPicker';
import { compressAndUploadAvatar, removeUploadedAvatar } from '@/lib/imageUpload';
import type { ConnectivityStatus } from '@/lib/connectivity';

interface AddProfilePhotoOptions {
    userId: string;
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
 * Returns false for a harmless picker cancellation. If the profile save fails
 * after upload, the fresh orphan is removed best-effort before the error is
 * handed back to the UI.
 */
export async function chooseAndSaveNewProfilePhoto({
    userId,
    onSourceChosen,
    saveAvatarUrl,
}: AddProfilePhotoOptions): Promise<boolean> {
    const asset = await chooseAvatarAsset(onSourceChosen);
    if (!asset) return false;

    let uploaded: string | null = null;
    try {
        uploaded = await compressAndUploadAvatar(asset.uri, userId);
        await saveAvatarUrl(uploaded);
        return true;
    } catch (error) {
        if (uploaded) await removeOrphanBestEffort(uploaded);
        throw error;
    }
}
