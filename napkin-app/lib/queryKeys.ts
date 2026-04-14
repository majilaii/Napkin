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
        activity: (tableId: string) => ['tableActivity', tableId] as const,
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
    },
} as const;
