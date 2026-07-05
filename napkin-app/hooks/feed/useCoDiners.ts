/**
 * useCoDiners — co-diner follow candidates for the zero-follow feed empty
 * state (TICKET-101, tier 1).
 *
 * The people the viewer has actually eaten with on Napkin (union of entry /
 * supper / round / table co-attendance), ranked by meals-together, minus
 * everyone they already follow, either-direction blocks, and self. Computed
 * server-side by fn_co_diner_candidates (SECURITY DEFINER); this hook is a thin
 * read. An empty array is legitimate — it flips the empty state to tier 2
 * (ghost card + invite). Per-viewer, so keyed by userId.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface CoDinerCandidate {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    /** Distinct meal-events shared with the viewer — the "N meals together". */
    meals_together: number;
}

async function fetchCoDiners(): Promise<CoDinerCandidate[]> {
    // POST action fn; callEdgeFn unwraps the { data: [...] } envelope to the array.
    const data = await callEdgeFn<CoDinerCandidate[]>('user-profile', {
        action: 'co_diners',
    });
    return Array.isArray(data) ? data : [];
}

export function useCoDiners(userId: string | null | undefined) {
    return useQuery<CoDinerCandidate[], Error>({
        queryKey: queryKeys.feed.coDiners(userId ?? ''),
        queryFn: fetchCoDiners,
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
