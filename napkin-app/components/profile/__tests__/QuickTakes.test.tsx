import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import type { ProfileQuickTake } from '@/lib/profileQuickTakes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
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

it('opens the restaurant from the expanded artwork without collapsing the take', () => {
    const { renderer, onOpenRestaurant, onEdit } = renderQuickTakes(PHOTO_TAKE);
    const artLink = pressableWith(
        renderer,
        'accessibilityLabel',
        'Open Evelyn’s Table restaurant page',
    );
    const collapse = pressableWith(renderer, 'accessibilityHint', 'Collapses this take');

    expect(artLink).toBeDefined();
    expect(artLink.props.accessibilityRole).toBe('link');
    expect(artLink.props.accessibilityHint).toBe('Shows the restaurant’s details');
    expect(collapse).toBeDefined();

    let ancestor = artLink.parent;
    while (ancestor) {
        expect(ancestor).not.toBe(collapse);
        ancestor = ancestor.parent;
    }

    act(() => artLink.props.onPress());

    expect(onOpenRestaurant).toHaveBeenCalledWith('restaurant-1');
    expect(pressableWith(renderer, 'accessibilityHint', 'Collapses this take')).toBeDefined();
    expect(onEdit).not.toHaveBeenCalled();
    // One chevron on the card: the circular open badge (chevron-forward) is gone.
    expect(renderer.root.findAllByType('Ionicons').some((node: any) => node.props.name === 'chevron-forward'))
        .toBe(false);
});

it('keeps collapse, owner edit, and restaurant navigation as separate actions', () => {
    const { renderer, onOpenRestaurant, onEdit } = renderQuickTakes(PHOTO_TAKE);
    const collapse = pressableWith(renderer, 'accessibilityHint', 'Collapses this take');

    act(() => collapse.props.onPress());
    expect(pressableWith(renderer, 'accessibilityHint', 'Expands this take')).toBeDefined();
    expect(onOpenRestaurant).not.toHaveBeenCalled();

    const edit = pressableWith(renderer, 'accessibilityLabel', 'edit');
    act(() => edit.props.onPress());
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onOpenRestaurant).not.toHaveBeenCalled();
});

it('places a small thumbnail inline immediately left of the collapse chevron in the header row', () => {
    const { renderer } = renderQuickTakes(PHOTO_TAKE);
    const detail = renderer.root.findByProps({ testID: 'quick-take-detail' });
    const header = renderer.root.findByProps({ testID: 'quick-take-detail-header' });
    const collapse = pressableWith(renderer, 'testID', 'quick-take-collapse-control');
    const artLink = pressableWith(
        renderer,
        'accessibilityLabel',
        'Open Evelyn’s Table restaurant page',
    );
    const collapseSurface = collapse.findAllByType('AnimatedView')[0];
    const artSurface = artLink.findAllByType('AnimatedView')[0];

    // detail is a column: header row on top, full-width body below.
    expect(
        detail.children
            .filter((node: any) => typeof node !== 'string')
            .map((node: any) => node.props.testID),
    ).toEqual(['quick-take-detail-header', 'quick-take-detail-body']);
    expect(flattenStyle(detail.props.style).flexDirection).not.toBe('row');

    // header row order: prompt kicker · artwork · collapse — art immediately left of the chevron.
    expect(header.findAllByType('Pressable').map((node: any) => node.props.accessibilityLabel)).toEqual([
        'Open Evelyn’s Table restaurant page',
        'Collapse Best value: Evelyn’s Table',
    ]);
    expect(flattenStyle(header.props.style)).toMatchObject({
        flexDirection: 'row',
        alignItems: 'center',
    });

    // small thumbnail (~44) sits beside a 44 hit target; neither is absolutely positioned.
    expect(flattenStyle(artSurface.props.style)).toMatchObject({ width: 44, height: 44 });
    expect(flattenStyle(collapseSurface.props.style)).toMatchObject({
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    });
    expect(flattenStyle(artSurface.props.style).position).toBeUndefined();
    expect(flattenStyle(collapseSurface.props.style).position).toBeUndefined();

    // no circular open badge anywhere.
    expect(renderer.root.findAllByType('Ionicons').some((node: any) => node.props.name === 'chevron-forward'))
        .toBe(false);
});

it('uses the monogram fallback as the same restaurant link', () => {
    const take = { ...PHOTO_TAKE, photo_url: null };
    const { renderer, onOpenRestaurant } = renderQuickTakes(take);
    const artLink = pressableWith(
        renderer,
        'accessibilityLabel',
        'Open Evelyn’s Table restaurant page',
    );

    expect(renderer.root.findAllByType('Image')).toHaveLength(0);
    expect(JSON.stringify(renderer.toJSON())).toContain('E');

    act(() => artLink.props.onPress());
    expect(onOpenRestaurant).toHaveBeenCalledWith('restaurant-1');
});
