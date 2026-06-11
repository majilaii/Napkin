/**
 * Mosaic layout chooser — pure function, zero React dependencies.
 *
 * Apple Journal adaptive layouts:
 *   0   → 'empty'    (show 72 px dashed add tile)
 *   1   → 'single'   (full-width 4:3 hero, r12)
 *   2   → 'two'      (two equal 1:1 columns, gap 6)
 *   3   → 'three'    (2/3-width 1:1 hero left + stacked pair right)
 *   4   → 'four'     (2×2 grid)
 *   5+  → 'overflow' (2×2 grid, 4th tile dimmed +{count-3} scrim)
 *
 * This is the single source of truth the PhotoMosaic component imports.
 * It is purposely free of any React / UI dependencies so it runs cleanly
 * in a node test environment.
 */

export type MosaicLayout =
    | 'empty'
    | 'single'
    | 'two'
    | 'three'
    | 'four'
    | 'overflow';

/**
 * Returns the mosaic layout for a given photo count.
 * Counts ≤ 0 → 'empty'. Counts ≥ 5 → 'overflow'.
 */
export function chooseMosaicLayout(count: number): MosaicLayout {
    if (count <= 0) return 'empty';
    if (count === 1) return 'single';
    if (count === 2) return 'two';
    if (count === 3) return 'three';
    if (count === 4) return 'four';
    return 'overflow';
}
