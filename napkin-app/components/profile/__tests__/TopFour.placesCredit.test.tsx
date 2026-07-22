import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import type { TopPick } from '@/hooks/users/useUserProfile';
import { TopFour } from '../TopFour';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
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
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('../SectionHeader', () => ({ SectionHeader: 'SectionHeader' }));
jest.mock('../MarqueePlate', () => ({ MarqueePlate: 'MarqueePlate' }));

function pick(id: string, overrides: Partial<TopPick> = {}): TopPick {
    return {
        restaurant_id: id,
        name: `Restaurant ${id}`,
        city: 'London',
        cuisine: 'Italian',
        photo_url: null,
        photo_source: null,
        places_photo_attribution_html: null,
        hero_photo_url: null,
        hero_entry_photo_id: null,
        max_rating: 4.5,
        visit_count: 1,
        last_visited_at: '2026-07-15T00:00:00.000Z',
        liked: true,
        has_review: false,
        review_entry_id: null,
        ...overrides,
    };
}

describe('TopFour sourced photos', () => {
    it('renders sourced Places plates without inline attribution', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <TopFour picks={[
                    pick('a', {
                        name: 'A',
                        photo_url: 'https://cdn.test/a.jpg',
                        photo_source: 'places',
                        places_photo_attribution_html: '<a href="https://maps.test/jane">Jane Doe</a>',
                    }),
                    pick('b', {
                        name: 'B',
                        photo_url: 'https://cdn.test/b.jpg',
                        photo_source: 'places',
                        places_photo_attribution_html: '  jane   doe  ',
                    }),
                    pick('c', {
                        name: 'C',
                        photo_url: 'https://cdn.test/c.jpg',
                        photo_source: 'places',
                        places_photo_attribution_html: 'Luis Ray',
                    }),
                ]} />,
            );
        });

        expect(renderer.root.findAllByType('MarqueePlate').map((node: any) => node.props.photoUrl))
            .toEqual([
                'https://cdn.test/a.jpg',
                'https://cdn.test/b.jpg',
                'https://cdn.test/c.jpg',
            ]);
        expect(renderer.root.findAllByProps({ testID: 'profile-top-four-places-credit' }))
            .toHaveLength(0);

        act(() => renderer.unmount());
    });

    it('fails an uncredited Places plate closed while a chosen memory stays visible', () => {
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <TopFour picks={[
                    pick('missing', {
                        name: 'Missing',
                        photo_url: 'https://cdn.test/uncredited.jpg',
                        photo_source: 'places',
                        places_photo_attribution_html: null,
                    }),
                    pick('memory', {
                        name: 'Memory',
                        photo_url: 'https://cdn.test/underlying-places.jpg',
                        photo_source: 'places',
                        places_photo_attribution_html: 'Places Author',
                        hero_photo_url: 'https://cdn.test/own-memory.jpg',
                    }),
                ]} />,
            );
        });

        const plates = renderer.root.findAllByType('MarqueePlate');
        expect(plates[0].props).toMatchObject({ photoUrl: null, placesWash: false });
        expect(plates[1].props).toMatchObject({
            photoUrl: 'https://cdn.test/own-memory.jpg',
            placesWash: false,
        });
        expect(renderer.root.findAllByProps({ testID: 'profile-top-four-places-credit' })
            .filter((node: any) => node.type === 'Text'))
            .toHaveLength(0);

        act(() => renderer.unmount());
    });
});
