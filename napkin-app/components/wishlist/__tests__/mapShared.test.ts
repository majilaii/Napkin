import {
    CITY_DELTA,
    SPOT_DELTA,
    chooseCollectionCamera,
    type WishlistMapItem,
} from '../mapShared';

function pin(id: string, lat: number, lng: number): WishlistMapItem {
    return { id, name: id, city: null, cuisine: null, lat, lng };
}

describe('chooseCollectionCamera (A5)', () => {
    it('frames a single pin at SPOT_DELTA', () => {
        const action = chooseCollectionCamera([pin('a', 51.5, -0.12)], null, 'granted');
        expect(action).toEqual({
            kind: 'region',
            region: { latitude: 51.5, longitude: -0.12, latitudeDelta: SPOT_DELTA, longitudeDelta: SPOT_DELTA },
        });
    });

    it('fits a city-scale collection over its whole footprint', () => {
        const items = [pin('a', 51.48, -0.22), pin('b', 51.58, 0.08)];
        const action = chooseCollectionCamera(items, null, 'granted');
        expect(action).toEqual({
            kind: 'fit',
            coords: [
                { latitude: 51.48, longitude: -0.22 },
                { latitude: 51.58, longitude: 0.08 },
            ],
        });
    });

    it('anchors a cross-city spread on the pin nearest the user at CITY_DELTA', () => {
        const london = pin('london', 51.51, -0.12);
        const newYork = pin('nyc', 40.71, -74.0);
        const nearNy = { latitude: 40.7, longitude: -74.01 };
        const action = chooseCollectionCamera([london, newYork], nearNy, 'granted');
        expect(action).toEqual({
            kind: 'region',
            region: { latitude: 40.71, longitude: -74.0, latitudeDelta: CITY_DELTA, longitudeDelta: CITY_DELTA },
        });
    });

    it('defers a cross-city spread while location is still resolving', () => {
        const items = [pin('london', 51.51, -0.12), pin('nyc', 40.71, -74.0)];
        expect(chooseCollectionCamera(items, null, 'idle')).toEqual({ kind: 'defer' });
        expect(chooseCollectionCamera(items, null, 'pending')).toEqual({ kind: 'defer' });
    });

    it('falls back to the first pin when a cross-city spread has resolved without coords', () => {
        const items = [pin('london', 51.51, -0.12), pin('nyc', 40.71, -74.0)];
        expect(chooseCollectionCamera(items, null, 'denied')).toEqual({
            kind: 'region',
            region: { latitude: 51.51, longitude: -0.12, latitudeDelta: CITY_DELTA, longitudeDelta: CITY_DELTA },
        });
    });

    it('defers an empty collection', () => {
        expect(chooseCollectionCamera([], null, 'granted')).toEqual({ kind: 'defer' });
    });
});
