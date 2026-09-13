import React from 'react';
import { View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { Colors } from '@/constants/theme';
import { PlacesSelectedCard } from '../PlacesSelectedCard';
import { projectPlacesPins, type PlacesDisplayRow } from '../placesPresentation';
import { usePeekCard, type PeekCardData } from '@/hooks/restaurants/usePeekCard';

jest.mock('react-native', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactModule = require('react') as typeof React;
    const host = (name: string) => (props: Record<string, unknown>) => (
        ReactModule.createElement(name, props, props.children as React.ReactNode)
    );
    return {
        Image: host('Image'),
        ActivityIndicator: host('ActivityIndicator'),
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios },
        Pressable: host('Pressable'),
        StyleSheet: {
            absoluteFill: { position: 'absolute', inset: 0 },
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
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));


jest.mock('@/hooks/restaurants/usePeekCard', () => ({
    ...jest.requireActual('@/hooks/restaurants/usePeekCard'),
    usePeekCard: jest.fn(),
}));
const mockPeek = jest.mocked(usePeekCard);
const row: PlacesDisplayRow = {
    id: 'ritz', name: 'The Ritz London', city: 'London', cuisine: 'Modern British',
    lat: 51.5, lng: -0.14, priceLevel: 4, rating: null,
    isPinned: true, friendsBeenCount: 0,
};
const emptyPreview: PeekCardData = {
    media: [], price_level: null, google_rating: 4.8, google_rating_count: 100,
    hours: null, address_short: null, reserve_url: null,
};
function preview(data?: PeekCardData, isLoading = false) {
    mockPeek.mockReturnValue({ data, isLoading } as ReturnType<typeof usePeekCard>);
}
function props(value = row) {
    return { row: value, item: projectPlacesPins([value])[0], viewerId: 'viewer',
        distance: '0.4 mi', palette: Colors.light, onOpen: jest.fn() };
}
beforeEach(() => { jest.clearAllMocks(); preview(emptyPreview); });

describe('selected Places card', () => {
    it('shows carried facts immediately while only the selected restaurant enriches', () => {
        preview(undefined, true);
        const input = props();
        const screen = render(<PlacesSelectedCard {...input} />);
        expect(screen.getByText('The Ritz London')).toBeTruthy();
        expect(screen.getByText('modern british')).toBeTruthy();
        expect(screen.getByText('$$$$')).toBeTruthy();
        expect(screen.getByText('London · 0.4 mi')).toBeTruthy();
        expect(screen.getByTestId('places-selected-photo-loading')).toBeTruthy();
        expect(mockPeek).toHaveBeenLastCalledWith({ viewerId: 'viewer', restaurantId: 'ritz',
            context: { layer: 'saved' }, isSelected: true });
        fireEvent.press(screen.getByTestId('places-selected-caption'));
        expect(input.onOpen).toHaveBeenCalledTimes(1);
    });

    it('prefers attributed venue photography, then falls back after an image error', () => {
        preview({ ...emptyPreview, price_level: 3, address_short: '150 Piccadilly', media: [
            { kind: 'entry', url: 'https://example.org/meal.jpg', photo_source: 'user' },
            { kind: 'places', url: 'https://example.org/venue.jpg', photo_source: 'places', attribution: 'Jane Doe' },
        ] });
        const screen = render(<PlacesSelectedCard {...props()} />);
        expect(screen.getByTestId('places-selected-photo').props.source.uri).toContain('venue.jpg');
        expect(screen.getByText('photo by Jane Doe')).toBeTruthy();
        expect(screen.getByText('$$$')).toBeTruthy();
        expect(screen.getByText('150 Piccadilly · 0.4 mi')).toBeTruthy();
        expect(screen.queryByText('4.8')).toBeNull();
        fireEvent(screen.getByTestId('places-selected-photo'), 'error');
        expect(screen.getByTestId('places-selected-photo').props.source.uri).toContain('meal.jpg');
        expect(screen.queryByTestId('places-selected-photo-credit')).toBeNull();
        fireEvent(screen.getByTestId('places-selected-photo'), 'error');
        expect(screen.getByTestId('places-selected-no-photo')).toBeTruthy();
    });

    it('fails closed for uncredited photos and keeps missing data quiet on failed enrichment', () => {
        preview(undefined);
        const screen = render(<PlacesSelectedCard {...props({ ...row,
            cuisine: 'Establishment', priceLevel: null, city: null,
            photoUrl: 'https://example.org/uncredited.jpg', photoSource: 'places',
        })} distance={null} />);
        expect(screen.queryByTestId('places-selected-photo')).toBeNull();
        expect(screen.getByText('no photo')).toBeTruthy();
        expect(screen.queryByText(/\$/)).toBeNull();
        expect(screen.queryByText('establishment')).toBeNull();
        expect(screen.getByText('The Ritz London')).toBeTruthy();
    });

    it('keeps source identity and trusted context on friends cards', () => {
        const friend = { ...row, priceLevel: null, network: {
            author: { id: 'clara', name: 'Clara Bennett', avatar: null },
            entryId: 'entry', hasReview: true, rating: 4.7, note: null,
        }, friendsBeenCount: 3 };
        const screen = render(<PlacesSelectedCard {...props(friend)} />);
        expect(screen.getByText('Clara Bennett · 3 friends been')).toBeTruthy();
        expect(screen.getByText('4.7')).toBeTruthy();
        expect(mockPeek).toHaveBeenLastCalledWith(expect.objectContaining({
            context: { layer: 'network', entry_id: 'entry' },
        }));
    });

    it('a new keyed selection resets image errors and never shows the previous photo', () => {
        const first = { ...row, photoUrl: 'https://example.org/a.jpg', photoSource: 'user' };
        const screen = render(<View><PlacesSelectedCard key="ritz" {...props(first)} /></View>);
        fireEvent(screen.getByTestId('places-selected-photo'), 'error');
        const next = { ...row, id: 'b', name: 'Brawn', photoUrl: 'https://example.org/b.jpg', photoSource: 'user' };
        screen.rerender(<View><PlacesSelectedCard key="b" {...props(next)} /></View>);
        expect(screen.getByTestId('places-selected-photo').props.source.uri).toContain('b.jpg');
        expect(screen.queryByText('The Ritz London')).toBeNull();
    });
});
