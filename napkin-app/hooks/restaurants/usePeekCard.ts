import { useQuery } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { RestaurantHours } from '@/lib/restaurantHours';
import type { WishlistMapItem } from '@/components/wishlist/mapShared';

export type PeekCardLayer = 'saved' | 'been' | 'network' | 'overlap' | 'gathered' | 'list';

export interface PeekCardContext {
    layer: PeekCardLayer;
    entry_id?: string;
    table_id?: string;
    list_id?: string;
}

export interface PeekCardMediaCandidate {
    kind: 'entry' | 'clip' | 'places';
    url: string;
    photo_source?: 'user' | 'table' | 'places';
    attribution?: string | null;
}

export interface PeekCardData {
    media: PeekCardMediaCandidate[];
    google_rating: number | null;
    google_rating_count: number | null;
    price_level: number | null;
    hours: RestaurantHours | null;
    visible_saves_count?: number;
    address_short: string | null;
    reserve_url: string | null;
}

export function peekCardContextForItem(item: WishlistMapItem): PeekCardContext {
    if (item.overlap != null) return { layer: 'overlap' };
    if (item.entryId != null) return { layer: 'network', entry_id: item.entryId };
    if (item.gathered != null) {
        return { layer: 'gathered', table_id: item.gathered.tableId };
    }
    if (item.listContext != null) {
        return { layer: 'list', list_id: item.listContext.listId };
    }
    if (item.been) return { layer: 'been' };
    return { layer: 'saved' };
}

/** Stable, delimiter-safe here because every id is UUID-shaped and layer is an enum. */
export function peekCardContextToken(context: PeekCardContext): string {
    return [
        context.layer,
        context.entry_id ?? '',
        context.table_id ?? '',
        context.list_id ?? '',
    ].join(':');
}

interface UsePeekCardOptions {
    viewerId: string | null | undefined;
    restaurantId: string | null | undefined;
    context: PeekCardContext;
    isSelected: boolean;
}

export function usePeekCard({
    viewerId,
    restaurantId,
    context,
    isSelected,
}: UsePeekCardOptions) {
    const contextToken = peekCardContextToken(context);
    return useQuery<PeekCardData, Error>({
        queryKey: queryKeys.restaurants.peekCard(
            viewerId ?? '',
            restaurantId ?? '',
            contextToken,
        ),
        queryFn: () =>
            callEdgeFn<PeekCardData>('restaurant-history', {
                action: 'peek_card',
                params: { restaurant_id: restaurantId },
                body: { restaurant_id: restaurantId, context },
            }),
        enabled: isSelected && !!viewerId && !!restaurantId,
        staleTime: 1000 * 60 * 5,
    });
}
