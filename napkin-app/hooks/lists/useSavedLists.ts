/**
 * Query hook: public lists the caller has explicitly saved, newest save first.
 *
 * Saving a list is intentionally distinct from pinning all of its restaurants
 * to the wishlist. This collection preserves the list as an authored object.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface SavedList {
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    ranked: boolean;
    /** Saved-list rows are only returned while the source list remains public. */
    privacy: 'public';
    emoji: string | null;
    created_at: string;
    updated_at: string;
    saved_at: string;
    entry_count: number;
    save_count: number;
    cover_photo_url: string | null;
    /** Source-aware cover provenance; absent stale rows fail closed in cards. */
    cover_photo_source?: 'user' | 'table' | 'places' | 'none' | null;
    cover_attribution_html?: string | null;
    cover_restaurant_name?: string | null;
    owner_display_name: string | null;
    owner_avatar_url: string | null;
    owner_username: string | null;
}

async function fetchSavedLists(): Promise<SavedList[]> {
    const data = await callEdgeFn<SavedList[]>('lists', { action: 'saved_mine' });
    return data ?? [];
}

export function useSavedLists(
    userId: string | null | undefined,
    options: { enabled?: boolean } = {},
) {
    return useQuery<SavedList[], Error>({
        queryKey: queryKeys.lists.saved(userId ?? ''),
        queryFn: fetchSavedLists,
        enabled: !!userId && (options.enabled ?? true),
        staleTime: 1000 * 60 * 5,
    });
}
