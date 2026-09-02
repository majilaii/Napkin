jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/hooks/wishlist/useTableWishlist', () => ({ useTableWishlist: jest.fn() }));
jest.mock('../TableWishlistRow', () => ({ TableWishlistRow: 'TableWishlistRow' }));
// Neither expo-router nor useMyWishlist's transitive supabase import
// (react-native-url-polyfill) survives the jest transform allowlist — every
// suite that renders a router/wishlist consumer mocks them locally
// (see table-map.test.tsx).
jest.mock('expo-router', () => ({
    useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('@/hooks/wishlist/useMyWishlist', () => ({ useMyWishlist: jest.fn(() => ({ data: [], isLoading: false })) }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/wishlist/useWishlistRemove', () => ({ useWishlistRemove: jest.fn(() => ({ mutate: jest.fn() })) }));

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
