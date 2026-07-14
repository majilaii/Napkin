/**
 * listSheetMath — the pure geometry for `ListDetailSheet`'s three-snap sheet
 * (TICKET-186, A8). No React / reanimated imports so it stays jest-testable; the
 * shared values in `ListDetailSheet` consume these on the UI thread.
 *
 * Snap indices: 0 = peek, 1 = half, 2 = full.
 * Model: the sheet view is laid out at a FIXED height `SHEET_H = 0.92·H`, pinned
 * bottom:0, and moved DOWN by `translateY` (0 = full). Offsets are the translateY
 * for each snap; `translateY = SHEET_H − visibleHeight(snap)`.
 */
export type Snap = 0 | 1 | 2;

export const PEEK: Snap = 0;
export const HALF: Snap = 1;
export const FULL: Snap = 2;

/**
 * Measured peek floor (Codex #9): handle + compact identity row (44² cover +
 * title/metadata) + 48pt primary + context line + pads ≈ 176pt. On the smallest
 * viewport (iPhone SE, H ≈ 521 → 0.16·H ≈ 83) the floor wins; still ~25% of a
 * modern screen, so the founder's "pin fills the screen" peek holds.
 */
export const PEEK_FLOOR = 176;

const PEEK_RATIO = 0.16;
const HALF_RATIO = 0.56;
const FULL_RATIO = 0.92;

/** Velocity projection window: where the sheet would coast to in 0.2s. */
const PROJECTION_SECONDS = 0.2;

/** The fixed laid-out sheet height (full snap's visible height). */
export function sheetHeight(H: number): number {
    return H * FULL_RATIO;
}

/** Visible sheet height at a snap (peek honors the PEEK_FLOOR). */
export function visibleHeight(H: number, snap: Snap): number {
    if (snap === FULL) return H * FULL_RATIO;
    if (snap === HALF) return H * HALF_RATIO;
    return Math.max(H * PEEK_RATIO, PEEK_FLOOR);
}

/** translateY offsets per snap: [peek, half, full]. 0 = full (sheet at top). */
export function offsetsFor(H: number): [number, number, number] {
    const full = H * FULL_RATIO;
    return [
        full - Math.max(H * PEEK_RATIO, PEEK_FLOOR),
        full - H * HALF_RATIO,
        0,
    ];
}

/**
 * Review F3: the sheet's edit LOCK (force-full + both pans disabled) derives
 * from edit permission alone — `ranked` gates ONLY the DraggableFlatList swap.
 * Unranked edit = a plain scrollable list at full, pans still disabled.
 */
export function resolveSheetMode(
    isEditingPlaces: boolean,
    canEditEntries: boolean,
    ranked: boolean,
): { locked: boolean; reorder: boolean } {
    const locked = isEditingPlaces && canEditEntries;
    return { locked, reorder: locked && ranked };
}

/**
 * Commit a released drag to the snap nearest the velocity-projected position
 * (A8: `pos + v·0.2s`, nearest snap, no dead zones). Called on the UI thread
 * from the sheet's gesture worklets; the `'worklet'` directive is a no-op in
 * jest so the projection math stays directly unit-testable.
 */
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
