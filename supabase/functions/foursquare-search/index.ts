import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';

type SearchPayload = {
  query?: string;
  near?: string;
  latitude?: number;
  longitude?: number;
  limit?: number;
  radius?: number;
};

const FOURSQUARE_API_KEY = Deno.env.get('FOURSQUARE_API_KEY');
const FOURSQUARE_BASE_URL = 'https://api.foursquare.com/v3/places/search';

serve(async req => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!FOURSQUARE_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'FOURSQUARE_API_KEY is not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const payload: SearchPayload = await parsePayload(req);
    const query = payload.query?.trim();

    if (!query) {
      return new Response(JSON.stringify({ error: 'Missing query parameter' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const hasCoordinates =
      typeof payload.latitude === 'number' && typeof payload.longitude === 'number';

    const searchParams = new URLSearchParams({
      query,
      limit: String(clamp(payload.limit ?? 5, 1, 20)),
      fields: 'fsq_id,name,location,geocodes,link,website,categories,distance',
    });

    if (payload.radius) {
      searchParams.set('radius', String(clamp(payload.radius, 1, 50000)));
    }

    if (hasCoordinates) {
      searchParams.set('ll', `${payload.latitude},${payload.longitude}`);
    } else if (payload.near) {
      searchParams.set('near', payload.near);
    } else {
      searchParams.set('near', 'London');
    }

    const upstream = await fetch(`${FOURSQUARE_BASE_URL}?${searchParams.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: FOURSQUARE_API_KEY,
      },
    });

    const responseBody = await upstream.json();

    if (!upstream.ok) {
      return new Response(
        JSON.stringify({
          error: responseBody?.message || 'Foursquare request failed',
          details: responseBody,
        }),
        {
          status: upstream.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    const sanitized = (responseBody?.results ?? []).map((place: any) => ({
      id: place.fsq_id,
      name: place.name,
      formattedAddress: place?.location?.formatted_address ?? null,
      locality: place?.location?.locality ?? null,
      region: place?.location?.region ?? null,
      country: place?.location?.country ?? null,
      latitude: place?.geocodes?.main?.latitude ?? null,
      longitude: place?.geocodes?.main?.longitude ?? null,
      categories: (place?.categories ?? []).map((category: any) => category?.name).filter(Boolean),
      distance: place?.distance ?? null,
      website: place?.website ?? null,
      link: place?.link ?? null,
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
        near: body.near ?? searchParams.get('near') ?? undefined,
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
    near: searchParams.get('near') ?? undefined,
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
