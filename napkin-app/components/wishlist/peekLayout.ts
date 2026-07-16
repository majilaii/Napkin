import type { WishlistMapItem } from './mapShared';

export const PEEK_MAX_FONT_SCALE = 2;
export const PEEK_BASE_CARD_HEIGHT = 136;
const PEEK_DYNAMIC_TYPE_GROWTH = 74;
const PEEK_PLACES_CREDIT_LINE_HEIGHT = 15;

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

/** Exact off-image TICKET-200 credit line; only a rendered Places photo adds it. */
export function peekPlacesCreditHeight(fontScale: number): number {
    return Math.round(PEEK_PLACES_CREDIT_LINE_HEIGHT * peekEffectiveFontScale(fontScale));
}

export function peekCardHeight(fontScale: number, hasPlacesCredit: boolean): number {
    return peekRailCardHeight(fontScale)
        + (hasPlacesCredit ? peekPlacesCreditHeight(fontScale) : 0);
}

/** The rail reserves this transparent envelope so a credited card cannot clip. */
export function peekRailMaxCardHeight(fontScale: number): number {
    return peekCardHeight(fontScale, true);
}

export function peekCardHeightsForRail(
    items: readonly WishlistMapItem[],
    fontScale: number,
): number[] {
    const height = peekRailCardHeight(fontScale);
    return items.map(() => height);
}
