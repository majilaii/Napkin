import { resolveRestaurantMastheadPhoto } from '../restaurantMastheadPhoto';

const restaurant = {
    name: 'Kono',
    photo_url: 'https://cdn.test/places.jpg',
    photo_source: 'places',
    places_photo_attribution_html: '<a href="https://maps.test/ada">Ada Lens</a>',
};

describe('resolveRestaurantMastheadPhoto', () => {
    it('prefers the viewer\'s own entry photo over clips and Places', () => {
        expect(resolveRestaurantMastheadPhoto({
            restaurant,
            entryPhotos: [
                { url: 'https://cdn.test/tablemate.jpg', is_self: false },
                { url: 'https://cdn.test/mine.jpg', is_self: true },
            ],
            clips: [{ thumb_url: 'https://cdn.test/clip.jpg', source: { type: 'tiktok' } }],
        })).toEqual({
            url: 'https://cdn.test/mine.jpg',
            source: 'entry',
            credit: null,
            placesWash: false,
        });
    });

    it('uses a durable clipping thumbnail before the Places venue photo', () => {
        expect(resolveRestaurantMastheadPhoto({
            restaurant,
            entryPhotos: [{ url: 'https://cdn.test/tablemate.jpg', is_self: false }],
            clips: [
                { thumb_url: 'https://cdn.test/video.jpg', source: { type: 'video' } },
                { thumb_url: 'https://cdn.test/clip.jpg', source: { type: 'web' } },
            ],
        })).toEqual({
            url: 'https://cdn.test/clip.jpg',
            source: 'clip',
            credit: null,
            placesWash: false,
        });
    });

    it('uses the attributed Places photo as the final imagery tier', () => {
        const resolved = resolveRestaurantMastheadPhoto({ restaurant });

        expect(resolved).toMatchObject({
            url: 'https://cdn.test/places.jpg',
            source: 'places',
            placesWash: true,
            credit: {
                label: 'Ada Lens',
                href: 'https://maps.test/ada',
            },
        });
    });

    it('falls through failed URLs and removes the plate when no safe tier remains', () => {
        const failedUrls = new Set([
            'https://cdn.test/mine.jpg',
            'https://cdn.test/clip.jpg',
            'https://cdn.test/places.jpg',
        ]);

        expect(resolveRestaurantMastheadPhoto({
            restaurant,
            entryPhotos: [{ url: 'https://cdn.test/mine.jpg', is_self: true }],
            clips: [{ thumb_url: 'https://cdn.test/clip.jpg', source: { type: 'tiktok' } }],
            failedUrls,
        })).toBeNull();
    });

    it.each([
        { photo_source: 'places', places_photo_attribution_html: null },
        { photo_source: 'user', places_photo_attribution_html: null },
        { photo_source: 'table', places_photo_attribution_html: null },
        { photo_source: null, places_photo_attribution_html: null },
    ])('does not promote an unsafe restaurant photo: %p', (overrides) => {
        expect(resolveRestaurantMastheadPhoto({
            restaurant: { ...restaurant, ...overrides },
        })).toBeNull();
    });
});
