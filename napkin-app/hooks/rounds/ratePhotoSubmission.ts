export interface RatePhotoSlot {
    publicUrl: string | null;
    uploading: boolean;
}

interface SubmitRateWithSettledPhotosInput {
    getPhotos: () => readonly RatePhotoSlot[];
    submit: (photoUrls: string[]) => Promise<void>;
    onCommitted: () => void;
}

/**
 * Keep selected Round photos attached to the rating they were chosen for.
 * A rating cannot commit (or clear its local slots) while any upload is pending.
 */
export async function submitRateWithSettledPhotos({
    getPhotos,
    submit,
    onCommitted,
}: SubmitRateWithSettledPhotosInput): Promise<boolean> {
    // Read at the mutation seam so an async join immediately before this call
    // cannot make us submit a stale pre-upload snapshot.
    const photos = getPhotos();
    if (photos.some((photo) => photo.uploading)) {
        return false;
    }

    const photoUrls = photos.flatMap((photo) =>
        photo.publicUrl === null ? [] : [photo.publicUrl]
    );

    await submit(photoUrls);
    onCommitted();
    return true;
}
