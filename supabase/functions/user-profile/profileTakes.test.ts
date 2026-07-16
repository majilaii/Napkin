import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { hydrateProfileTakes } from './profileTakes.ts';

Deno.test('profile quick takes: ordered narrow projection with Places photos only', () => {
    const result = hydrateProfileTakes([
        { prompt_key: 'best_pub', position: 2, restaurant_id: 'r2', note: null },
        { prompt_key: 'best_value', position: 1, restaurant_id: 'r1', note: 'Lunch.' },
    ], [
        {
            id: 'r1',
            name: 'One',
            city: 'London',
            cuisine: 'Thai',
            photo_url: 'https://places.test/one.jpg',
            photo_source: 'places',
            places_photo_attribution_html: '<a href="https://maps.google.test/one">One photographer</a>',
        },
        {
            id: 'r2',
            name: 'Two',
            city: null,
            cuisine: null,
            photo_url: 'https://private-user-upload.test/two.jpg',
            photo_source: 'user',
            places_photo_attribution_html: '<a href="https://maps.google.test/two">Wrong source</a>',
        },
    ]);

    assertEquals(result, [
        {
            prompt_key: 'best_value',
            position: 1,
            restaurant_id: 'r1',
            name: 'One',
            city: 'London',
            cuisine: 'Thai',
            photo_url: 'https://places.test/one.jpg',
            photo_source: 'places',
            places_photo_attribution_html: '<a href="https://maps.google.test/one">One photographer</a>',
            note: 'Lunch.',
        },
        {
            prompt_key: 'best_pub',
            position: 2,
            restaurant_id: 'r2',
            name: 'Two',
            city: null,
            cuisine: null,
            photo_url: null,
            photo_source: null,
            places_photo_attribution_html: null,
            note: null,
        },
    ]);

    assertEquals(Object.keys(result[0]).sort(), [
        'city',
        'cuisine',
        'name',
        'note',
        'photo_source',
        'photo_url',
        'places_photo_attribution_html',
        'position',
        'prompt_key',
        'restaurant_id',
    ]);
});

Deno.test('profile quick takes: unattributed Places photos fail closed', () => {
    const takes = [
        { prompt_key: 'best_value', position: 1, restaurant_id: 'missing', note: null },
        { prompt_key: 'best_pub', position: 2, restaurant_id: 'blank', note: null },
    ];
    const result = hydrateProfileTakes(takes, [
        {
            id: 'missing',
            name: 'Missing credit',
            city: null,
            cuisine: null,
            photo_url: 'https://places.test/missing.jpg',
            photo_source: 'places',
            places_photo_attribution_html: null,
        },
        {
            id: 'blank',
            name: 'Blank credit',
            city: null,
            cuisine: null,
            photo_url: 'https://places.test/blank.jpg',
            photo_source: 'places',
            places_photo_attribution_html: '   ',
        },
    ]);

    assertEquals(result.map(({ photo_url, photo_source, places_photo_attribution_html }) => ({
        photo_url,
        photo_source,
        places_photo_attribution_html,
    })), [
        { photo_url: null, photo_source: null, places_photo_attribution_html: null },
        { photo_url: null, photo_source: null, places_photo_attribution_html: null },
    ]);
});
