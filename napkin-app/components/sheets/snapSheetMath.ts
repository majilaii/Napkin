/** Pure three-detent geometry shared by every sheet-over-map surface. */
export type Snap = 0 | 1 | 2;

export const PEEK: Snap = 0;
export const HALF: Snap = 1;
export const FULL: Snap = 2;
export const PEEK_FLOOR = 176;

export type SnapMetrics = Readonly<{
    peekRatio: number;
    peekFloor: number;
    halfRatio: number;
    fullRatio: number;
}>;

export const DEFAULT_SNAP_METRICS: SnapMetrics = Object.freeze({
    peekRatio: 0.16,
    peekFloor: PEEK_FLOOR,
    halfRatio: 0.56,
    fullRatio: 0.92,
});

/** Founder-approved Places artboard: sheet top rests about 250pt above the nav. */
export const PLACES_SNAP_METRICS: SnapMetrics = Object.freeze({
    ...DEFAULT_SNAP_METRICS,
    peekRatio: 0,
    peekFloor: 250,
});

const PROJECTION_SECONDS = 0.2;

export function sheetHeight(H: number, metrics: SnapMetrics = DEFAULT_SNAP_METRICS): number {
    return H * metrics.fullRatio;
}

export function visibleHeight(
    H: number,
    snap: Snap,
    metrics: SnapMetrics = DEFAULT_SNAP_METRICS,
): number {
    if (snap === FULL) return H * metrics.fullRatio;
    if (snap === HALF) return H * metrics.halfRatio;
    return Math.min(
        H * metrics.fullRatio,
        Math.max(H * metrics.peekRatio, metrics.peekFloor),
    );
}

export function offsetsFor(
    H: number,
    metrics: SnapMetrics = DEFAULT_SNAP_METRICS,
): [number, number, number] {
    const full = H * metrics.fullRatio;
    return [
        full - visibleHeight(H, PEEK, metrics),
        full - H * metrics.halfRatio,
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
