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
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

// ── Types ──────────────────────────────────────────────────────────────────

export type Calibration = {
    match_pct: number;    // 0–100, integer
    mae: number;          // mean absolute error, 0–5 scale
    overlap_n: number;    // count of shared rated restaurants
    fallback: boolean;    // true iff MAE-fallback fired (Pearson was NULL)
};

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
    followers_count: number;
    following_count: number;
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
    max_rating: number | null;
    visit_count: number;
    last_visited_at: string | null;
    /** Top-Four glance indicators (default false on older payloads). */
    liked?: boolean;
    has_review?: boolean;
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
    /**
     * TICKET-044 — merged-round discriminators.
     * Present only when the diary entry is part of a merged round (self-view).
     * Undefined for plain solo entries and public-profile diary (Tables are private).
     */
    round_kind?: 'merged';
    round_id?: string | null;
    round_participants?: Array<{
        user_id: string;
        display_name: string;
        avatar_url: string | null;
        rating: number | null;
        notes: string | null;
    }>;
    round_average_rating?: number | null;
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
    /** Taste calibration — present only when viewer_target_relationship === 'public_only'. */
    calibration?: Calibration | null;
    /** Viewer's own rated-entry count — present only when viewer_target_relationship === 'public_only'. */
    viewer_rated_entry_count?: number;
};

export type UserProfileResult = {
    data: UserProfileData | null;
    isNotFound: boolean;
};

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchUserProfile(identifier: string): Promise<UserProfileResult> {
    try {
        const data = await callEdgeFn<UserProfileData | null>('user-profile', {
            action: 'profile',
            body: { identifier },
        });
        return { data: data ?? null, isNotFound: false };
    } catch (err) {
        // 404 → not found is a normal UX state, not an error
        const cause = (err as Error & { cause?: { status?: number; code?: string; message?: string; details?: unknown } })?.cause;
        if (cause?.status === 404 || cause?.code === 'NOT_FOUND') {
            return { data: null, isNotFound: true };
        }
        if (cause?.message === 'not_found') {
            return { data: null, isNotFound: true };
        }
        throw err;
    }
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
