import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryKeys';

/** Server-derived profile/Taste surfaces affected by any scalar entry mutation. */
export function invalidateEntryTasteCaches(queryClient: QueryClient, userId: string) {
    queryClient.invalidateQueries({ queryKey: queryKeys.users.profile(userId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.spots(userId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.taste(userId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.users.ledgerAll(userId) });
}
