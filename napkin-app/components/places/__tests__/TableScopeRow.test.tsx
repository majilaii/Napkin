/* eslint-disable import/first -- Jest mocks must be registered before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            hairlineWidth: 1,
            flatten: (style: unknown): Record<string, unknown> =>
                (Array.isArray(style) ? style : [style])
                    .flat(Infinity)
                    .filter(Boolean)
                    .reduce<Record<string, unknown>>(
                        (acc, item) => ({ ...acc, ...(item as Record<string, unknown>) }),
                        {},
                    ),
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@/components/feed/Avatar', () => ({ Avatar: 'Avatar' }));

import React from 'react';
import { render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import type { TableMapPin } from '@/hooks/tables/useTableMapPins';
import type { TableWishlistItem } from '@/hooks/wishlist/useTableWishlist';
import { TableScopeRow, formatGatheredDate, tablePinnedSignal } from '../TableScopeRow';

function pinned(count: number): TableWishlistItem {
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
            display_name: ['Thomas', 'Clara', 'Mina', 'Alex'][index],
            avatar_url: null,
        })),
    };
}

describe('TableScopeRow', () => {
    it('uses pinned copy, upright names, avatars, and overflow', () => {
        expect(tablePinnedSignal(pinned(1))).toBe('thomas pinned');
        expect(tablePinnedSignal(pinned(3))).toBe('3 of you pinned');
        const screen = render(
            <TableScopeRow kind="pinned" item={pinned(4)} palette={Colors.light} onPress={jest.fn()} />,
        );
        expect(screen.getByText('Chez Napkin').props.style).toEqual(expect.arrayContaining([
            expect.objectContaining({ fontFamily: 'Newsreader_500Medium' }),
        ]));
        expect(screen.getByText('French · London · 4 of you pinned')).toBeTruthy();
        expect(screen.getAllByTestId('table-scope-avatar')).toHaveLength(3);
        expect(screen.getByText('+1')).toBeTruthy();
        expect(screen.getByLabelText('open Chez Napkin — 4 of you pinned')).toBeTruthy();
        expect(screen.queryByText(/saved by/i)).toBeNull();
    });

    it('renders gathered date copy for the been layer', () => {
        const item: TableMapPin = {
            table_id: 'table-a',
            restaurant_id: 'restaurant-2',
            name: 'Brawn',
            city: 'London',
            cuisine: 'British',
            lat: 51.5,
            lng: -0.1,
            supper_id: 'supper-a',
            gathered_on: '2026-08-31T19:00:00Z',
            participants: [],
            suppers_count: 1,
        };
        const screen = render(
            <TableScopeRow kind="been" item={item} palette={Colors.light} onPress={jest.fn()} />,
        );
        expect(formatGatheredDate(item.gathered_on)).toBe('31 aug');
        expect(screen.getByText('gathered 31 aug')).toBeTruthy();
    });
});
