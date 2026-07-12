/**
 * share-page edge function — TICKET-072, live shares TICKET-077.
 *
 * PUBLIC (verify_jwt = false in config.toml).
 * Returns text/html — no CORS headers needed (not an API, not XHR target).
 * No Authorization header required; accessed by browsers, WhatsApp, iMessage bots.
 *
 * GET ?t={token}
 *   Live token   → 200 warm-paper letterpress page (OG meta, scheme-link CTA),
 *                  rendered from the source author's CURRENT verified spots (TICKET-077:
 *                  read LIVE via loadLiveSpots, not a frozen snapshot).
 *   Any bad token → 410 tombstone (invalid / malformed / unknown / revoked / the
 *                  list-or-owner is gone — all identical, no detail differentiation)
 *
 * Security invariants (TICKET-072 Codex #4/#6/#7/#8/#10/#11 — PRESERVED under live read):
 *   - Every interpolated string passes escapeText or escapeAttr (never raw concatenation)
 *   - render context is EXACTLY { sharer_name, list_name, created_at,
 *     spots[{name,city,cuisine,rating}] } (restaurant_id stripped — no uuid in HTML)
 *   - Verified-only: loadLiveSpots filters restaurants.verification='verified'
 *   - Cache-Control: no-store (revocation takes effect immediately on next fetch)
 *   - Referrer-Policy: no-referrer + <meta name="referrer" content="no-referrer"> in page
 *   - Outbound links: rel="noopener noreferrer"
 *   - Uniform 410 for all bad-token classes (no detail differentiation)
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { renderPage, renderTombstone } from './render.ts';
import { buildRenderContext, buildSnapshot, loadLiveSpots } from '../handoff/snapshot.ts';
import { resolveShareLiveSource } from '../handoff/shareSource.ts';
import { reportError } from '../_shared/report.ts';

// ── Token validation (Codex #8: malformed = same 410 as unknown/revoked) ──────

/**
 * A valid handoff token is exactly 22 base64url chars (no padding).
 * Pattern: [A-Za-z0-9_-]{22}
 * Anything else is treated as an unknown/invalid token → 410 tombstone.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;

// ── Response helpers ──────────────────────────────────────────────────────────

const PAGE_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
} as const;

function tombstone(): Response {
    return new Response(renderTombstone(), { status: 410, headers: PAGE_HEADERS });
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
    // Only GET (handle OPTIONS just for completeness — no real CORS needed)
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    if (req.method !== 'GET') {
        return tombstone();
    }

    // Parse token from ?t= query param
    let tokenParam: string;
    try {
        const url = new URL(req.url);
        tokenParam = url.searchParams.get('t') ?? '';
    } catch {
        return tombstone();
    }

    // Malformed token → tombstone (Codex #8: uniform response for all bad-token classes)
    if (!TOKEN_RE.test(tokenParam)) {
        return tombstone();
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        // Service-role client — exact-token lookup (clients never query by token — Codex #9)
        const supabase = createClient(supabaseUrl, serviceKey);

        // Read the live keys plus the optional strict relay-source marker.
        const { data: share, error: shareErr } = await supabase
            .from('wishlist_shares')
            .select('owner_id, list_id, snapshot, revoked_at, created_at')
            .eq('token', tokenParam)
            .maybeSingle();

        // Any DB error, unknown token, or revoked → same tombstone (Codex #8)
        if (shareErr || !share || (share as any).revoked_at !== null) {
            return tombstone();
        }

        const tokenOwnerId = (share as any).owner_id as string;
        const listId = ((share as any).list_id as string | null) ?? null;
        const createdAt = (share as any).created_at as string;
        const source = resolveShareLiveSource(tokenOwnerId, (share as any).snapshot);

        // TICKET-077: read the source author's CURRENT verified spots + ratings.
        // A deleted/unowned list → null → uniform tombstone (no leak).
        const live = await loadLiveSpots(supabase, source.sourceOwnerId, listId, {
            publicViewerId: source.publicViewerId,
        });
        if (!live) {
            return tombstone();
        }

        // Assemble the canonical payload via buildSnapshot (fed LIVE rows), then
        // build the allowlisted render context (strips restaurant_id — Codex #6).
        const payload = buildSnapshot(live.sharer_name, live.spots, live.list_name);
        const ctx = buildRenderContext(payload, createdAt);

        // Read install URL from env (validated as https-only by safeHref in render.ts)
        const testflightUrl = Deno.env.get('TESTFLIGHT_PUBLIC_URL') ?? null;

        // Render: token is used only in the generated scheme-link CTA
        const html = renderPage(ctx, tokenParam, testflightUrl);

        return new Response(html, { status: 200, headers: PAGE_HEADERS });

    } catch (err) {
        // Never expose internals — always tombstone (Codex #8)
        console.error('[share-page] error:', err);
        reportError(err, { fn: 'share-page' });
        return tombstone();
    }
});
