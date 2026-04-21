/**
 * useRecentCompanions — top-5 companions the caller has tagged most often.
 *
 * V1 implementation: query entry_companions for entries authored by the caller,
 * group by user_id, sort by frequency desc, take top 5.
 * Fetches profile names for the resulting user IDs.
 *
 * No new edge function needed — this is a lightweight two-step client query.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserSearchResult } from './useUserSearch';

const TOP_N = 5;

async function fetchRecentCompanions(userId: string): Promise<UserSearchResult[]> {
    // 1. All entry_companions rows for entries the caller authored
    //    We need entries.user_id = userId. Join via a subquery isn't possible
    //    directly; instead fetch entries first, then companions.
    const { data: myEntries, error: entriesErr } = await supabase
        .from('entries')
        .select('id')
        .eq('user_id', userId)
        .limit(200); // scan last 200 entries at most

    if (entriesErr) throw entriesErr;

    const myEntryIds = ((myEntries ?? []) as { id: string }[]).map((e) => e.id);
    if (myEntryIds.length === 0) return [];

    // 2. Companions across those entries
    const { data: companions, error: compErr } = await supabase
        .from('entry_companions')
        .select('user_id')
        .in('entry_id', myEntryIds);

    if (compErr) throw compErr;

    // 3. Count frequency per user_id
    const freq = new Map<string, number>();
    for (const c of (companions ?? []) as { user_id: string }[]) {
        freq.set(c.user_id, (freq.get(c.user_id) ?? 0) + 1);
    }

    if (freq.size === 0) return [];

    // 4. Sort by frequency, take top N
    const topIds = Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_N)
        .map(([uid]) => uid);

    // 5. Fetch profiles for those user IDs
    const { data: profiles, error: profilesErr } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', topIds);

    if (profilesErr) throw profilesErr;

    // Return in frequency order
    const byId = new Map(
        ((profiles ?? []) as { user_id: string; display_name: string; avatar_url: string | null }[])
            .map((p) => [p.user_id, p])
    );

    return topIds
        .map((id) => byId.get(id))
        .filter((p): p is UserSearchResult => p !== undefined)
        .map((p) => ({
            user_id: p.user_id,
            display_name: p.display_name,
            avatar_url: p.avatar_url ?? null,
        }));
}

export function useRecentCompanions(userId?: string | null) {
    return useQuery<UserSearchResult[]>({
        queryKey: queryKeys.users.recentCompanions(userId ?? ''),
        queryFn: () => fetchRecentCompanions(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 10, // 10 min — recent companions don't change quickly
    });
}
