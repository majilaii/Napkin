/**
 * account — account lifecycle + safety actions (TICKET-090, App Review pack).
 *
 * Actions (POST body { action, ... }):
 *   delete        — permanently delete the caller's account + all owned data.
 *   report        — file a content/user report ({ target_type, target_id, reason }).
 *   block         — block a user ({ user_id }); also severs follow edges both ways.
 *   unblock       — remove a block ({ user_id }).
 *   blocked_list  — the caller's blocked users, hydrated with profiles.
 *
 * Auth: service-role client + manual JWT validation (canonical pattern,
 * table-management). Service role is REQUIRED for `delete` (auth.admin) and
 * for hydrating blocked profiles regardless of their privacy.
 *
 * Deletion contract (TICKET-196): freeze writers with a durable tombstone,
 * drain generation-fenced staging writes, inventory every per-user namespace,
 * purge Storage, re-list stable-zero, then delete Auth and content rows. Any
 * external-call failure resumes through the monitored account_cleanup job.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { reportError } from '../_shared/report.ts';
import { errorResponse } from '../_shared/errors.ts';
import { advanceAccountDeletion } from './deletionSaga.ts';
import { requestAccountDeletion } from './deletionRequest.ts';
import {
    createSupabaseDeletionAdapter,
    freezeAccountDeletion,
} from './deletionSupabase.ts';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

const REPORT_TARGET_TYPES = new Set(['entry', 'comment', 'profile', 'share', 'supper', 'photo']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return errorResponse('UNAUTHORIZED', 'Missing Authorization header', 401);
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) return errorResponse('UNAUTHORIZED', 'Unauthorized', 401);

        if (req.method !== 'POST') {
            return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405);
        }

        const body = await req.json().catch(() => ({}));
        const action = typeof body?.action === 'string' ? body.action : null;

        // ── report ───────────────────────────────────────────────────────────
        if (action === 'report') {
            const targetType = typeof body?.target_type === 'string' ? body.target_type : '';
            const targetId = typeof body?.target_id === 'string' ? body.target_id : '';
            const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
            if (!REPORT_TARGET_TYPES.has(targetType)) {
                return errorResponse('INVALID_INPUT', 'Invalid target_type', 400);
            }
            if (!UUID_RE.test(targetId)) {
                return errorResponse('INVALID_INPUT', 'Invalid target_id', 400);
            }
            if (!reason || reason.length > 500) {
                return errorResponse('INVALID_INPUT', 'Reason is required (max 500 chars)', 400);
            }
            const { error } = await supabase.from('content_reports').insert({
                reporter_id: user.id,
                target_type: targetType,
                target_id: targetId,
                reason,
            });
            if (error) throw error;
            return jsonResponse({ data: { reported: true } });
        }

        // ── block ────────────────────────────────────────────────────────────
        if (action === 'block') {
            const targetId = typeof body?.user_id === 'string' ? body.user_id : '';
            if (!UUID_RE.test(targetId) || targetId === user.id) {
                return errorResponse('INVALID_INPUT', 'Invalid user_id', 400);
            }
            const { error } = await supabase
                .from('blocked_users')
                .upsert(
                    { blocker_id: user.id, blocked_id: targetId },
                    { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
                );
            if (error) throw error;
            // Sever the follow graph both ways — blocking someone you follow
            // (or who follows you) must not leave a live distribution edge.
            await supabase
                .from('follows')
                .delete()
                .or(
                    `and(follower_id.eq.${user.id},following_id.eq.${targetId}),` +
                    `and(follower_id.eq.${targetId},following_id.eq.${user.id})`,
                );
            return jsonResponse({ data: { blocked: true } });
        }

        // ── unblock ──────────────────────────────────────────────────────────
        if (action === 'unblock') {
            const targetId = typeof body?.user_id === 'string' ? body.user_id : '';
            if (!UUID_RE.test(targetId)) {
                return errorResponse('INVALID_INPUT', 'Invalid user_id', 400);
            }
            const { error } = await supabase
                .from('blocked_users')
                .delete()
                .eq('blocker_id', user.id)
                .eq('blocked_id', targetId);
            if (error) throw error;
            return jsonResponse({ data: { blocked: false } });
        }

        // ── blocked_list ─────────────────────────────────────────────────────
        if (action === 'blocked_list') {
            const { data: rows, error } = await supabase
                .from('blocked_users')
                .select('blocked_id, created_at')
                .eq('blocker_id', user.id)
                .order('created_at', { ascending: false });
            if (error) throw error;
            const ids = (rows ?? []).map((r: { blocked_id: string }) => r.blocked_id);
            let profileById = new Map<string, { display_name: string | null; avatar_url: string | null; username: string | null }>();
            if (ids.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('user_id, display_name, avatar_url, username')
                    .in('user_id', ids);
                profileById = new Map(
                    (profiles ?? []).map((p: any) => [p.user_id, {
                        display_name: p.display_name ?? null,
                        avatar_url: p.avatar_url ?? null,
                        username: p.username ?? null,
                    }]),
                );
            }
            return jsonResponse({
                data: {
                    rows: (rows ?? []).map((r: { blocked_id: string; created_at: string }) => ({
                        user_id: r.blocked_id,
                        created_at: r.created_at,
                        ...(profileById.get(r.blocked_id) ?? {
                            display_name: null, avatar_url: null, username: null,
                        }),
                    })),
                },
            });
        }

        // ── delete ───────────────────────────────────────────────────────────
        if (action === 'delete') {
            // This RPC is the linearization point: it takes the same lifecycle
            // lock as staging/binding, writes the tombstone FIRST, consumes live
            // staging generations, and persists the maximum writer-alive
            // quiesce deadline. Never sleep 730s inside this invocation.
            const result = await requestAccountDeletion({
                freeze: () => freezeAccountDeletion(supabase, user.id),
                advance: (deletion) => advanceAccountDeletion(
                    deletion,
                    createSupabaseDeletionAdapter(supabase, user.id),
                ),
                reportDeferredError: (error, deletion) => {
                    console.error('account deletion deferred after freeze:', error);
                    reportError(error, {
                        fn: 'account',
                        action: 'delete',
                        extra: {
                            phase: 'post_freeze',
                            deletion_state: deletion.state,
                        },
                    });
                },
            });

            return jsonResponse(
                { data: result },
                result.deleted ? 200 : 202,
            );
        }

        return errorResponse('INVALID_INPUT', 'Unknown action', 400);
    } catch (err) {
        console.error('account error:', err);
        reportError(err, { fn: 'account' });
        return errorResponse('INTERNAL', 'Internal server error', 500);
    }
});
