/**
 * handoff edge function — TICKET-072
 *
 * Authed; canonical table-management pattern (service role + manual getUser).
 * Returns { data } | { error } envelope with corsHeaders.
 *
 * Actions (POST body: { action, ...fields }):
 *
 *   create      — read caller's verified wishlist, freeze snapshot, mint token
 *                 → { token, share_url }
 *
 *   revoke_all  — set revoked_at on all live tokens for the caller (cutoff = now())
 *                 ARCH-REVIEW-2 #12: concurrent shares created exactly at the cutoff
 *                 are accepted and documented.
 *                 → { revoked_count }
 *
 *   resolve     — in-app receive: lookup token, compute already_wishlisted, build
 *                 ResolveSpot[] with deterministic candidate_ids (no owner_id leaked)
 *                 → { status:'live'|'revoked', sharer_name?, spots? }
 *
 * ARCH-REVIEW-2 #12: 'status' action DROPPED from v1.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { mintShareToken } from '../_shared/handoffToken.ts';
import { buildSnapshot, buildResolveCandidates, type WishlistShareSnapshot } from './snapshot.ts';
import { deriveClientNonce } from './nonce.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function errorResponse(code: string, message: string, status: number) {
    return jsonResponse({ error: { code, message } }, status);
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // ── Auth ──────────────────────────────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return jsonResponse({ error: 'Missing Authorization header' }, 401);
        }

        const token = authHeader.replace('Bearer ', '');
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        // Service-role client — bypasses RLS; auth validated manually via getUser
        const supabase = createClient(supabaseUrl, serviceKey);

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        if (req.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405);
        }

        const body = await req.json();
        const { action } = body as { action?: string };

        // ── create ────────────────────────────────────────────────────────────
        if (action === 'create') {
            // 1. Read caller's verified pinned wishlist items joined to restaurants
            //    ARCH-REVIEW-2 #2: only include verified restaurants
            const { data: wishlistRows, error: wishlistErr } = await supabase
                .from('wishlist_items')
                .select(`
                    restaurant_id,
                    restaurant:restaurants!inner (
                        id,
                        name,
                        city,
                        cuisine,
                        verification
                    )
                `)
                .eq('user_id', user.id)
                .is('deleted_at', null)
                .not('restaurant_id', 'is', null)
                .eq('restaurant.verification', 'verified');

            if (wishlistErr) throw wishlistErr;

            if (!wishlistRows || wishlistRows.length === 0) {
                return errorResponse('EMPTY_WISHLIST', 'No verified wishlist items to share', 400);
            }

            // 2. Fetch caller's most-recent rating per restaurant in one query
            const restaurantIds = (wishlistRows as any[]).map((w) => w.restaurant_id as string);

            const { data: ratingRows, error: ratingErr } = await supabase
                .from('entries')
                .select('restaurant_id, rating, created_at')
                .eq('user_id', user.id)
                .in('restaurant_id', restaurantIds)
                .not('rating', 'is', null)
                .order('created_at', { ascending: false });

            if (ratingErr) throw ratingErr;

            // First result per restaurant_id = most recent (due to ORDER BY created_at DESC)
            const ratingMap = new Map<string, number>();
            for (const row of (ratingRows ?? []) as any[]) {
                if (!ratingMap.has(row.restaurant_id)) {
                    ratingMap.set(row.restaurant_id, row.rating as number);
                }
            }

            // 3. Caller display_name → sharer_name (first token)
            const { data: profile } = await supabase
                .from('profiles')
                .select('display_name')
                .eq('user_id', user.id)
                .maybeSingle();

            const displayName = (profile as any)?.display_name as string ?? '';
            const sharerName = displayName.split(' ')[0]?.trim() || displayName || 'someone';

            // 4. Build frozen snapshot
            const snapshotInput = (wishlistRows as any[]).map((w) => ({
                restaurant_id: w.restaurant_id as string,
                name: (w.restaurant as any).name as string,
                city: (w.restaurant as any).city as string | null ?? null,
                cuisine: (w.restaurant as any).cuisine as string | null ?? null,
                rating: ratingMap.get(w.restaurant_id) ?? null,
            }));

            const snapshot = buildSnapshot(sharerName, snapshotInput);

            // 5. Mint token with ≤3 retry on unique violation (ARCH-REVIEW-2 #9)
            let shareToken: string | null = null;
            let insertId: string | null = null;

            for (let attempt = 0; attempt < 3; attempt++) {
                const candidate = mintShareToken();
                const { data: inserted, error: insertErr } = await supabase
                    .from('wishlist_shares')
                    .insert({
                        owner_id: user.id,
                        token: candidate,
                        snapshot,
                    })
                    .select('id')
                    .single();

                if (!insertErr) {
                    shareToken = candidate;
                    insertId = (inserted as any).id;
                    break;
                }

                // 23505 = unique_violation — retry with a fresh token
                if ((insertErr as any).code === '23505') {
                    continue;
                }
                throw insertErr;
            }

            if (!shareToken) {
                return errorResponse('TOKEN_GENERATION_FAILED', 'Could not mint a unique token', 500);
            }

            // 6. Share URL = share-page edge function with token as query param
            const shareUrl = `${supabaseUrl}/functions/v1/share-page?t=${shareToken}`;

            return jsonResponse({ data: { token: shareToken, share_url: shareUrl } }, 201);
        }

        // ── revoke_all ────────────────────────────────────────────────────────
        if (action === 'revoke_all') {
            // ARCH-REVIEW-2 #12: cutoff = now(); a share created at exactly this
            // instant may survive — accepted, documented.
            const cutoff = new Date().toISOString();

            const { data: updated, error: revokeErr } = await supabase
                .from('wishlist_shares')
                .update({ revoked_at: cutoff })
                .eq('owner_id', user.id)
                .is('revoked_at', null)
                .lte('created_at', cutoff)
                .select('id');

            if (revokeErr) throw revokeErr;

            return jsonResponse({ data: { revoked_count: (updated ?? []).length } });
        }

        // ── resolve ───────────────────────────────────────────────────────────
        if (action === 'resolve') {
            const { token: resolveToken } = body as { token?: string };

            // Malformed or missing token → in-app tombstone (Codex #1/#8)
            if (!resolveToken || typeof resolveToken !== 'string' || resolveToken.trim() === '') {
                return jsonResponse({ data: { status: 'revoked' } });
            }

            // Exact-token service-role lookup (no client ever queries by token — Codex #9)
            const { data: share, error: shareErr } = await supabase
                .from('wishlist_shares')
                .select('snapshot, revoked_at')
                .eq('token', resolveToken)
                .maybeSingle();

            if (shareErr) throw shareErr;

            // Unknown or revoked → uniform in-app tombstone (Codex #8)
            if (!share || (share as any).revoked_at !== null) {
                return jsonResponse({ data: { status: 'revoked' } });
            }

            const snapshot = (share as any).snapshot as WishlistShareSnapshot;

            // Server-compute already_wishlisted for the receiver (not the sharer)
            const restaurantIds = snapshot.spots.map((s) => s.restaurant_id);

            const { data: existingItems } = await supabase
                .from('wishlist_items')
                .select('restaurant_id')
                .eq('user_id', user.id)
                .in('restaurant_id', restaurantIds)
                .is('deleted_at', null);

            const alreadyIds = new Set(
                (existingItems ?? []).map((r: any) => r.restaurant_id as string),
            );

            // Derive deterministic candidate_ids (Codex #10)
            const candidateIds = new Map<string, string>();
            await Promise.all(
                snapshot.spots.map(async (spot) => {
                    const nonce = await deriveClientNonce(resolveToken, spot.restaurant_id);
                    candidateIds.set(spot.restaurant_id, nonce);
                }),
            );

            const spots = buildResolveCandidates(snapshot, alreadyIds, candidateIds);

            return jsonResponse({
                data: {
                    status: 'live',
                    sharer_name: snapshot.sharer_name,
                    spots,
                },
            });
        }

        return errorResponse('UNKNOWN_ACTION', `Unknown action: ${action}`, 400);

    } catch (err) {
        console.error('[handoff] error:', err);
        return jsonResponse({ error: 'Internal Server Error', details: String(err) }, 500);
    }
});
