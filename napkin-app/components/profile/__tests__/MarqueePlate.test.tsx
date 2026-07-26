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
        absoluteFill: { position: 'absolute', inset: 0 },
        create: (styles: unknown) => styles,
    },
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/lib/engraving', () => ({
    markFor: () => ({ kind: 'monogram', letter: 'A' }),
    tintFor: () => '#fff',
}));

// Jest must install the native-module stubs before this component import.
// eslint-disable-next-line import/first
import { MarqueePlate } from '../MarqueePlate';

it('renders photo rank and rating directly on the plate without a pill container', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <MarqueePlate
                restaurantId="restaurant-1"
                name="Evelyn's Table"
                rating={4.5}
                rank={1}
                photoUrl="https://example.com/evelyns.jpg"
                onPress={jest.fn()}
            />,
        );
    });

    const plate = renderer!.root.findByType('Pressable');
    const vignette = renderer!.root.findByProps({ testID: 'top-four-photo-vignette' });
    const textNodes = renderer!.root.findAllByType('Text');
    // The rank numeral is deliberately NOT painted (founder call 2026-07-24) —
    // grid order states the ranking. Kept as a lookup so the assertion below is
    // a real guard against it creeping back onto the plate.
    const rank = textNodes.find((node: any) => node.children.join('') === '1');
    // The score renders as "4.5" + a nested upright "/5" (founder option A,
    // 2026-07-24), so the numeral is the FIRST child rather than the whole
    // joined string. Matching on children[0] keeps this lookup honest about
    // that structure instead of accidentally matching nothing.
    const rating = textNodes.find((node: any) => node.children[0] === '4.5');
    const denominator = textNodes.find((node: any) => node.children.join('') === '/5');

    expect(plate.props.accessibilityLabel).toBe("1. Evelyn's Table, rated 4.5 out of 5");
    // The denominator is what makes the numeral read as a score rather than a
    // second rank; it must be upright, not the italic serif of the numeral.
    expect(denominator).toBeDefined();
    expect(denominator?.parent).toBe(rating);
    expect(denominator?.props.style).toMatchObject({ fontStyle: 'normal' });
    expect(vignette.props.colors).toEqual([
        'rgba(28,28,25,0.70)',
        'rgba(28,28,25,0.62)',
        'transparent',
    ]);
    expect(vignette.props.style).toMatchObject({ top: 0, height: '32%' });
    // No rank numeral on the plate — but the position still reaches VoiceOver
    // via the accessibility label asserted above.
    expect(rank).toBeUndefined();
    expect(rating?.parent).toBe(plate);
    expect(rating?.props.style).toMatchObject({ position: 'absolute', right: 9 });
    expect(rating?.props.style).not.toHaveProperty('backgroundColor');
});
