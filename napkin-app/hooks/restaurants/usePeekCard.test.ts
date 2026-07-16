import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react-native';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import {
    peekCardContextForItem,
    peekCardContextToken,
    usePeekCard,
    type PeekCardData,
} from './usePeekCard';
import type { WishlistMapItem } from '@/components/wishlist/mapShared';

const base: WishlistMapItem = {
    id: 'same-restaurant',
    name: 'Cafe',
    city: null,
    cuisine: null,
    lat: 51.5,
    lng: -0.1,
};

describe('peek-card cache fence', () => {
    it('does not reuse a been hero for the same restaurant in network context', () => {
        const viewerId = 'viewer-1';
        const been = { ...base, been: true };
        const network = { ...base, entryId: 'followee-entry-1' };
        const beenKey = queryKeys.restaurants.peekCard(
            viewerId,
            base.id,
            peekCardContextToken(peekCardContextForItem(been)),
        );
        const networkKey = queryKeys.restaurants.peekCard(
            viewerId,
            base.id,
            peekCardContextToken(peekCardContextForItem(network)),
        );
        const client = new QueryClient();
        const beenPayload: PeekCardData = {
            media: [{ kind: 'entry', url: 'https://storage.example/own.jpg' }],
            google_rating: null,
            google_rating_count: null,
            price_level: null,
            hours: null,
            address_short: null,
            reserve_url: null,
        };

        expect(networkKey).not.toEqual(beenKey);
        client.setQueryData(beenKey, beenPayload);
        expect(client.getQueryData(networkKey)).toBeUndefined();
    });

    it('viewer-fences overlap cards and separates the same restaurant by table id', () => {
        const overlapItem = (tableId: string): WishlistMapItem => ({
            ...base,
            overlap: {
                count: 2,
                tableId,
                tableName: 'Table',
                members: [],
            },
        });
        const contextA = peekCardContextForItem(overlapItem('table-a'));
        const contextB = peekCardContextForItem(overlapItem('table-b'));
        const viewerAKey = queryKeys.restaurants.peekCard(
            'viewer-a',
            base.id,
            peekCardContextToken(contextA),
        );
        const viewerBKey = queryKeys.restaurants.peekCard(
            'viewer-b',
            base.id,
            peekCardContextToken(contextA),
        );
        const tableBKey = queryKeys.restaurants.peekCard(
            'viewer-a',
            base.id,
            peekCardContextToken(contextB),
        );

        expect(contextA).toEqual({ layer: 'overlap', table_id: 'table-a' });
        expect(peekCardContextToken(contextA)).not.toBe(peekCardContextToken(contextB));
        expect(viewerAKey).toContain('viewer-a');
        expect(viewerAKey).not.toEqual(viewerBKey);
        expect(viewerAKey).not.toEqual(tableBKey);
    });

    it('fetches enrichment only after a pre-rendered card becomes selected', async () => {
        const payload: PeekCardData = {
            media: [],
            google_rating: null,
            google_rating_count: null,
            price_level: null,
            hours: null,
            address_short: null,
            reserve_url: null,
        };
        (callEdgeFn as jest.Mock).mockResolvedValue(payload);
        const context = peekCardContextForItem(base);
        const { rerender } = renderHookWithClient(
            ({ selected }: { selected: boolean }) => usePeekCard({
                viewerId: 'viewer-1',
                restaurantId: base.id,
                context,
                isSelected: selected,
            }),
            { initialProps: { selected: false } },
        );

        expect(callEdgeFn).not.toHaveBeenCalled();
        rerender({ selected: true });
        await waitFor(() => expect(callEdgeFn).toHaveBeenCalledTimes(1));
        expect(callEdgeFn).toHaveBeenCalledWith('restaurant-history', {
            action: 'peek_card',
            params: { restaurant_id: base.id },
            body: { restaurant_id: base.id, context },
        });
    });
});
