import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { guestSafePhoto, toGuestRow } from './guestProjection.ts';

const base = {
    id: 'r1',
    name: 'Padella',
    city: 'London',
    country: 'United Kingdom',
    address: '6 Southwark St',
    cuisine: 'Italian',
    price_level: 2,
    google_rating: 4.6,
    google_rating_count: 9000,
};

Deno.test('a Places photo and its credit survive', () => {
    const row = toGuestRow({
        ...base,
        photo_url: 'https://cdn.example/places.jpg',
        photo_source: 'places',
        places_photo_attribution_html: '<a href="https://maps.example">A. Author</a>',
    }, 3);
    assertEquals(row.photo_url, 'https://cdn.example/places.jpg');
    assertEquals(row.places_photo_attribution_html, '<a href="https://maps.example">A. Author</a>');
    assertEquals(row.review_count, 3);
});

Deno.test('a member or Table photo never reaches a guest', () => {
    for (const source of ['user', 'table', 'none', null, undefined]) {
        const row = toGuestRow({
            ...base,
            photo_url: 'https://storage.example/entry-photos/member/meal.jpg',
            photo_source: source,
            places_photo_attribution_html: 'x',
        }, 0);
        assertEquals(row.photo_url, null, `photo_source=${String(source)}`);
        assertEquals(row.places_photo_attribution_html, null, `photo_source=${String(source)}`);
    }
});

Deno.test('toGuestRow emits exactly the allowlisted keys', () => {
    const row = toGuestRow({
        ...base,
        photo_url: null,
        photo_source: 'places',
        places_photo_attribution_html: null,
        created_by: 'someone',
        verification: 'verified',
        reserve_url: 'https://book.example',
    }, 0);
    assertEquals(Object.keys(row).sort(), [
        'address', 'city', 'country', 'cuisine', 'google_rating', 'google_rating_count', 'id', 'name',
        'photo_source', 'photo_url', 'places_photo_attribution_html', 'price_level', 'review_count',
    ]);
});

Deno.test('guestSafePhoto keeps every other page field', () => {
    const page = guestSafePhoto({
        id: 'r1',
        photo_url: 'https://storage.example/x.jpg',
        photo_source: 'table',
        places_photo_attribution_html: null,
        website: 'https://padella.example',
    });
    assertEquals(page, {
        id: 'r1',
        photo_url: null,
        photo_source: 'table',
        places_photo_attribution_html: null,
        website: 'https://padella.example',
    });
});
