import {
    buildMapPeekMeta,
    mapPeekCuisine,
    resolveMapPeekMedia,
} from './mapPeekPresentation';
import type { PeekCardMediaCandidate } from '@/hooks/restaurants/usePeekCard';

describe('compact map peek presentation', () => {
    it.each([
        'Association Or Organization',
        ' point of interest ',
        'ESTABLISHMENT',
    ])('suppresses junk Google type %s and falls back to price + city', (cuisine) => {
        expect(mapPeekCuisine(cuisine)).toBeNull();
        expect(buildMapPeekMeta({ cuisine, price: '$$$', area: 'Kensington' }))
            .toBe('$$$ · Kensington');
    });

    it('keeps a real cuisine in cuisine · price · area order', () => {
        expect(buildMapPeekMeta({
            cuisine: 'Modern British',
            price: '$$$$',
            area: 'Notting Hill',
        })).toBe('Modern British · $$$$ · Notting Hill');
    });

    it('keeps entry → clip → attributed Places order and credits Places only', () => {
        const candidates: PeekCardMediaCandidate[] = [
            { kind: 'entry', url: 'https://storage.example/entry.jpg', photo_source: 'user' },
            { kind: 'clip', url: 'https://storage.example/clip.jpg' },
            {
                kind: 'places',
                url: 'https://storage.example/places.jpg',
                photo_source: 'places',
                attribution: '<a href="https://maps.example/jane">Jane Doe</a>',
            },
        ];
        const resolved = candidates.map((candidate) => resolveMapPeekMedia(candidate, 'Dorian'));

        expect(resolved.map((item) => item?.thumbnail.url)).toEqual(candidates.map((item) => item.url));
        expect(resolved[0]?.credit).toBeNull();
        expect(resolved[1]?.credit).toBeNull();
        expect(resolved[2]?.credit?.label).toBe('Jane Doe');
        expect(resolved[2]?.thumbnail.isPlaces).toBe(true);
    });

    it('fails closed instead of rendering an unattributed Places thumbnail', () => {
        expect(resolveMapPeekMedia({
            kind: 'places',
            url: 'https://storage.example/uncredited.jpg',
            photo_source: 'places',
            attribution: null,
        }, 'Dorian')).toBeNull();
    });
});
