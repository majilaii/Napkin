export type ListSummarySource = {
    id: string;
    title: string;
    ranked: boolean;
    privacy: 'public' | 'private';
    updated_at: string;
};

export type ListCoverRestaurant = {
    name?: string | null;
    photo_url?: string | null;
    photo_source?: string | null;
    places_photo_attribution_html?: string | null;
};

export type ListSummary = ListSummarySource & {
    entry_count: number;
    cover_photo_url: string | null;
    cover_photo_source: string | null;
    cover_attribution_html: string | null;
    cover_restaurant_name: string | null;
};

/**
 * Build the exact public-list summary row carried by the user-profile payload.
 * Keep every existing field and photo URL semantic intact; the client owns the
 * Places fail-safe when source and attribution do not form a renderable pair.
 */
export function projectListSummary(
    list: ListSummarySource,
    entryCount: number,
    restaurant: ListCoverRestaurant | null | undefined,
): ListSummary {
    return {
        id: list.id,
        title: list.title,
        entry_count: entryCount,
        ranked: list.ranked,
        privacy: list.privacy,
        updated_at: list.updated_at,
        cover_photo_url: restaurant?.photo_url ?? null,
        cover_photo_source: restaurant?.photo_source ?? null,
        cover_attribution_html: restaurant?.places_photo_attribution_html ?? null,
        cover_restaurant_name: restaurant?.name ?? null,
    };
}
