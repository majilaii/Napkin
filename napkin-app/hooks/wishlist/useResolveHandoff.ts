/**
 * useResolveHandoff — resolve a share token for the in-app receive screen (TICKET-072).
 *
 * Calls handoff?action=resolve with the bearer token.
 * Returns { status: 'live', sharer_name, list_name, spots } OR { status: 'revoked' }.
 * list_name (TICKET-074): frozen list title for per-list shares; null for
 * wishlist shares and pre-074 snapshots.
 *
 * ARCH-REVIEW-2 #1: staleTime=0 — the receive screen always re-resolves from the
 * server so a revoked token resolves to the in-app tombstone even if a stale resolve
 * was cached. Pinning additionally re-checks revocation server-side at write time.
 *
 * retry: false — revoked/unknown should not retry.
 */
import { useQuery } from '@tanstack/react-query';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export interface ResolveHandoffSpot {
    candidate_id: string;          // = deriveClientNonce(token, restaurant_id) — use as client_nonce
    restaurant_id: string;
    restaurant: {
        id: string;
        name: string;
        city: string | null;
        cuisine: string | null;
        external_id: null;
    };
    confidence: 'high';
    sharer_rating: number | null;
    already_wishlisted: boolean;
}

export interface HandoffResolveData {
    status: 'live' | 'revoked';
    sharer_name?: string;
    /** TICKET-074: frozen list title for per-list shares; null/absent otherwise. */
    list_name?: string | null;
    spots?: ResolveHandoffSpot[];
}

export function useResolveHandoff(token: string | null | undefined) {
    return useQuery<HandoffResolveData>({
        queryKey: queryKeys.handoff.resolve(token ?? ''),
        queryFn: () =>
            callEdgeFn<HandoffResolveData>('handoff', {
                action: 'resolve',
                body: { token },
            }),
        enabled: !!token,
        staleTime: 0,
        retry: false,
    });
}
