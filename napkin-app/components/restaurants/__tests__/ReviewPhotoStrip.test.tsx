/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        StyleSheet: {
            absoluteFill: { position: 'absolute', inset: 0 },
            absoluteFillObject: { position: 'absolute', inset: 0 },
            create: (styles: unknown) => styles,
            flatten: (style: unknown): Record<string, unknown> =>
                (Array.isArray(style) ? style : [style])
                    .flat(Infinity)
                    .filter(Boolean)
                    .reduce<Record<string, unknown>>(
                        (acc, item) => ({ ...acc, ...(item as Record<string, unknown>) }),
                        {},
                    ),
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('@/components/photos/PhotoLightbox', () => {
    const ReactModule = jest.requireActual('react');
    return {
        PhotoLightbox: (props: Record<string, unknown>) =>
            ReactModule.createElement('PhotoLightbox', { ...props, testID: 'review-photo-lightbox' }),
    };
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import { ReviewPhotoStrip, reviewPhotoUrls } from '../ReviewPhotoStrip';

describe('reviewPhotoUrls', () => {
    it('prefers the full list, dedupes, and falls back to the legacy single photo', () => {
        expect(reviewPhotoUrls({ photo_urls: ['a', 'b', 'a'], photo_url: 'z' })).toEqual(['a', 'b']);
        expect(reviewPhotoUrls({ photo_urls: [], photo_url: 'z' })).toEqual(['z']);
        expect(reviewPhotoUrls({ photo_url: null })).toEqual([]);
    });
});

describe('ReviewPhotoStrip', () => {
    it('renders nothing without photos', () => {
        const screen = render(
            <ReviewPhotoStrip photos={[]} author="Nina" caption="Nina · jul" palette={Colors.light} />,
        );
        expect(screen.queryByTestId('review-photo-strip')).toBeNull();
    });

    it('shows at most three tiles with the overflow count and opens the lightbox on tap', () => {
        const photos = ['p1', 'p2', 'p3', 'p4', 'p5'];
        const screen = render(
            <ReviewPhotoStrip photos={photos} author="Nina" caption="Nina · jul" palette={Colors.light} />,
        );
        expect(screen.getAllByLabelText(/^Photo \d of 5 by Nina$/)).toHaveLength(3);
        expect(screen.getByText('+2')).toBeTruthy();
        expect(screen.queryByTestId('review-photo-lightbox')).toBeNull();

        fireEvent.press(screen.getByLabelText('Photo 2 of 5 by Nina'));
        const lightbox = screen.getByTestId('review-photo-lightbox');
        expect(lightbox.props.photos).toEqual(photos);
        expect(lightbox.props.initialIndex).toBe(1);
        expect(lightbox.props.caption).toBe('Nina · jul');
    });
});
