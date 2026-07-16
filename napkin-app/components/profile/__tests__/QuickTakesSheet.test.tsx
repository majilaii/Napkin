/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import type { ProfileQuickTake } from '@/lib/profileQuickTakes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    AccessibilityInfo: { announceForAccessibility: jest.fn() },
    Alert: { alert: jest.fn() },
    Linking: { openURL: jest.fn(() => Promise.resolve()) },
    Modal: 'Modal',
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    Text: 'Text',
    TextInput: 'TextInput',
    View: 'View',
    StyleSheet: {
        absoluteFill: { position: 'absolute', inset: 0 },
        hairlineWidth: 1,
        create: (styles: unknown) => styles,
    },
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('react-native-draggable-flatlist', () => {
    const ReactModule = require('react');
    return {
        __esModule: true,
        default: (props: any) => ReactModule.createElement(
            'DraggableFlatList',
            props,
            ReactModule.Children.toArray([
                props.ListHeaderComponent,
                ...props.data.map((item: ProfileQuickTake, index: number) => props.renderItem({
                    item,
                    drag: jest.fn(),
                    isActive: false,
                    getIndex: () => index,
                })),
                props.ListFooterComponent,
            ]),
        ),
        ScaleDecorator: ({ children }: any) => children,
    };
});
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/hooks/users/useSetProfileQuickTakes', () => ({
    useSetProfileQuickTakes: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('@/lib/engraving', () => ({ tintFor: () => '#eee8dc' }));
jest.mock('@/components/search/RestaurantPickerScreen', () => ({
    RestaurantPickerScreen: 'RestaurantPickerScreen',
}));
jest.mock('@/components/ui/napkin/PressableScale', () => ({ PressableScale: 'PressableScale' }));
jest.mock('@/components/ui/SheetHeader', () => ({ SheetHeader: 'SheetHeader' }));

// Native and list stubs must be installed before importing the sheet.
// eslint-disable-next-line import/first
import { QuickTakesSheet } from '../QuickTakesSheet';

function take(
    prompt_key: ProfileQuickTake['prompt_key'],
    name: string,
    author: string | null,
    overrides: Partial<ProfileQuickTake> = {},
): ProfileQuickTake {
    return {
        prompt_key,
        position: 1,
        restaurant_id: `restaurant-${prompt_key}`,
        name,
        city: 'London',
        cuisine: null,
        photo_url: `https://images.example/${prompt_key}.jpg`,
        photo_source: 'places',
        places_photo_attribution_html: author
            ? `<a href="https://maps.example/${prompt_key}">${author}</a>`
            : null,
        note: null,
        ...overrides,
    };
}

function renderSheet(currentTakes: ProfileQuickTake[]) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <QuickTakesSheet
                visible
                onClose={jest.fn()}
                userId="user-1"
                profileIdentifier="jacky"
                currentTakes={currentTakes}
            />,
        );
    });
    return renderer;
}

function textContent(node: any): string {
    return node.children
        .map((child: any) => typeof child === 'string' ? child : textContent(child))
        .join('');
}

it('shows one adjacent, deduped credit line for every gated draft thumbnail', () => {
    const renderer = renderSheet([
        take('best_value', 'One', 'Jane Doe'),
        take('best_pub', 'Two', '  JANE   DOE  '),
        take('best_curry', 'Three', 'Marco'),
        take('date_night', 'Missing credit', null),
        take('late_night', 'Unknown source', 'Ignored', { photo_source: null }),
    ]);

    const images = renderer.root.findAllByType('Image');
    const creditLines = renderer.root.findAllByProps({ testID: 'quick-takes-sheet-places-credit' })
        .filter((node: any) => node.type === 'Text');
    const credit = creditLines[0];
    const authors = credit.findAll((node: any) =>
        typeof node.props.testID === 'string'
        && node.props.testID.startsWith('quick-takes-sheet-places-credit-author-'));

    expect(images).toHaveLength(3);
    expect(creditLines).toHaveLength(1);
    expect(authors.map((node: any) => node.children.join(''))).toEqual(['Jane Doe', 'Marco']);
    expect(JSON.stringify(renderer.toJSON())).toContain('photos');
    for (const image of images) {
        expect(image.parent.findAllByProps({ testID: 'quick-takes-sheet-places-credit' })).toHaveLength(0);
    }
    act(() => renderer.unmount());
});

it('removes a failed thumbnail from the rendered-photo credit aggregate', () => {
    const renderer = renderSheet([
        take('best_value', 'One', 'Jane Doe'),
        take('best_pub', 'Two', 'Marco'),
    ]);
    const failedImage = renderer.root.findAllByType('Image')[0];

    act(() => failedImage.props.onError());

    expect(renderer.root.findAllByType('Image')).toHaveLength(1);
    const credit = renderer.root.findAllByProps({ testID: 'quick-takes-sheet-places-credit' })
        .find((node: any) => node.type === 'Text');
    expect(textContent(credit)).toBe('photo · Marco');
    expect(credit.findAll((node: any) =>
        typeof node.props.testID === 'string'
        && node.props.testID.startsWith('quick-takes-sheet-places-credit-author-'))
        .map((node: any) => node.children.join(''))).toEqual(['Marco']);
    act(() => renderer.unmount());
});
