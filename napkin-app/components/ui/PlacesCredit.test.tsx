/* eslint-disable @typescript-eslint/no-require-imports, import/first */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockOpenURL = jest.fn((_url: string) => Promise.resolve());

jest.mock('react-native', () => {
    const ReactModule = require('react');
    const Text = (props: Record<string, unknown>) =>
        ReactModule.createElement('Text', props, props.children);
    return {
        Text,
        Linking: { openURL: (url: string) => mockOpenURL(url) },
        StyleSheet: { create: (styles: unknown) => styles },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    };
});
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

import {
    PlacesCredit,
    dedupePlacesCredits,
    normalizePlacesCreditLabel,
    resolveSourcedPhoto,
} from './PlacesCredit';
import { Colors } from '@/constants/theme';

const attributed = (label: string, restaurantName?: string) => resolveSourcedPhoto({
    url: `https://images.example/${encodeURIComponent(label)}`,
    photoSource: 'places',
    attributionHtml: `<a href="https://maps.example/${encodeURIComponent(label)}">${label}</a>`,
    restaurantName,
});

function render(element: React.ReactElement) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(element);
    });
    return renderer;
}

function textByTestId(renderer: any, testID: string) {
    return renderer.root.findAllByProps({ testID }).find((node: any) => node.type === 'Text')!;
}

describe('PlacesCredit', () => {
    it('normalizes author identity independently of the device locale', () => {
        expect(normalizePlacesCreditLabel('  IRMAK   IŞIK  ')).toBe('irmak işik');
    });

    it('dedupes normalized authors while preserving distinct authors and photo grammar', () => {
        const jane = attributed('Jane Doe');
        const duplicate = attributed('  JANE   DOE  ');
        const marco = attributed('Marco');

        const deduped = dedupePlacesCredits([jane.credit, duplicate.credit, marco.credit]);
        expect(deduped.map((credit) => credit.label)).toEqual(['Jane Doe', 'Marco']);

        const renderer = render(
            <PlacesCredit credits={[jane.credit, duplicate.credit, marco.credit]} photoCount={3} />,
        );
        const line = textByTestId(renderer, 'places-credit');
        expect(line.props.numberOfLines).toBe(1);
        expect(line.props.ellipsizeMode).toBe('tail');
        expect(renderer.root.findAllByType('Text').filter(
            (node: any) => node.props.testID?.startsWith('places-credit-author-'),
        )).toHaveLength(2);
        expect(JSON.stringify(renderer.toJSON())).toContain('photos');
        expect(JSON.stringify(renderer.toJSON())).toContain('Jane Doe');
        expect(JSON.stringify(renderer.toJSON())).toContain('Marco');
    });

    it('keeps a normalized restaurant-name author present but minimized and un-underlined', () => {
        const same = attributed('  OSTERIA   ROMANA  ', 'Osteria Romana');
        const renderer = render(<PlacesCredit credits={[same.credit]} photoCount={1} />);
        const line = textByTestId(renderer, 'places-credit');
        const author = textByTestId(renderer, 'places-credit-author-0');

        expect(JSON.stringify(renderer.toJSON())).toContain('photo');
        expect(JSON.stringify(renderer.toJSON())).toContain('OSTERIA');
        expect(line.props.style).toEqual(expect.arrayContaining([
            expect.objectContaining({ fontSize: 11 }),
            expect.objectContaining({ color: Colors.light.textMuted }),
            expect.objectContaining({ opacity: 0.74 }),
        ]));
        expect(author.props.style).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ textDecorationLine: 'underline' }),
        ]));
    });

    it('fails closed for uncredited Places photos and adds no chrome to own photos', () => {
        expect(resolveSourcedPhoto({
            url: 'https://images.example/places',
            photoSource: 'places',
            attributionHtml: null,
        })).toEqual({ url: null, credit: null, isPlaces: true });

        expect(resolveSourcedPhoto({
            url: 'https://images.example/user',
            photoSource: 'user',
        })).toEqual({ url: 'https://images.example/user', credit: null, isPlaces: false });

        expect(render(<PlacesCredit credits={[]} />).toJSON()).toBeNull();
    });

    it('opens only a safe parsed author link and can disable nested card taps', () => {
        const jane = attributed('Jane Doe');
        const interactive = render(<PlacesCredit credits={[jane.credit]} />);
        const author = textByTestId(interactive, 'places-credit-author-0');

        act(() => author.props.onPress());
        expect(mockOpenURL).toHaveBeenCalledWith('https://maps.example/Jane%20Doe');

        const nestedCard = render(<PlacesCredit credits={[jane.credit]} interactive={false} />);
        const nestedAuthor = textByTestId(nestedCard, 'places-credit-author-0');
        expect(nestedAuthor.props.onPress).toBeUndefined();
        expect(nestedAuthor.props.accessibilityRole).toBeUndefined();
    });
});
