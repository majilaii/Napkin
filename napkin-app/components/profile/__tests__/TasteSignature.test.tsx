import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
    View: 'View',
    Text: 'Text',
    Pressable: 'Pressable',
    StyleSheet: {
        hairlineWidth: 1,
        create: (styles: unknown) => styles,
    },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

// Jest must install the native-module stubs before this component import.
// eslint-disable-next-line import/first
import { TasteSignature } from '../TasteSignature';

const histogram = [
    { r: 3.0, n: 1 },
    { r: 3.5, n: 2 },
    { r: 4.0, n: 4 },
    { r: 4.5, n: 3 },
];

it('keeps the owner card tappable without the rating-band sentence', () => {
    const onPress = jest.fn();
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <TasteSignature
                topCuisines={['indian', 'thai', 'british']}
                cityCount={4}
                countryCount={2}
                histogram={histogram}
                averageRating={4.1}
                isSelf
                onPress={onPress}
            />,
        );
    });

    const card = renderer.root.findByType('Pressable');
    const rendered = JSON.stringify(renderer.toJSON()).toLowerCase();

    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityHint).toBe('Opens your detailed taste breakdown');
    expect(card.props.accessibilityLabel).toContain('indian · thai · british');
    expect(card.props.accessibilityLabel).toContain('4.1, 10 ratings');
    expect(card.props.accessibilityLabel).not.toContain('0.5 stars');
    expect(card.props.accessibilityLabel).toContain('3 stars, 1 rating');
    expect(card.props.accessibilityLabel).toContain('4.5 stars, 3 ratings');
    expect(card.props.accessibilityLabel.toLowerCase()).not.toContain('most marks');
    expect(rendered).not.toContain('most marks');

    act(() => card.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(renderer.root.findAllByType('Ionicons')).toHaveLength(1);
    const nestedHistogram = renderer.root.findByProps({ importantForAccessibility: 'no-hide-descendants' });
    expect(nestedHistogram.props.accessible).toBe(false);
    expect(nestedHistogram.props.accessibilityLabel).toBeUndefined();
});

it('lets another person’s visible signature open its privacy-safe drill-in', () => {
    const onPress = jest.fn();
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <TasteSignature
                topCuisines={['ramen']}
                cityCount={1}
                countryCount={1}
                histogram={histogram}
                averageRating={4.1}
                isSelf={false}
                onPress={onPress}
            />,
        );
    });

    const card = renderer.root.findByType('Pressable');
    expect(card.props.accessibilityHint).toBe('Opens this person’s detailed taste breakdown');
    expect(renderer.root.findAllByType('Ionicons')).toHaveLength(1);

    act(() => card.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
});

it('keeps a signature static when no drill-in handler is supplied', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <TasteSignature
                topCuisines={['ramen']}
                cityCount={1}
                countryCount={1}
                histogram={histogram}
                averageRating={4.1}
                isSelf={false}
            />,
        );
    });

    expect(renderer.root.findAllByType('Pressable')).toHaveLength(0);
    expect(renderer.root.findAllByType('Ionicons')).toHaveLength(0);

    const distribution = renderer.root.find(
        (node: any) => node.props.accessibilityLabel?.startsWith('Rating distribution:'),
    );
    expect(distribution.props.accessible).toBe(true);
    expect(distribution.props.accessibilityLabel).not.toContain('0.5 stars');
    expect(distribution.props.accessibilityLabel).toContain('4 stars, 4 ratings');
});
