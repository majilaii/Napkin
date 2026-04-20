/**
 * useUserRegulars — full list of ≥3-visit restaurants for a user.
 * TICKET-025
 *
 * Single fetch (up to 200 rows expected). Sorted by visit_count desc server-side.
 * Gated: self always; stranger requires public profile.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { RegularSummary } from './useUserProfile';

export type { RegularSummary } from './useUserProfile';

async function fetchUserRegulars(identifier: string): Promise<RegularSummary[]> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'regulars', identifier },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) {
        let details = error.message;
        try {
            if (error.context && typeof error.context.json === 'function') {
                const b = await error.context.json();
                details = JSON.stringify(b);
            }
        } catch (_) { /* ignore */ }
        throw new Error(details);
    }
    if (data?.error) throw new Error(data.error);

    return (data?.data?.regulars ?? []) as RegularSummary[];
}

export function useUserRegulars(identifier: string | null | undefined) {
    return useQuery<RegularSummary[], Error>({
        queryKey: queryKeys.users.regulars(identifier ?? ''),
        queryFn: () => fetchUserRegulars(identifier!),
        enabled: !!identifier,
        staleTime: 1000 * 60 * 5,
    });
}
