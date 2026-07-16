jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { act, waitFor } from '@testing-library/react-native';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { useRepointWishlistItem } from './useRepointWishlistItem';

describe('useRepointWishlistItem', () => {
    beforeEach(() => {
        (callEdgeFn as jest.Mock).mockReset().mockResolvedValue({});
    });

    it('invalidates the exact viewer-fenced Table wishlist after repair', async () => {
        const { result, client } = renderHookWithClient(
            () => useRepointWishlistItem('viewer-1', null, 'table-1'),
        );
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        act(() => result.current.mutate({
            item_id: 'wishlist-item-1',
            restaurant_id: 'restaurant-2',
        }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(callEdgeFn).toHaveBeenCalledWith('wishlist', {
            action: 'repoint',
            body: { item_id: 'wishlist-item-1', restaurant_id: 'restaurant-2' },
        });
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.wishlist.table('viewer-1', 'table-1'),
        });
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.wishlist.personal('viewer-1'),
        });
    });
});
