export interface TableWishlistProfile {
    display_name: string | null;
    avatar_url: string | null;
}

export interface TableWishlistRow<Restaurant = unknown> {
    id: string;
    user_id: string;
    restaurant_id: string;
    created_at: string;
    restaurant: Restaurant;
}

export interface AggregatedTableWishlistItem<Restaurant = unknown> {
    restaurant: Restaurant;
    count: number;
    members: Array<{
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
    }>;
    viewer_item_id: string | null;
}

/**
 * Groups member wishlist rows into the existing table-wishlist response shape.
 *
 * Rows arrive newest-first from PostgREST. Keep scanning after the five-member
 * avatar cap so the authenticated viewer's own item id is resolved without
 * relying on display-only member data.
 */
export function aggregateTableWishlist<Restaurant>(
    rows: readonly TableWishlistRow<Restaurant>[],
    profileMap: ReadonlyMap<string, TableWishlistProfile>,
    viewerId: string,
): AggregatedTableWishlistItem<Restaurant>[] {
    const restaurantMap = new Map<string, {
        restaurant: Restaurant;
        count: number;
        members: Array<{
            user_id: string;
            display_name: string | null;
            avatar_url: string | null;
        }>;
        viewer_item_id: string | null;
        max_created_at: string;
    }>();

    for (const row of rows) {
        const rid = row.restaurant_id;
        if (!restaurantMap.has(rid)) {
            restaurantMap.set(rid, {
                restaurant: row.restaurant,
                count: 0,
                members: [],
                viewer_item_id: null,
                max_created_at: row.created_at,
            });
        }
        const entry = restaurantMap.get(rid)!;
        entry.count++;
        // Cap at 5 members for the avatar stack.
        if (entry.members.length < 5) {
            const prof = profileMap.get(row.user_id);
            entry.members.push({
                user_id: row.user_id,
                display_name: prof?.display_name ?? null,
                avatar_url: prof?.avatar_url ?? null,
            });
        }
        // This is deliberately independent of the display-member cap above.
        if (row.user_id === viewerId) {
            entry.viewer_item_id = row.id;
        }
        // Keep the most recent save timestamp for secondary sort.
        if (row.created_at > entry.max_created_at) {
            entry.max_created_at = row.created_at;
        }
    }

    // Preserve the existing runtime order: count DESC, then newest save DESC.
    return Array.from(restaurantMap.values())
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return b.max_created_at > a.max_created_at ? 1 : -1;
        })
        .slice(0, 200)
        .map(({ restaurant, count, members, viewer_item_id }) => ({
            restaurant,
            count,
            members,
            viewer_item_id,
        }));
}
