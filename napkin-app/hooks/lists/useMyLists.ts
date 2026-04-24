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
    entry_count: number;
    cover_photo_url: string | null;
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
