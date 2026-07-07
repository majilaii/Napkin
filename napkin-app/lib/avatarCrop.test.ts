import { AVATAR_SIZE, pickAvatarResize, computeCenterCrop } from './avatarCrop';

describe('pickAvatarResize', () => {
    it('constrains width for a portrait image (shortest edge = width)', () => {
        expect(pickAvatarResize(800, 1200)).toEqual({ width: AVATAR_SIZE });
    });

    it('constrains height for a landscape image (shortest edge = height)', () => {
        expect(pickAvatarResize(1600, 900)).toEqual({ height: AVATAR_SIZE });
    });

    it('constrains width for a perfect square (tie → width)', () => {
        expect(pickAvatarResize(1000, 1000)).toEqual({ width: AVATAR_SIZE });
    });

    it('upscales a small source toward the target', () => {
        expect(pickAvatarResize(120, 300)).toEqual({ width: AVATAR_SIZE });
    });

    it('honours a custom target', () => {
        expect(pickAvatarResize(1600, 900, 256)).toEqual({ height: 256 });
    });
});

describe('computeCenterCrop', () => {
    it('returns a full 512² crop centred on a landscape post-resize image', () => {
        // Landscape resized so shortest edge (height) = 512 → e.g. 910x512.
        expect(computeCenterCrop(910, 512)).toEqual({
            originX: 199, // floor((910-512)/2)
            originY: 0,
            width: 512,
            height: 512,
        });
    });

    it('returns a full 512² crop centred on a portrait post-resize image', () => {
        // Portrait resized so shortest edge (width) = 512 → e.g. 512x768.
        expect(computeCenterCrop(512, 768)).toEqual({
            originX: 0,
            originY: 128, // floor((768-512)/2)
            width: 512,
            height: 512,
        });
    });

    it('is a no-op crop for an exact square at target', () => {
        expect(computeCenterCrop(512, 512)).toEqual({
            originX: 0,
            originY: 0,
            width: 512,
            height: 512,
        });
    });

    it('clamps the side to the image when smaller than target (never over-crops)', () => {
        // A resize that rounded to 511 on the shortest edge must not crop 512.
        expect(computeCenterCrop(700, 511)).toEqual({
            originX: 94, // floor((700-511)/2)
            originY: 0,
            width: 511,
            height: 511,
        });
    });

    it('floors fractional dimensions defensively', () => {
        const c = computeCenterCrop(513.9, 512.4);
        expect(c.width).toBe(512);
        expect(c.height).toBe(512);
        expect(c.originX).toBe(0); // floor((513-512)/2) = 0
        expect(c.originY).toBe(0);
    });

    it('never returns a negative origin or zero side', () => {
        const c = computeCenterCrop(10, 10);
        expect(c.originX).toBeGreaterThanOrEqual(0);
        expect(c.originY).toBeGreaterThanOrEqual(0);
        expect(c.width).toBeGreaterThan(0);
        expect(c.height).toBe(c.width);
    });
});
