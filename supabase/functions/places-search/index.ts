import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { parsePayload, clamp, type SearchPayload } from './utils.ts';

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

        const fieldMask = [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.location',
            'places.types',
            'places.websiteUri',
            'places.googleMapsUri',
            'places.photos',
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
            photoReference: place.photos?.[0]?.name ?? null,
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
