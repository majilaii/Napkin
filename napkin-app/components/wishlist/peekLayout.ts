import type { WishlistMapItem } from './mapShared';

export const PEEK_MAX_FONT_SCALE = 2;
export const PEEK_BASE_CARD_HEIGHT = 136;
const PEEK_DYNAMIC_TYPE_GROWTH = 74;

export function peekEffectiveFontScale(fontScale: number): number {
    return Math.max(1, Math.min(fontScale, PEEK_MAX_FONT_SCALE));
}

/** One rail-wide height. Item layer and enrichment are deliberately not inputs. */
export function peekRailCardHeight(fontScale: number): number {
    const effectiveScale = peekEffectiveFontScale(fontScale);
    return Math.round(
        PEEK_BASE_CARD_HEIGHT + (effectiveScale - 1) * PEEK_DYNAMIC_TYPE_GROWTH,
    );
}

export function peekCardHeight(fontScale: number, _hasPlacesCredit: boolean): number {
    return peekRailCardHeight(fontScale);
}

/** The rail reserves one uniform transparent envelope for every card. */
export function peekRailMaxCardHeight(fontScale: number): number {
    return peekRailCardHeight(fontScale);
}

export function peekCardHeightsForRail(
    items: readonly WishlistMapItem[],
    fontScale: number,
): number[] {
    const height = peekRailCardHeight(fontScale);
    return items.map(() => height);
}
