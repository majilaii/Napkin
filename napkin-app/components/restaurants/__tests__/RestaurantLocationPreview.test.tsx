/* eslint-disable import/first -- Register native mocks before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, { accessible: name === 'Pressable', ...props }, props.children);
    return {
        Alert: { alert: jest.fn() },
        Linking: { openURL: jest.fn(() => Promise.resolve()) },
        Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
        Pressable: host('Pressable'),
        ScrollView: host('ScrollView'),
        StyleSheet: {
            create: (styles: unknown) => styles,
            flatten: (style: unknown) => Array.isArray(style) ? Object.assign({}, ...style.flat(Infinity).filter(Boolean)) : style ?? {},
            absoluteFillObject: { position: 'absolute', inset: 0 },
        },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-maps', () => ({
    __esModule: true,
    default: 'MapView', Marker: 'Marker', UrlTile: 'UrlTile',
    PROVIDER_DEFAULT: undefined, PROVIDER_GOOGLE: 'google',
}));
jest.mock('@/lib/maptiler', () => ({
    __esModule: true,
    MAP_TILE_MODE: 'apple', MAPTILER_ATTRIBUTION: '© MapTiler © OpenStreetMap',
    tileUrlTemplate: () => 'https://tiles.test/{z}/{x}/{y}.png',
}));

import React from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Colors } from '@/constants/theme';
import * as tileConfig from '@/lib/maptiler';
import { RestaurantLocationPreview } from '../RestaurantLocationPreview';

const props = {
    name: 'Padella', lat: 51.505, lng: -0.09,
    directionsUrl: 'https://maps.google.com/venue', palette: Colors.light,
};

describe('RestaurantLocationPreview', () => {
    afterEach(() => {
        (Platform as { OS: string }).OS = 'ios';
        (tileConfig as { MAP_TILE_MODE: string }).MAP_TILE_MODE = 'apple';
    });

    it('renders the venue pin without requesting or displaying the viewer location', async () => {
        const screen = render(<RestaurantLocationPreview {...props} />);
        const map = screen.getByTestId('restaurant-location-map', { includeHiddenElements: true });
        expect(map.props.initialRegion).toEqual(expect.objectContaining({ latitude: 51.505, longitude: -0.09 }));
        expect(map.props).toEqual(expect.objectContaining({
            scrollEnabled: false, zoomEnabled: false, showsUserLocation: false,
            showsMyLocationButton: false, userInterfaceStyle: 'light', mapType: 'mutedStandard',
        }));
        fireEvent.press(screen.getByRole('link'));
        await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(props.directionsUrl));
    });

    it('hides the cutout when the pin is unavailable', () => {
        expect(render(<RestaurantLocationPreview {...props} lat={null} />).toJSON()).toBeNull();
    });

    it('moves the native map when the restaurant coordinate changes', () => {
        const screen = render(<RestaurantLocationPreview {...props} />);
        screen.rerender(<RestaurantLocationPreview {...props} lat={40.72} lng={-73.99} />);
        expect(screen.getByTestId('restaurant-location-map', { includeHiddenElements: true }).props.initialRegion)
            .toEqual(expect.objectContaining({ latitude: 40.72, longitude: -73.99 }));
    });

    it('keeps Android on the existing tile provider with attribution', () => {
        (Platform as { OS: string }).OS = 'android';
        (tileConfig as { MAP_TILE_MODE: string }).MAP_TILE_MODE = 'maptiler';
        const screen = render(<RestaurantLocationPreview {...props} />);
        expect(screen.getByTestId('restaurant-location-map', { includeHiddenElements: true }).props.mapType).toBe('none');
        expect(screen.getByText('© MapTiler © OpenStreetMap')).toBeTruthy();
    });

    it('reports a rejected open action instead of silently swallowing it', async () => {
        (Linking.openURL as jest.Mock).mockRejectedValueOnce(new Error('not available'));
        const screen = render(<RestaurantLocationPreview {...props} />);
        fireEvent.press(screen.getByRole('link'));
        await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith("Couldn't open Maps", expect.any(String)));
    });
});
