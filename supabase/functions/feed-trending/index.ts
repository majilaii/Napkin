/**
 * feed-trending edge function — TICKET-098 Phase B.
 *
 * Trending wishlist rail: restaurants ranked by wishlist INTENT (distinct
 * savers), never ratings. Computed on-read with a 1h global cache row
 * (dispatch-on-read, TICKET-095 pattern — no cron): fn_get_trending does the
 * whole read → advisory-lock → recompute → upsert cycle in one transaction
 * [ARCH-REVIEW-3], so this fn is a thin authenticated shim over the RPC.
 *
 * Privacy invariants:
 *   - Auth required (any signed-in user); aggregation runs service-role
 *     (wishlist RLS deliberately bypassed for the aggregate).
 *   - Response carries restaurant fields + integer counts ONLY — never raw
 *     wishlist rows or user ids. The cache payload is built in SQL with the
 *     same shape; this fn re-projects the whitelist defensively.
 *   - Counts are global + block-agnostic by design (aggregates reveal no
 *     identity; block filtering applies to the friends feed only).
 *   - Server floor: fn_compute_trending returns [] below 3 qualifying
 *     restaurants; this fn re-gates (<3 → []) so a malformed/stale cache can
 *     never leak a one-card rail. The client gates a third time.
 *
 * GET or POST (no params). Response:
 *   { data: { rows: TrendingCard[]; fallback: FallbackCard[] } }
 * BOTH arrays live INSIDE `data` (callEdgeFn strips the outer { data } envelope —
 * siblings of `data` get dropped). `rows` is mode-1 trending (may be [] — rail
 * hidden below 3 qualifiers). `fallback` is TICKET-102 mode-2 (Google-rated,
 * non-user-derived) — the client renders it ONLY when `rows` is below the floor,
 * so the rail is never empty in practice. Smoke asserts Array.isArray on both.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

interface TrendingPayloadRow {
    restaurant_id?: unknown;
    name?: unknown;
    cuisine?: unknown;
    neighborhood?: unknown;
    photo_url?: unknown;
    saver_count_7d?: unknown;
}

interface FallbackPayloadRow {
    restaurant_id?: unknown;
    name?: unknown;
    cuisine?: unknown;
    neighborhood?: unknown;
    photo_url?: unknown;
    google_rating?: unknown;
    google_rating_count?: unknown;
}

function fail(code: string, message: string, status = 400) {
    return new Response(
        JSON.stringify({ error: { code, message } }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        if (req.method !== 'GET' && req.method !== 'POST') {
            return fail('METHOD_NOT_ALLOWED', 'GET or POST only', 405);
        }

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return fail('UNAUTHORIZED', 'Missing Authorization header', 401);

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) return fail('UNAUTHORIZED', 'Unauthorized', 401);

        // Mode 1 (trending) and mode 2 (fallback) recompute independently under
        // distinct cache keys + advisory locks — fetch both in one round-trip so
        // the client can flip to the fallback on cold start without a second call
        // (the exact moment mode 2 fires). The fallback is a ≤1h-cached single-row
        // read, so computing it even when mode 1 wins is one cheap RPC.
        const [trendingRes, fallbackRes] = await Promise.all([
            supabase.rpc('fn_get_trending'),
            supabase.rpc('fn_get_fallback'),
        ]);
        if (trendingRes.error) throw trendingRes.error;
        if (fallbackRes.error) throw fallbackRes.error;

        const raw: TrendingPayloadRow[] = Array.isArray(trendingRes.data) ? trendingRes.data : [];

        // Defensive whitelist re-projection — restaurant fields + counts only.
        let rows = raw.map((r) => ({
            restaurant_id: String(r.restaurant_id ?? ''),
            name: typeof r.name === 'string' ? r.name : '',
            cuisine: typeof r.cuisine === 'string' ? r.cuisine : null,
            neighborhood: typeof r.neighborhood === 'string' ? r.neighborhood : null,
            photo_url: typeof r.photo_url === 'string' ? r.photo_url : null,
            saver_count_7d: Number(r.saver_count_7d ?? 0),
        })).filter((r) => r.restaurant_id && r.name);

        // Double-gate the k-floor server-side (SQL already enforces it; a stale
        // or hand-edited cache row must never surface a sub-3 rail).
        if (rows.length < 3) rows = [];
        // Hard cap — finite rail, max 10 cards.
        rows = rows.slice(0, 10);

        // Mode 2 (TICKET-102) — Google-rated fallback. Defensive whitelist:
        // restaurant fields + labeled Google numbers only, NEVER a Napkin number.
        // google_rating is NUMERIC(2,1) — coerce with Number() defensively.
        const rawFallback: FallbackPayloadRow[] = Array.isArray(fallbackRes.data) ? fallbackRes.data : [];
        let fallback = rawFallback.map((r) => ({
            restaurant_id: String(r.restaurant_id ?? ''),
            name: typeof r.name === 'string' ? r.name : '',
            cuisine: typeof r.cuisine === 'string' ? r.cuisine : null,
            neighborhood: typeof r.neighborhood === 'string' ? r.neighborhood : null,
            photo_url: typeof r.photo_url === 'string' ? r.photo_url : null,
            google_rating: Number(r.google_rating ?? 0),
            google_rating_count: Number(r.google_rating_count ?? 0),
        })).filter((r) => r.restaurant_id && r.name);

        // Absolute floor: <1 qualifying row → [] (rail hides; clean absence, no
        // broken partial). Hard cap 10 — finite rail, same as mode 1.
        if (fallback.length < 1) fallback = [];
        fallback = fallback.slice(0, 10);

        return new Response(
            JSON.stringify({ data: { rows, fallback } }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('feed-trending error:', error);
        const details = error instanceof Error ? error.message : JSON.stringify(error);
        return new Response(
            JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error', details } }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
