/**
 * feed-socials edge function — TICKET-189: the "on socials" For You module.
 *
 * What's being saved off TikTok/IG, community-scoped, privacy re-gated per
 * viewer. Two stages:
 *
 *   Stage 1 — fn_get_socials_candidates: global viewer-agnostic candidate
 *     cache (1h dispatch-on-read, trending_cache dance). Public accounts only,
 *     verifiable social sources only. Used HERE for the candidate id array
 *     ONLY — every viewer-dependent fact is recomputed live in stage 2.
 *   Stage 2 — fn_socials_viewer_pass(p_viewer, ids): LATERALs TICKET-155's
 *     fn_restaurant_saves_visible per candidate — blocks in both directions,
 *     public→private flips since the cache compute, and self-exclusion (k
 *     recomputed) are all honored at read time. Returns viewer-adjusted
 *     k7/k30, PER-WINDOW platform facts, and the representative clip.
 *
 * Ladder (resolveSocialsLadder, _shared/socialsLadder.ts): candidates demote
 * down the rungs (week → month → clip-as-content), never straight out; a
 * candidate drops entirely only when zero viewer-eligible clips remain. Cards
 * are sorted count desc (rung-3 cards after counted ones, recency-tiebroken)
 * and capped at 6 AFTER filtering.
 *
 * Projection: SocialsCard carries NO saver ids (rep_saver_id stays server-
 * side; creator_handle is the platform CREATOR, never the Napkin saver —
 * Codex P2). thumb_url is the durable clip_thumbs storage copy only (never a
 * provider CDN link); content_key derives via _shared/videoUrlKey.ts — the
 * single canonicalization authority (capture/read/backfill must never
 * diverge), NEVER recomputed in SQL.
 *
 * FAILS CLOSED (Codex P1): any RPC error — including 42883/PGRST202
 * missing-function — reports + rethrows → 500. NO fail-open [] (a dead module
 * must look dead to smoke, not legitimately empty). This deliberately does
 * NOT copy restaurant-history's social_clippings fail-open.
 *
 * POST (no params beyond auth). Response: { data: { rows: SocialsCard[] } } —
 * rows nest INSIDE data (callEdgeFn strips the outer envelope).
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { contentKey } from '../_shared/videoUrlKey.ts';
import {
    reduceRailKicker,
    resolveSocialsLadder,
    type SocialsLadderResolution,
    type SocialsPlatformFact,
} from '../_shared/socialsLadder.ts';

const RAIL_CAP = 6;

interface ViewerPassRow {
    restaurant_id: string;
    k7: number;
    k30: number;
    platform_7d: SocialsPlatformFact;
    platform_30d: SocialsPlatformFact;
    rep_saver_id: string;           // NEVER projected to the client
    rep_source_type: 'tiktok' | 'instagram';
    rep_url: string | null;
    rep_author_handle: string | null;
    rep_created_at: string;
}

interface RestaurantRow {
    id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
    photo_source: string | null;
    places_photo_attribution_html: string | null;
}

/** The client card — counts-or-creator-content only; no Napkin identity. */
interface SocialsCard {
    restaurant_id: string;
    name: string;
    neighborhood: string | null;
    rung: 1 | 2 | 3;
    window: 'week' | 'month' | null;
    count: number | null;
    platform: 'tiktok' | 'instagram' | 'socials';
    /** Platform creator handle (rung 3 provenance) — never the saver. */
    creator_handle: string | null;
    /** Durable clip_thumbs storage URL, or null (client degrades the chain). */
    thumb_url: string | null;
    photo_url: string | null;
    photo_source: string | null;
    attribution_html: string | null;
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
        if (req.method !== 'POST') {
            return fail('METHOD_NOT_ALLOWED', 'POST only', 405);
        }

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return fail('UNAUTHORIZED', 'Missing Authorization header', 401);

        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabase = createClient(
            supabaseUrl,
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) return fail('UNAUTHORIZED', 'Unauthorized', 401);

        // ── Stage 1: cached viewer-agnostic candidates (ids only) ────────────
        // FAIL CLOSED: a missing/broken RPC rethrows — never [] (see header).
        const candidatesRes = await supabase.rpc('fn_get_socials_candidates');
        if (candidatesRes.error) {
            reportError(candidatesRes.error, { fn: 'feed-socials', action: 'get_candidates' });
            throw candidatesRes.error;
        }
        const candidatePayload: Array<{ restaurant_id?: unknown }> =
            Array.isArray(candidatesRes.data) ? candidatesRes.data : [];
        const candidateIds = [...new Set(
            candidatePayload
                .map((c) => (typeof c?.restaurant_id === 'string' ? c.restaurant_id : null))
                .filter((id): id is string => !!id),
        )];

        if (candidateIds.length === 0) {
            return new Response(
                JSON.stringify({ data: { rows: [], kicker: reduceRailKicker([]) } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // ── Stage 2: JWT-bound live pass (blocks / flips / self-exclusion) ───
        const passRes = await supabase.rpc('fn_socials_viewer_pass', {
            p_viewer: user.id,
            p_restaurant_ids: candidateIds,
        });
        if (passRes.error) {
            reportError(passRes.error, { fn: 'feed-socials', action: 'viewer_pass' });
            throw passRes.error;
        }
        const passRows = (Array.isArray(passRes.data) ? passRes.data : []) as ViewerPassRow[];

        // ── Ladder + sort + cap (cap applies AFTER the viewer filtering) ─────
        type Scored = { row: ViewerPassRow; ladder: SocialsLadderResolution };
        const scored: Scored[] = passRows.map((row) => ({
            row,
            ladder: resolveSocialsLadder({
                k7: Number(row.k7 ?? 0),
                k30: Number(row.k30 ?? 0),
                platform_7d: row.platform_7d ?? 'none',
                platform_30d: row.platform_30d ?? 'none',
                rep_source_type: row.rep_source_type === 'instagram' ? 'instagram' : 'tiktok',
            }),
        }));

        scored.sort((a, b) => {
            const ca = a.ladder.count ?? -1;   // rung-3 (no count) sorts after counted cards
            const cb = b.ladder.count ?? -1;
            if (cb !== ca) return cb - ca;
            // ties: most-recent representative save first
            if (a.row.rep_created_at < b.row.rep_created_at) return 1;
            if (a.row.rep_created_at > b.row.rep_created_at) return -1;
            return a.row.restaurant_id < b.row.restaurant_id ? -1 : 1;
        });

        const capped = scored.slice(0, RAIL_CAP);

        // ── Durable thumbs: content_key via videoUrlKey.ts, join clip_thumbs ─
        const keyByRestaurant = new Map<string, string>();
        for (const s of capped) {
            if (s.row.rep_url) {
                keyByRestaurant.set(s.row.restaurant_id, await contentKey(s.row.rep_url));
            }
        }
        const thumbByKey = new Map<string, string>();
        const wantKeys = [...new Set(keyByRestaurant.values())];
        if (wantKeys.length > 0) {
            const { data: thumbRows, error: thumbErr } = await supabase
                .from('clip_thumbs')
                .select('content_key, storage_path')
                .in('content_key', wantKeys)
                .eq('status', 'cached');
            if (thumbErr) {
                reportError(thumbErr, { fn: 'feed-socials', action: 'clip_thumbs' });
                throw thumbErr;
            }
            for (const t of (thumbRows ?? []) as Array<{ content_key: string; storage_path: string | null }>) {
                if (t.storage_path) thumbByKey.set(t.content_key, t.storage_path);
            }
        }

        // ── Restaurant hydration ─────────────────────────────────────────────
        const restaurantById = new Map<string, RestaurantRow>();
        if (capped.length > 0) {
            const { data: restaurants, error: restErr } = await supabase
                .from('restaurants')
                .select('id, name, city, photo_url, photo_source, places_photo_attribution_html')
                .in('id', capped.map((s) => s.row.restaurant_id));
            if (restErr) {
                reportError(restErr, { fn: 'feed-socials', action: 'restaurants' });
                throw restErr;
            }
            for (const r of (restaurants ?? []) as RestaurantRow[]) restaurantById.set(r.id, r);
        }

        // ── Projection — no saver ids, whitelist only ────────────────────────
        const rows: SocialsCard[] = [];
        for (const s of capped) {
            const r = restaurantById.get(s.row.restaurant_id);
            if (!r || !r.name) continue; // restaurant vanished mid-flight
            const key = keyByRestaurant.get(s.row.restaurant_id) ?? null;
            const storagePath = key ? thumbByKey.get(key) ?? null : null;
            rows.push({
                restaurant_id: s.row.restaurant_id,
                name: r.name,
                neighborhood: r.city ?? null,
                rung: s.ladder.rung,
                window: s.ladder.window,
                count: s.ladder.count,
                platform: s.ladder.platform,
                creator_handle:
                    typeof s.row.rep_author_handle === 'string' && s.row.rep_author_handle
                        ? s.row.rep_author_handle
                        : null,
                thumb_url: storagePath
                    ? `${supabaseUrl}/storage/v1/object/public/clip-thumbs/${storagePath}`
                    : null,
                photo_url: r.photo_url ?? null,
                photo_source: r.photo_source ?? null,
                attribution_html: r.places_photo_attribution_html ?? null,
            });
        }

        // Rail kicker rides along (client also recomputes from the cards —
        // socialsPresentation.ts mirror). Nested INSIDE data (envelope law).
        return new Response(
            JSON.stringify({ data: { rows, kicker: reduceRailKicker(rows) } }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    } catch (error) {
        console.error('feed-socials error:', error);
        reportError(error, { fn: 'feed-socials' });
        const details = error instanceof Error ? error.message : JSON.stringify(error);
        return new Response(
            JSON.stringify({ error: { code: 'INTERNAL', message: 'Internal Server Error', details } }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
