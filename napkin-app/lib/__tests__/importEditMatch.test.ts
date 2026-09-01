import {
    buildImportEditMatchSearchBody,
    initialImportEditMatchQuery,
} from '@/lib/importEditMatch';

const candidate = {
    area: 'Le Marais',
    restaurant: { name: 'Parisik', city: 'Paris' },
};

describe('import edit-match request', () => {
    it('seeds and sends the bare candidate name with structured locality and granted coords', () => {
        expect(initialImportEditMatchQuery(candidate)).toBe('Parisik');
        expect(buildImportEditMatchSearchBody('Parisik', candidate, {
            latitude: 51.5,
            longitude: -0.1,
        })).toEqual({
            query: 'Parisik',
            limit: 5,
            city: 'Paris',
            area: 'Le Marais',
            lat: 51.5,
            lng: -0.1,
        });
    });

    it('falls back to structured city when the candidate name is absent', () => {
        expect(initialImportEditMatchQuery({
            area: 'Le Marais',
            restaurant: { name: null, city: 'Paris' },
        })).toBe('Paris');
    });
});
