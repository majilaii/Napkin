import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import type { ProfileQuickTake } from '@/lib/profileQuickTakes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    Linking: { openURL: jest.fn(() => Promise.resolve()) },
    StyleSheet: {
        absoluteFill: { position: 'absolute', inset: 0 },
        hairlineWidth: 1,
        create: (styles: unknown) => styles,
    },
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-haptics', () => ({
    impactAsync: jest.fn(),
    selectionAsync: jest.fn(),
    ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));
jest.mock('react-native-reanimated', () => ({
    __esModule: true,
    default: { View: 'AnimatedView' },
    LinearTransition: { duration: () => 'layout-transition' },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withTiming: (value: unknown) => value,
    withSpring: (value: unknown) => value,
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

// Native and animation stubs must be installed before importing the component.
// eslint-disable-next-line import/first
import { QuickTakes } from '../QuickTakes';

const PHOTO_TAKE: ProfileQuickTake = {
    prompt_key: 'best_value',
    position: 1,
    restaurant_id: 'restaurant-1',
    name: 'Evelyn’s Table',
    city: 'London',
    cuisine: 'Modern British',
    photo_url: 'https://example.com/evelyns.jpg',
    photo_source: 'places',
    places_photo_attribution_html: '<a href="https://maps.example/ada">Ada Lens</a>',
    note: 'The set menu still feels generous.',
};

function renderQuickTakes(
    take: ProfileQuickTake,
    onOpenRestaurant = jest.fn(),
    onEdit = jest.fn(),
) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <QuickTakes
                takes={[take]}
                isOwner
                onEdit={onEdit}
                onOpenRestaurant={onOpenRestaurant}
            />,
        );
    });
    return { renderer, onOpenRestaurant, onEdit };
}

function pressableWith(renderer: any, prop: string, value: unknown) {
    return renderer.root.findAllByType('Pressable').find((node: any) => node.props[prop] === value);
}

function flattenStyle(style: any) {
    const styles = Array.isArray(style) ? style.flat(Infinity) : [style];
    return Object.assign({}, ...styles.filter(Boolean));
}

function resolvedPressableStyle(node: any, pressed = false) {
    return flattenStyle(
        typeof node.props.style === 'function'
            ? node.props.style({ pressed })
            : node.props.style,
    );
}

it('opens the restaurant from both the expanded plate and name without collapsing the take', () => {
    const { renderer, onOpenRestaurant, onEdit } = renderQuickTakes(PHOTO_TAKE);
    const artLink = pressableWith(renderer, 'testID', 'quick-take-restaurant-art-link');
    const copyLink = pressableWith(renderer, 'testID', 'quick-take-restaurant-copy-link');
    const collapse = pressableWith(renderer, 'accessibilityHint', 'Collapses this take');

    expect(collapse).toBeDefined();
    for (const link of [artLink, copyLink]) {
        expect(link).toBeDefined();
        expect(link.props.accessibilityRole).toBe('link');
        expect(link.props.accessibilityLabel).toBe('Open Evelyn’s Table restaurant page');
        expect(link.props.accessibilityHint).toBe('Shows the restaurant’s details');

        let ancestor = link.parent;
        while (ancestor) {
            expect(ancestor).not.toBe(collapse);
            ancestor = ancestor.parent;
        }
    }

    act(() => {
        artLink.props.onPress();
        copyLink.props.onPress();
    });

    expect(onOpenRestaurant).toHaveBeenNthCalledWith(1, 'restaurant-1');
    expect(onOpenRestaurant).toHaveBeenNthCalledWith(2, 'restaurant-1');
    expect(pressableWith(renderer, 'accessibilityHint', 'Collapses this take')).toBeDefined();
    expect(onEdit).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType('Ionicons').some((node: any) => node.props.name === 'chevron-forward'))
        .toBe(false);
});

it('keeps collapse, owner edit, and restaurant navigation as separate actions', () => {
    const { renderer, onOpenRestaurant, onEdit } = renderQuickTakes(PHOTO_TAKE);
    const collapse = pressableWith(renderer, 'accessibilityHint', 'Collapses this take');

    act(() => collapse.props.onPress());
    const summary = pressableWith(renderer, 'accessibilityHint', 'Expands this take');
    const summaryTexts = summary.findAllByType('Text');

    expect(summary).toBeDefined();
    expect(flattenStyle(summaryTexts[0].props.style).width).toBe(112);
    expect(flattenStyle(summaryTexts[1].props.style)).toMatchObject({ flex: 1, minWidth: 0 });
    expect(summary.findAllByType('Ionicons').map((node: any) => node.props.name)).toEqual([
        'chevron-down',
    ]);
    expect(renderer.root.findAllByType('Image')).toHaveLength(0);
    expect(onOpenRestaurant).not.toHaveBeenCalled();

    act(() => summary.props.onPress());
    expect(pressableWith(renderer, 'accessibilityHint', 'Collapses this take')).toBeDefined();
    expect(onOpenRestaurant).not.toHaveBeenCalled();

    const edit = pressableWith(renderer, 'accessibilityLabel', 'edit');
    act(() => edit.props.onPress());
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onOpenRestaurant).not.toHaveBeenCalled();
});

it('renders the approved photo plate grid with olive semibold metadata', () => {
    const { renderer } = renderQuickTakes(PHOTO_TAKE);
    const detail = renderer.root.findByProps({ testID: 'quick-take-detail' });
    const header = renderer.root.findByProps({ testID: 'quick-take-detail-header' });
    const body = renderer.root.findByProps({ testID: 'quick-take-detail-body' });
    const mediaRow = renderer.root.findByProps({ testID: 'quick-take-detail-media-row' });
    const collapse = pressableWith(renderer, 'testID', 'quick-take-collapse-control');
    const artLink = pressableWith(renderer, 'testID', 'quick-take-restaurant-art-link');
    const copyLink = pressableWith(renderer, 'testID', 'quick-take-restaurant-copy-link');
    const collapseSurface = collapse.findAllByType('AnimatedView')[0];
    const artSurface = artLink.findAllByType('AnimatedView')[0];
    const image = artLink.findByType('Image');
    const overlay = artSurface.findAllByType('View')[0];
    const kicker = header.findAllByType('Text')[0];
    const name = copyLink.findAllByType('Text')[0];
    const meta = copyLink.findAllByType('Text')[1];
    const note = renderer.root.findByProps({ testID: 'quick-take-detail-note' });

    expect(
        detail.children
            .filter((node: any) => typeof node !== 'string')
            .map((node: any) => node.props.testID),
    ).toEqual(['quick-take-detail-header', 'quick-take-detail-body']);
    expect(flattenStyle(detail.props.style).flexDirection).not.toBe('row');

    expect(header.findAllByType('Pressable').map((node: any) => node.props.testID)).toEqual([
        'quick-take-collapse-control',
    ]);
    expect(kicker.props.numberOfLines).toBe(2);
    expect(flattenStyle(header.props.style)).toMatchObject({
        flexDirection: 'row',
        alignItems: 'center',
    });

    expect(mediaRow.findAllByType('Pressable').map((node: any) => node.props.testID)).toEqual([
        'quick-take-restaurant-art-link',
        'quick-take-restaurant-copy-link',
    ]);
    expect(flattenStyle(mediaRow.props.style)).toMatchObject({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    });
    expect(flattenStyle(artSurface.props.style)).toMatchObject({
        width: 76,
        height: 76,
        borderRadius: Radius.md,
        borderWidth: 1,
        borderColor: Colors.light.imageOutline,
    });
    expect(image.props).toMatchObject({ contentFit: 'cover', accessible: false });
    expect(flattenStyle(overlay.props.style)).toMatchObject({
        position: 'absolute',
        inset: 0,
        backgroundColor: Colors.light.placesOverlayTint,
        opacity: Colors.light.placesOverlayOpacity,
    });
    expect(overlay.props.pointerEvents).toBe('none');
    expect(renderer.root.findAllByProps({ testID: 'quick-take-places-credit' }))
        .toHaveLength(0);
    expect(resolvedPressableStyle(copyLink)).toMatchObject({
        flex: 1,
        minWidth: 0,
        minHeight: 44,
    });
    expect(name.props.numberOfLines).toBe(3);
    expect(meta.children).toEqual(['London · Modern British']);
    expect(flattenStyle(meta.props.style)).toMatchObject({
        fontSize: Type.metadata.fontSize,
        lineHeight: Type.metadata.lineHeight,
        fontFamily: Type.sectionTitle.fontFamily,
        fontWeight: Type.sectionTitle.fontWeight,
        color: Colors.light.textSecondary,
    });

    expect(
        body.children
            .filter((node: any) => typeof node !== 'string')
            .map((node: any) => node.props.testID),
    ).toEqual(['quick-take-detail-media-row', 'quick-take-detail-note']);
    expect(note.children).toEqual(['— The set menu still feels generous.']);
    expect(flattenStyle(note.props.style).marginTop).toBe(Spacing.sm + Spacing.xs);
    expect(flattenStyle(collapseSurface.props.style)).toMatchObject({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    });
    expect(flattenStyle(artSurface.props.style).position).toBeUndefined();
    expect(flattenStyle(collapseSurface.props.style).position).toBeUndefined();
});

it('renders a pure-type, full-width restaurant link when no photo exists', () => {
    const take = { ...PHOTO_TAKE, photo_url: null };
    const { renderer, onOpenRestaurant } = renderQuickTakes(take);
    const mediaRow = renderer.root.findByProps({ testID: 'quick-take-detail-media-row' });
    const copyLink = pressableWith(renderer, 'testID', 'quick-take-restaurant-copy-link');

    expect(renderer.root.findAllByType('Image')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'quick-take-places-credit' })).toHaveLength(0);
    expect(pressableWith(renderer, 'testID', 'quick-take-restaurant-art-link')).toBeUndefined();
    expect(mediaRow.findAllByType('AnimatedView')).toHaveLength(0);
    expect(mediaRow.findAllByType('Pressable').map((node: any) => node.props.testID)).toEqual([
        'quick-take-restaurant-copy-link',
    ]);
    expect(mediaRow.findAllByType('Text').map((node: any) => node.children.join(''))).toEqual([
        'Evelyn’s Table',
        'London · Modern British',
    ]);
    expect(resolvedPressableStyle(copyLink)).toMatchObject({ flex: 1, minWidth: 0 });

    act(() => copyLink.props.onPress());
    expect(onOpenRestaurant).toHaveBeenCalledWith('restaurant-1');
});

it('falls back to the same pure-type layout when the photo fails to load', () => {
    const { renderer, onOpenRestaurant } = renderQuickTakes(PHOTO_TAKE);
    const image = renderer.root.findByType('Image');

    act(() => image.props.onError());

    const mediaRow = renderer.root.findByProps({ testID: 'quick-take-detail-media-row' });
    const copyLink = pressableWith(renderer, 'testID', 'quick-take-restaurant-copy-link');

    expect(renderer.root.findAllByType('Image')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'quick-take-places-credit' })).toHaveLength(0);
    expect(pressableWith(renderer, 'testID', 'quick-take-restaurant-art-link')).toBeUndefined();
    expect(mediaRow.findAllByType('Pressable').map((node: any) => node.props.testID)).toEqual([
        'quick-take-restaurant-copy-link',
    ]);

    act(() => copyLink.props.onPress());
    expect(onOpenRestaurant).toHaveBeenCalledWith('restaurant-1');
});

it.each([
    ['missing attribution', { places_photo_attribution_html: null }],
    ['ambiguous provenance', { photo_source: null }],
])('fails closed to pure type for %s', (_caseName, override) => {
    const { renderer } = renderQuickTakes({ ...PHOTO_TAKE, ...override });

    expect(renderer.root.findAllByType('Image')).toHaveLength(0);
    expect(pressableWith(renderer, 'testID', 'quick-take-restaurant-art-link')).toBeUndefined();
    expect(renderer.root.findAllByProps({ testID: 'quick-take-places-credit' })).toHaveLength(0);
});
