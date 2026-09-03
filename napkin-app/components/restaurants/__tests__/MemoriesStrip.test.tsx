/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';
import { MemoriesStrip } from '../MemoriesStrip';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        View: host('View'),
        StyleSheet: {
            absoluteFillObject: { position: 'absolute', inset: 0 },
            hairlineWidth: 0.5,
            create: (styles: unknown) => styles,
        },
    };
});
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

function selfRow(overrides: Partial<SelfLogRow>): SelfLogRow {
    return {
        id: 'self',
        entry_id: 'entry-self',
        table_night_id: null,
        source: 'solo',
        rating: 4,
        note: null,
        visited_at: '2026-09-01T12:00:00.000Z',
        companions: [],
        photos: [],
        ...overrides,
    };
}

function renderStrip(payload: any, excludedUrls: string[] = []) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <MemoriesStrip
                restaurantId="restaurant-1"
                payload={payload}
                excludedUrls={excludedUrls}
            />,
        );
    });
    return renderer;
}

describe('MemoriesStrip', () => {
    beforeEach(() => mockPush.mockClear());

    it('orders sources, sorts self rows newest-first, dedupes URLs, and caps at 12', () => {
        const others = Array.from({ length: 15 }, (_, index) => ({
            url: `https://photos.test/other-${index}.jpg`,
            entry_id: `other-${index}`,
        }));
        const renderer = renderStrip({
            self_log: [
                selfRow({
                    id: 'old',
                    entry_id: 'entry-old',
                    visited_at: '2026-08-01T12:00:00.000Z',
                    photos: [{ id: 'old-photo', url: 'https://photos.test/old.jpg' }],
                }),
                selfRow({
                    id: 'new',
                    entry_id: 'entry-new',
                    visited_at: '2026-09-01T12:00:00.000Z',
                    photos: [
                        { id: 'new-a', url: 'https://photos.test/new-a.jpg' },
                        { id: 'new-b', url: 'https://photos.test/new-b.jpg' },
                    ],
                }),
            ],
            photos: {
                from_your_table: [
                    { url: 'https://photos.test/new-a.jpg', entry_id: 'duplicate' },
                    { url: 'https://photos.test/table.jpg', entry_id: 'table-entry' },
                ],
                from_others: others,
            },
            public_reviews: [{
                entry_id: 'review-entry',
                photo_url: 'https://photos.test/review.jpg',
            }],
        });

        const images = renderer.root.findAllByType('ExpoImage');
        expect(images).toHaveLength(12);
        expect(images.map((image: any) => image.props.source.uri)).toEqual([
            'https://photos.test/new-a.jpg',
            'https://photos.test/new-b.jpg',
            'https://photos.test/old.jpg',
            'https://photos.test/table.jpg',
            ...others.slice(0, 8).map((photo) => photo.url),
        ]);

        act(() => renderer.unmount());
    });

    it('renders nothing for zero tiles and for a photos-less legacy payload', () => {
        const empty = renderStrip({
            self_log: [],
            photos: { from_your_table: [], from_others: [] },
            public_reviews: [],
        });
        expect(empty.toJSON()).toBeNull();
        act(() => empty.unmount());

        const legacy = renderStrip({
            self_log: [selfRow({
                photos: [{ id: 'legacy', url: 'https://photos.test/legacy.jpg' }],
            })],
            public_reviews: [],
        });
        expect(legacy.toJSON()).toBeNull();
        act(() => legacy.unmount());
    });

    it('does not repeat entry photos already promoted into the masthead', () => {
        const renderer = renderStrip({
            self_log: [selfRow({
                photos: [
                    { id: 'hero', url: 'https://photos.test/hero.jpg' },
                    { id: 'memory', url: 'https://photos.test/memory.jpg' },
                ],
            })],
            photos: { from_your_table: [], from_others: [] },
            public_reviews: [],
        }, ['https://photos.test/hero.jpg']);

        const images = renderer.root.findAllByType('ExpoImage');
        expect(images.map((image: any) => image.props.source.uri)).toEqual([
            'https://photos.test/memory.jpg',
        ]);
        act(() => renderer.unmount());
    });

    it('routes own and public entry photos with the correct scope and leaves unbacked photos inert', () => {
        const renderer = renderStrip({
            self_log: [selfRow({
                entry_id: 'entry-tappable',
                photos: [{ id: 'self-photo', url: 'https://photos.test/tappable.jpg' }],
            })],
            photos: {
                from_your_table: [],
                from_others: [{ url: 'https://photos.test/inert.jpg' }],
            },
            public_reviews: [{
                entry_id: 'entry-public',
                photo_url: 'https://photos.test/public.jpg',
            }],
        });
        const labelled = renderer.root
            .findAllByProps({ accessibilityLabel: 'photo from a visit' })
            .filter((node: any) => typeof node.type === 'string');

        expect(labelled).toHaveLength(3);
        expect(labelled[0].props.accessibilityRole).toBe('imagebutton');
        act(() => labelled[0].props.onPress());
        expect(mockPush).toHaveBeenCalledWith({
            pathname: '/entry-detail',
            params: { entryId: 'entry-tappable' },
        });
        expect(labelled[1].props.accessibilityRole).toBeUndefined();
        expect(labelled[1].props.onPress).toBeUndefined();
        expect(labelled[2].props.accessibilityRole).toBe('imagebutton');
        act(() => labelled[2].props.onPress());
        expect(mockPush).toHaveBeenLastCalledWith({
            pathname: '/entry-detail',
            params: { entryId: 'entry-public', viewAs: 'public' },
        });

        act(() => renderer.unmount());
    });
});
