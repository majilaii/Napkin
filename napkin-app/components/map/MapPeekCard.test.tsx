/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        View: host('View'),
        Text: host('Text'),
        Pressable: host('Pressable'),
        ActivityIndicator: host('ActivityIndicator'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            absoluteFill: { position: 'absolute', inset: 0 },
        },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});
jest.mock('@expo/vector-icons', () => {
    const ReactModule = require('react');
    return {
        Ionicons: (props: Record<string, unknown>) =>
            ReactModule.createElement('Ionicon', props),
    };
});
jest.mock('expo-image', () => {
    const ReactModule = require('react');
    return {
        Image: (props: Record<string, unknown>) =>
            ReactModule.createElement('ExpoImage', props),
    };
});
import { MapPeekCard } from './MapPeekCard';
import { Colors, Radius } from '@/constants/theme';

const noop = jest.fn();

function props(overrides: Record<string, unknown> = {}) {
    return {
        name: 'The Ledbury',
        meta: 'Modern British · $$$$ · Notting Hill',
        hoursLine: 'today 9:00 am – 11:00 pm',
        contextLine: 'saved by you',
        thumbnail: null,
        fontScale: 1,
        palette: Colors.light,
        onThumbnailError: noop,
        onOpen: noop,
        openAccessibilityLabel: 'Open The Ledbury',
        saved: false,
        wishlistPending: false,
        wishlistDisabled: false,
        onWishlistPress: noop,
        onWishlistPressIn: noop,
        onLogVisit: noop,
        onDirections: noop,
        ...overrides,
    };
}

function render(overrides: Record<string, unknown> = {}) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(<MapPeekCard {...props(overrides) as any} />);
    });
    return renderer;
}

function styleObjects(style: unknown): Record<string, unknown>[] {
    return (Array.isArray(style) ? style.flat(Infinity) : [style])
        .filter((value): value is Record<string, unknown> => !!value && typeof value === 'object');
}

describe('MapPeekCard compact states', () => {
    it('renders a 136pt pure-type card with no media slot, plate, glyph, or ghost gap', () => {
        const renderer = render();
        const card = renderer.root.findByProps({ testID: 'map-peek-card' });

        expect(styleObjects(card.props.style)).toEqual(expect.arrayContaining([
            expect.objectContaining({ height: 136 }),
        ]));
        expect(renderer.root.findAllByProps({ testID: 'map-peek-thumbnail' })).toHaveLength(0);
        expect(renderer.root.findAllByType('ExpoImage')).toHaveLength(0);
        // The only icons are the three literal actions; no restaurant/plate glyph exists.
        expect(renderer.root.findAllByType('Ionicon').map((node: any) => node.props.name)).toEqual([
            'create-outline',
            'heart-outline',
            'navigate-outline',
        ]);
    });

    it.each(['entry', 'clip'])('renders a 60pt radius-12 %s thumbnail at 136pt', (kind) => {
        const renderer = render({
            thumbnail: { url: `https://storage.example/${kind}.jpg`, isPlaces: false },
        });
        const card = renderer.root.findByProps({ testID: 'map-peek-card' });
        const thumbnail = renderer.root.findByProps({ testID: 'map-peek-thumbnail' });

        expect(styleObjects(card.props.style)).toEqual(expect.arrayContaining([
            expect.objectContaining({ height: 136 }),
        ]));
        expect(styleObjects(thumbnail.props.style)).toEqual(expect.arrayContaining([
            expect.objectContaining({ width: 60, height: 60, borderRadius: Radius.md }),
        ]));
        expect(renderer.root.findAllByProps({ testID: 'map-peek-places-credit' })).toHaveLength(0);
    });

    it('keeps a Places thumbnail at 136pt with no inline attribution', () => {
        const renderer = render({
            thumbnail: { url: 'https://storage.example/places.jpg', isPlaces: true },
        });
        const card = renderer.root.findByProps({ testID: 'map-peek-card' });

        expect(styleObjects(card.props.style)).toEqual(expect.arrayContaining([
            expect.objectContaining({ height: 136 }),
        ]));
        expect(renderer.root.findAllByProps({ testID: 'map-peek-places-credit' }))
            .toHaveLength(0);
    });

    it('keeps profile and gather as separate 44pt controls outside the restaurant button', () => {
        const openProfile = jest.fn();
        const gather = jest.fn();
        const renderer = render({
            contextLine: 'saved by Clara',
            contextActionLabel: "Open Clara's profile",
            onContextPress: openProfile,
            contextTailLine: 'gather here',
            contextTailActionLabel: 'Gather at The Ledbury',
            onContextTailPress: gather,
        });
        const open = renderer.root.findByProps({ testID: 'map-peek-open-action' });
        const overlay = renderer.root.findByProps({ testID: 'map-peek-context-actions-overlay' });
        const profile = renderer.root.findByProps({ testID: 'map-peek-context-action' });
        const gatherAction = renderer.root.findByProps({ testID: 'map-peek-context-tail-action' });

        expect(open.props.children).toBeUndefined();
        expect(overlay.props.style).toEqual(expect.objectContaining({ height: 44 }));
        expect(styleObjects(profile.props.style({ pressed: false }))).toEqual(expect.arrayContaining([
            expect.objectContaining({ minWidth: 44, height: 44 }),
        ]));
        expect(styleObjects(gatherAction.props.style({ pressed: false }))).toEqual(expect.arrayContaining([
            expect.objectContaining({ minWidth: 44, height: 44 }),
        ]));

        act(() => profile.props.onPress());
        act(() => gatherAction.props.onPress());
        expect(openProfile).toHaveBeenCalledTimes(1);
        expect(gather).toHaveBeenCalledTimes(1);
    });

    it('keeps 44pt heart/directions targets and the fixed log · heart · directions grammar', () => {
        const renderer = render();
        const heart = renderer.root.findByProps({ testID: 'map-peek-heart-action' });
        const directions = renderer.root.findByProps({ testID: 'map-peek-directions-action' });
        const log = renderer.root.findByProps({ testID: 'map-peek-log-action' });

        expect(styleObjects(heart.props.style({ pressed: false }))).toEqual(expect.arrayContaining([
            expect.objectContaining({ width: 44, minHeight: 44 }),
            expect.objectContaining({ height: 44 }),
        ]));
        expect(styleObjects(directions.props.style({ pressed: false }))).toEqual(expect.arrayContaining([
            expect.objectContaining({ width: 44, minHeight: 44 }),
            expect.objectContaining({ height: 44 }),
        ]));
        expect(log.props.accessibilityLabel).toBe('Log a visit to The Ledbury');
        expect(directions.props.accessibilityLabel).toBe('Directions to The Ledbury');
    });
});
