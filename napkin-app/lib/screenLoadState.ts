export type RequiredDataState = 'loading' | 'error' | 'ready';

export function resolveRequiredDataState({
    isLoading,
    isError,
    hasData,
}: {
    isLoading: boolean;
    isError: boolean;
    hasData: boolean;
}): RequiredDataState {
    if (hasData) return 'ready';
    if (isError) return 'error';
    if (isLoading) return 'loading';
    return 'error';
}

export type WishlistPrimaryState = 'loading' | 'error' | 'empty' | 'list';

export function resolveWishlistPrimaryState({
    isLoading,
    isError,
    cachedItemCount,
    pinnedCount,
    hasActiveFilters,
    hasSearchQuery,
}: {
    isLoading: boolean;
    isError: boolean;
    cachedItemCount: number;
    pinnedCount: number;
    hasActiveFilters: boolean;
    hasSearchQuery: boolean;
}): WishlistPrimaryState {
    if (isError && cachedItemCount === 0) return 'error';
    if (isLoading && cachedItemCount === 0) return 'loading';
    if (pinnedCount === 0 && !hasActiveFilters && !hasSearchQuery) return 'empty';
    return 'list';
}

export function isWishlistPullRefreshing(
    isRefetching: boolean,
    isFetchingNextPage: boolean,
): boolean {
    return isRefetching && !isFetchingNextPage;
}

export function shouldShowRestaurantErrorShell({
    hasError,
    hasRestaurant,
    isGhost,
    isResolvedEmpty = false,
}: {
    hasError: boolean;
    hasRestaurant: boolean;
    isGhost: boolean;
    /**
     * The page query settled but carried no restaurant. A deleted or unknown id
     * returns 200 with `restaurant: null` rather than an error, so `hasError`
     * alone leaves the screen painting blank paper with no back control
     * (TICKET-217 drive-through, 2026-08-27).
     */
    isResolvedEmpty?: boolean;
}): boolean {
    if (hasRestaurant || isGhost) return false;
    return hasError || isResolvedEmpty;
}
