import {
    loadVisibleEntryIds,
    type EntryVisibilityRpcClient,
} from './entryVisibility.ts';

export type SearchRating = {
    tier: 'you' | 'friends' | 'google';
    value: number;
    scale: 5;
};

export type SearchRestaurantRow = {
    id: string;
    google_rating?: number | null;
    [key: string]: unknown;
};

export type SearchRatingEntry = {
    id: string;
    user_id: string;
    restaurant_id: string;
    rating: number;
};

type SearchProjectionContext = {
    viewerId: string;
    followedUserIds: ReadonlySet<string>;
    pinnedRestaurantIds: ReadonlySet<string>;
    ratingEntries: readonly SearchRatingEntry[];
    visibleFolloweeEntryIds: ReadonlySet<string>;
};

type SearchProjectionQueryResult = {
    data: Array<Record<string, unknown>> | null;
    error: unknown;
};

type SearchProjectionQueryBuilder = PromiseLike<SearchProjectionQueryResult> & {
    eq: (column: string, value: unknown) => SearchProjectionQueryBuilder;
    in: (column: string, values: unknown[]) => SearchProjectionQueryBuilder;
    not: (column: string, operator: string, value: unknown) => SearchProjectionQueryBuilder;
};

type SearchProjectionClient = EntryVisibilityRpcClient & {
    from: (table: string) => {
        select: (columns: string) => SearchProjectionQueryBuilder;
    };
};

function mean(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, rating) => sum + rating, 0) / values.length;
}

function roundedMean(values: readonly number[]): number | null {
    const value = mean(values);
    return value == null ? null : Math.round((value + Number.EPSILON) * 10) / 10;
}

/**
 * The friends ring is followees only. Every candidate id crosses the shared
 * SECURITY DEFINER visibility gate before it can affect either the count or
 * rating. Keeping this seam exported makes the authorization boundary directly
 * probeable without importing the edge-function server.
 */
export async function resolveVisibleFolloweeEntryIds(
    supabase: EntryVisibilityRpcClient,
    viewerId: string,
    entries: readonly SearchRatingEntry[],
): Promise<Set<string>> {
    return await loadVisibleEntryIds(
        supabase,
        viewerId,
        entries.map((entry) => ({ entryId: entry.id, authorId: entry.user_id })),
        { requireContent: true },
    );
}

/** Pure, stable projection: original row keys are copied byte-for-byte first. */
export function projectSearchRows<T extends SearchRestaurantRow>(
    rows: readonly T[],
    context: SearchProjectionContext,
): Array<T & {
    is_pinned: boolean;
    friends_been_count: number;
    rating: SearchRating | null;
}> {
    const entriesByRestaurant = new Map<string, SearchRatingEntry[]>();
    for (const entry of context.ratingEntries) {
        const list = entriesByRestaurant.get(entry.restaurant_id) ?? [];
        list.push(entry);
        entriesByRestaurant.set(entry.restaurant_id, list);
    }

    return rows.map((row) => {
        const entries = entriesByRestaurant.get(row.id) ?? [];
        const ownRatings = entries
            .filter((entry) => entry.user_id === context.viewerId)
            .map((entry) => entry.rating);

        const visibleFriendRatings = new Map<string, number[]>();
        for (const entry of entries) {
            if (
                !context.followedUserIds.has(entry.user_id)
                || !context.visibleFolloweeEntryIds.has(entry.id)
            ) continue;
            const ratings = visibleFriendRatings.get(entry.user_id) ?? [];
            ratings.push(entry.rating);
            visibleFriendRatings.set(entry.user_id, ratings);
        }

        const friendPersonAverages = [...visibleFriendRatings.values()]
            .map((ratings) => mean(ratings))
            .filter((value): value is number => value != null);
        const ownAverage = roundedMean(ownRatings);
        const friendsAverage = roundedMean(friendPersonAverages);
        const googleRating = typeof row.google_rating === 'number'
            ? row.google_rating
            : null;

        const rating: SearchRating | null = ownAverage != null
            ? { tier: 'you', value: ownAverage, scale: 5 }
            : friendsAverage != null
                ? { tier: 'friends', value: friendsAverage, scale: 5 }
                : googleRating != null
                    ? { tier: 'google', value: googleRating, scale: 5 }
                    : null;

        return {
            ...row,
            is_pinned: context.pinnedRestaurantIds.has(row.id),
            friends_been_count: visibleFriendRatings.size,
            rating,
        };
    });
}

/** One batched wishlist read + one followed-ring read + one rated-entry read. */
export async function enrichSearchRows<T extends SearchRestaurantRow>(
    supabase: SearchProjectionClient,
    viewerId: string,
    rows: readonly T[],
): Promise<ReturnType<typeof projectSearchRows<T>>> {
    const restaurantIds = [...new Set(rows.map((row) => row.id).filter(Boolean))];
    if (restaurantIds.length === 0) return [];

    const [pinsResult, followsResult] = await Promise.all([
        supabase
            .from('wishlist_items')
            .select('restaurant_id')
            .eq('user_id', viewerId)
            .in('restaurant_id', restaurantIds),
        supabase
            .from('follows')
            .select('following_id')
            .eq('follower_id', viewerId),
    ]);
    if (pinsResult.error) throw pinsResult.error;
    if (followsResult.error) throw followsResult.error;

    const followedUserIds = new Set<string>(
        (followsResult.data ?? [])
            .map((row) => row.following_id)
            .filter((id: string | undefined): id is string => !!id),
    );
    const authorIds = [viewerId, ...followedUserIds];
    const { data: rawEntries, error: entriesError } = await supabase
        .from('entries')
        .select('id, user_id, restaurant_id, rating')
        .in('restaurant_id', restaurantIds)
        .in('user_id', authorIds)
        .not('rating', 'is', null);
    if (entriesError) throw entriesError;

    const ratingEntries = (rawEntries ?? [])
        .filter((entry) => (
            typeof entry.id === 'string'
            && typeof entry.user_id === 'string'
            && typeof entry.restaurant_id === 'string'
            && typeof entry.rating === 'number'
        )) as SearchRatingEntry[];
    const followeeEntries = ratingEntries.filter((entry) => followedUserIds.has(entry.user_id));
    const visibleFolloweeEntryIds = followeeEntries.length > 0
        ? await resolveVisibleFolloweeEntryIds(supabase, viewerId, followeeEntries)
        : new Set<string>();

    return projectSearchRows(rows, {
        viewerId,
        followedUserIds,
        pinnedRestaurantIds: new Set<string>(
            (pinsResult.data ?? [])
                .map((row) => row.restaurant_id)
                .filter((id: string | undefined): id is string => !!id),
        ),
        ratingEntries,
        visibleFolloweeEntryIds,
    });
}
