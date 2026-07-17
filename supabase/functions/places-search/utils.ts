/**
 * Utility functions for places-search edge function
 * Extracted for testability
 */

import { humanizeCuisine, type PlaceAttestationProjection } from '../_shared/completeness.ts';

export type SearchPayload = {
    action?: 'match_correction';
    query?: string;
    place_id?: string;
    latitude?: number;
    longitude?: number;
    limit?: number;
    radius?: number;
    /**
     * When true and place_id is provided, server upserts the resulting place
     * into restaurants and returns restaurant_id alongside the sanitized place.
     * Used by the client for opportunistic backfill of stale rows and for
     * recovering from missing-payload deep links.
     */
    persist?: boolean;
    import_nonce?: string;
    prior_resolution_id?: string | null;
    chosen_external_id?: string;
    expected_owner_id?: unknown;
};

export async function parsePayload(req: Request): Promise<SearchPayload> {
    const { searchParams } = new URL(req.url);
    if (req.headers.get('content-type')?.includes('application/json')) {
        try {
            const body = (await req.json()) as SearchPayload;

            return {
                action: body.action,
                query: body.query ?? searchParams.get('query') ?? undefined,
                place_id: body.place_id ?? searchParams.get('place_id') ?? undefined,
                latitude: firstNumber(body.latitude, searchParams.get('latitude')),
                longitude: firstNumber(body.longitude, searchParams.get('longitude')),
                limit: firstNumber(body.limit, searchParams.get('limit')),
                radius: firstNumber(body.radius, searchParams.get('radius')),
                persist: typeof body.persist === 'boolean'
                    ? body.persist
                    : searchParams.get('persist') === 'true' || undefined,
                import_nonce: body.import_nonce,
                prior_resolution_id: body.prior_resolution_id,
                chosen_external_id: body.chosen_external_id,
                expected_owner_id: body.expected_owner_id,
            };
        } catch {
            // fall through to query params only
        }
    }

    return {
        query: searchParams.get('query') ?? undefined,
        place_id: searchParams.get('place_id') ?? undefined,
        latitude: firstNumber(undefined, searchParams.get('latitude')),
        longitude: firstNumber(undefined, searchParams.get('longitude')),
        limit: firstNumber(undefined, searchParams.get('limit')),
        radius: firstNumber(undefined, searchParams.get('radius')),
        persist: searchParams.get('persist') === 'true' || undefined,
    };
}

export type ExpectedSearchOwnerDecision = 'allow' | 'invalid' | 'mismatch';

/** Optional owner echo for async import correction/search calls. */
export function expectedSearchOwnerDecision(
    expectedOwnerId: unknown,
    authenticatedOwnerId: string,
): ExpectedSearchOwnerDecision {
    if (expectedOwnerId === undefined) return 'allow';
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof expectedOwnerId !== 'string' || !uuid.test(expectedOwnerId)) return 'invalid';
    return expectedOwnerId === authenticatedOwnerId ? 'allow' : 'mismatch';
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

/** Map an import-safe attestation projection to the places-search wire shape. */
export function projectionToPlace(projection: PlaceAttestationProjection) {
    return {
        id: projection.place_id,
        name: projection.display_name,
        formattedAddress: projection.formatted_address,
        city: projection.city,
        country: projection.country,
        latitude: projection.lat,
        longitude: projection.lng,
        categories: projection.types ?? [],
        cuisine: humanizeCuisine(projection.primary_type),
        googleRating: projection.google_rating,
        googleRatingCount: projection.google_rating_count,
        priceLevel: projection.price_level,
        photoReference: projection.photo_reference,
        photoAttributionHtml: projection.photo_attribution_html,
        website: projection.website,
        link: projection.google_maps_uri,
        phone: projection.phone,
        google_maps_uri: projection.google_maps_uri,
        hours: projection.opening_hours,
    };
}

export function firstNumber(bodyValue?: number, queryValue?: string | null) {
    if (typeof bodyValue === 'number') return bodyValue;
    if (typeof queryValue === 'string') {
        const parsed = Number(queryValue);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}
