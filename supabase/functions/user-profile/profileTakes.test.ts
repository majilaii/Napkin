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
        },
        {
            id: 'r2',
            name: 'Two',
            city: null,
            cuisine: null,
            photo_url: 'https://private-user-upload.test/two.jpg',
            photo_source: 'user',
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
            note: null,
        },
    ]);

    assertEquals(Object.keys(result[0]).sort(), [
        'city',
        'cuisine',
        'name',
        'note',
        'photo_url',
        'position',
        'prompt_key',
        'restaurant_id',
    ]);
});
