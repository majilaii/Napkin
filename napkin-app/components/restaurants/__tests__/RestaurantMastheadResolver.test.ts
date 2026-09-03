import type {
    RestaurantPageData,
    RestaurantPageRestaurant,
    SelfLogRow,
} from '@/hooks/restaurants/useRestaurantPage';
import { resolveMastheadPhotos } from '@/lib/restaurantPhoto';

function restaurant(
    overrides: Partial<RestaurantPageRestaurant> = {},
): RestaurantPageRestaurant {
    return {
        id: 'restaurant',
        name: 'The Ritz Restaurant',
        address: null,
        city: 'London',
        country: 'UK',
        cuisine: 'Fine dining',
        price_level: 4,
        photo_url: 'https://photos.test/places.jpg',
        google_rating: 4.6,
        google_rating_count: 1200,
        external_id: 'place',
        photo_source: 'places',
        places_photo_attribution_html: '<a href="https://author.test">Clara &amp; Co.</a>',
        phone: null,
        website: null,
        google_maps_uri: null,
        hours: null,
        places_synced_at: null,
        reserve_url: null,
        reserve_url_checked_at: null,
        ...overrides,
    };
}

function selfLog(
    id: string,
    visitedAt: string,
    urls: string[],
): SelfLogRow {
    return {
        id,
        entry_id: `entry-${id}`,
        table_night_id: null,
        source: 'solo',
        rating: 4.5,
        note: null,
        visited_at: visitedAt,
        companions: [],
        photos: urls.map((url, index) => ({ id: `${id}-${index}`, url })),
    };
}

describe('resolveMastheadPhotos', () => {
    it('orders entry sources first, dedupes them, and caps the pager at four', () => {
        const page = {
            restaurant: restaurant(),
            self_log: [
                selfLog('old', '2026-08-01T12:00:00.000Z', ['https://photos.test/old.jpg']),
                selfLog('new', '2026-09-01T12:00:00.000Z', [
                    'https://photos.test/new-a.jpg',
                    'https://photos.test/new-b.jpg',
                ]),
            ],
            photos: {
                from_your_table: [
                    {
                        url: 'https://photos.test/new-a.jpg',
                        author_display_name: 'Jacky',
                        author_handle: 'jacky',
                        is_tablemate: true,
                        is_self: true,
                        entry_id: 'duplicate',
                    },
                    {
                        url: 'https://photos.test/table.jpg',
                        author_display_name: 'Clara',
                        author_handle: 'clara',
                        is_tablemate: true,
                        is_self: false,
                        entry_id: 'table',
                    },
                ],
                from_others: [{
                    url: 'https://photos.test/fifth.jpg',
                    author_display_name: 'Maya',
                    author_handle: 'maya',
                    is_tablemate: false,
                    is_self: false,
                    entry_id: 'other',
                }],
            },
            public_reviews: [],
        } as unknown as RestaurantPageData;

        const photos = resolveMastheadPhotos(page, {
            clippings: [{ thumb_url: 'https://clips.test/thumb.jpg' }],
            settled: true,
        });
        expect(photos.map(({ kind, url, label, entryId }) => [kind, url, label, entryId]))
            .toEqual([
                ['entry', 'https://photos.test/new-a.jpg', 'your photo', 'entry-new'],
                ['entry', 'https://photos.test/new-b.jpg', 'your photo', 'entry-new'],
                ['entry', 'https://photos.test/old.jpg', 'your photo', 'entry-old'],
                ['entry', 'https://photos.test/table.jpg', 'table photo', 'table'],
            ]);
    });

    it('upgrades Places or no-photo to a stored clip thumbnail without displacing an entry', () => {
        const page = { restaurant: restaurant() };
        expect(resolveMastheadPhotos(page, { clippings: [], settled: false })).toEqual([{
            kind: 'places',
            url: 'https://photos.test/places.jpg',
            entryId: null,
            label: 'via google',
            attribution: 'Clara & Co.',
        }]);
        expect(resolveMastheadPhotos(page, {
            clippings: [{ thumb_url: 'https://clips.test/thumb.jpg' }],
            settled: true,
        })).toEqual([{
            kind: 'clip',
            url: 'https://clips.test/thumb.jpg',
            entryId: null,
            label: null,
            attribution: null,
        }]);

        const withEntry = {
            restaurant: restaurant(),
            self_log: [selfLog('self', '2026-09-01T12:00:00.000Z', [
                'https://photos.test/mine.jpg',
            ])],
        };
        expect(resolveMastheadPhotos(withEntry, {
            clippings: [{ thumb_url: 'https://clips.test/thumb.jpg' }],
            settled: true,
        }))
            .toEqual([{
                kind: 'entry',
                url: 'https://photos.test/mine.jpg',
                entryId: 'entry-self',
                label: 'your photo',
                attribution: null,
            }]);
    });

    it('uses the shared Places credit rules and fails closed without valid attribution', () => {
        expect(resolveMastheadPhotos({
            restaurant: restaurant({
                places_photo_attribution_html: '<span>Photo by <b>A &amp; B</b></span>',
            }),
        }, { clippings: [], settled: true })[0]?.attribution).toBe('Photo by A & B');
        expect(resolveMastheadPhotos({
            restaurant: restaurant({
                places_photo_attribution_html: '<a href="https://author.test">The Ritz Restaurant</a>',
            }),
        }, { clippings: [], settled: true })).toEqual([{
            kind: 'places',
            url: 'https://photos.test/places.jpg',
            entryId: null,
            label: 'via google',
            attribution: null,
        }]);
        expect(resolveMastheadPhotos({
            restaurant: restaurant({ places_photo_attribution_html: null }),
        }, { clippings: [], settled: true })).toEqual([]);
        expect(resolveMastheadPhotos({
            restaurant: restaurant({ photo_source: 'user' }),
        }, { clippings: [], settled: true })).toEqual([]);
    });

    it('uses generic photo provenance outside the Table when an author name is absent', () => {
        const page = {
            restaurant: restaurant(),
            photos: {
                from_your_table: [],
                from_others: [{
                    url: 'https://photos.test/other.jpg',
                    author_display_name: '',
                    author_handle: '',
                    is_tablemate: false,
                    is_self: false,
                    entry_id: 'other-entry',
                }],
            },
            public_reviews: [],
        } as unknown as RestaurantPageData;

        expect(resolveMastheadPhotos(page, { clippings: [], settled: true })[0])
            .toEqual({
                kind: 'entry',
                url: 'https://photos.test/other.jpg',
                entryId: 'other-entry',
                label: 'photo',
                attribution: null,
            });
    });

    it('keeps typographic fallback while loading and after an empty settlement', () => {
        const page = { restaurant: restaurant({ photo_url: null, photo_source: null }) };
        const clip = { thumb_url: 'https://clips.test/thumb.jpg' };

        expect(resolveMastheadPhotos(page, { clippings: [clip], settled: false })).toEqual([]);
        expect(resolveMastheadPhotos(page, { clippings: [clip], settled: true })).toEqual([{
            kind: 'clip',
            url: clip.thumb_url,
            entryId: null,
            label: null,
            attribution: null,
        }]);
        expect(resolveMastheadPhotos(page, { clippings: [], settled: true })).toEqual([]);
    });
});
