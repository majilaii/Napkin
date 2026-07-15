import { assertEquals, createMockRequest, mockEnv } from '../_shared/test-utils.ts';
import { createFeedSocialsHandler } from './index.ts';

Deno.test('feed-socials endpoint strips user and table restaurant heroes', async () => {
    mockEnv();

    const restaurants = [
        {
            id: '18900000-0000-4000-8000-000000000001',
            name: 'User Hero Cafe',
            city: 'London',
            photo_url: 'https://private.invalid/user-hero.jpg',
            photo_source: 'user',
            places_photo_attribution_html: '<span>must not make user photos public</span>',
        },
        {
            id: '18900000-0000-4000-8000-000000000002',
            name: 'Table Hero Cafe',
            city: 'London',
            photo_url: 'https://private.invalid/table-hero.jpg',
            photo_source: 'table',
            places_photo_attribution_html: '<span>must not make table photos public</span>',
        },
    ];

    const viewerPassRows = restaurants.map((restaurant) => ({
        restaurant_id: restaurant.id,
        k7: 3,
        k30: 3,
        platform_7d: 'tiktok',
        platform_30d: 'tiktok',
        rep_saver_id: '18900000-0000-4000-8000-000000000099',
        rep_source_type: 'tiktok',
        rep_url: null,
        rep_author_handle: null,
        rep_created_at: '2026-07-15T12:00:00.000Z',
    }));

    const seededClient = {
        auth: {
            getUser: async () => ({
                data: { user: { id: '18900000-0000-4000-8000-000000000098' } },
                error: null,
            }),
        },
        rpc: async (name: string) => {
            if (name === 'fn_get_socials_candidates') {
                return {
                    data: restaurants.map((restaurant) => ({ restaurant_id: restaurant.id })),
                    error: null,
                };
            }
            if (name === 'fn_socials_viewer_pass') {
                return { data: viewerPassRows, error: null };
            }
            throw new Error(`Unexpected RPC: ${name}`);
        },
        from: (table: string) => {
            if (table !== 'restaurants') throw new Error(`Unexpected table: ${table}`);
            return {
                select: () => ({
                    in: async () => ({ data: restaurants, error: null }),
                }),
            };
        },
    };

    const handler = createFeedSocialsHandler(() => seededClient as never);
    const response = await handler(createMockRequest('POST'));
    const responseText = await response.text();
    const body = JSON.parse(responseText) as {
        data: {
            rows: Array<{
                restaurant_id: string;
                photo_url: string | null;
                photo_source: string | null;
                attribution_html: string | null;
            }>;
        };
    };

    assertEquals(response.status, 200);
    assertEquals(body.data.rows.length, 2);
    for (const row of body.data.rows) {
        assertEquals(row.photo_url, null);
        assertEquals(row.photo_source, null);
        assertEquals(row.attribution_html, null);
    }
    assertEquals(responseText.includes('user-hero.jpg'), false);
    assertEquals(responseText.includes('table-hero.jpg'), false);
});
