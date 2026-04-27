/**
 * Centralized React Query cache keys.
 * All hooks import from here instead of hardcoding keys.
 *
 * Scope is deliberately small: Napkin's v1 is Tables and Table Night.
 * Add new key groups here when you wire new features — don't inline them.
 *
 * Each group exposes both leaf-key builders (e.g. `users.profile(id)`) and
 * `*All()` prefix helpers (e.g. `users.profileAll()`) for invalidation.
 * Use the `*All()` form when invalidating across many ids; never inline
 * `['users', 'profile']` literals — TICKET-039 doctrine.
 */
export const queryKeys = {
    // Tables (supper club groups)
    tables: {
        list: (userId: string) => ['tables', userId] as const,
        detail: (tableId: string) => ['table', tableId] as const,
        members: (tableId: string) => ['tableMembers', tableId] as const,
        activityAll: () => ['tableActivity'] as const,
        activityForTable: (tableId: string) => ['tableActivity', tableId] as const,
        activity: (tableId: string, filters?: { filterType?: string; filterUserId?: string }) =>
            filters && (filters.filterType || filters.filterUserId)
                ? ['tableActivity', tableId, filters] as const
                : ['tableActivity', tableId] as const,
        lastSeen: (tableId: string, userId: string) =>
            ['tableLastSeen', tableId, userId] as const,
        topFourAll: () => ['tables', 'topFour'] as const,
        topFour: (tableId: string) => ['tables', 'topFour', tableId] as const,
    },

    // Entries (individual meal logs)
    entries: {
        list: (userId: string) => ['entries', userId] as const,
        detail: (entryId: string) => ['entry', entryId] as const,
        participants: (entryId: string) => ['entry', entryId, 'participants'] as const,
        forDayAll: (userId: string) => ['entriesForDay', userId] as const,
        forDay: (userId: string, date: string) => ['entriesForDay', userId, date] as const,
        mySolo: (userId: string) => ['entries', 'mySolo', userId] as const,
    },

    // Table Night (real-time group rating sessions)
    tableNight: {
        status: (nightId: string) => ['tableNight', nightId] as const,
        active: (tableId: string) => ['tableNight', 'active', tableId] as const,
        participants: (nightId: string) =>
            ['tableNight', nightId, 'participants'] as const,
        roundContext: (nightId: string) => ['roundContext', nightId] as const,
        photoPool: (nightId: string) => ['night-photos-pool', nightId] as const,
        nightPhotos: (nightId: string) => ['night-entry-photos', nightId] as const,
        myEntryId: (nightId: string, userId: string) => ['myEntryId', nightId, userId] as const,
        resolveEntryByNight: (nightId: string, userId: string) => ['resolve-entry-by-night', nightId, userId] as const,
    },

    // Members (Table-scoped member profiles)
    members: {
        profile: (userId: string, tableId: string) => ['members', 'profile', userId, tableId] as const,
    },

    // Post Interactions (reactions + comments on table_nights and entries)
    postInteractions: {
        all: (targetType: string, targetId: string, scope: 'table' | 'public' = 'table') =>
            ['postInteractions', targetType, targetId, scope] as const,
    },

    // Search (restaurant search — Places + local DB)
    search: {
        places: (q: string) => ['search', 'places', q] as const,
        persisted: (q: string, userId: string) => ['search', 'persisted', userId, q] as const,
    },

    // Wishlist (personal saves + derived Table overlap view)
    wishlist: {
        personal: (userId: string) => ['wishlist', 'personal', userId] as const,
        tableAll: () => ['wishlist', 'table'] as const,
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
        profileAll: () => ['users', 'profile'] as const,
        profile: (identifier: string) => ['users', 'profile', identifier] as const,
        diary: (userId: string) =>
            ['users', 'diary', userId] as const,
        regulars: (userId: string) => ['users', 'regulars', userId] as const,
        searchAll: () => ['users', 'search'] as const,
        search: (q: string, opts?: { mutualOnly?: boolean }) =>
            opts?.mutualOnly
                ? ['users', 'search', q, 'mutual'] as const
                : ['users', 'search', q] as const,
        recentCompanions: (userId: string) => ['users', 'recentCompanions', userId] as const,
        followingAll: () => ['users', 'following'] as const,
        following: (userId: string) => ['users', 'following', userId] as const,
        followListAll: () => ['users', 'followList'] as const,
        followList: (userId: string, kind: 'followers' | 'following') =>
            ['users', 'followList', userId, kind] as const,
    },

    // Feed (cross-Table chronological feed — Feed tab)
    feed: {
        rootAll: () => ['feed'] as const,
        all: (userId: string) => ['feed', userId] as const,
    },

    // Atlas (geographic lens on a Table's dining history)
    atlas: {
        all: () => ['atlas'] as const,
        index: (tableId: string) => ['atlas', tableId] as const,
        city: (tableId: string, city: string) => ['atlas', tableId, city] as const,
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

    // Misc per-entry caches (entry-detail screen ad-hoc queries)
    entryDetail: {
        photos: (entryId: string) => ['entry-photos', entryId] as const,
        publicEligibility: (entryId: string) => ['entry-public-eligibility', entryId] as const,
    },

    // Notifications (Heirloom inbox — friend logs, pins, Top 4 edits, invites, nudges)
    notifications: {
        all: (userId: string) => ['notifications', userId] as const,
        unreadCount: (userId: string) => ['notifications', userId, 'unread'] as const,
    },

    // Top Fours — personal regional Top 4s (TICKET-047)
    // [ARCH-8] Two distinct keys: owner sees nudge + edit chrome; viewer does not.
    // Mutations only touch owner(authUserId). Viewer caches drain on stale-time.
    topFours: {
        owner: (userId: string) => ['topFours', 'owner', userId] as const,
        publicView: (userId: string) => ['topFours', 'public', userId] as const,
        availableCities: (userId: string) => ['topFours', 'availableCities', userId] as const,
        eligibleRestaurants: (userId: string, city: string) =>
            ['topFours', 'eligibleRestaurants', userId, city] as const,
    },

    // Admin — operator surfaces (TICKET-033)
    admin: {
        // Critics list paginated by (scraped_at desc, id desc)
        criticsList: () => ['admin', 'criticsList'] as const,
        // Cached isAdmin check per user — staleTime: Infinity in useIsAdmin
        isAdmin: (userId: string) => ['admin', 'isAdmin', userId] as const,
    },
} as const;

