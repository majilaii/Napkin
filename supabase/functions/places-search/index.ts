import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { parsePayload, clamp, type SearchPayload } from './utils.ts';

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');
const GOOGLE_PLACES_BASE_URL = 'https://places.googleapis.com/v1/places:searchText';

serve(async req => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // ── Auth gate ──────────────────────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const token = authHeader.replace('Bearer ', '');
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // ── API key check ──────────────────────────────────────────────────
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
        };

        // Add location bias if coordinates provided
        if (typeof payload.latitude === 'number' && typeof payload.longitude === 'number') {
            requestBody.locationBias = {
                circle: {
                    center: {
                        latitude: payload.latitude,
                        longitude: payload.longitude,
                    },
                    radius: payload.radius ?? 5000,
                },
            };
        }

        // Extended field mask to include rating, price, and address components
        const fieldMask = [
            'places.id',
            'places.displayName',
            'places.formattedAddress',
            'places.addressComponents',
            'places.location',
            'places.types',
            'places.primaryType',
            'places.rating',
            'places.userRatingCount',
            'places.priceLevel',
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

        // Transform to normalized shape for Napkin clients
        const sanitized = (responseBody?.places ?? []).map((place: any) => {
            // Extract city and country from addressComponents
            let city: string | null = null;
            let country: string | null = null;
            if (Array.isArray(place.addressComponents)) {
                for (const component of place.addressComponents) {
                    const types: string[] = component.types ?? [];
                    if (types.includes('locality') || types.includes('postal_town')) {
                        city = component.longText ?? component.shortText ?? null;
                    }
                    if (types.includes('country')) {
                        country = component.longText ?? component.shortText ?? null;
                    }
                }
            }

            // Map Google price level enum to integer (1-4)
            const priceLevelMap: Record<string, number> = {
                PRICE_LEVEL_FREE: 0,
                PRICE_LEVEL_INEXPENSIVE: 1,
                PRICE_LEVEL_MODERATE: 2,
                PRICE_LEVEL_EXPENSIVE: 3,
                PRICE_LEVEL_VERY_EXPENSIVE: 4,
            };
            const priceLevel = place.priceLevel
                ? (priceLevelMap[place.priceLevel] ?? null)
                : null;

            // Derive cuisine from primaryType (best available signal)
            const cuisine: string | null = place.primaryType ?? null;

            return {
                id: place.id, // Google Place ID (= external_id in our schema)
                name: place.displayName?.text ?? null,
                formattedAddress: place.formattedAddress ?? null,
                city,
                country,
                latitude: place.location?.latitude ?? null,
                longitude: place.location?.longitude ?? null,
                categories: place.types ?? [],
                cuisine,
                googleRating: place.rating ?? null,
                googleRatingCount: place.userRatingCount ?? null,
                priceLevel,
                photoReference: place.photos?.[0]?.name ?? null,
                website: place.websiteUri ?? null,
                link: place.googleMapsUri ?? null,
            };
        });

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
