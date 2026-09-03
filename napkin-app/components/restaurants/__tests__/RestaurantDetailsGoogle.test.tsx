/* eslint-disable import/first -- Jest mocks must be registered before module imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
        Platform: {
            OS: 'ios',
            select: (options: Record<string, unknown>) => options.ios ?? options.default,
        },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
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
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors } from '@/constants/theme';
import type { RestaurantPageRestaurant } from '@/hooks/restaurants/useRestaurantPage';
import { RestaurantDetails } from '../RestaurantPageV3';

const restaurant: RestaurantPageRestaurant = {
    id: 'restaurant',
    name: 'The Ritz Restaurant',
    address: null,
    city: 'London',
    country: 'UK',
    cuisine: 'Fine dining',
    price_level: 4,
    photo_url: null,
    google_rating: 4.6,
    google_rating_count: 1200,
    external_id: 'place',
    photo_source: null,
    places_photo_attribution_html: null,
    phone: null,
    website: null,
    google_maps_uri: null,
    hours: null,
    places_synced_at: null,
    reserve_url: null,
    reserve_url_checked_at: null,
};

describe('RestaurantDetails Google fact', () => {
    it('renders as the only detail in the faint treatment and hides without a rating', () => {
        const visible = render(
            <RestaurantDetails
                restaurant={restaurant}
                directionsUrl="https://maps.test"
                palette={Colors.light}
            />,
        );
        const copy = visible.getByText('4.6 on google · 1.2k ratings');
        expect(StyleSheet.flatten(copy.props.style).color).toBe(Colors.light.textFaint);
        expect(visible.UNSAFE_getByType(Ionicons).props).toEqual(expect.objectContaining({
            name: 'star-outline',
            color: Colors.light.textFaint,
        }));
        visible.unmount();

        const hidden = render(
            <RestaurantDetails
                restaurant={{ ...restaurant, google_rating: null }}
                directionsUrl="https://maps.test"
                palette={Colors.light}
            />,
        );
        expect(hidden.toJSON()).toBeNull();
    });

    it.each([null, 0])('omits the count suffix when the count is %s', (count) => {
        const screen = render(
            <RestaurantDetails
                restaurant={{ ...restaurant, google_rating_count: count }}
                directionsUrl="https://maps.test"
                palette={Colors.light}
            />,
        );

        expect(screen.getByText('4.6 on google')).toBeTruthy();
        expect(screen.queryByText(/no ratings/)).toBeNull();
    });
});
