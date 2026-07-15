/** Restaurant cover metadata selected for the `list_mine` shelf projection. */
export interface MyListCoverRestaurant {
    photo_url: string | null;
    photo_source: string | null;
    places_photo_attribution_html: string | null;
}

/** Supabase relationship inference may expose a to-one embed as an array. */
export function normalizeMyListCoverRestaurant(
    value:
        | MyListCoverRestaurant
        | MyListCoverRestaurant[]
        | null
        | undefined,
): MyListCoverRestaurant | null {
    return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

interface BuildMyListSummaryInput<T extends object> {
    list: T;
    entryCount: number | null;
    verifiedCount: number;
    coverRestaurant: MyListCoverRestaurant | null | undefined;
    tableName: string | null;
}

/**
 * Exact additive projection returned by `list_mine`.
 *
 * Keep the raw source metadata paired with the URL. The client owns the
 * fail-safe rendering rule (a Places URL without attribution is suppressed),
 * while non-Places authored/Table covers remain available without a credit.
 */
export function buildMyListSummary<T extends object>({
    list,
    entryCount,
    verifiedCount,
    coverRestaurant,
    tableName,
}: BuildMyListSummaryInput<T>) {
    return {
        ...list,
        entry_count: entryCount ?? 0,
        verified_count: verifiedCount,
        cover_photo_url: coverRestaurant?.photo_url ?? null,
        cover_photo_source: coverRestaurant?.photo_source ?? null,
        cover_attribution_html: coverRestaurant?.places_photo_attribution_html ?? null,
        table_name: tableName,
    };
}
