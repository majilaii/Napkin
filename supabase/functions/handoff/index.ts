/**
 * handoff edge function — TICKET-072, live shares TICKET-077.
 *
 * Authed; canonical table-management pattern (service role + manual getUser).
 * Returns { data } | { error } envelope with corsHeaders.
 *
 * TICKET-077: shares are LIVE. A token references (owner_id, list_id?) and is
 * resolved at view time off the owner's CURRENT verified spots + ratings — no
 * frozen snapshot. The display payload is built by loadLiveSpots (the single
 * source of truth, shared with share-page and the pin path).
 *
 * Actions (POST body: { action, ...fields }):
 *
 *   create      — mint a token for the caller's wishlist (no snapshot built).
 *                 → { token, share_url }
 *                 list_id (optional, must be caller-owned via lists.owner_id)
 *                 mints a per-list share instead. Validation only: a non-empty,
 *                 verified-spot live read is required at create time so the
 *                 affordance stays honest (empty → 400), but NOTHING is frozen.
 *
 *   revoke_all  — set revoked_at on all live tokens for the caller (cutoff = now())
 *                 ARCH-REVIEW-2 #12: concurrent shares created exactly at the cutoff
 *                 are accepted and documented.
 *                 → { revoked_count }
 *
 *   resolve     — in-app receive: lookup token → loadLiveSpots(owner, list) →
 *                 compute already_wishlisted (per CALLER), build ResolveSpot[]
 *                 with deterministic candidate_ids (no owner_id leaked).
 *                 → { status:'live'|'revoked', sharer_name?, list_name?, spots? }
 *
 * ARCH-REVIEW-2 #12: 'status' action DROPPED from v1.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { mintShareToken } from '../_shared/handoffToken.ts';
import {
    loadLiveSpots,
    buildSnapshot,
    buildResolveCandidates,
} from './snapshot.ts';
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
            const { list_id: listIdInput } = body as { list_id?: unknown };

            // TICKET-077: NOTHING is frozen. We only (a) validate list ownership
            // and (b) run the live read once to keep the affordance honest — an
            // empty/all-unverified source → 400 rather than a dead link. The token
            // stores only (owner_id, list_id); every view re-reads live.
            let listId: string | null = null;
            if (listIdInput !== undefined && listIdInput !== null) {
                if (typeof listIdInput !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listIdInput)) {
                    return errorResponse('INVALID_LIST_ID', 'list_id must be a list uuid', 400);
                }
                listId = listIdInput;
            }

            // Live read (also validates list ownership: null → not yours / missing).
            const live = await loadLiveSpots(supabase, user.id, listId);

            if (listId !== null && live === null) {
                // List not found or not owned by the caller. Uniform 404 — no
                // existence oracle ("not yours" and "missing" are identical).
                return errorResponse('LIST_NOT_FOUND', 'List not found', 404);
            }

            if (!live || live.spots.length === 0) {
                // Honest affordance: nothing verified to share *right now*.
                return errorResponse(
                    listId !== null ? 'EMPTY_LIST' : 'EMPTY_WISHLIST',
                    'No verified spots to share',
                    400,
                );
            }

            // Mint token with ≤3 retry on unique violation (ARCH-REVIEW-2 #9).
            // snapshot is left NULL — vestigial column, never read (TICKET-077).
            let shareToken: string | null = null;

            for (let attempt = 0; attempt < 3; attempt++) {
                const candidate = mintShareToken();
                const { error: insertErr } = await supabase
                    .from('wishlist_shares')
                    .insert({
                        owner_id: user.id,
                        list_id: listId,
                        token: candidate,
                        snapshot: null,
                    })
                    .select('id')
                    .single();

                if (!insertErr) {
                    shareToken = candidate;
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

            // Share URL = share-page edge function with token as query param
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

            // Exact-token service-role lookup (no client ever queries by token — Codex #9).
            // TICKET-077: read (owner_id, list_id) — the live read keys, not a snapshot.
            const { data: share, error: shareErr } = await supabase
                .from('wishlist_shares')
                .select('owner_id, list_id, revoked_at')
                .eq('token', resolveToken)
                .maybeSingle();

            if (shareErr) throw shareErr;

            // Unknown or revoked → uniform in-app tombstone (Codex #8)
            if (!share || (share as any).revoked_at !== null) {
                return jsonResponse({ data: { status: 'revoked' } });
            }

            const ownerId = (share as any).owner_id as string;
            const listId = ((share as any).list_id as string | null) ?? null;

            // TICKET-077: read the owner's CURRENT verified spots + ratings.
            // A deleted/unowned list → null → tombstone (uniform, no leak).
            const live = await loadLiveSpots(supabase, ownerId, listId);
            if (!live) {
                return jsonResponse({ data: { status: 'revoked' } });
            }

            // Server-compute already_wishlisted for the receiver (not the sharer)
            const restaurantIds = live.spots.map((s) => s.restaurant_id);

            const alreadyIds = new Set<string>();
            if (restaurantIds.length > 0) {
                const { data: existingItems } = await supabase
                    .from('wishlist_items')
                    .select('restaurant_id')
                    .eq('user_id', user.id)
                    .in('restaurant_id', restaurantIds)
                    .is('deleted_at', null);
                for (const r of (existingItems ?? []) as any[]) {
                    alreadyIds.add(r.restaurant_id as string);
                }
            }

            // Derive deterministic candidate_ids (Codex #10). Nonce derives from
            // (token, restaurant_id) — stable for a given restaurant across views.
            const candidateIds = new Map<string, string>();
            await Promise.all(
                live.spots.map(async (spot) => {
                    const nonce = await deriveClientNonce(resolveToken, spot.restaurant_id);
                    candidateIds.set(spot.restaurant_id, nonce);
                }),
            );

            // Assemble the canonical payload shape via buildSnapshot (now fed LIVE
            // rows instead of frozen ones) so resolve/share-page share one shape
            // builder — then derive the receive candidates from it.
            const payload = buildSnapshot(live.sharer_name, live.spots, live.list_name);
            const spots = buildResolveCandidates(payload, alreadyIds, candidateIds);

            return jsonResponse({
                data: {
                    status: 'live',
                    sharer_name: live.sharer_name,
                    // TICKET-077: live list title for per-list shares; null for wishlist.
                    list_name: live.list_name,
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
