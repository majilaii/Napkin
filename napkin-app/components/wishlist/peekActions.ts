import type { WishlistMapItem } from './mapShared';

export type PeekActionId =
    | 'log_visit'
    | 'log_again'
    | 'directions'
    | 'wishlist'
    | 'reserve'
    | 'view_restaurant'
    | 'gather_here';

export interface PeekPresentationActions {
    slot1: PeekActionId;
    slot2?: PeekActionId;
    slot3?: PeekActionId;
}

export function peekLayerForItem(
    item: WishlistMapItem,
): 'saved' | 'been' | 'network' | 'overlap' | 'gathered' | 'list' {
    if (item.overlap != null) return 'overlap';
    if (item.entryId != null) return 'network';
    if (item.gathered != null) return 'gathered';
    if (item.listContext != null) return 'list';
    if (item.been) return 'been';
    return 'saved';
}

/**
 * The literal product table for one card presentation. Callers snapshot this
 * when the card becomes selected; async enrichment must not recompute it.
 */
export function peekActionsForPresentation(
    item: WishlistMapItem,
    { reserveResolved }: { reserveResolved: boolean },
): PeekPresentationActions {
    switch (peekLayerForItem(item)) {
        case 'saved':
            return {
                slot1: 'log_visit',
                slot2: 'wishlist',
                slot3: reserveResolved ? 'reserve' : 'directions',
            };
        case 'been':
            return { slot1: 'directions', slot2: 'wishlist', slot3: 'log_again' };
        case 'network':
            return { slot1: 'wishlist', slot2: 'view_restaurant', slot3: 'log_visit' };
        case 'overlap':
            return { slot1: 'gather_here', slot2: 'wishlist', slot3: 'log_visit' };
        case 'gathered':
            return { slot1: 'log_again', slot2: 'wishlist', slot3: 'directions' };
        case 'list':
            return { slot1: 'wishlist', slot2: 'view_restaurant', slot3: 'directions' };
    }
}
