/**
 * Utility functions for places-search edge function
 * Extracted for testability
 */

export type SearchPayload = {
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
};

export async function parsePayload(req: Request): Promise<SearchPayload> {
    const { searchParams } = new URL(req.url);
    if (req.headers.get('content-type')?.includes('application/json')) {
        try {
            const body = (await req.json()) as SearchPayload;

            return {
                query: body.query ?? searchParams.get('query') ?? undefined,
                place_id: body.place_id ?? searchParams.get('place_id') ?? undefined,
                latitude: firstNumber(body.latitude, searchParams.get('latitude')),
                longitude: firstNumber(body.longitude, searchParams.get('longitude')),
                limit: firstNumber(body.limit, searchParams.get('limit')),
                radius: firstNumber(body.radius, searchParams.get('radius')),
                persist: typeof body.persist === 'boolean'
                    ? body.persist
                    : searchParams.get('persist') === 'true' || undefined,
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

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Shape persisted to restaurants.hours (jsonb) and returned in the search payload.
 * weekdayDescriptions: 7 strings, index 0 = Monday (Places v1 convention).
 * openNow: snapshot at fetch time when Places provides it.
 */
export type PlaceHours = {
    weekdayDescriptions: string[];
    openNow?: boolean;
};

/**
 * Normalize a Places v1 `regularOpeningHours` object into our PlaceHours shape.
 * Returns null when there are no usable weekday descriptions — callers treat a
 * null hours payload as "no hours" and omit the UI entirely (no empty rows).
 *
 * TICKET-081: kept pure + in utils.ts (not index.ts) so it's importable in tests
 * without triggering serve().
 */
export function mapRegularOpeningHours(raw: unknown): PlaceHours | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const descriptions = Array.isArray(obj.weekdayDescriptions)
        ? obj.weekdayDescriptions.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
        : [];
    if (descriptions.length === 0) return null;
    const hours: PlaceHours = { weekdayDescriptions: descriptions };
    if (typeof obj.openNow === 'boolean') hours.openNow = obj.openNow;
    return hours;
}

export function firstNumber(bodyValue?: number, queryValue?: string | null) {
    if (typeof bodyValue === 'number') return bodyValue;
    if (typeof queryValue === 'string') {
        const parsed = Number(queryValue);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}
