import { restaurantDirectionsUrl, restaurantMapCoordinate } from './restaurantLocation';

describe('restaurant location', () => {
    it.each([
        [null, -0.1], [51.5, undefined], [NaN, -0.1], [51.5, Infinity],
        [91, 0], [0, -181], ['51.5', '-0.1'],
    ])('does not invent a map pin from %s, %s', (lat, lng) => {
        expect(restaurantMapCoordinate(lat, lng)).toBeNull();
    });

    it('accepts finite coordinates, including zero longitude', () => {
        expect(restaurantMapCoordinate(51.5, 0)).toEqual({ latitude: 51.5, longitude: 0 });
    });

    it('preserves the venue map link when one is supplied', () => {
        expect(restaurantDirectionsUrl({
            name: 'Padella', google_maps_uri: ' https://maps.google.com/venue ', lat: 51.5, lng: -0.1,
        })).toBe('https://maps.google.com/venue');
    });

    it('opens the exact map cutout coordinate when names alone would be ambiguous', () => {
        const url = restaurantDirectionsUrl({ name: 'Padella', city: 'London', lat: 51.505, lng: -0.09 });
        expect(new URL(url).searchParams.get('query')).toBe('51.505,-0.09');
    });

    it('retains the address directions fallback when coordinates are missing', () => {
        const url = restaurantDirectionsUrl({
            name: 'Padella', city: 'London', address: '6 Southwark Street', lat: null, lng: null,
        });
        expect(new URL(url).searchParams.get('query')).toBe('Padella 6 Southwark Street London');
    });
});
