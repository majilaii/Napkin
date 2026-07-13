jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { callEdgeFn } from '@/lib/edgeInvoke';
import { fetchPersonalWishlist, type PersonalWishlistPage } from './useMyWishlist';

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

describe('fetchPersonalWishlist', () => {
    beforeEach(() => mockCallEdgeFn.mockReset());

    it('keeps the next cursor so queries continue beyond the first 40 rows', async () => {
        const page: PersonalWishlistPage = {
            data: [],
            next_cursor: '2026-07-12T10:00:00.000Z',
        };
        mockCallEdgeFn.mockResolvedValue(page);

        await expect(fetchPersonalWishlist(null)).resolves.toEqual(page);
        expect(mockCallEdgeFn).toHaveBeenCalledWith('wishlist', {
            action: 'list_personal',
            body: { limit: 40 },
            unwrapData: false,
        });
    });

    it('sends the prior cursor when fetching the next page', async () => {
        mockCallEdgeFn.mockResolvedValue({ data: [], next_cursor: null });

        await fetchPersonalWishlist('2026-07-12T10:00:00.000Z');

        expect(mockCallEdgeFn).toHaveBeenCalledWith('wishlist', {
            action: 'list_personal',
            body: {
                limit: 40,
                before_created_at: '2026-07-12T10:00:00.000Z',
            },
            unwrapData: false,
        });
    });
});
