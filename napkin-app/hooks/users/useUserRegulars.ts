/**
 * useUserRegulars — full list of ≥3-visit restaurants for a user.
 * TICKET-025
 *
 * Single fetch (up to 200 rows expected). Sorted by visit_count desc server-side.
 * Gated: self always; stranger requires public profile.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import type { RegularSummary } from './useUserProfile';

export type { RegularSummary } from './useUserProfile';

async function fetchUserRegulars(identifier: string): Promise<RegularSummary[]> {
    const data = await callEdgeFn<{ regulars?: RegularSummary[] }>('user-profile', {
        action: 'regulars',
        body: { identifier },
    });
    return (data?.regulars ?? []) as RegularSummary[];
}

export function useUserRegulars(identifier: string | null | undefined) {
    return useQuery<RegularSummary[], Error>({
        queryKey: queryKeys.users.regulars(identifier ?? ''),
        queryFn: () => fetchUserRegulars(identifier!),
        enabled: !!identifier,
        staleTime: 1000 * 60 * 5,
    });
}
