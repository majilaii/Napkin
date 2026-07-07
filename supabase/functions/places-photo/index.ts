import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';

/**
 * Public photo proxy for Google Places media references.
 *
 * Why public (no auth): the URL is rendered as <Image src=...> on RN, which
 * cannot attach an Authorization header. The photoReference itself is opaque
 * and only useful to anyone holding the Google API key (we do; the client
 * does not). We rely on (a) Cache-Control to keep cost bounded, (b) the
 * photoReference being non-guessable.
 *
 * Used by:
 *  - RestaurantHero (ghost / not-yet-upserted rows that only have photoReference)
 *  - FastLogForm (search-result thumbnails)
 *
 * The persisted-row path is unchanged: _shared/restaurant.ts::_storeHeroPhoto
 * already mirrors the bytes to Supabase Storage on upsert and writes
 * restaurants.photo_url. Once that runs, RestaurantHero uses photo_url
 * directly and never hits this proxy.
 *
 * Inputs: ?ref=places/<id>/photos/<token>  (photoReference as returned by
 * places-search). Optional ?w=<int> &h=<int> width/height hints (clamped).
 */

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');
const DEFAULT_MAX_W = 1200;
const DEFAULT_MAX_H = 800;
const HARD_MAX = 1600;

function clamp(n: number, min: number, max: number) {
    return Math.min(Math.max(n, min), max);
}

serve(async req => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }
    if (req.method !== 'GET') {
        return new Response('GET only', {
            status: 405,
            headers: { ...corsHeaders, Allow: 'GET, OPTIONS' },
        });
    }

    if (!GOOGLE_PLACES_API_KEY) {
        return new Response(
            JSON.stringify({ error: 'GOOGLE_PLACES_API_KEY not configured' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }

    const url = new URL(req.url);
    const ref = url.searchParams.get('ref');
    if (!ref || !ref.startsWith('places/')) {
        return new Response(
            JSON.stringify({ error: 'Missing or invalid ref parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }

    const wParam = Number(url.searchParams.get('w'));
    const hParam = Number(url.searchParams.get('h'));
    const maxW = Number.isFinite(wParam) && wParam > 0
        ? clamp(Math.round(wParam), 64, HARD_MAX)
        : DEFAULT_MAX_W;
    const maxH = Number.isFinite(hParam) && hParam > 0
        ? clamp(Math.round(hParam), 64, HARD_MAX)
        : DEFAULT_MAX_H;

    const mediaUrl =
        `https://places.googleapis.com/v1/${ref}/media` +
        `?maxHeightPx=${maxH}&maxWidthPx=${maxW}&key=${GOOGLE_PLACES_API_KEY}`;

    try {
        const upstream = await fetch(mediaUrl);
        if (!upstream.ok) {
            return new Response(
                JSON.stringify({ error: 'Upstream fetch failed', status: upstream.status }),
                { status: upstream.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }
        const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
        const bytes = await upstream.arrayBuffer();

        return new Response(bytes, {
            status: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': contentType,
                // 30 days at edge + browser; photoReferences are stable for the
                // lifetime of the underlying place so this is safe.
                'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, immutable',
            },
        });
    } catch (e) {
        console.error('places-photo error:', e);
        reportError(e, { fn: 'places-photo' });
        return new Response(
            JSON.stringify({ error: 'Proxy error', details: String(e) }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
