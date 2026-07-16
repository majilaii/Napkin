/**
 * Query hook: the caller's own lists, reverse-chron by updated_at.
 * Drives the Lists tab and the AddToListSheet.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface MyList {
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    ranked: boolean;
    privacy: 'public' | 'private';
    /** TICKET-108: user-chosen emoji shown before the title on the Lists row +
     * on the wishlist map pin. Nullable = default terracotta teardrop. */
    emoji: string | null;
    /** TICKET-115: non-null → this is a shared Table list (owned by a Table, not
     * a single user). Personal lists are null. */
    table_id?: string | null;
    /** TICKET-115: resolved Table name for badging shared lists (`· {Table}`).
     * Null on personal lists. */
    table_name?: string | null;
    entry_count: number;
    /**
     * Count of entries whose restaurant is verified — what a handoff share
     * would actually freeze (TICKET-074 fix-pass). Optional because responses
     * from a pre-074-fix server omit it; treat absent as 0.
     */
    verified_count?: number;
    cover_photo_url: string | null;
    /**
     * TICKET-194: source + Places attribution for the derived shelf cover.
     * Optional so an in-memory response from a pre-194 edge deployment fails
     * closed to the tint plate instead of guessing whether a photo needs credit.
     */
    cover_photo_source?: 'user' | 'table' | 'places' | 'none' | null;
    cover_attribution_html?: string | null;
    cover_restaurant_name?: string | null;
    created_at: string;
    updated_at: string;
}

async function fetchMyLists(): Promise<MyList[]> {
    const data = await callEdgeFn<MyList[]>('lists', { action: 'list_mine' });
    return data ?? [];
}

export function useMyLists(userId: string | null | undefined) {
    return useQuery<MyList[], Error>({
        queryKey: queryKeys.lists.mine(userId ?? ''),
        queryFn: fetchMyLists,
        enabled: !!userId,
        staleTime: 1000 * 60 * 5,
    });
}
