/* eslint-disable import/first -- Jest mock must be registered before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
            hairlineWidth: 1,
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@/components/feed/Avatar', () => ({ Avatar: 'Avatar' }));

import React from 'react';
import { render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import type { TableWishlistItem } from '@/hooks/wishlist/useTableWishlist';
import { TableWishlistRow } from '../TableWishlistRow';

function item(count: number): TableWishlistItem {
    return {
        count,
        viewer_item_id: null,
        restaurant: {
            id: 'restaurant-1',
            name: 'Chez Napkin',
            cuisine: 'French',
            city: 'London',
        } as TableWishlistItem['restaurant'],
        members: Array.from({ length: count }, (_, index) => ({
            user_id: `user-${index}`,
            display_name: ['Clara', 'Thomas', 'Mina', 'Alex', 'Jacky'][index] ?? `Member ${index}`,
            avatar_url: null,
        })),
    };
}

describe('TableWishlistRow saver avatars', () => {
    it.each([
        [1, 1, null],
        [3, 3, null],
        [5, 3, '+2'],
    ])('renders %i savers as %i avatars and overflow %s', (count, avatarCount, overflow) => {
        const screen = render(
            <TableWishlistRow
                index={1}
                item={item(count)}
                palette={Colors.light}
                onPress={jest.fn()}
            />,
        );
        expect(screen.getAllByTestId('table-wishlist-saver')).toHaveLength(avatarCount);
        if (overflow) expect(screen.getByText(overflow)).toBeTruthy();
        else expect(screen.queryByText(/^\+/)).toBeNull();
        expect(screen.queryByText('saved')).toBeNull();
        expect(screen.queryByText('of you')).toBeNull();
    });

    it('announces named savers and the hidden remainder', () => {
        const screen = render(
            <TableWishlistRow
                index={1}
                item={item(5)}
                palette={Colors.light}
                onPress={jest.fn()}
            />,
        );
        expect(screen.getByLabelText('Open Chez Napkin — saved by Clara, Thomas & 3 more'))
            .toBeTruthy();
    });
});
