/**
 * useSupper — read one Supper's merged-review payload (TICKET-082, Phase 3).
 *
 * A Supper is an `entries` cluster keyed by supper_id; `supper_members` is the
 * roster + trust anchor. The `supper-detail` GET action returns
 * `{ supper, roster, takes }` nested in `data` — callEdgeFn strips the outer
 * envelope, so the hook receives that object directly.
 *
 * Shape contract (Phase 2, supabase/functions/entry/index.ts:supper-detail):
 *   supper: { id, restaurant_id, host_user_id, created_at }
 *   roster: SupperRosterMember[]  — the full table incl. host; a roster member
 *           with no matching take is "pending".
 *   takes:  SupperTake[]          — one `entries` row per member who has logged,
 *           joined to profiles + entry_photos.
 *
 * Read-only — no optimistic concerns. Keyed on queryKeys.suppers.detail(id).
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface SupperAnchor {
    id: string;
    restaurant_id: string;
    host_user_id: string;
    /** Supper v2: the Table this supper belongs to. Null for legacy v1 suppers. */
    table_id: string | null;
    created_at: string;
}

export interface SupperRosterMember {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    created_at: string;
}

export interface SupperTake {
    entry_id: string;
    user_id: string;
    restaurant_id: string | null;
    supper_id: string;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    visited_at: string | null;
    created_at: string;
    vibe_rating: number | null;
    flavor_rating: number | null;
    service_rating: number | null;
    value_rating: number | null;
    liked: boolean | null;
    photo_url: string | null;
    photos: string[];
    display_name: string | null;
    avatar_url: string | null;
}

export interface SupperRestaurant {
    id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
}

export interface SupperDetail {
    supper: SupperAnchor;
    /** Restaurant the supper is anchored to (null only if the row was deleted). */
    restaurant: SupperRestaurant | null;
    roster: SupperRosterMember[];
    takes: SupperTake[];
    /**
     * TICKET-159 provenance: the gather this supper was born from — reverse
     * lookup on the unique gatherings.supper_id. `planned` is the gather's
     * created_at (ISO timestamptz), `gathered` its gather_on ('YYYY-MM-DD').
     * Null for a set-a-table supper (no gather) → no lineage line renders.
     */
    lineage: { planned: string; gathered: string } | null;
}

async function fetchSupper(supperId: string): Promise<SupperDetail> {
    return callEdgeFn<SupperDetail>('entry', {
        method: 'GET',
        action: 'supper-detail',
        params: { supper_id: supperId },
    });
}

export function useSupper(supperId?: string | null) {
    return useQuery({
        queryKey: queryKeys.suppers.detail(supperId ?? ''),
        queryFn: () => fetchSupper(supperId!),
        enabled: !!supperId,
        staleTime: 1000 * 30,
    });
}
