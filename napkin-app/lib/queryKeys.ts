/**
 * Centralized React Query cache keys.
 * All hooks should import from here instead of hardcoding keys.
 */
export const queryKeys = {
    // User profile
    profile: (userId: string) => ['profile', userId] as const,

    // Reviews
    reviews: {
        byUser: (userId: string) => ['reviews', userId] as const,
        existing: (userId: string, restaurantId: string) =>
            ['existingReview', userId, restaurantId] as const,
    },

    // Restaurants
    restaurant: (foursquareId: string) => ['restaurant', foursquareId] as const,
    restaurantSearch: (query: string) => ['restaurantSearch', query] as const,
    restaurantStatus: (userId: string, restaurantId: string) =>
        ['restaurantStatus', userId, restaurantId] as const,

    // Feed
    feed: () => ['feed'] as const,
} as const;
