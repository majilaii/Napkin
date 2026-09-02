/** Pure three-detent geometry shared by every sheet-over-map surface. */
export type Snap = 0 | 1 | 2;

export const PEEK: Snap = 0;
export const HALF: Snap = 1;
export const FULL: Snap = 2;
export const PEEK_FLOOR = 176;

const PEEK_RATIO = 0.16;
const HALF_RATIO = 0.56;
const FULL_RATIO = 0.92;
const PROJECTION_SECONDS = 0.2;

export function sheetHeight(H: number): number {
    return H * FULL_RATIO;
}

export function visibleHeight(H: number, snap: Snap): number {
    if (snap === FULL) return H * FULL_RATIO;
    if (snap === HALF) return H * HALF_RATIO;
    return Math.max(H * PEEK_RATIO, PEEK_FLOOR);
}

export function offsetsFor(H: number): [number, number, number] {
    const full = H * FULL_RATIO;
    return [
        full - Math.max(H * PEEK_RATIO, PEEK_FLOOR),
        full - H * HALF_RATIO,
        0,
    ];
}

export function listPanOwnsSheet(
    atFull: boolean,
    beganTop: boolean,
    translationY: number,
): boolean {
    'worklet';
    return !atFull || (beganTop && translationY > 0);
}

export function resolveSnap(
    offset: number,
    velocity: number,
    offsets: readonly [number, number, number],
): Snap {
    'worklet';
    const projected = offset + velocity * PROJECTION_SECONDS;
    let best: Snap = PEEK;
    let bestDistance = Infinity;
    for (let i = 0; i < offsets.length; i += 1) {
        const distance = Math.abs(projected - offsets[i]);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = i as Snap;
        }
    }
    return best;
}

export function resolveSheetMode(
    isEditingPlaces: boolean,
    canEditEntries: boolean,
    ranked: boolean,
): { locked: boolean; reorder: boolean } {
    const locked = isEditingPlaces && canEditEntries;
    return { locked, reorder: locked && ranked };
}
