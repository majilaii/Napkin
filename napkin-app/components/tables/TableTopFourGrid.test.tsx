import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import { Colors } from '@/constants/theme';
import type { TopFourSlot } from '@/hooks/tables/useTableTopFour';
import { TableTopFourGrid } from './TableTopFourGrid';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    Image: 'Image',
    Linking: { openURL: jest.fn(() => Promise.resolve()) },
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    Pressable: 'Pressable',
    StyleSheet: {
        absoluteFill: { position: 'absolute', inset: 0 },
        absoluteFillObject: { position: 'absolute', inset: 0 },
        create: (styles: unknown) => styles,
    },
    Text: 'Text',
    View: 'View',
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

function slot(
    position: 1 | 2 | 3 | 4,
    overrides: Partial<TopFourSlot['restaurant']> = {},
    customPhotoUrl: string | null = null,
): TopFourSlot {
    return {
        position,
        restaurant_id: `restaurant-${position}`,
        custom_photo_url: customPhotoUrl,
        updated_by: 'user-1',
        updated_at: '2026-07-15T00:00:00.000Z',
        restaurant: {
            id: `restaurant-${position}`,
            name: `Restaurant ${position}`,
            city: 'London',
            country: 'GB',
            photo_url: null,
            photo_source: null,
            places_photo_attribution_html: null,
            external_id: `place-${position}`,
            ...overrides,
        },
    };
}

function textContent(node: any): string {
    return node.children
        .map((child: any) => typeof child === 'string' ? child : textContent(child))
        .join('');
}

const baseProps = {
    currentUserId: 'viewer-1',
    onEdit: jest.fn(),
    onTapEmptySlot: jest.fn(),
    palette: Colors.light,
};

describe('TableTopFourGrid sourced photos', () => {
    it('renders sourced Places photos without inline attribution', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <TableTopFourGrid
                    {...baseProps}
                    slots={[
                        slot(1, {
                            photo_url: 'https://cdn.test/a.jpg',
                            photo_source: 'places',
                            places_photo_attribution_html: 'Jane Doe',
                        }),
                        slot(2, {
                            photo_url: 'https://cdn.test/b.jpg',
                            photo_source: 'places',
                            places_photo_attribution_html: 'Luis Ray',
                        }),
                    ]}
                    lastEvent={null}
                />,
            );
        });

        expect(renderer.root.findAllByType('ExpoImage').map((node: any) => node.props.source))
            .toEqual([
                { uri: 'https://cdn.test/a.jpg' },
                { uri: 'https://cdn.test/b.jpg' },
            ]);
        expect(renderer.root.findAllByProps({ testID: 'table-top-four-places-credit' }))
            .toHaveLength(0);

        act(() => renderer.root.findAllByType('ExpoImage')[0].props.onError());
        expect(renderer.root.findAllByType('ExpoImage')).toHaveLength(1);
        expect(renderer.root.findAllByProps({ testID: 'table-top-four-places-credit' }))
            .toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('suppresses missing source metadata and preserves custom-photo precedence and social history', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <TableTopFourGrid
                    {...baseProps}
                    slots={[
                        slot(1, {
                            name: 'Kono',
                            photo_url: 'https://cdn.test/a.jpg',
                            photo_source: 'places',
                            places_photo_attribution_html: '<a href="https://maps.test/jane">Jane Doe</a>',
                        }),
                        slot(2, {
                            photo_url: 'https://cdn.test/b.jpg',
                            photo_source: 'places',
                            places_photo_attribution_html: ' jane   doe ',
                        }),
                        slot(3, {
                            photo_url: 'https://cdn.test/underlying.jpg',
                            photo_source: 'places',
                            places_photo_attribution_html: 'Hidden Author',
                        }, 'https://cdn.test/custom.jpg'),
                        slot(4, {
                            photo_url: 'https://cdn.test/uncredited.jpg',
                            photo_source: 'places',
                            places_photo_attribution_html: null,
                        }),
                    ]}
                    lastEvent={{
                        actor_id: 'editor-1',
                        actor_name: 'Alex',
                        actor_avatar_url: null,
                        event_type: 'added',
                        position: 1,
                        prev_restaurant: null,
                        next_restaurant: { id: 'restaurant-1', name: 'Kono' },
                        created_at: '2025-01-01T00:00:00.000Z',
                    }}
                />,
            );
        });

        expect(renderer.root.findAllByType('ExpoImage').map((node: any) => node.props.source))
            .toEqual([
                { uri: 'https://cdn.test/a.jpg' },
                { uri: 'https://cdn.test/b.jpg' },
                { uri: 'https://cdn.test/custom.jpg' },
            ]);
        expect(renderer.root.findAllByProps({ testID: 'table-top-four-places-credit' }))
            .toHaveLength(0);
        expect(
            renderer.root.findAllByType('Text')
                .map((node: any) => textContent(node))
                .some((text: string) => text.startsWith('Alex added Kono ·')),
        ).toBe(true);

        act(() => renderer.unmount());
    });
});
