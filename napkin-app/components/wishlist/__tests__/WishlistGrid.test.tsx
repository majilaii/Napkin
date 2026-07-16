jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/wishlist/useTableWishlist', () => ({ useTableWishlist: jest.fn() }));

import React from 'react';
import { render } from '@testing-library/react-native';

import { useAuth } from '@/providers/AuthProvider';
import { useTableWishlist } from '@/hooks/wishlist/useTableWishlist';
import { WishlistGrid } from '../WishlistGrid';

describe('WishlistGrid table mode', () => {
    it('renders nothing and never starts the Table query without a viewer', () => {
        (useAuth as jest.Mock).mockReturnValue({ user: null });

        const view = render(<WishlistGrid mode="table" tableId="table-1" />);

        expect(view.toJSON()).toBeNull();
        expect(useTableWishlist).not.toHaveBeenCalled();
    });
});
