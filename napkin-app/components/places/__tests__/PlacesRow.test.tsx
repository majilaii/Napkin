import React from 'react';
import { render } from '@testing-library/react-native';

import { PlacesRow } from '../PlacesRow';
import type { DecoratedPlacesRow } from '../placesPresentation';

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) => (
        ReactModule.createElement(name, props, props.children as React.ReactNode)
    );
    return {
        Image: host('Image'),
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            hairlineWidth: 1,
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
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const base: DecoratedPlacesRow = {
    row: {
        id: 'brawn',
        name: 'Brawn',
        city: 'London',
        cuisine: 'British',
        lat: 51.53,
        lng: -0.07,
        priceLevel: 3,
        rating: null,
        photoUrl: null,
        isPinned: true,
        friendsBeenCount: 0,
    },
    distanceLabel: '0.4 mi',
    distanceMiles: 0.4,
};

describe('PlacesRow', () => {
    it('renders only source-aware thumbnails and credits attributed Places photos', () => {
        const noPhoto = render(<PlacesRow item={base} onPress={jest.fn()} showThumbnail />);
        expect(noPhoto.queryByText(/not yet rated/i)).toBeNull();
        expect(noPhoto.queryByTestId('places-row-thumbnail-brawn')).toBeNull();

        const attributedPlaces = render(
            <PlacesRow
                item={{
                    ...base,
                    row: {
                        ...base.row,
                        photoUrl: 'https://cdn.example/places.jpg',
                        photoSource: 'places',
                        photoAttributionHtml: '<a href="https://maps.example/jane">Jane Doe</a>',
                    },
                }}
                onPress={jest.fn()}
                showThumbnail
            />,
        );
        expect(attributedPlaces.getByTestId('places-row-thumbnail-brawn')).toBeTruthy();
        expect(attributedPlaces.getByTestId('places-row-photo-credit')).toBeTruthy();
        expect(attributedPlaces.getByText('photo by Jane Doe')).toBeTruthy();

        const uncreditedPlaces = render(
            <PlacesRow
                item={{
                    ...base,
                    row: {
                        ...base.row,
                        photoUrl: 'https://cdn.example/uncredited.jpg',
                        photoSource: 'places',
                        photoAttributionHtml: null,
                    },
                }}
                onPress={jest.fn()}
                showThumbnail
            />,
        );
        expect(uncreditedPlaces.queryByTestId('places-row-thumbnail-brawn')).toBeNull();

        const sourceLessSpot = render(
            <PlacesRow
                item={{
                    ...base,
                    row: { ...base.row, photoUrl: 'https://cdn.example/unknown.jpg' },
                }}
                onPress={jest.fn()}
                showThumbnail
            />,
        );
        expect(sourceLessSpot.queryByTestId('places-row-thumbnail-brawn')).toBeNull();

        const userPhoto = render(
            <PlacesRow
                item={{
                    ...base,
                    row: {
                        ...base.row,
                        photoUrl: 'https://cdn.example/user.jpg',
                        photoSource: 'user',
                    },
                }}
                onPress={jest.fn()}
                showThumbnail
            />,
        );
        expect(userPhoto.getByTestId('places-row-thumbnail-brawn')).toBeTruthy();
        expect(userPhoto.queryByTestId('places-row-photo-credit')).toBeNull();
    });

    it('renders the network author rating and first name from the carried payload', () => {
        const screen = render(
            <PlacesRow
                item={{
                    ...base,
                    row: {
                        ...base.row,
                        rating: null,
                        network: {
                            author: { id: 'clara', name: 'Clara Bennett', avatar: null },
                            entryId: 'entry-1',
                            hasReview: true,
                            rating: 4.7,
                            note: null,
                        },
                    },
                }}
                onPress={jest.fn()}
            />,
        );
        expect(screen.getByText('4.7')).toBeTruthy();
        expect(screen.getByText(' · Clara')).toBeTruthy();

        const unrated = render(
            <PlacesRow
                item={{
                    ...base,
                    row: {
                        ...base.row,
                        network: {
                            author: { id: 'clara', name: 'Clara Bennett', avatar: null },
                            entryId: 'entry-1',
                            hasReview: false,
                            rating: null,
                            note: null,
                        },
                    },
                }}
                onPress={jest.fn()}
            />,
        );
        expect(unrated.getByText('Clara')).toBeTruthy();
    });
});
