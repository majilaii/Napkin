import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

import { ComposerMasthead } from '../ComposerMasthead';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
    Image: 'Image',
    Linking: { openURL: jest.fn(() => Promise.resolve()) },
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
    Pressable: 'Pressable',
    StyleSheet: { create: (styles: unknown) => styles },
    Text: 'Text',
    View: 'View',
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

function render(overrides: Partial<React.ComponentProps<typeof ComposerMasthead>> = {}) {
    let renderer: any;
    act(() => {
        renderer = TestRenderer.create(
            <ComposerMasthead
                restaurantName="Osteria Romana"
                thumbnailUri="https://places.example/photo.jpg"
                thumbnailPhotoSource="places"
                thumbnailAttributionHtml={'<a href="https://maps.example/osteria">Osteria Romana</a>'}
                {...overrides}
            />,
        );
    });
    return renderer;
}

it('gates the Places proxy without rendering inline attribution', () => {
    const renderer = render();
    const image = renderer.root.findByType('Image');
    expect(renderer.root.findAllByProps({ testID: 'composer-masthead-places-credit' }))
        .toHaveLength(0);

    act(() => image.props.onError());
    expect(renderer.root.findAllByType('Image')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: 'composer-masthead-places-credit' }))
        .toHaveLength(0);
});

it('suppresses an un-attributed Places proxy while preserving own photos', () => {
    const missing = render({ thumbnailAttributionHtml: null });
    expect(missing.root.findAllByType('Image')).toHaveLength(0);
    expect(missing.root.findAllByProps({ testID: 'composer-masthead-places-credit' }))
        .toHaveLength(0);

    const own = render({ thumbnailPhotoSource: 'user', thumbnailAttributionHtml: null });
    expect(own.root.findAllByType('Image')).toHaveLength(1);
    expect(own.root.findAllByProps({ testID: 'composer-masthead-places-credit' }))
        .toHaveLength(0);
});
