jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/hooks/tables/useTables', () => ({ useTables: jest.fn() }));

import { waitFor } from '@testing-library/react-native';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { useTables } from '@/hooks/tables/useTables';
import { useTablesOverlap } from './useTablesOverlap';
import type { TableWishlistItem } from './useTableWishlist';

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

const memberships = [{
    role: 'member' as const,
    joined_at: '2026-07-01T00:00:00Z',
    tables: {
        id: TABLE_ID,
        name: 'Table',
        avatar_url: null,
        owner_id: 'owner-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
    },
}];

describe('useTablesOverlap', () => {
    beforeEach(() => {
        (callEdgeFn as jest.Mock).mockReset();
        (useTables as jest.Mock).mockReturnValue({ data: memberships });
    });

    it('uses distinct per-viewer table keys across an identity switch', async () => {
        (callEdgeFn as jest.Mock)
            .mockResolvedValueOnce([row('item-for-a')])
            .mockResolvedValueOnce([row('item-for-b')]);

        const { result, rerender, client } = renderHookWithClient(
            ({ viewerId }: { viewerId: string }) => useTablesOverlap(viewerId, { enabled: true }),
            { initialProps: { viewerId: 'viewer-a' } },
        );

        await waitFor(() => expect(
            result.current.sources[0]?.items[0]?.viewer_item_id,
        ).toBe('item-for-a'));
        rerender({ viewerId: 'viewer-b' });
        await waitFor(() => expect(
            result.current.sources[0]?.items[0]?.viewer_item_id,
        ).toBe('item-for-b'));

        expect(callEdgeFn).toHaveBeenCalledTimes(2);
        expect(client.getQueryData<TableWishlistItem[]>(
            queryKeys.wishlist.table('viewer-a', TABLE_ID),
        )?.[0].viewer_item_id).toBe('item-for-a');
        expect(client.getQueryData<TableWishlistItem[]>(
            queryKeys.wishlist.table('viewer-b', TABLE_ID),
        )?.[0].viewer_item_id).toBe('item-for-b');
    });

    it('creates no table fan-out when the viewer is absent', () => {
        const { result } = renderHookWithClient(
            () => useTablesOverlap(null, { enabled: true }),
        );

        expect(result.current.sources).toEqual([]);
        expect(callEdgeFn).not.toHaveBeenCalled();
    });
});
