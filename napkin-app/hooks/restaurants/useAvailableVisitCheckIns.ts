import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { fetchRestaurantPage, type SelfLogRow } from './useRestaurantPage';

export function isAvailableVisitCheckIn(visit: SelfLogRow): boolean {
    return visit.source === 'solo' && !!visit.entry_id && !visit.supper_id && !visit.table_night_id
        && visit.rating == null && !visit.note?.trim() && !visit.photos.length;
}

/** self_log is the authenticated viewer's history. Keep its suggestion cache
 * owner-scoped; the selected entry is loaded and checked again before editing. */
export function useAvailableVisitCheckIns(userId?: string, pageId?: string, enabled = true) {
    return useQuery({
        queryKey: queryKeys.restaurants.availableCheckIns(userId ?? '', pageId ?? ''),
        queryFn: async () => {
            const page = await fetchRestaurantPage(pageId!);
            return (page.self_log ?? []).filter(isAvailableVisitCheckIn).sort((a, b) =>
                (b.visited_at ?? b.created_at ?? '').localeCompare(a.visited_at ?? a.created_at ?? '')
                || (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id.localeCompare(a.id));
        },
        enabled: enabled && !!userId && !!pageId,
        staleTime: 0,
        retry: false,
    });
}
