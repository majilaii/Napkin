jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { waitFor } from '@testing-library/react-native';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { useTableWishlist, type TableWishlistItem } from './useTableWishlist';

const TABLE_ID = 'table-1';

function row(viewerItemId: string): TableWishlistItem {
    return {
        restaurant: {
            id: 'restaurant-1',
            name: 'Kono',
            address: null,
            city: 'London',
            country: 'UK',
            photo_url: null,
            cuisine: 'Japanese',
            google_rating: null,
            price_level: 3,
            external_id: null,
            lat: 51.5,
            lng: -0.1,
        },
        count: 2,
        members: [],
        viewer_item_id: viewerItemId,
    };
}

describe('useTableWishlist', () => {
    beforeEach(() => {
        (callEdgeFn as jest.Mock).mockReset();
    });

    it('fences viewer-specific rows when identity changes on the same table', async () => {
        (callEdgeFn as jest.Mock)
            .mockResolvedValueOnce([row('item-for-a')])
            .mockResolvedValueOnce([row('item-for-b')]);

        const { result, rerender, client } = renderHookWithClient(
            ({ viewerId }: { viewerId: string }) => useTableWishlist(viewerId, TABLE_ID),
            { initialProps: { viewerId: 'viewer-a' } },
        );

        await waitFor(() => expect(result.current.data?.[0].viewer_item_id).toBe('item-for-a'));
        rerender({ viewerId: 'viewer-b' });
        await waitFor(() => expect(result.current.data?.[0].viewer_item_id).toBe('item-for-b'));

        expect(callEdgeFn).toHaveBeenCalledTimes(2);
        expect(client.getQueryData<TableWishlistItem[]>(
            queryKeys.wishlist.table('viewer-a', TABLE_ID),
        )?.[0].viewer_item_id).toBe('item-for-a');
        expect(client.getQueryData<TableWishlistItem[]>(
            queryKeys.wishlist.table('viewer-b', TABLE_ID),
        )?.[0].viewer_item_id).toBe('item-for-b');
    });

    it('makes zero edge reads and creates no empty-viewer table key', () => {
        const { result, client } = renderHookWithClient(
            () => useTableWishlist(null, TABLE_ID),
        );

        expect(result.current.fetchStatus).toBe('idle');
        expect(callEdgeFn).not.toHaveBeenCalled();
        expect(client.getQueryCache().findAll({
            queryKey: queryKeys.wishlist.tableAll(),
        })).toHaveLength(0);
    });
});
