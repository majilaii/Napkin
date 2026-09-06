/**
 * Similar places (restaurant page v3) — DB-backed, zero Google cost.
 *
 * Other `restaurants` rows in the same city, ranked:
 *   1. same cuisine (case-insensitive; generic cuisines never match)
 *   2. overlap on a specific `place_types` value (generic types ignored)
 *   3. plain proximity
 * Within a tier: haversine distance ascending. Anything farther than 5 km
 * is dropped; at most 6 rows come back.
 *
 * Privacy: reads only `restaurants` (public place facts). Never joins
 * entries, wishlist_items or profiles. Rows are fenced with the same
 * visibility predicate as action=page (verified OR created by the viewer).
 */
import { corsHeaders } from '../_shared/cors.ts';

export type SimilarMatch = 'cuisine' | 'type' | 'nearby';

export interface SimilarCandidate {
    id: string;
    name: string;
    city: string | null;
    country?: string | null;
    cuisine: string | null;
    price_level: number | null;
    photo_url: string | null;
    photo_source: string | null;
    places_photo_attribution_html: string | null;
    lat: number | null;
    lng: number | null;
    place_types: string[] | null;
    merged_into?: string | null;
    verification?: string | null;
    created_by?: string | null;
}

export interface SimilarRestaurantRow {
    id: string;
    name: string;
    cuisine: string | null;
    city: string | null;
    price_level: number | null;
    photo_url: string | null;
    photo_source: string | null;
    places_photo_attribution_html: string | null;
    distance_m: number;
    match: SimilarMatch;
}

export interface RankSimilarOptions {
    /** Viewer id — their own unverified import ghosts stay eligible. */
    viewerId?: string | null;
    /** Max rows returned. Default 6. */
    limit?: number;
    /** Drop candidates farther than this. Default 5 000 m. */
    maxDistanceM?: number;
}

export interface SimilarClient {
    from: (table: string) => any;
}

export const SIMILAR_LIMIT = 6;
export const SIMILAR_MAX_DISTANCE_M = 5_000;
const CANDIDATE_POOL = 300;
const EARTH_RADIUS_M = 6_371_000;

const CANDIDATE_COLUMNS =
    'id, name, city, country, cuisine, price_level, photo_url, photo_source, ' +
    'places_photo_attribution_html, lat, lng, place_types, merged_into, verification, created_by';

/** Cuisine labels that describe nothing — never a match key. */
const GENERIC_CUISINES = new Set(['restaurant', 'food', 'point of interest', 'establishment']);
/** Place types every venue carries — never a match key. bar/cafe/pub stay specific. */
const GENERIC_TYPES = new Set(['restaurant', 'food', 'point_of_interest', 'establishment', 'store']);

const TIER: Record<SimilarMatch, number> = { cuisine: 0, type: 1, nearby: 2 };

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

/** Normalised cuisine key, or null when absent/generic. */
export function cuisineKey(cuisine: string | null | undefined): string | null {
    const key = (cuisine ?? '').trim().toLowerCase().replace(/_/g, ' ');
    return key.length > 0 && !GENERIC_CUISINES.has(key) ? key : null;
}

/** Specific (non-generic) place types, lower-cased. */
export function specificTypes(types: string[] | null | undefined): Set<string> {
    const out = new Set<string>();
    for (const raw of types ?? []) {
        const key = String(raw).trim().toLowerCase();
        if (key.length > 0 && !GENERIC_TYPES.has(key)) out.add(key);
    }
    return out;
}

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Pure ranking. `source` is the canonical row of the page being viewed;
 * `candidates` is the same-city pool. Self, merged aliases, coordinate-less
 * rows and other people's unverified ghosts are dropped here too, so the
 * DB fence is defence in depth rather than the only gate.
 */
export function rankSimilarRestaurants(
    source: SimilarCandidate,
    candidates: SimilarCandidate[],
    opts: RankSimilarOptions = {},
): SimilarRestaurantRow[] {
    if (!finite(source.lat) || !finite(source.lng)) return [];
    const limit = opts.limit ?? SIMILAR_LIMIT;
    const maxDistanceM = opts.maxDistanceM ?? SIMILAR_MAX_DISTANCE_M;
    const viewerId = opts.viewerId ?? null;
    const sourceCuisine = cuisineKey(source.cuisine);
    const sourceTypes = specificTypes(source.place_types);

    const ranked: Array<SimilarRestaurantRow & { tier: number }> = [];
    for (const row of candidates) {
        if (row.id === source.id) continue;
        if (row.merged_into) continue;
        if (row.verification === 'unverified' && row.created_by !== viewerId) continue;
        if (!finite(row.lat) || !finite(row.lng)) continue;

        const distance = haversineMeters(source.lat, source.lng, row.lat, row.lng);
        if (distance > maxDistanceM) continue;

        let match: SimilarMatch = 'nearby';
        if (sourceCuisine && cuisineKey(row.cuisine) === sourceCuisine) {
            match = 'cuisine';
        } else if (sourceTypes.size > 0) {
            for (const t of specificTypes(row.place_types)) {
                if (sourceTypes.has(t)) {
                    match = 'type';
                    break;
                }
            }
        }

        ranked.push({
            id: row.id,
            name: row.name,
            cuisine: row.cuisine ?? null,
            city: row.city ?? null,
            price_level: row.price_level ?? null,
            photo_url: row.photo_url ?? null,
            photo_source: row.photo_source ?? null,
            places_photo_attribution_html: row.places_photo_attribution_html ?? null,
            distance_m: Math.round(distance),
            match,
            tier: TIER[match],
        });
    }

    ranked.sort((a, b) =>
        a.tier - b.tier
        || a.distance_m - b.distance_m
        || a.name.localeCompare(b.name),
    );

    return ranked.slice(0, limit).map(({ tier: _tier, ...row }) => row);
}

/** Escape PostgREST pattern wildcards so a city name is matched literally. */
function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function readSource(
    client: SimilarClient,
    viewerId: string,
    id: string,
): Promise<SimilarCandidate | null> {
    const { data, error } = await client
        .from('restaurants')
        .select(CANDIDATE_COLUMNS)
        .eq('id', id)
        .or(`verification.eq.verified,created_by.eq.${viewerId}`)
        .maybeSingle();
    if (error) throw error;
    return (data as SimilarCandidate | null) ?? null;
}

/**
 * Read + rank + project. `restaurantId` should already be canonical (the
 * router resolves it); a stale `merged_into` alias is followed one hop
 * anyway so a tombstone never yields an empty section by accident.
 */
export async function loadSimilarRestaurants(
    client: SimilarClient,
    viewerId: string,
    restaurantId: string,
): Promise<SimilarRestaurantRow[]> {
    let source = await readSource(client, viewerId, restaurantId);
    if (source?.merged_into) source = await readSource(client, viewerId, source.merged_into);
    if (!source) return [];

    const city = (source.city ?? '').trim();
    if (!city || !finite(source.lat) || !finite(source.lng)) return [];

    // Same city plus a 5 km bounding box, so the 300-row pool is the
    // neighbourhood rather than an arbitrary slice of a big city.
    const dLat = SIMILAR_MAX_DISTANCE_M / 111_320;
    const dLng = dLat / Math.max(0.1, Math.cos((source.lat * Math.PI) / 180));
    const { data, error } = await client
        .from('restaurants')
        .select(CANDIDATE_COLUMNS)
        .ilike('city', escapeLike(city))
        .neq('id', source.id)
        .is('merged_into', null)
        .gte('lat', source.lat - dLat)
        .lte('lat', source.lat + dLat)
        .gte('lng', source.lng - dLng)
        .lte('lng', source.lng + dLng)
        .or(`verification.eq.verified,created_by.eq.${viewerId}`)
        .limit(CANDIDATE_POOL);
    if (error) throw error;

    return rankSimilarRestaurants(source, (data ?? []) as SimilarCandidate[], { viewerId });
}

/**
 * Router shim: `{ data: { rows } }` envelope, or null when the body carries
 * no restaurant_id so the caller can fail with its own 400 shape.
 */
export async function handleSimilarAction(
    client: SimilarClient,
    userId: string,
    body: { restaurant_id?: string | null } | null | undefined,
): Promise<Response | null> {
    const restaurantId = typeof body?.restaurant_id === 'string' ? body.restaurant_id.trim() : '';
    if (!restaurantId) return null;
    const rows = await loadSimilarRestaurants(client, userId, restaurantId);
    return new Response(JSON.stringify({ data: { rows } }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}
