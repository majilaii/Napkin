import {
    isWishlistPullRefreshing,
    resolveRequiredDataState,
    resolveWishlistPrimaryState,
    shouldShowRestaurantErrorShell,
} from './screenLoadState';

describe('TICKET-217 screen load states', () => {
    it('entry detail leaves the spinner for failed and loaded-but-missing reads', () => {
        expect(resolveRequiredDataState({ isLoading: true, isError: false, hasData: false }))
            .toBe('loading');
        expect(resolveRequiredDataState({ isLoading: false, isError: true, hasData: false }))
            .toBe('error');
        expect(resolveRequiredDataState({ isLoading: false, isError: false, hasData: false }))
            .toBe('error');
        expect(resolveRequiredDataState({ isLoading: false, isError: false, hasData: true }))
            .toBe('ready');
    });

    it('privacy renders cached profile data and errors when the required profile is absent', () => {
        expect(resolveRequiredDataState({ isLoading: true, isError: false, hasData: true }))
            .toBe('ready');
        expect(resolveRequiredDataState({ isLoading: false, isError: true, hasData: false }))
            .toBe('error');
        expect(resolveRequiredDataState({ isLoading: false, isError: false, hasData: false }))
            .toBe('error');
    });

    it('wishlist distinguishes a failed empty cache from a successful empty wishlist', () => {
        const base = {
            isLoading: false,
            cachedItemCount: 0,
            pinnedCount: 0,
            hasActiveFilters: false,
            hasSearchQuery: false,
        };

        expect(resolveWishlistPrimaryState({ ...base, isError: true })).toBe('error');
        expect(resolveWishlistPrimaryState({ ...base, isError: false })).toBe('empty');
        expect(resolveWishlistPrimaryState({
            ...base,
            isError: true,
            cachedItemCount: 1,
            pinnedCount: 1,
        })).toBe('list');
    });

    it('wishlist pull-to-refresh excludes pagination fetches', () => {
        expect(isWishlistPullRefreshing(true, false)).toBe(true);
        expect(isWishlistPullRefreshing(true, true)).toBe(false);
        expect(isWishlistPullRefreshing(false, false)).toBe(false);
    });

    it('restaurant uses a hard error shell only when persisted identity is unavailable', () => {
        expect(shouldShowRestaurantErrorShell({
            hasError: true,
            hasRestaurant: false,
            isGhost: false,
        })).toBe(true);
        expect(shouldShowRestaurantErrorShell({
            hasError: true,
            hasRestaurant: true,
            isGhost: false,
        })).toBe(false);
        expect(shouldShowRestaurantErrorShell({
            hasError: true,
            hasRestaurant: false,
            isGhost: true,
        })).toBe(false);
    });

    // Drive-through 2026-08-27: napkin://restaurant/<unknown-uuid> resolves 200
    // with restaurant: null — no error — and painted blank paper with no back
    // control. A settled-empty page must reach the same shell as a failure.
    it('restaurant shows the shell when the page resolves with no restaurant', () => {
        expect(shouldShowRestaurantErrorShell({
            hasError: false,
            hasRestaurant: false,
            isGhost: false,
            isResolvedEmpty: true,
        })).toBe(true);
        // Still loading (nothing resolved yet) must stay on the spinner.
        expect(shouldShowRestaurantErrorShell({
            hasError: false,
            hasRestaurant: false,
            isGhost: false,
            isResolvedEmpty: false,
        })).toBe(false);
        // A resolved-empty page that still has a cached/ghost identity renders.
        expect(shouldShowRestaurantErrorShell({
            hasError: false,
            hasRestaurant: true,
            isGhost: false,
            isResolvedEmpty: true,
        })).toBe(false);
    });
});
