/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import { Colors, Radius, Spacing } from '@/constants/theme';
import type { FriendFeedRow } from '@/hooks/feed/useFriendsFeed';
import { tintFor } from '@/lib/engraving';
import { FriendFeedCard } from '../FriendFeedCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        StyleSheet: {
            absoluteFillObject: { position: 'absolute', inset: 0 },
            hairlineWidth: 0.5,
            create: (styles: unknown) => styles,
        },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'viewer' } }) }));
jest.mock('@/hooks/entries/useDeleteEntry', () => ({
    useDeleteEntry: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/components/common', () => ({ OwnerActionsSheet: 'OwnerActionsSheet' }));
jest.mock('../Avatar', () => ({ Avatar: 'Avatar' }));

function feedRow(photos: string[], content: string | null = 'quietly excellent'): FriendFeedRow {
    return {
        id: 'entry-1',
        user_id: 'friend-1',
        restaurant_id: 'restaurant-1',
        rating: 4.5,
        content,
        visited_at: '2026-08-30T12:00:00.000Z',
        created_at: '2026-08-30T12:00:00.000Z',
        sort_date: '2026-08-30T12:00:00.000Z',
        photos,
        photo_count: photos.length,
        reaction_count: 3,
        comment_count: 1,
        top_emojis: [],
        my_reactions: [],
        restaurant: { id: 'restaurant-1', name: 'AGORA souvla bar', photo_url: null },
        author: {
            user_id: 'friend-1',
            username: 'maya',
            display_name: 'Maya Chen',
            avatar_url: null,
        },
    };
}

function render(row: FriendFeedRow, showDivider = true) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <FriendFeedCard row={row} showDivider={showDivider} />,
        );
    });
    return renderer;
}

function flattenStyle(style: unknown): Record<string, unknown> {
    const values = Array.isArray(style) ? style.flat(Infinity) : [style];
    return values.reduce<Record<string, unknown>>(
        (merged, value) => (value && typeof value === 'object' ? { ...merged, ...value } : merged),
        {},
    );
}

describe('FriendFeedCard density weights', () => {
    it('renders one photo as a 42pt note-row thumbnail with no engagement control', () => {
        const renderer = render(feedRow(['https://storage.example/note.jpg']));
        const row = renderer.root.findByProps({ testID: 'feed-note-row' });
        const thumbnail = renderer.root.findByProps({ testID: 'feed-note-thumbnail' });

        expect(renderer.root.findAllByProps({ testID: 'feed-photo-card' })).toHaveLength(0);
        expect(flattenStyle(row.props.style({ pressed: false }))).toMatchObject({
            paddingTop: Spacing.feed.rowTop,
            paddingBottom: Spacing.feed.rowBottom,
        });
        expect(flattenStyle(thumbnail.props.style)).toMatchObject({
            width: 42,
            height: 42,
            borderRadius: Radius.compact,
            borderColor: Colors.light.imageOutline,
        });
        expect(thumbnail.props.contentFit).toBe('cover');
        expect(flattenStyle(thumbnail.props.style).backgroundColor).toBe(
            tintFor('restaurant-1', Colors.light),
        );
        expect(row.props).toMatchObject({
            accessibilityLabel: 'Maya Chen, noted, AGORA souvla bar, 4.5, quietly excellent',
            accessibilityHint: 'Opens this entry',
        });
        expect(renderer.root.findAllByType('Ionicons')).toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('renders the two-photo boundary as a compressed 68pt-tile card', () => {
        const renderer = render(feedRow([
            'https://storage.example/one.jpg',
            'https://storage.example/two.jpg',
        ]));
        const card = renderer.root.findByProps({ testID: 'feed-photo-card' });
        // findAllByProps matches the composite AND host node per tile — keep host nodes only.
        const tiles = renderer.root
            .findAllByProps({ testID: 'feed-card-photo-tile' })
            .filter((node: any) => typeof node.type === 'string');

        expect(renderer.root.findAllByProps({ testID: 'feed-note-row' })).toHaveLength(0);
        expect(flattenStyle(card.props.style({ pressed: false }))).toMatchObject({
            marginVertical: Spacing.feed.cardMargin,
            borderRadius: Radius.lg,
            paddingTop: Spacing.feed.cardTop,
            paddingHorizontal: Spacing.feed.cardHorizontal,
            backgroundColor: Colors.light.surfaceNote,
        });
        expect(tiles).toHaveLength(2);
        const plateTints = [
            Colors.light.plateAmber,
            Colors.light.plateOlive,
            Colors.light.plateRose,
            Colors.light.plateGrey,
            Colors.light.plateSlate,
            Colors.light.plateSand,
        ];
        const baseTintIndex = plateTints.indexOf(tintFor('restaurant-1', Colors.light));
        for (const tile of tiles) {
            expect(flattenStyle(tile.props.style)).toMatchObject({
                height: 68,
                borderRadius: Radius.compact,
                borderColor: Colors.light.imageOutline,
            });
        }
        expect(flattenStyle(tiles[0].props.style).backgroundColor).toBe(plateTints[baseTintIndex]);
        expect(flattenStyle(tiles[1].props.style).backgroundColor).toBe(
            plateTints[(baseTintIndex + 1) % plateTints.length],
        );
        expect(card.props).toMatchObject({
            accessibilityLabel: 'Maya Chen, noted, AGORA souvla bar, 4.5, quietly excellent',
            accessibilityHint: 'Opens this entry',
        });
        expect(renderer.root.findAllByType('ExpoImage')).toHaveLength(2);
        expect(renderer.root.findByType('Ionicons').props).toMatchObject({
            name: 'heart-outline',
            size: 15,
            color: Colors.light.textMuted,
        });

        act(() => renderer.unmount());
    });

    it('uses the artboard amber and omits the trailing divider on the final ledger row', () => {
        const renderer = render(feedRow([], null), false);
        const ledger = renderer.root.findByProps({ testID: 'feed-ledger-row' });
        const rating = renderer.root.findByProps({ testID: 'feed-ledger-rating' });

        expect(ledger.props).toMatchObject({
            accessibilityLabel: 'Maya Chen, noted, AGORA souvla bar, 4.5',
            accessibilityHint: 'Opens this entry',
        });
        expect(flattenStyle(ledger.props.style({ pressed: false }))).toMatchObject({
            paddingVertical: Spacing.feed.ledgerVertical,
        });
        expect(flattenStyle(rating.props.style).color).toBe(Colors.light.amberBright);
        expect(renderer.root.findAllByProps({ testID: 'feed-row-divider' })).toHaveLength(0);

        act(() => renderer.unmount());
    });
});
