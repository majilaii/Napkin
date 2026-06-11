/**
 * Query hook: single list detail — list metadata + entries + owner profile.
 * Used by the list detail screen (/list/[id]).
 * Returns null data with isNotFound=true when server returns 404.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
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
    /**
     * TICKET-074 fix-pass: share eligibility counts verified entries only
     * (the handoff snapshot is verified-only). Optional for responses from a
     * pre-074-fix server; treat absent as not verified.
     */
    verification?: 'verified' | 'unverified';
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
    /** Added in TICKET-020: drives author-line tap-through on list detail */
    username: string | null;
    /** Added in TICKET-020: 'public' → author line is tappable; 'private' → plain text */
    account_privacy: 'public' | 'private';
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
    try {
        const data = await callEdgeFn<ListDetailData | null>('lists', {
            action: 'get',
            body: { list_id: listId },
        });
        return { data: data ?? null, isNotFound: !data };
    } catch (err) {
        // 404 from supabase.functions.invoke is the privacy-safe "not found" UI state
        // (indistinguishable from "private + not owner" by design).
        const cause = (err as Error & { cause?: { status?: number; code?: string } })?.cause;
        if (cause?.status === 404 || cause?.code === 'NOT_FOUND') {
            return { data: null, isNotFound: true };
        }
        throw err;
    }
}

export function useList(listId: string | null | undefined) {
    return useQuery<FetchResult, Error>({
        queryKey: queryKeys.lists.detail(listId ?? ''),
        queryFn: () => fetchList(listId!),
        enabled: !!listId,
        staleTime: 1000 * 60 * 5,
    });
}
