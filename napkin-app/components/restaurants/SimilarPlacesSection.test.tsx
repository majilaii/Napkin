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
                ? Object.assign({}, ...style.filter(Boolean))
                : (style ?? {}),
            hairlineWidth: 1,
        },
        Text: host('Text'),
        useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-image', () => ({ Image: 'ExpoImage' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'LinearGradient' }));
jest.mock('@/components/photos/PhotoLightbox', () => ({ PhotoLightbox: () => null }));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { Colors } from '@/constants/theme';
import type { SimilarRestaurant } from '@/hooks/restaurants/useSimilarRestaurants';
import { formatDistance, similarKicker, SimilarPlacesSection } from './SimilarPlacesSection';

const row = (over: Partial<SimilarRestaurant>): SimilarRestaurant => ({
    id: 'r1',
    name: 'Kono',
    cuisine: 'Japanese',
    city: 'London',
    price_level: null,
    photo_url: null,
    photo_source: null,
    places_photo_attribution_html: null,
    distance_m: 320,
    match: 'cuisine',
    ...over,
});

describe('SimilarPlacesSection', () => {
    it('renders each row as name + cuisine · distance and taps through with the id', () => {
        const onPress = jest.fn();
        const screen = render(
            <SimilarPlacesSection
                rows={[row({}), row({ id: 'r2', name: 'Bar Bruno', cuisine: null, distance_m: 1480, match: 'type' })]}
                onPress={onPress}
                palette={Colors.light}
            />,
        );

        expect(screen.getByText('SIMILAR PLACES')).toBeTruthy();
        expect(screen.getByText('japanese · 0.3 km')).toBeTruthy();
        expect(screen.getByText('1.5 km')).toBeTruthy();
        fireEvent.press(screen.getByText('Bar Bruno'));
        expect(onPress).toHaveBeenCalledWith('r2');
    });

    it('renders nothing when there are no rows', () => {
        const screen = render(
            <SimilarPlacesSection rows={[]} onPress={jest.fn()} palette={Colors.light} />,
        );
        expect(screen.toJSON()).toBeNull();
    });

    it('switches the kicker to NEARBY only when every row is a plain proximity match', () => {
        const nearby = [row({ match: 'nearby' }), row({ id: 'r2', match: 'nearby' })];
        expect(similarKicker(nearby)).toBe('NEARBY');
        expect(similarKicker([...nearby, row({ id: 'r3', match: 'type' })])).toBe('SIMILAR PLACES');
        expect(similarKicker([])).toBe('SIMILAR PLACES');

        const screen = render(
            <SimilarPlacesSection rows={nearby} onPress={jest.fn()} palette={Colors.light} />,
        );
        expect(screen.getByText('NEARBY')).toBeTruthy();
    });

    it('formats distance to one decimal under 10 km', () => {
        expect(formatDistance(320)).toBe('0.3 km');
        expect(formatDistance(40)).toBe('0.1 km');
        expect(formatDistance(1480)).toBe('1.5 km');
        expect(formatDistance(9949)).toBe('9.9 km');
        expect(formatDistance(12400)).toBe('12 km');
    });
});
