/**
 * critics-admin — Operator surface for professional critic review management.
 * TICKET-033
 *
 * Actions (POST body):
 *   list         — cursor-paged list of professional_critic_reviews joined to restaurants
 *   set_suppressed — toggle suppressed flag with audit columns
 *
 * Auth: service-role client + JWT validation + admin_users table check.
 * Admin gate is enforced server-side on every action (P1-2 ARCH-REVIEW).
 *
 * Pagination: (scraped_at desc, id desc) keyset — NOT using applyKeysetFilter
 * since that helper is coupled to "sort_date" column name (P2-1 ARCH-REVIEW).
 * Filter is written inline.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

// ── Pagination helpers (inline, P2-1) ─────────────────────────────────────────

function encodeCursor(scrapedAt: string, id: string): string {
    return btoa(`${scrapedAt}|${id}`);
}

function decodeCursor(s: string | null | undefined): { scraped_at: string; id: string } | null {
    if (!s) return null;
    try {
        const plain = atob(s);
        const pipe = plain.indexOf('|');
        if (pipe < 0) return null;
        const scraped_at = plain.slice(0, pipe);
        const id = plain.slice(pipe + 1);
        if (!scraped_at || !id) return null;
        return { scraped_at, id };
    } catch {
        return null;
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CriticAdminRow {
    id: string;
    publication: string;
    kind: string;
    score: string | null;
    score_out_of: string | null;
    author: string | null;
    published_date: string | null;
    excerpt: string | null;
    source_url: string | null;
    scraped_at: string;
    scrape_confidence: number;
    suppressed: boolean;
    suppressed_by: string | null;
    suppressed_at: string | null;
    suppression_reason: string | null;
    last_seen_on_source_at: string | null;
    restaurant: { id: string; name: string; city: string | null };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function errResponse(code: string, message: string, status = 400) {
    return jsonResponse({ error: { code, message } }, status);
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // ── Auth ────────────────────────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return errResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
        }

        const token = authHeader.replace('Bearer ', '');
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        // Service-role client — bypasses RLS; auth validated manually via getUser
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return errResponse('UNAUTHORIZED', 'Invalid or expired token', 401);
        }

        // ── Admin gate (P0-1, P1-2) ─────────────────────────────────────
        // Re-checked on every action. Reads admin_users table via service role.
        const { data: adminRow, error: adminErr } = await supabase
            .from('admin_users')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (adminErr) {
            return errResponse('DB_ERROR', adminErr.message, 500);
        }
        if (!adminRow) {
            return errResponse('FORBIDDEN', 'admin only', 403);
        }

        // ── Route ────────────────────────────────────────────────────────
        if (req.method !== 'POST') {
            return errResponse('METHOD_NOT_ALLOWED', 'Only POST is supported', 405);
        }

        const body = await req.json().catch(() => ({}));
        const action: string = body.action ?? '';

        // ── is_admin ──────────────────────────────────────────────────────
        // Returns { is_admin: true } if the caller is in admin_users.
        // The gate above already returned 403 for non-admins, so reaching
        // here always means the caller IS an admin. Exists so useIsAdmin
        // can distinguish "admin" from "403 = not admin" cleanly.
        if (action === 'is_admin') {
            return jsonResponse({ data: { is_admin: true } });
        }

        // ── list ─────────────────────────────────────────────────────────
        if (action === 'list') {
            const PAGE_SIZE = 50;
            const cursor: string | null = body.cursor ?? null;
            // include_suppressed defaults to true so operator can see + un-suppress takedowns
            const includeSuppressed: boolean = body.include_suppressed !== false;

            // Build base query — service role can read all columns including audit columns
            let query = supabase
                .from('professional_critic_reviews')
                .select(`
                    id,
                    publication,
                    kind,
                    score,
                    score_out_of,
                    author,
                    published_date,
                    excerpt,
                    source_url,
                    scraped_at,
                    scrape_confidence,
                    suppressed,
                    suppressed_by,
                    suppressed_at,
                    suppression_reason,
                    last_seen_on_source_at,
                    restaurant:restaurants ( id, name, city )
                `)
                .order('scraped_at', { ascending: false })
                .order('id', { ascending: false })
                .limit(PAGE_SIZE + 1);

            // Filter suppressed rows if requested
            if (!includeSuppressed) {
                query = query.eq('suppressed', false);
            }

            // Keyset filter inline (P2-1): (scraped_at, id) < (d, i) for DESC order
            // Equivalent to: scraped_at < d  OR  (scraped_at = d AND id < i)
            if (cursor) {
                const decoded = decodeCursor(cursor);
                if (decoded) {
                    const { scraped_at: d, id: i } = decoded;
                    query = query.or(
                        `scraped_at.lt.${d},and(scraped_at.eq.${d},id.lt.${i})`
                    );
                }
            }

            const { data: rows, error: listErr } = await query;
            if (listErr) {
                return errResponse('DB_ERROR', listErr.message, 500);
            }

            const typedRows = (rows ?? []) as CriticAdminRow[];
            const has_more = typedRows.length > PAGE_SIZE;
            const kept = has_more ? typedRows.slice(0, PAGE_SIZE) : typedRows;
            const last = kept[kept.length - 1];
            const next_cursor = has_more && last
                ? encodeCursor(last.scraped_at, last.id)
                : null;

            return jsonResponse({
                data: { rows: kept, next_cursor, has_more },
            });
        }

        // ── set_suppressed ────────────────────────────────────────────────
        if (action === 'set_suppressed') {
            const { review_id, suppressed, reason } = body as {
                review_id: string;
                suppressed: boolean;
                reason?: string;
            };

            if (!review_id) {
                return errResponse('BAD_REQUEST', 'review_id is required');
            }
            if (typeof suppressed !== 'boolean') {
                return errResponse('BAD_REQUEST', 'suppressed must be a boolean');
            }
            if (suppressed && (!reason || reason.trim().length === 0)) {
                return errResponse('BAD_REQUEST', 'reason is required when suppressing');
            }
            if (reason && reason.length > 200) {
                return errResponse('BAD_REQUEST', 'reason must be ≤200 characters');
            }

            let updatePayload: Record<string, unknown>;

            if (suppressed) {
                updatePayload = {
                    suppressed: true,
                    suppressed_by: user.id,
                    suppressed_at: new Date().toISOString(),
                    suppression_reason: reason!.trim(),
                };
            } else {
                // Un-suppression clears all audit columns
                updatePayload = {
                    suppressed: false,
                    suppressed_by: null,
                    suppressed_at: null,
                    suppression_reason: null,
                };
            }

            const { data: updated, error: updateErr } = await supabase
                .from('professional_critic_reviews')
                .update(updatePayload)
                .eq('id', review_id)
                .select('id, suppressed, suppressed_by, suppressed_at, suppression_reason')
                .single();

            if (updateErr) {
                return errResponse('DB_ERROR', updateErr.message, 500);
            }
            if (!updated) {
                return errResponse('NOT_FOUND', 'Review not found', 404);
            }

            return jsonResponse({ data: updated });
        }

        return errResponse('BAD_REQUEST', `Unknown action: ${action}`);

    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[critics-admin] Unexpected error:', message);
        return errResponse('INTERNAL_ERROR', 'An unexpected error occurred', 500);
    }
});
