import { assertEquals } from '../_shared/test-utils.ts';
import {
    aggregateTableWishlist,
    type TableWishlistProfile,
    type TableWishlistRow,
} from './listTable.ts';

interface TestRestaurant {
    id: string;
    name: string;
}

const VIEWER_ID = 'viewer';

function row(
    id: string,
    userId: string,
    restaurantId = 'restaurant-1',
    createdAt = '2026-07-16T12:00:00.000Z',
): TableWishlistRow<TestRestaurant> {
    return {
        id,
        user_id: userId,
        restaurant_id: restaurantId,
        created_at: createdAt,
        restaurant: { id: restaurantId, name: `Restaurant ${restaurantId}` },
    };
}

function profiles(userIds: readonly string[]) {
    return new Map<string, TableWishlistProfile>(
        userIds.map((userId) => [
            userId,
            { display_name: `Member ${userId}`, avatar_url: `https://example.com/${userId}.jpg` },
        ]),
    );
}

Deno.test('aggregateTableWishlist returns the JWT viewer exact wishlist item id', () => {
    const rows = [
        row('other-item', 'member-1'),
        row('viewer-item', VIEWER_ID, 'restaurant-1', '2026-07-16T11:00:00.000Z'),
    ];

    const [result] = aggregateTableWishlist(rows, profiles(['member-1', VIEWER_ID]), VIEWER_ID);

    assertEquals(result.viewer_item_id, 'viewer-item');
});

Deno.test('aggregateTableWishlist returns null when only other members saved a restaurant', () => {
    const rows = [
        row('member-1-item', 'member-1'),
        row('member-2-item', 'member-2', 'restaurant-1', '2026-07-16T11:00:00.000Z'),
    ];

    const [result] = aggregateTableWishlist(rows, profiles(['member-1', 'member-2']), VIEWER_ID);

    assertEquals(result.viewer_item_id, null);
});

Deno.test('aggregateTableWishlist never exposes another member item id', () => {
    const rows = [
        row('other-restaurant-item', 'member-1', 'restaurant-other'),
        row('viewer-item', VIEWER_ID, 'restaurant-viewer', '2026-07-16T11:00:00.000Z'),
        row('other-item', 'member-2', 'restaurant-viewer', '2026-07-16T10:00:00.000Z'),
    ];

    const result = aggregateTableWishlist(
        rows,
        profiles(['member-1', 'member-2', VIEWER_ID]),
        VIEWER_ID,
    );
    const otherRestaurant = result.find((item) => item.restaurant.id === 'restaurant-other');
    const viewerRestaurant = result.find((item) => item.restaurant.id === 'restaurant-viewer');

    assertEquals(otherRestaurant?.viewer_item_id, null);
    assertEquals(viewerRestaurant?.viewer_item_id, 'viewer-item');
});

Deno.test('aggregateTableWishlist resolves the viewer outside the five-member display cap', () => {
    const userIds = ['member-1', 'member-2', 'member-3', 'member-4', 'member-5', VIEWER_ID, 'member-7'];
    const rows = userIds.map((userId, index) =>
        row(
            userId === VIEWER_ID ? 'viewer-item' : `${userId}-item`,
            userId,
            'restaurant-1',
            `2026-07-16T${String(12 - index).padStart(2, '0')}:00:00.000Z`,
        )
    );

    const [result] = aggregateTableWishlist(rows, profiles(userIds), VIEWER_ID);

    assertEquals(result.count, 7);
    assertEquals(result.members.map((member) => member.user_id), userIds.slice(0, 5));
    assertEquals(result.viewer_item_id, 'viewer-item');
});

Deno.test('aggregateTableWishlist preserves grouping, response shape, and runtime ordering', () => {
    const rows = [
        row('a-1', 'member-1', 'restaurant-a', '2026-07-16T12:00:00.000Z'),
        row('b-1', 'member-2', 'restaurant-b', '2026-07-16T11:00:00.000Z'),
        row('b-2', 'member-3', 'restaurant-b', '2026-07-16T10:00:00.000Z'),
        row('c-1', 'member-4', 'restaurant-c', '2026-07-16T09:00:00.000Z'),
    ];

    const result = aggregateTableWishlist(
        rows,
        profiles(['member-1', 'member-2', 'member-3', 'member-4']),
        VIEWER_ID,
    );

    assertEquals(result.map((item) => item.restaurant.id), [
        'restaurant-b',
        'restaurant-a',
        'restaurant-c',
    ]);
    assertEquals(Object.keys(result[0]), ['restaurant', 'count', 'members', 'viewer_item_id']);
});
