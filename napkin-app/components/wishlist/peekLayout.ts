import type { WishlistMapItem } from './mapShared';

export const PEEK_MAX_FONT_SCALE = 2;
const PEEK_BASE_CARD_HEIGHT = 218;
const PEEK_DYNAMIC_TYPE_GROWTH = 116;

/** One rail-wide height. Item layer and enrichment are deliberately not inputs. */
export function peekRailCardHeight(fontScale: number): number {
    const effectiveScale = Math.max(1, Math.min(fontScale, PEEK_MAX_FONT_SCALE));
    return Math.round(
        PEEK_BASE_CARD_HEIGHT + (effectiveScale - 1) * PEEK_DYNAMIC_TYPE_GROWTH,
    );
}

export function peekCardHeightsForRail(
    items: readonly WishlistMapItem[],
    fontScale: number,
): number[] {
    const height = peekRailCardHeight(fontScale);
    return items.map(() => height);
}
