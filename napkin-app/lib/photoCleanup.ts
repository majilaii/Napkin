/**
 * Photo-cleanup decision for the logger's unmount effect.
 *
 * The logger uploads photos to the `entry-photos` bucket as the user picks
 * them. If the user ABANDONS the logger (closes without saving), those blobs
 * are orphaned and must be deleted. But on a SUCCESSFUL save every uploaded
 * blob is referenced by the new entry's `photo_url`/`photo_urls`, so deleting
 * any of them 404s the entry's photos permanently.
 *
 * The unmount cleanup therefore must skip deletion entirely once a save has
 * succeeded. This was the TICKET-071 regression: `log-meal.tsx` dropped the
 * `setPhotos([])` guard `create-entry.tsx` relied on, so the cleanup deleted
 * just-saved photos. The `saved` flag makes the rule explicit and correct by
 * construction (no reliance on a state-clear/navigation race).
 *
 * Structural input type so both logger screens' slot shapes satisfy it.
 */
export function collectOrphanedBlobUrls(
    photos: ReadonlyArray<{ publicUrl: string | null }>,
    saved: boolean,
): string[] {
    if (saved) return [];
    return photos
        .map((p) => p.publicUrl)
        .filter((url): url is string => !!url);
}
