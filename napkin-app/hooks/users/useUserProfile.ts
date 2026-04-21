/**
 * useUserProfile — aggregated hook for the /u/[identifier] profile screen.
 *
 * Calls user-profile with action=profile. Returns a relationship-gated payload:
 *   - 'self': full palate + your tables
 *   - 'public_and_tables': full palate + shared tables
 *   - 'public_only': palate only
 *   - 'tables_in_common': shared tables only, no palate
 *   - 'none': not_found (server returns 404)
 *
 * isNotFound=true maps to the privacy-safe 404 screen.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

// ── Types ──────────────────────────────────────────────────────────────────

export type ViewerRelationship =
    | 'self'
    | 'tables_in_common'
    | 'public_only'
    | 'public_and_tables'
    | 'none';

export type UserProfileRow = {
    user_id: string;
    username: string | null;
    display_name: string;
    bio: string | null;
    avatar_url: string | null;
    account_privacy: 'private' | 'public';
    allow_public_replies: boolean;
};

export type UserStats = {
    total_logs: number;
    total_restaurants: number;
    average_rating: number | null;
};

export type ProfileListSummary = {
    id: string;
    title: string;
    entry_count: number;
    ranked: boolean;
    privacy: 'public' | 'private';
    updated_at: string;
    cover_photo_url: string | null;
};

export type RestaurantTile = {
    id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
};

export type TablePreview = {
    table_id: string;
    table_name: string;
    avg: number | null;
    visit_count: number;
    last_entry_at: string | null;
    last_entry_restaurant_name: string | null;
    last_entry_rating: number | null;
};

export type TopPick = {
    restaurant_id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
    max_rating: number;
    visit_count: number;
    last_visited_at: string | null;
};

export type RegularSummary = {
    restaurant_id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
    visit_count: number;
    avg_rating: number | null;
    last_visited_at: string | null;
};

export type DiaryEntryRow = {
    entry_id: string;
    restaurant_id: string;
    restaurant_name: string;
    city: string | null;
    photo_url: string | null;
    rating: number | null;
    note: string | null;
    visited_at: string;
    created_at: string;
};

export type UserProfileData = {
    profile: UserProfileRow;
    stats: UserStats | null;
    public_lists: ProfileListSummary[] | null;
    recently_logged: RestaurantTile[] | null;
    tables_in_common: TablePreview[];
    top_four: TopPick[];
    regulars_preview: RegularSummary[];
    is_self: boolean;
    /** True if the viewing user is following the target. False for self, false for unauthenticated. */
    is_following_viewer: boolean;
    viewer_target_relationship: ViewerRelationship;
};

export type UserProfileResult = {
    data: UserProfileData | null;
    isNotFound: boolean;
};

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchUserProfile(identifier: string): Promise<UserProfileResult> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body: { action: 'profile', identifier },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) {
        // Try to extract body from the FunctionsHttpError
        let details = error.message;
        try {
            if (error.context && typeof error.context.json === 'function') {
                const body = await error.context.json();
                details = JSON.stringify(body);
            }
        } catch (_) { /* ignore */ }

        const status = (error as any).context?.status;
        if (status === 404) return { data: null, isNotFound: true };
        throw new Error(details);
    }

    if (data?.error === 'not_found') {
        return { data: null, isNotFound: true };
    }

    if (data?.error) {
        throw new Error(data.error);
    }

    return { data: data?.data ?? null, isNotFound: false };
}

// ── Hook ──────────────────────────────────────────────────────────────────

export function useUserProfile(identifier: string | null | undefined) {
    return useQuery<UserProfileResult, Error>({
        queryKey: queryKeys.users.profile(identifier ?? ''),
        queryFn: () => fetchUserProfile(identifier!),
        enabled: !!identifier,
        staleTime: 1000 * 60 * 5,
    });
}
