/**
 * table-invite-page edge function — public landing page for a table invite link.
 *
 * PUBLIC (verify_jwt = false in config.toml).
 * Returns text/html — no CORS headers needed (not an API, not an XHR target).
 * Accessed by browsers, iMessage/WhatsApp unfurl bots.
 *
 * GET ?c={code}
 *   Live code    → 200 warm-paper page: table name + "Open in Napkin"
 *                  (napkin://join-table?code=<code>) + optional "get Napkin".
 *   Any bad code → 410 tombstone (invalid / malformed / unknown / revoked — all
 *                  identical, no detail differentiation).
 *
 * Security invariants (mirrors share-page):
 *   - Every interpolated string passes escapeText / escapeAttr / safeHref
 *   - render input is EXACTLY { table_name } (no uuids echoed)
 *   - Cache-Control: no-store (revocation takes effect on next fetch)
 *   - Referrer-Policy: no-referrer
 *   - Uniform 410 for all bad-code classes
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { renderPage, renderTombstone } from './render.ts';
import { reportError } from '../_shared/report.ts';

// A valid invite code is exactly 22 base64url chars (mintShareToken output).
const CODE_RE = /^[A-Za-z0-9_-]{22}$/;

const PAGE_HEADERS = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
} as const;

function tombstone(): Response {
    return new Response(renderTombstone(), { status: 410, headers: PAGE_HEADERS });
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    if (req.method !== 'GET') {
        return tombstone();
    }

    let codeParam: string;
    try {
        const url = new URL(req.url);
        codeParam = url.searchParams.get('c') ?? '';
    } catch {
        return tombstone();
    }

    // Malformed code → tombstone (uniform response for all bad-code classes).
    if (!CODE_RE.test(codeParam)) {
        return tombstone();
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        // Service-role client — exact-code lookup (clients never query by code).
        const supabase = createClient(supabaseUrl, serviceKey);

        const { data: invite, error: inviteErr } = await supabase
            .from('table_invites')
            .select('table_id, revoked_at')
            .eq('code', codeParam)
            .maybeSingle();

        // Any DB error, unknown code, or revoked → same tombstone.
        if (inviteErr || !invite || (invite as any).revoked_at !== null) {
            return tombstone();
        }

        const { data: table, error: tableErr } = await supabase
            .from('tables')
            .select('name')
            .eq('id', (invite as any).table_id)
            .maybeSingle();

        if (tableErr || !table) {
            return tombstone();
        }

        const testflightUrl = Deno.env.get('TESTFLIGHT_PUBLIC_URL') ?? null;
        const html = renderPage((table as any).name ?? 'this table', codeParam, testflightUrl);

        return new Response(html, { status: 200, headers: PAGE_HEADERS });

    } catch (err) {
        // Never expose internals — always tombstone.
        console.error('[table-invite-page] error:', err);
        reportError(err, { fn: 'table-invite-page' });
        return tombstone();
    }
});
