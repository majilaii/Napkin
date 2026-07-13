import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
    View: 'View',
    Text: 'Text',
    StyleSheet: {
        hairlineWidth: 1,
        create: (styles: unknown) => styles,
    },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

// Jest must install the native-module stubs before this component import.
// eslint-disable-next-line import/first
import { TasteEmblem, TasteEmblemPending } from '../TasteEmblem';

it('groups the emblem name, explanation and evidence into one VoiceOver summary', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <TasteEmblem
                emblem={{
                    key: 'compass',
                    title: 'The Compass',
                    facets: ['Roaming', 'Discovering'],
                    description: 'A wide-ranging journal, usually choosing somewhere new.',
                }}
                totalMeals={26}
                totalPlaces={13}
                cityCount={4}
                countryCount={2}
            />,
        );
    });

    const grouped = renderer.root.findByProps({ accessible: true });
    expect(grouped.props.accessibilityLabel).toBe(
        'Your taste emblem. The Compass. Roaming and Discovering. ' +
        'A wide-ranging journal, usually choosing somewhere new. ' +
        'Formed from 26 meals, 13 places, 4 cities, 2 countries',
    );

    expect(renderer.root.findAllByType('Text').map((node: any) => node.props.children)).toContain(
        'formed from 26 meals · 13 places · 4 cities · 2 countries',
    );

    const decorativeSeal = renderer.root.findByProps({ importantForAccessibility: 'no-hide-descendants' });
    expect(decorativeSeal.props.accessibilityElementsHidden).toBe(true);
    const sealLabel = renderer.root.findByProps({ children: 'COMPASS' });
    expect(sealLabel.props.allowFontScaling).toBe(false);
    expect(sealLabel.props.numberOfLines).toBe(1);
    expect(renderer.root.findByType('Ionicons').props.name).toBe('compass-outline');
});

it('uses neutral ownership copy on another person’s Taste page', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <TasteEmblem
                emblem={{
                    key: 'hearth',
                    title: 'The Hearth',
                    facets: ['Concentrated', 'Returning'],
                    description: 'A tightly clustered journal, with tables worth returning to.',
                }}
                totalMeals={18}
                totalPlaces={10}
                cityCount={1}
                countryCount={1}
                isSelf={false}
            />,
        );
    });

    const grouped = renderer.root.findByProps({ accessible: true });
    expect(grouped.props.accessibilityLabel).toMatch(/^Taste emblem\. The Hearth\./);
    expect(grouped.props.accessibilityLabel).not.toContain('Your taste emblem');
});

it('keeps a one-country geography visible in the emblem evidence', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <TasteEmblem
                emblem={{
                    key: 'lantern',
                    title: 'The Lantern',
                    facets: ['Concentrated', 'Discovering'],
                    description: 'A tightly clustered journal, usually choosing somewhere new.',
                }}
                totalMeals={12}
                totalPlaces={10}
                cityCount={0}
                countryCount={1}
            />,
        );
    });

    expect(renderer.root.findByProps({ accessible: true }).props.accessibilityLabel).toContain('1 country');
});

it('explains how an owner’s not-yet-earned emblem takes shape', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <TasteEmblemPending totalMeals={7} cityCount={0} countryCount={0} />,
        );
    });

    const grouped = renderer.root.findByProps({ accessible: true });
    expect(grouped.props.accessibilityLabel).toBe(
        'Your taste emblem. Taking shape. Log 3 more meals, including one with a known location, to reveal it.',
    );
});

it('does not turn another person’s pending emblem into instructions for the viewer', () => {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <TasteEmblemPending
                totalMeals={7}
                cityCount={1}
                countryCount={1}
                isSelf={false}
            />,
        );
    });

    const grouped = renderer.root.findByProps({ accessible: true });
    expect(grouped.props.accessibilityLabel).toBe(
        'Taste emblem. Taking shape. More public journal activity will reveal it.',
    );
});
