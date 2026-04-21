/**
 * Centralized React Query cache keys.
 * All hooks import from here instead of hardcoding keys.
 *
 * Scope is deliberately small: Napkin's v1 is Tables and Table Night.
 * Add new key groups here when you wire new features — don't inline them.
 */
export const queryKeys = {
    // Tables (supper club groups)
    tables: {
        list: (userId: string) => ['tables', userId] as const,
        detail: (tableId: string) => ['table', tableId] as const,
        members: (tableId: string) => ['tableMembers', tableId] as const,
        activity: (tableId: string, filters?: { filterType?: string; filterUserId?: string }) =>
            filters && (filters.filterType || filters.filterUserId)
                ? ['tableActivity', tableId, filters] as const
                : ['tableActivity', tableId] as const,
        lastSeen: (tableId: string, userId: string) =>
            ['tableLastSeen', tableId, userId] as const,
    },

    // Entries (individual meal logs)
    entries: {
        list: (userId: string) => ['entries', userId] as const,
        detail: (entryId: string) => ['entry', entryId] as const,
        participants: (entryId: string) => ['entry', entryId, 'participants'] as const,
    },

    // Table Night (real-time group rating sessions)
    tableNight: {
        status: (nightId: string) => ['tableNight', nightId] as const,
        active: (tableId: string) => ['tableNight', 'active', tableId] as const,
        participants: (nightId: string) =>
            ['tableNight', nightId, 'participants'] as const,
        roundContext: (nightId: string) => ['roundContext', nightId] as const,
        photoPool: (nightId: string) => ['night-photos-pool', nightId] as const,
    },

    // Members (Table-scoped member profiles)
    members: {
        profile: (userId: string, tableId: string) => ['members', 'profile', userId, tableId] as const,
    },

    // Post Interactions (reactions + comments on table_nights and entries)
    postInteractions: {
        all: (targetType: string, targetId: string) =>
            ['postInteractions', targetType, targetId] as const,
    },

    // Personal Table (diary table auto-created on signup)
    personalTable: {
        byUser: (userId: string) => ['personalTable', userId] as const,
    },

    // Search (restaurant search — Places + local DB)
    search: {
        places: (q: string) => ['search', 'places', q] as const,
        persisted: (q: string, userId: string) => ['search', 'persisted', userId, q] as const,
    },

    // Wishlist (personal saves + derived Table overlap view)
    wishlist: {
        personal: (userId: string) => ['wishlist', 'personal', userId] as const,
        table: (tableId: string) => ['wishlist', 'table', tableId] as const,
        check: (userId: string, restaurantId: string) =>
            ['wishlist', 'check', userId, restaurantId] as const,
    },

    // Lists (curated, themed, shareable — TICKET-018)
    lists: {
        mine: (userId: string) => ['lists', 'mine', userId] as const,
        detail: (listId: string) => ['lists', 'detail', listId] as const,
        containing: (userId: string, restaurantId: string) =>
            ['lists', 'containing', userId, restaurantId] as const,
    },

    // Users (public / merged profile surface — TICKET-020, TICKET-025)
    users: {
        profile: (identifier: string) => ['users', 'profile', identifier] as const,
        diary: (userId: string, cursor?: string) =>
            cursor
                ? ['users', 'diary', userId, cursor] as const
                : ['users', 'diary', userId] as const,
        regulars: (userId: string) => ['users', 'regulars', userId] as const,
        search: (q: string) => ['users', 'search', q] as const,
        recentCompanions: (userId: string) => ['users', 'recentCompanions', userId] as const,
        following: (userId: string) => ['users', 'following', userId] as const,
    },

    // Feed (cross-Table chronological feed — Feed tab)
    feed: {
        all: (userId: string) => ['feed', userId] as const,
    },

    // Restaurants (accumulated Table + user memory per venue)
    restaurants: {
        tableHistory: (
            restaurantId: string,
            tableId: string,
            excludeNightId?: string,
        ) =>
            excludeNightId
                ? ['restaurantHistory', 'table', restaurantId, tableId, excludeNightId] as const
                : ['restaurantHistory', 'table', restaurantId, tableId] as const,
        userHistory: (
            restaurantId: string,
            userId: string,
            excludeEntryId?: string,
        ) =>
            excludeEntryId
                ? ['restaurantHistory', 'user', restaurantId, userId, excludeEntryId] as const
                : ['restaurantHistory', 'user', restaurantId, userId] as const,
        page: (restaurantId: string, tableId?: string) =>
            tableId
                ? ['restaurantPage', restaurantId, tableId] as const
                : ['restaurantPage', restaurantId] as const,
    },
} as const;
