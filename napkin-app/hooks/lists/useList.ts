/**
 * Query hook: single list detail — list metadata + entries + owner profile.
 * Used by the list detail screen (/list/[id]).
 * Returns null data with isNotFound=true when server returns 404.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

export interface ListEntryRestaurant {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    photo_url: string | null;
    cuisine: string | null;
    google_rating: number | null;
    price_level: number | null;
    external_id: string | null;
}

export interface ListEntry {
    id: string;
    list_id: string;
    restaurant_id: string;
    note: string | null;
    position: number;
    created_at: string;
    restaurant: ListEntryRestaurant;
}

export interface ListDetail {
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    ranked: boolean;
    privacy: 'public' | 'private';
    created_at: string;
    updated_at: string;
}

export interface OwnerProfile {
    display_name: string | null;
    avatar_url: string | null;
}

export interface ListDetailData {
    list: ListDetail;
    entries: ListEntry[];
    owner_profile: OwnerProfile;
}

export interface FetchResult {
    data: ListDetailData | null;
    isNotFound: boolean;
}

async function fetchList(listId: string): Promise<FetchResult> {
    const { data: { session } } = await supabase.auth.getSession();

    const { data, error } = await supabase.functions.invoke('lists', {
        body: { action: 'get', list_id: listId },
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) {
        // supabase-js throws FunctionsHttpError for non-2xx. Surface 404 as the
        // "not found" UI state (indistinguishable from "private + not owner" by design).
        const status = (error as { context?: { status?: number } }).context?.status;
        if (status === 404) {
            return { data: null, isNotFound: true };
        }
        throw error;
    }

    if (data?.error) {
        return { data: null, isNotFound: true };
    }

    return { data: data?.data ?? null, isNotFound: false };
}

export function useList(listId: string | null | undefined) {
    return useQuery<FetchResult, Error>({
        queryKey: queryKeys.lists.detail(listId ?? ''),
        queryFn: () => fetchList(listId!),
        enabled: !!listId,
        staleTime: 1000 * 60 * 5,
    });
}
