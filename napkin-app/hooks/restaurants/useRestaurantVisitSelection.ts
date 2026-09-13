import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

/** Ephemeral, owner-scoped return signal between the native composer modal and
 * its restaurant page. Starting a composer clears the previous signal. */
export function useRestaurantVisitSelection(userId: string, pageId: string) {
    const qc = useQueryClient();
    const queryKey = queryKeys.restaurants.visitSelection(userId, pageId);
    const { data } = useQuery<string | null>({ queryKey, queryFn: () => null, enabled: false, initialData: null });
    const selectVisit = useCallback((entryId: string | null) => {
        qc.setQueryData(queryKeys.restaurants.visitSelection(userId, pageId), entryId);
    }, [qc, userId, pageId]);
    return { selectedVisitId: data, selectVisit };
}
