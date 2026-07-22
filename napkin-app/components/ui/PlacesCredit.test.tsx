import {
    dedupePlacesCredits,
    normalizePlacesCreditLabel,
    resolveSourcedPhoto,
} from './PlacesCredit';

const attributed = (label: string, restaurantName?: string) => resolveSourcedPhoto({
    url: `https://images.example/${encodeURIComponent(label)}`,
    photoSource: 'places',
    attributionHtml: `<a href="https://maps.example/${encodeURIComponent(label)}">${label}</a>`,
    restaurantName,
});

describe('Places photo resolution', () => {
    it('normalizes author identity independently of the device locale', () => {
        expect(normalizePlacesCreditLabel('  IRMAK   IŞIK  ')).toBe('irmak işik');
    });

    it('dedupes normalized authors while preserving order and a safe href', () => {
        const jane = attributed('Jane Doe');
        const duplicate = attributed('  JANE   DOE  ');
        const marco = attributed('Marco');

        const deduped = dedupePlacesCredits([jane.credit, duplicate.credit, marco.credit]);
        expect(deduped.map((credit) => credit.label)).toEqual(['Jane Doe', 'Marco']);
        expect(deduped[0].href).toBe('https://maps.example/Jane%20Doe');
    });

    it('keeps restaurant-name matching as comparison metadata', () => {
        const same = attributed('  OSTERIA   ROMANA  ', 'Osteria Romana');

        expect(same.url).toBeTruthy();
        expect(same.credit).toMatchObject({
            normalizedLabel: 'osteria romana',
            redundant: true,
        });
    });

    it('fails closed for uncredited Places photos and preserves own photos', () => {
        expect(resolveSourcedPhoto({
            url: 'https://images.example/places',
            photoSource: 'places',
            attributionHtml: null,
        })).toEqual({ url: null, credit: null, isPlaces: true });

        expect(resolveSourcedPhoto({
            url: 'https://images.example/user',
            photoSource: 'user',
        })).toEqual({ url: 'https://images.example/user', credit: null, isPlaces: false });

        expect(resolveSourcedPhoto({
            url: 'https://images.example/unknown',
            photoSource: null,
        })).toEqual({ url: null, credit: null, isPlaces: false });
    });
});
