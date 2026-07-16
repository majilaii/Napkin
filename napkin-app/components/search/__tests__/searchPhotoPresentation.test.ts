import type { SearchResultRow } from '@/hooks/search/useRestaurantSearch';
import {
    deriveSearchPlacesCredits,
    resolveSearchResultPhoto,
    searchPhotoFailureKey,
} from '../searchPhotoPresentation';

function row(
    id: string | undefined,
    name: string,
    overrides: Partial<SearchResultRow> = {},
): SearchResultRow {
    return {
        id,
        name,
        city: null,
        cuisine: null,
        address: null,
        photoUrl: null,
        photoSource: null,
        photoReference: null,
        photoAttributionHtml: null,
        tier: id ? 'onNapkin' : 'morePlaces',
        ...overrides,
    };
}

describe('search photo presentation', () => {
    it('fails closed for unattributed or ambiguous persisted photos', () => {
        expect(resolveSearchResultPhoto(row('r1', 'No credit', {
            photoUrl: 'https://img.test/places.jpg',
            photoSource: 'places',
        })).url).toBeNull();

        expect(resolveSearchResultPhoto(row('r2', 'Stale payload', {
            photoUrl: 'https://img.test/stale.jpg',
            photoSource: null,
        })).url).toBeNull();
    });

    it('renders user photos without credit and attributed Places photos with credit', () => {
        const own = resolveSearchResultPhoto(row('r1', 'Own photo', {
            photoUrl: 'https://img.test/user.jpg',
            photoSource: 'user',
        }));
        expect(own).toMatchObject({ url: 'https://img.test/user.jpg', credit: null, isPlaces: false });

        const places = resolveSearchResultPhoto(row('r2', 'Cafe', {
            photoUrl: 'https://img.test/places.jpg',
            photoSource: 'places',
            photoAttributionHtml: '<a href="https://maps.example/jane">Jane Doe</a>',
        }));
        expect(places.url).toBe('https://img.test/places.jpg');
        expect(places.credit?.label).toBe('Jane Doe');
    });

    it('keeps Google ghosts text-only even if a stale caller supplies a photo URL', () => {
        const ghost = resolveSearchResultPhoto(row(undefined, 'Ghost', {
            photoUrl: 'https://img.test/ghost.jpg',
            photoSource: 'places',
            photoAttributionHtml: 'Jane Doe',
        }));
        expect(ghost).toEqual({ url: null, credit: null, isPlaces: false });
    });

    it('dedupes authors while retaining the rendered Places-photo count', () => {
        const summary = deriveSearchPlacesCredits([
            row('r1', 'First', {
                photoUrl: 'https://img.test/one.jpg',
                photoSource: 'places',
                photoAttributionHtml: 'Jane Doe',
            }),
            row('r2', 'Second', {
                photoUrl: 'https://img.test/two.jpg',
                photoSource: 'places',
                photoAttributionHtml: '  JANE   DOE  ',
            }),
            row('r3', 'Own', {
                photoUrl: 'https://img.test/user.jpg',
                photoSource: 'table',
            }),
        ]);

        expect(summary.photoCount).toBe(2);
        expect(summary.credits.map((credit) => credit.label)).toEqual(['Jane Doe']);
    });

    it('removes a failed URI from both its thumbnail and aggregate grammar', () => {
        const first = row('r1', 'First', {
            photoUrl: 'https://img.test/one.jpg',
            photoSource: 'places',
            photoAttributionHtml: 'Jane Doe',
        });
        const second = row('r2', 'Second', {
            photoUrl: 'https://img.test/two.jpg',
            photoSource: 'places',
            photoAttributionHtml: 'Marco',
        });

        const summary = deriveSearchPlacesCredits(
            [first, second],
            new Set([searchPhotoFailureKey(second)!]),
        );

        expect(summary.photoCount).toBe(1);
        expect(summary.credits.map((credit) => credit.label)).toEqual(['Jane Doe']);
    });
});
