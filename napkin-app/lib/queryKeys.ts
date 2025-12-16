/**
 * Centralized React Query cache keys.
 * All hooks should import from here instead of hardcoding keys.
 */
export const queryKeys = {
    // User profile
    profile: (userId: string) => ['profile', userId] as const,

    // Entries (meals, reviews, visits)
    entries: {
        byUser: (userId: string) => ['entries', userId] as const,
        latest: (userId: string, locationId: string) =>
            ['latestEntry', userId, locationId] as const,
        history: (userId: string, locationId: string) =>
            ['entryHistory', userId, locationId] as const,
    },

    // Restaurants
    restaurant: (placeId: string) => ['restaurant', placeId] as const,
    restaurantSearch: (query: string) => ['restaurantSearch', query] as const,
    restaurantStatus: (userId: string, placeId: string) =>
        ['restaurantStatus', userId, placeId] as const,

    // User saved places
    userPlaces: (userId: string) => ['userPlaces', userId] as const,

    // Feed
    feed: () => ['feed'] as const,
} as const;

