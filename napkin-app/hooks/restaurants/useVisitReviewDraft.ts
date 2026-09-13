import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';

export type VisitReviewDraft = {
    id: string;
    user_id: string;
    restaurant_id: string;
    created_at: string;
    visited_at: string | null;
    rating: number | null;
    content: string | null;
    liked: boolean;
    visibility: string;
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
    photos: { id: string; url: string }[];
    companions: UserSearchResult[];
    table_ids: string[];
};

/** Load the owned visit, never infer it from restaurant or day. Fail the whole
 * draft if any collection fails: an empty fallback could erase existing data. */
export async function fetchVisitReviewDraft(userId: string, entryId: string): Promise<VisitReviewDraft> {
    const { data: entry, error } = await supabase.from('entries')
        .select('id,user_id,restaurant_id,created_at,visited_at,rating,content,liked,visibility,vibe_rating,flavor_rating,service_rating,value_rating,photo_url,supper_id,table_night_id')
        .eq('id', entryId).eq('user_id', userId).single();
    if (error) throw error;
    if (!entry || entry.user_id !== userId || !entry.restaurant_id || entry.supper_id || entry.table_night_id) {
        throw new Error('Open this meal to edit its review.');
    }
    const results = await Promise.all([
        supabase.from('entry_photos').select('id,photo_url').eq('entry_id', entryId).order('sort_order').order('id'),
        supabase.from('entry_companions').select('user_id').eq('entry_id', entryId),
        supabase.from('entry_tables').select('table_id').eq('entry_id', entryId).order('posted_at'),
    ]);
    for (const result of results) if (result.error) throw result.error;
    const photos = (results[0].data ?? []).map((p) => ({ id: p.id, url: p.photo_url }));
    if (entry.photo_url && !photos.some((p) => p.url === entry.photo_url)) {
        photos.unshift({ id: `hero:${entry.id}`, url: entry.photo_url });
    }
    const companionIds = (results[1].data ?? []).map((c) => c.user_id);
    let profiles: { user_id: string; display_name: string; avatar_url: string | null }[] = [];
    if (companionIds.length) {
        const response = await supabase.from('profiles').select('user_id,display_name,avatar_url').in('user_id', companionIds);
        if (response.error) throw response.error;
        profiles = response.data ?? [];
    }
    // entry_companions points to auth users, not public profiles. Resolve
    // display rows separately; no inferred PostgREST relationship exists.
    const companions = companionIds.map((id) => {
        const profile = profiles.find((p) => p.user_id === id);
        return { user_id: id, display_name: profile?.display_name ?? 'User', avatar_url: profile?.avatar_url ?? null };
    });
    return { ...entry, photos, companions, table_ids: (results[2].data ?? []).map((t) => t.table_id) };
}

export function useVisitReviewDraft(userId?: string, entryId?: string) {
    return useQuery({
        queryKey: queryKeys.entries.visitDraft(userId ?? '', entryId ?? ''),
        queryFn: () => fetchVisitReviewDraft(userId!, entryId!),
        enabled: !!userId && !!entryId,
        staleTime: 0,
        gcTime: 0,
        retry: false,
    });
}
