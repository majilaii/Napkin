import { chooseAvatarAsset } from '@/lib/avatarPicker';
import { stageAndModerate } from '@/lib/imageStaging';
import type { ConnectivityStatus } from '@/lib/connectivity';

interface SaveProfilePhotoOptions {
    onSourceChosen: () => void;
    saveAvatarUrl: (url: string) => Promise<unknown>;
}

export function shouldBlockProfilePhotoPicker(status: ConnectivityStatus): boolean {
    return status === 'offline';
}

/**
 * Shared transaction for the Profile-tab shortcut: pick → moderate → save.
 * Returns false for a harmless picker cancellation. Approved-but-unbound
 * objects are intentionally left to the registry's 48h GC if the save fails;
 * clients cannot delete service-owned approved bytes.
 */
export async function chooseAndSaveNewProfilePhoto({
    onSourceChosen,
    saveAvatarUrl,
}: SaveProfilePhotoOptions): Promise<boolean> {
    const asset = await chooseAvatarAsset(onSourceChosen);
    if (!asset) return false;

    const approved = await stageAndModerate(asset.uri, 'avatar');
    await saveAvatarUrl(approved.approved_url);
    return true;
}
