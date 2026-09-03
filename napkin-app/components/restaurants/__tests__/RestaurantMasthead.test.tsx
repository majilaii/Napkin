/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    const scrollTo = jest.fn();
    const ScrollView = ReactModule.forwardRef(
        (props: Record<string, unknown>, ref: React.ForwardedRef<unknown>) => {
            ReactModule.useImperativeHandle(ref, () => ({ scrollTo }));
            return ReactModule.createElement('ScrollView', props, props.children);
        },
    );
    return {
        __mockScrollTo: scrollTo,
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        ScrollView,
        StyleSheet: {
            absoluteFill: { position: 'absolute', inset: 0 },
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style)
                ? Object.assign({}, ...style.flat(Infinity).filter(Boolean))
                : (style ?? {}),
            hairlineWidth: 1,
        },
        Text: host('Text'),
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
        View: host('View'),
    };
});
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import type { RestaurantPageRestaurant } from '@/hooks/restaurants/useRestaurantPage';
import { resolveMastheadPhotos, type MastheadPhoto } from '@/lib/restaurantPhoto';
import { RestaurantTop } from '../RestaurantPageV3';

const mockScrollTo = (jest.requireMock('react-native') as { __mockScrollTo: jest.Mock })
    .__mockScrollTo;

const restaurant: RestaurantPageRestaurant = {
    id: 'restaurant',
    name: 'The Ritz Restaurant',
    address: null,
    city: 'London',
    country: 'UK',
    cuisine: 'Fine dining',
    price_level: 4,
    photo_url: 'https://photos.test/places.jpg',
    google_rating: 4.6,
    google_rating_count: 1200,
    external_id: 'place',
    photo_source: 'places',
    places_photo_attribution_html: '<a href="https://author.test">Clara</a>',
    phone: null,
    website: null,
    google_maps_uri: null,
    hours: null,
    places_synced_at: null,
    reserve_url: null,
    reserve_url_checked_at: null,
};

const baseProps = {
    restaurant,
    meta: 'fine dining · london · ££££',
    saved: false,
    saveDisabled: false,
    onBack: jest.fn(),
    onSave: jest.fn(),
    topInset: 47,
    palette: Colors.light,
};

describe('RestaurantTop photo mode', () => {
    it('crossfades in the late clip at an unchanged capped masthead height', () => {
        const onPhotoPress = jest.fn();
        const initialPhotos = resolveMastheadPhotos(
            { restaurant },
            { clippings: [], settled: false },
        );
        const screen = render(
            <RestaurantTop
                {...baseProps}
                photos={initialPhotos}
                onPhotoPress={onPhotoPress}
            />,
        );
        const firstHeight = StyleSheet.flatten(
            screen.getByTestId('restaurant-photo-masthead').props.style,
        ).height;
        expect(screen.getByTestId('masthead-photo-0').props.source.uri)
            .toBe('https://photos.test/places.jpg');
        expect(screen.queryByTestId('masthead-photo-link-0')).toBeNull();
        mockScrollTo.mockClear();

        const landedPhotos = resolveMastheadPhotos(
            { restaurant },
            {
                clippings: [{ thumb_url: 'https://clips.test/thumb.jpg' }],
                settled: true,
            },
        );
        screen.rerender(
            <RestaurantTop
                {...baseProps}
                photos={landedPhotos}
                onPhotoPress={onPhotoPress}
            />,
        );

        expect(screen.getByTestId('masthead-photo-0').props.source.uri)
            .toBe('https://clips.test/thumb.jpg');
        expect(screen.queryByTestId('masthead-photo-link-0')).toBeNull();
        expect(onPhotoPress).not.toHaveBeenCalled();
        expect(StyleSheet.flatten(
            screen.getByTestId('restaurant-photo-masthead').props.style,
        ).height).toBe(firstHeight);
        expect(firstHeight).toBeCloseTo(
            844 * Spacing.restaurant.photoMastheadMaxWindowRatio,
        );
        expect(mockScrollTo).toHaveBeenCalledWith({ x: 0, animated: false });
    });

    it('keeps the existing typographic masthead when the resolver returns no photo', () => {
        const screen = render(<RestaurantTop {...baseProps} photos={[]} />);
        expect(screen.queryByTestId('restaurant-photo-masthead')).toBeNull();
        expect(screen.getByText('The Ritz Restaurant')).toBeTruthy();
        expect(screen.getByText('fine dining · london · ££££')).toBeTruthy();
    });

    it('pages entry photos and updates the provenance count', () => {
        const onPhotoPress = jest.fn();
        const photos: MastheadPhoto[] = [
            {
                kind: 'entry',
                url: 'https://photos.test/mine.jpg',
                entryId: 'mine-entry',
                label: 'your photo',
                attribution: null,
            },
            {
                kind: 'entry',
                url: 'https://photos.test/clara.jpg',
                entryId: 'clara-entry',
                label: "clara's photo",
                attribution: null,
            },
        ];
        const screen = render(
            <RestaurantTop
                {...baseProps}
                photos={photos}
                onPhotoPress={onPhotoPress}
            />,
        );
        expect(screen.getByText('your photo · 1 / 2')).toBeTruthy();
        fireEvent.press(screen.getByTestId('masthead-photo-link-0'));
        expect(onPhotoPress).toHaveBeenCalledWith(photos[0]);

        fireEvent(screen.getByTestId('masthead-photo-pager'), 'momentumScrollEnd', {
            nativeEvent: { contentOffset: { x: 390 } },
        });

        expect(screen.getByText("clara's photo · 2 / 2")).toBeTruthy();
    });
});
