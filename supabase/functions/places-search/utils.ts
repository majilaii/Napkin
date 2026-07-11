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
    /**
     * TICKET-174: when true AND the request carries coords (i.e. the first
     * text-search pass was location-biased) AND that pass returns zero places,
     * the server re-runs the same textQuery once with a world-scale rectangle
     * bias and tags those rows `fartherAfield`. Opt-in per request so the
     * resolve-url import-verification callers (which must treat "nothing
     * nearby-or-named-right" as an unverified ghost) can never inherit it.
     */
    global_fallback?: boolean;
};

/**
 * World-scale rectangle bias for the TICKET-174 fallback pass. Omitting
 * locationBias entirely is NOT global — Google then IP-biases to the edge
 * function's data-center egress (nondeterministic, wrong continent). An
 * explicit whole-world rectangle disables IP biasing deterministically while
 * letting prominence ranking do the work.
 */
export const WORLD_RECT_BIAS = {
    rectangle: {
        low: { latitude: -85, longitude: -180 },
        high: { latitude: 85, longitude: 180 },
    },
} as const;

/**
 * The fallback second pass fires only under the double gate:
 * the caller opted in AND the first pass was actually location-biased
 * (coords present) AND it came back empty. Callers that never send coords
 * (all resolve-url import paths) can never trigger it, by construction.
 */
export function shouldGlobalFallback(payload: SearchPayload, firstPassCount: number): boolean {
    return payload.global_fallback === true &&
        typeof payload.latitude === 'number' &&
        typeof payload.longitude === 'number' &&
        firstPassCount === 0;
}

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
                global_fallback: typeof body.global_fallback === 'boolean'
                    ? body.global_fallback
                    : searchParams.get('global_fallback') === 'true' || undefined,
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
        global_fallback: searchParams.get('global_fallback') === 'true' || undefined,
    };
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Shape persisted to restaurants.hours (jsonb) and returned in the search payload.
 * weekdayDescriptions: Places v1 `regularOpeningHours.weekdayDescriptions` strings.
 *
 * TICKET-081 fix-pass (Codex HIGH): NO `openNow`. Places' openNow is a point-in-time
 * flag — true only when Places served it. We persist `hours` and re-read it for weeks,
 * so a stored open/closed claim is stale. We never store it; the page derives "today's
 * hours" by matching the weekday name (see lib/restaurantHours.ts) and shows no live
 * open/closed badge. We also do NOT trust array order (it's locale-dependent) — the
 * request pins languageCode=en for deterministic English day names.
 */
export type PlaceHours = {
    weekdayDescriptions: string[];
};

/**
 * Normalize a Places v1 `regularOpeningHours` object into our PlaceHours shape.
 * Returns null when there are no usable weekday descriptions — callers treat a
 * null hours payload as "no hours" and omit the UI entirely (no empty rows).
 *
 * TICKET-081: kept pure + in utils.ts (not index.ts) so it's importable in tests
 * without triggering serve(). openNow is intentionally dropped (see PlaceHours).
 */
export function mapRegularOpeningHours(raw: unknown): PlaceHours | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const descriptions = Array.isArray(obj.weekdayDescriptions)
        ? obj.weekdayDescriptions.filter((d): d is string => typeof d === 'string' && d.trim() !== '')
        : [];
    if (descriptions.length === 0) return null;
    return { weekdayDescriptions: descriptions };
}

export function firstNumber(bodyValue?: number, queryValue?: string | null) {
    if (typeof bodyValue === 'number') return bodyValue;
    if (typeof queryValue === 'string') {
        const parsed = Number(queryValue);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}
