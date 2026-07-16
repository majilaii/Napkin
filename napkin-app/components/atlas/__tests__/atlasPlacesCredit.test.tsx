import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import { Colors } from '@/constants/theme';
import type { AtlasCityRow, TableAtlasData } from '@/hooks/tables/useTableAtlas';
import type { AtlasRestaurantTile } from '@/hooks/tables/useTableAtlasCity';
import { AtlasPeekStrip } from '../AtlasCityPage';
import { AtlasGridView } from '../AtlasGridView';
import { AtlasCityIndex } from '../AtlasCityIndex';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator',
    Image: 'Image',
    ImageBackground: 'ImageBackground',
    Linking: { openURL: jest.fn(() => Promise.resolve()) },
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    Pressable: 'Pressable',
    RefreshControl: 'RefreshControl',
    ScrollView: 'ScrollView',
    StyleSheet: {
        absoluteFill: { position: 'absolute', inset: 0 },
        absoluteFillObject: { position: 'absolute', inset: 0 },
        create: (styles: unknown) => styles,
    },
    Text: 'Text',
    View: 'View',
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({
    ImpactFeedbackStyle: { Light: 'light' },
    impactAsync: jest.fn(),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/components/ui/napkin', () => ({ PressableScale: 'PressableScale' }));
jest.mock('@/components/feed/Avatar', () => ({ Avatar: 'Avatar' }));
jest.mock('../AtlasEmptyState', () => ({ AtlasEmptyState: 'AtlasEmptyState' }));
jest.mock('../AtlasLegend', () => ({ AtlasLegend: 'AtlasLegend' }));
jest.mock('../AtlasMapView', () => ({ AtlasMapView: 'AtlasMapView' }));
jest.mock('../AtlasPeekSheet', () => ({ AtlasPeekSheet: 'AtlasPeekSheet' }));

function city(name: string, overrides: Partial<AtlasCityRow> = {}): AtlasCityRow {
    return {
        name,
        spot_count: 2,
        member_count: 2,
        last_visit_at: '2026-07-15T00:00:00.000Z',
        hero_photo_url: null,
        hero_photo_source: null,
        hero_places_photo_attribution_html: null,
        hero_restaurant_name: null,
        ...overrides,
    };
}

function tile(id: string, overrides: Partial<AtlasRestaurantTile> = {}): AtlasRestaurantTile {
    return {
        id,
        name: `Restaurant ${id}`,
        cuisine: null,
        photo_url: null,
        photo_source: null,
        places_photo_attribution_html: null,
        lat: 51.5,
        lng: -0.1,
        rating: 4.5,
        tile_type: 'solo',
        wished_by_viewer: false,
        companion_ids: [],
        visits: [],
        round_count: 0,
        solo_count: 1,
        member_ids: ['member-1'],
        member_names: ['Alex'],
        member_avatar_urls: [null],
        ...overrides,
    };
}

function textContent(node: any): string {
    return node.children
        .map((child: any) => typeof child === 'string' ? child : textContent(child))
        .join('');
}

function creditTextNodes(renderer: any, testID: string) {
    return renderer.root.findAllByType('Text')
        .filter((node: any) => node.props.testID === testID);
}

describe('Atlas Places photo compliance', () => {
    it('gates city heroes and renders one aggregate line for the city index', () => {
        const data: TableAtlasData = {
            stats: { members: 2, cities: 5, spots: 10, founded_at: null },
            cities: [
                city('London', {
                    hero_photo_url: 'https://cdn.test/places.jpg',
                    hero_photo_source: 'places',
                    hero_places_photo_attribution_html: 'Jane Doe',
                    hero_restaurant_name: 'Kono',
                }),
                city('Berlin', {
                    hero_photo_url: 'https://cdn.test/berlin.jpg',
                    hero_photo_source: 'places',
                    hero_places_photo_attribution_html: 'Luis Ray',
                    hero_restaurant_name: 'Otto',
                }),
                city('Paris', {
                    hero_photo_url: 'https://cdn.test/user.jpg',
                    hero_photo_source: 'user',
                }),
                city('Rome', {
                    hero_photo_url: 'https://cdn.test/uncredited.jpg',
                    hero_photo_source: 'places',
                    hero_places_photo_attribution_html: null,
                }),
                city('Madrid', {
                    hero_photo_url: 'https://cdn.test/ambiguous.jpg',
                }),
            ],
        };
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <AtlasCityIndex data={data} onCityPress={jest.fn()} />,
            );
        });

        const heroSources = renderer.root.findAllByType('ImageBackground')
            .map((node: any) => node.props.source);
        expect(heroSources).toHaveLength(3);
        expect(heroSources).toEqual(expect.arrayContaining([
            { uri: 'https://cdn.test/places.jpg' },
            { uri: 'https://cdn.test/berlin.jpg' },
            { uri: 'https://cdn.test/user.jpg' },
        ]));
        const credits = creditTextNodes(renderer, 'atlas-city-index-places-credit');
        expect(credits).toHaveLength(1);
        expect(textContent(credits[0])).toBe('photos · Jane Doe, Luis Ray');

        act(() => renderer.unmount());
    });

    it('renders one deduped aggregate line for the restaurant grid', () => {
        const tiles = [
            tile('a', {
                photo_url: 'https://cdn.test/a.jpg',
                photo_source: 'places',
                places_photo_attribution_html: 'Jane Doe',
            }),
            tile('b', {
                photo_url: 'https://cdn.test/b.jpg',
                photo_source: 'places',
                places_photo_attribution_html: ' jane   doe ',
            }),
            tile('c', {
                photo_url: 'https://cdn.test/c.jpg',
                photo_source: 'places',
                places_photo_attribution_html: 'Luis Ray',
            }),
            tile('user', {
                photo_url: 'https://cdn.test/user.jpg',
                photo_source: 'table',
            }),
            tile('missing', {
                photo_url: 'https://cdn.test/missing.jpg',
                photo_source: 'places',
                places_photo_attribution_html: null,
            }),
        ];
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <AtlasGridView tiles={tiles} onTilePress={jest.fn()} />,
            );
        });

        expect(renderer.root.findAllByType('ImageBackground').map((node: any) => node.props.source))
            .toEqual(expect.arrayContaining([
                { uri: 'https://cdn.test/a.jpg' },
                { uri: 'https://cdn.test/b.jpg' },
                { uri: 'https://cdn.test/c.jpg' },
                { uri: 'https://cdn.test/user.jpg' },
            ]));
        expect(renderer.root.findAllByType('ImageBackground')).toHaveLength(4);
        const credits = creditTextNodes(renderer, 'atlas-grid-places-credit');
        expect(credits).toHaveLength(1);
        const [credit] = credits;
        expect(textContent(credit)).toBe('photos · Jane Doe, Luis Ray');

        act(() => renderer.unmount());
    });

    it('gates peek-strip images and renders one surface-level aggregate line', () => {
        const tiles = [
            tile('a', {
                photo_url: 'https://cdn.test/a.jpg',
                photo_source: 'places',
                places_photo_attribution_html: 'Jane Doe',
            }),
            tile('b', {
                photo_url: 'https://cdn.test/b.jpg',
                photo_source: 'places',
                places_photo_attribution_html: 'Luis Ray',
            }),
            tile('unknown', {
                photo_url: 'https://cdn.test/unknown.jpg',
            }),
        ];
        let renderer: any;
        act(() => {
            renderer = TestRenderer.create(
                <AtlasPeekStrip
                    tiles={tiles}
                    palette={Colors.light}
                    onCardPress={jest.fn()}
                />,
            );
        });

        expect(renderer.root.findAllByType('Image').map((node: any) => node.props.source))
            .toEqual([
                { uri: 'https://cdn.test/a.jpg' },
                { uri: 'https://cdn.test/b.jpg' },
            ]);
        const credits = creditTextNodes(renderer, 'atlas-peek-strip-places-credit');
        expect(credits).toHaveLength(1);
        const [credit] = credits;
        expect(textContent(credit)).toBe('photos · Jane Doe, Luis Ray');

        act(() => renderer.unmount());
    });
});
