/**
 * avatarCrop.ts — pure geometry for the square-crop avatar pipeline (TICKET-126).
 *
 * Kept native-free (no expo-image-manipulator / supabase imports) so it unit-tests
 * in jest without pulling native modules — same posture as photoMosaic.ts. The
 * imageUpload.ts avatar path resizes FIRST (native), reads the ACTUAL result
 * dimensions, then calls computeCenterCrop on those so rounding drift can never
 * push the crop outside the image bounds.
 */

/** Every avatar is normalised to this square edge before upload. */
export const AVATAR_SIZE = 512;

/**
 * Resize action so the image's SHORTEST edge becomes `target` (aspect preserved).
 * Portrait/square → constrain width; landscape → constrain height. This may
 * upscale a sub-target source; that's fine for a small avatar.
 */
export function pickAvatarResize(
    width: number,
    height: number,
    target: number = AVATAR_SIZE,
): { width: number } | { height: number } {
    return width <= height ? { width: target } : { height: target };
}

/**
 * Centre square-crop of side `min(target, width, height)` from a (typically
 * post-resize) image. Origin is clamped to ≥0 and the side never exceeds the
 * real dimensions, so an off-by-one from the native resize can't crop past the
 * edge.
 */
export function computeCenterCrop(
    width: number,
    height: number,
    target: number = AVATAR_SIZE,
): { originX: number; originY: number; width: number; height: number } {
    const side = Math.max(1, Math.min(target, Math.floor(width), Math.floor(height)));
    const originX = Math.max(0, Math.floor((width - side) / 2));
    const originY = Math.max(0, Math.floor((height - side) / 2));
    return { originX, originY, width: side, height: side };
}
