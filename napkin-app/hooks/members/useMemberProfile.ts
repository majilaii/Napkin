/**
 * Hook to fetch a Table-scoped member profile.
 *
 * useMemberProfile(userId, tableId) — returns profile, stats, top entries,
 * and recent activity for the given user within the given table context.
 *
 * Backed by the `member-profile` edge function.
 * Authorization: caller must be a current table member;
 * target must be current or historical member.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

// ── Public types ──────────────────────────────────────────────────────────

export interface MemberProfile {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    joined_at: string | null;
}

export interface MemberStats {
    avg: number | null;
    entry_count: number;
    round_count: number;
    std_dev: number | null;
}

export interface TopEntry {
    id: string;
    restaurant_name: string;
    rating: number;
    visited_at: string | null;
}

export interface RecentActivityItem {
    kind: 'entry' | 'round';
    id: string;
    restaurant_name: string;
    rating: number | null;
    date: string | null;
}

export interface MemberProfileData {
    profile: MemberProfile;
    is_current_member: boolean;
    stats: MemberStats;
    top_entries: TopEntry[];
    recent_activity: RecentActivityItem[];
}

// ── Fetch ─────────────────────────────────────────────────────────────────

async function fetchMemberProfile(
    userId: string,
    tableId: string,
): Promise<MemberProfileData> {
    return callEdgeFn<MemberProfileData>('member-profile', {
        method: 'GET',
        action: 'profile',
        params: { user_id: userId, table_id: tableId },
    });
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useMemberProfile(
    userId: string | null | undefined,
    tableId: string | null | undefined,
) {
    return useQuery<MemberProfileData, Error>({
        queryKey: queryKeys.members.profile(userId ?? '', tableId ?? ''),
        queryFn: () => fetchMemberProfile(userId!, tableId!),
        enabled: !!userId && !!tableId,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
