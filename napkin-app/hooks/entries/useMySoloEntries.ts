/**
 * useMySoloEntries — viewer's own feed-only solo entries.
 *
 * Returns entries where user_id = viewer AND table_id IS NULL, shaped as
 * SoloShareActivity so the existing JournalNoteCard can render them on the
 * journal tab. Reactions/comments are omitted in v1 (JournalNoteCard treats
 * those fields as optional).
 *
 * Direct Supabase query — RLS already scopes to own entries.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { SoloShareActivity } from '@/hooks/tables/useTableActivity';

interface EntryRow {
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    visited_at: string | null;
    created_at: string;
    photo_url: string | null;
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    profiles: { display_name: string | null } | null;
}

async function fetchMySoloEntries(userId: string): Promise<SoloShareActivity[]> {
    const { data, error } = await (supabase
        .from('entries')
        .select(`
            id,
            user_id,
            restaurant_id,
            rating,
            content,
            dish_description,
            visited_at,
            created_at,
            photo_url,
            restaurants ( id, name, address, city, photo_url ),
            profiles:user_id ( display_name )
        `)
        .eq('user_id', userId)
        .is('table_id', null)
        .is('table_night_id', null)
        .order('visited_at', { ascending: false, nullsFirst: false })
        .limit(50) as any);

    if (error) throw error;

    const rows = (data ?? []) as EntryRow[];
    return rows.map((r): SoloShareActivity => ({
        type: 'solo_share',
        id: r.id,
        user_id: r.user_id,
        restaurant_id: r.restaurant_id,
        rating: r.rating,
        content: r.content,
        dish_description: r.dish_description,
        visited_at: r.visited_at ?? r.created_at,
        created_at: r.created_at,
        sort_date: r.visited_at ?? r.created_at,
        photo_url: r.photo_url,
        restaurants: r.restaurants,
        profiles: { display_name: r.profiles?.display_name ?? '' },
    }));
}

export function useMySoloEntries(userId: string | undefined) {
    return useQuery({
        queryKey: userId ? queryKeys.entries.mySolo(userId) : ['entries', 'mySolo', 'anon'],
        queryFn: () => fetchMySoloEntries(userId!),
        enabled: !!userId,
        staleTime: 1000 * 60 * 2,
    });
}
