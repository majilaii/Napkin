import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

type SearchPayload = {
    query?: string;
    latitude?: number;
    longitude?: number;
    limit?: number;
    radius?: number;
};

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');
const GOOGLE_PLACES_BASE_URL = 'https://places.googleapis.com/v1/places:searchText';

serve(async req => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (!GOOGLE_PLACES_API_KEY) {
            return new Response(
                JSON.stringify({ error: 'GOOGLE_PLACES_API_KEY is not configured' }),
                {
                    status: 500,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                },
            );
        }

        const payload: SearchPayload = await parsePayload(req);
        console.log('Google Places search payload:', payload);
        const query = payload.query?.trim();

        if (!query) {
            return new Response(JSON.stringify({ error: 'Missing query parameter' }), {
                status: 400,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
        }

        // Build the request body for Google Places Text Search
        const requestBody: any = {
            textQuery: query,
            maxResultCount: clamp(payload.limit ?? 5, 1, 20),
            // Only request fields we need (cost optimization - no photos!)
            // See: https://developers.google.com/maps/documentation/places/web-service/text-search
        };

        // Add location bias if coordinates provided
        if (typeof payload.latitude === 'number' && typeof payload.longitude === 'number') {
            requestBody.locationBias = {
                circle: {
                    center: {
                        latitude: payload.latitude,
                        longitude: payload.longitude,
                    },
                    radius: payload.radius ?? 5000, // Default 5km radius
                },
            };
        }

        // Field mask to request only what we need (cost optimization)
        // Photos excluded to save on API costs
        const fieldMask = [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.types',
            'places.websiteUri',
            'places.googleMapsUri',
        ].join(',');

        const upstream = await fetch(GOOGLE_PLACES_BASE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
                'X-Goog-FieldMask': fieldMask,
            },
            body: JSON.stringify(requestBody),
        });

        const responseBody = await upstream.json();

        // DEBUG: Log the first result to see the raw structure
        if (responseBody.places && responseBody.places.length > 0) {
            console.log('Raw Google Places Result:', JSON.stringify(responseBody.places[0]));
        }

        if (!upstream.ok) {
            console.error('Google Places API error:', responseBody);
            return new Response(
                JSON.stringify({
                    error: responseBody?.error?.message || 'Google Places request failed',
                    details: responseBody,
                }),
                {
                    status: upstream.status,
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                },
            );
        }

        // Transform to match existing frontend interface
        const sanitized = (responseBody?.places ?? []).map((place: any) => ({
            id: place.id, // Google Place ID
            name: place.displayName?.text ?? null,
            formattedAddress: place.formattedAddress ?? null,
            locality: null, // Google doesn't separate these in basic response
            region: null,
            country: null,
            latitude: place.location?.latitude ?? null,
            longitude: place.location?.longitude ?? null,
            categories: place.types ?? [],
            distance: null, // Google doesn't return distance in text search
            website: place.websiteUri ?? null,
            link: place.googleMapsUri ?? null,
        }));

        return new Response(JSON.stringify({ data: sanitized }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error('Edge function error', error);
        return new Response(
            JSON.stringify({ error: 'Unexpected error', details: String(error) }),
            {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            },
        );
    }
});

export async function parsePayload(req: Request): Promise<SearchPayload> {
    const { searchParams } = new URL(req.url);
    if (req.headers.get('content-type')?.includes('application/json')) {
        try {
            const body = (await req.json()) as SearchPayload;

            return {
                query: body.query ?? searchParams.get('query') ?? undefined,
                latitude: firstNumber(body.latitude, searchParams.get('latitude')),
                longitude: firstNumber(body.longitude, searchParams.get('longitude')),
                limit: firstNumber(body.limit, searchParams.get('limit')),
                radius: firstNumber(body.radius, searchParams.get('radius')),
            };
        } catch {
            // fall through to query params only
        }
    }

    return {
        query: searchParams.get('query') ?? undefined,
        latitude: firstNumber(undefined, searchParams.get('latitude')),
        longitude: firstNumber(undefined, searchParams.get('longitude')),
        limit: firstNumber(undefined, searchParams.get('limit')),
        radius: firstNumber(undefined, searchParams.get('radius')),
    };
}

export function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function firstNumber(bodyValue?: number, queryValue?: string | null) {
    if (typeof bodyValue === 'number') return bodyValue;
    if (typeof queryValue === 'string') {
        const parsed = Number(queryValue);
        return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
}
