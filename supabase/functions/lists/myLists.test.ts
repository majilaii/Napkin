import { assertEquals } from '../_shared/test-utils.ts';
import { buildMyListSummary } from './myLists.ts';

const LIST = {
    id: '11111111-1111-4111-8111-111111111111',
    owner_id: '22222222-2222-4222-8222-222222222222',
    title: 'Late-night noodles',
    description: null,
    ranked: false,
    privacy: 'public' as const,
    emoji: '🍜',
    table_id: null,
    created_at: '2026-07-15T12:00:00.000Z',
    updated_at: '2026-07-15T13:00:00.000Z',
};

Deno.test('list_mine payload snapshot carries attributed Places cover metadata additively', () => {
    const row = buildMyListSummary({
        list: LIST,
        entryCount: 3,
        verifiedCount: 2,
        coverRestaurant: {
            name: 'Ada Cafe',
            photo_url: 'https://project.supabase.co/storage/v1/object/public/restaurant-photos/place.jpg',
            photo_source: 'places',
            places_photo_attribution_html: '<a href="https://maps.google.com/?cid=1">Ada</a>',
        },
        tableName: null,
    });

    // Freeze the wire envelope and complete row so neither existing fields nor
    // the new source/attribution pair can drift independently of the function.
    assertEquals({ data: [row] }, {
        data: [{
            ...LIST,
            entry_count: 3,
            verified_count: 2,
            cover_photo_url: 'https://project.supabase.co/storage/v1/object/public/restaurant-photos/place.jpg',
            cover_photo_source: 'places',
            cover_attribution_html: '<a href="https://maps.google.com/?cid=1">Ada</a>',
            cover_restaurant_name: 'Ada Cafe',
            table_name: null,
        }],
    });
});

Deno.test('list_mine cover projection preserves non-Places covers without inventing attribution', () => {
    const row = buildMyListSummary({
        list: LIST,
        entryCount: null,
        verifiedCount: 0,
        coverRestaurant: {
            name: 'Own Photo Cafe',
            photo_url: 'https://project.supabase.co/storage/v1/object/public/entry-photos/own.jpg',
            photo_source: 'user',
            places_photo_attribution_html: null,
        },
        tableName: 'Sunday Club',
    });

    assertEquals(row.cover_photo_url, 'https://project.supabase.co/storage/v1/object/public/entry-photos/own.jpg');
    assertEquals(row.cover_photo_source, 'user');
    assertEquals(row.cover_attribution_html, null);
    assertEquals(row.cover_restaurant_name, 'Own Photo Cafe');
    assertEquals(row.entry_count, 0);
    assertEquals(row.table_name, 'Sunday Club');
});

Deno.test('list_mine cover projection emits an explicit nullable triplet when no cover exists', () => {
    const row = buildMyListSummary({
        list: LIST,
        entryCount: 0,
        verifiedCount: 0,
        coverRestaurant: null,
        tableName: null,
    });

    assertEquals({
        cover_photo_url: row.cover_photo_url,
        cover_photo_source: row.cover_photo_source,
        cover_attribution_html: row.cover_attribution_html,
        cover_restaurant_name: row.cover_restaurant_name,
    }, {
        cover_photo_url: null,
        cover_photo_source: null,
        cover_attribution_html: null,
        cover_restaurant_name: null,
    });
});
