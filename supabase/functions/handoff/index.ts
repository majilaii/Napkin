/**
 * handoff edge function — TICKET-072, live shares TICKET-077.
 *
 * Authed; canonical table-management pattern (service role + manual getUser).
 * Returns { data } | { error } envelope with corsHeaders.
 *
 * TICKET-077: shares are LIVE. A token references (owner_id, list_id?) and is
 * resolved at view time off the source author's CURRENT verified spots + ratings.
 * Public-list relays keep a strict source-owner marker; no spots are frozen. The
 * display payload is built by loadLiveSpots (the single source of truth, shared
 * with share-page and the pin path).
 *
 * Actions (POST body: { action, ...fields }):
 *
 *   create      — mint a token for the caller's wishlist (no snapshot built).
 *                 → { token, share_url }
 *                 list_id (optional, caller-owned or currently visible public)
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
import { reportError } from '../_shared/report.ts';
import { mintShareToken } from '../_shared/handoffToken.ts';
import {
    loadLiveSpots,
    buildSnapshot,
    buildResolveCandidates,
} from './snapshot.ts';
import { deriveClientNonce } from './nonce.ts';
import {
    canViewerSavePublicList,
    isBlockedEitherDirection,
} from '../lists/savedLists.ts';
import {
    buildPublicListRelayMarker,
    resolveShareLiveSource,
} from './shareSource.ts';

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

            // TICKET-077: NOTHING is frozen. Author-created shares retain the
            // original owner path. A non-owner may relay only a currently visible
            // public personal list; the token stays owned/revocable by that viewer
            // and carries a strict source-author marker for live re-authorization.
            let listId: string | null = null;
            if (listIdInput !== undefined && listIdInput !== null) {
                if (typeof listIdInput !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listIdInput)) {
                    return errorResponse('INVALID_LIST_ID', 'list_id must be a list uuid', 400);
                }
                listId = listIdInput;
            }

            let sourceOwnerId = user.id;
            let publicViewerId: string | null = null;

            if (listId !== null) {
                const { data: sourceList, error: sourceListErr } = await supabase
                    .from('lists')
                    .select('id, owner_id, privacy, table_id')
                    .eq('id', listId)
                    .maybeSingle();
                if (sourceListErr) throw sourceListErr;
                if (!sourceList) {
                    return errorResponse('LIST_NOT_FOUND', 'List not found', 404);
                }

                sourceOwnerId = (sourceList as any).owner_id as string;
                if (sourceOwnerId !== user.id) {
                    const { data: ownerProfile, error: ownerProfileErr } = await supabase
                        .from('profiles')
                        .select('account_privacy')
                        .eq('user_id', sourceOwnerId)
                        .maybeSingle();
                    if (ownerProfileErr) throw ownerProfileErr;

                    const passesStaticGate = canViewerSavePublicList(
                        user.id,
                        sourceList as any,
                        ownerProfile as any,
                        false,
                    );
                    if (!passesStaticGate || await isBlockedEitherDirection(
                        supabase as any,
                        user.id,
                        sourceOwnerId,
                    )) {
                        return errorResponse('LIST_NOT_FOUND', 'List not found', 404);
                    }
                    publicViewerId = user.id;
                }
            }

            // Live read keeps the affordance honest (empty/all-unverified → 400)
            // and re-runs the public gate for relayed links.
            const live = await loadLiveSpots(supabase, sourceOwnerId, listId, {
                publicViewerId,
            });

            if (listId !== null && live === null) {
                // Missing, no longer owned by the source author, or no longer
                // public to a relay viewer. Keep every failure uniform.
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
            // Owned shares leave snapshot NULL. Relays use only a strict source
            // marker; spots and display data are always read live.
            let shareToken: string | null = null;

            for (let attempt = 0; attempt < 3; attempt++) {
                const candidate = mintShareToken();
                const { error: insertErr } = await supabase
                    .from('wishlist_shares')
                    .insert({
                        owner_id: user.id,
                        list_id: listId,
                        token: candidate,
                        snapshot: publicViewerId
                            ? buildPublicListRelayMarker(sourceOwnerId)
                            : null,
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

            // Share URL = the web renderer (a Vercel proxy that serves the
            // share-page HTML with the correct text/html content-type — Supabase
            // edge functions force text/plain on *.supabase.co so the raw page
            // would not render in a browser). Configurable via SHARE_WEB_BASE.
            const shareWebBase = Deno.env.get('SHARE_WEB_BASE') ?? 'https://napkinshare.vercel.app';
            const shareUrl = `${shareWebBase}/s/${shareToken}`;

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
            // Read the live keys plus the optional strict relay-source marker.
            const { data: share, error: shareErr } = await supabase
                .from('wishlist_shares')
                .select('owner_id, list_id, snapshot, revoked_at')
                .eq('token', resolveToken)
                .maybeSingle();

            if (shareErr) throw shareErr;

            // Unknown or revoked → uniform in-app tombstone (Codex #8)
            if (!share || (share as any).revoked_at !== null) {
                return jsonResponse({ data: { status: 'revoked' } });
            }

            const tokenOwnerId = (share as any).owner_id as string;
            const listId = ((share as any).list_id as string | null) ?? null;
            const source = resolveShareLiveSource(tokenOwnerId, (share as any).snapshot);

            // TICKET-077: read the source author's CURRENT verified spots + ratings.
            // A deleted/unowned list → null → tombstone (uniform, no leak).
            const live = await loadLiveSpots(supabase, source.sourceOwnerId, listId, {
                publicViewerId: source.publicViewerId,
            });
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
        reportError(err, { fn: 'handoff' });
        return jsonResponse({ error: 'Internal Server Error', details: String(err) }, 500);
    }
});
