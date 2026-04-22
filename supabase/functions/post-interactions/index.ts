/**
 * Post Interactions Edge Function
 * Handles reactions and comments on table_nights and entries.
 *
 * POST actions: react, comment, edit_comment, delete_comment
 * GET: ?target_type=X&target_id=Y  →  { reactions, comments, counts }
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const VALID_EMOJIS = ['🔥', '😋', '❤️', '💯', '👀'] as const;
type ValidEmoji = typeof VALID_EMOJIS[number];

function isValidEmoji(v: unknown): v is ValidEmoji {
    return typeof v === 'string' && (VALID_EMOJIS as readonly string[]).includes(v);
}

function isValidTargetType(v: unknown): v is 'table_night' | 'entry' {
    return v === 'table_night' || v === 'entry';
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace('Bearer ', '');
        const supabase = createClient(supabaseUrl ?? '', supabaseServiceKey ?? '');

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const json = (data: unknown, status = 200) =>
            new Response(JSON.stringify({ data }), {
                status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });

        const fail = (error: string, status = 400) =>
            new Response(JSON.stringify({ error }), {
                status,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });

        // ── Helper: validate table membership for a given table_id ──────────────
        async function validateTableMember(tableId: string): Promise<boolean> {
            const { data } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', tableId)
                .eq('member_id', user!.id)
                .single();
            return !!data;
        }

        // ── Helper: resolve table_id from a target ──────────────────────────────
        async function resolveTableId(
            targetType: 'table_night' | 'entry',
            targetId: string
        ): Promise<string | null> {
            if (targetType === 'table_night') {
                const { data } = await supabase
                    .from('table_nights')
                    .select('table_id')
                    .eq('id', targetId)
                    .single();
                return data?.table_id ?? null;
            } else {
                const { data } = await supabase
                    .from('entries')
                    .select('table_id')
                    .eq('id', targetId)
                    .single();
                return data?.table_id ?? null;
            }
        }

        // ── Helper: validate round is revealed (for table_night targets) ────────
        async function validateRoundRevealed(targetId: string): Promise<boolean> {
            const { data } = await supabase
                .from('table_nights')
                .select('status')
                .eq('id', targetId)
                .single();
            return data?.status === 'revealed' || data?.status === 'closed';
        }

        // ── GET ─────────────────────────────────────────────────────────────────
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const targetType = url.searchParams.get('target_type');
            const targetId   = url.searchParams.get('target_id');

            if (!isValidTargetType(targetType)) return fail('target_type must be table_night or entry');
            if (!targetId) return fail('target_id is required');

            // Resolve table_id for membership check
            const tableId = await resolveTableId(targetType, targetId);
            if (!tableId) return fail('Target not found', 404);
            if (!(await validateTableMember(tableId))) {
                return fail('Not a member of this table', 403);
            }

            // If unrevealed round, return empty (no leaked data)
            if (targetType === 'table_night') {
                const isRevealed = await validateRoundRevealed(targetId);
                if (!isRevealed) {
                    return json({
                        reactions: [],
                        comments: [],
                        counts: { reactions: 0, comments: 0, top_emojis: [] },
                    });
                }
            }

            // Fetch reactions (no PostgREST embedding — the FK lives on auth.users,
            // not profiles, so the join can't be auto-resolved)
            const { data: reactionsRaw, error: reactionsError } = await supabase
                .from('post_reactions')
                .select('id, user_id, emoji, created_at')
                .eq('target_type', targetType)
                .eq('target_id', targetId)
                .order('created_at', { ascending: true });

            if (reactionsError) throw reactionsError;

            // Fetch comments
            const { data: commentsRaw, error: commentsError } = await supabase
                .from('post_comments')
                .select('id, user_id, body, created_at, edited_at')
                .eq('target_type', targetType)
                .eq('target_id', targetId)
                .order('created_at', { ascending: true });

            if (commentsError) throw commentsError;

            // Batch-fetch profiles for all unique user_ids referenced
            const userIds = Array.from(new Set([
                ...(reactionsRaw ?? []).map((r: any) => r.user_id as string),
                ...(commentsRaw  ?? []).map((c: any) => c.user_id as string),
            ]));

            const profileById = new Map<string, { display_name: string; avatar_url: string | null }>();
            if (userIds.length > 0) {
                const { data: profiles, error: profilesErr } = await supabase
                    .from('profiles')
                    .select('user_id, display_name, avatar_url')
                    .in('user_id', userIds);
                if (profilesErr) throw profilesErr;
                for (const p of (profiles ?? []) as any[]) {
                    profileById.set(p.user_id, {
                        display_name: p.display_name,
                        avatar_url: p.avatar_url ?? null,
                    });
                }
            }

            const reactionsList = (reactionsRaw ?? []).map((r: any) => ({
                ...r,
                profiles: profileById.get(r.user_id) ?? null,
            }));
            const commentsList = (commentsRaw ?? []).map((c: any) => ({
                ...c,
                profiles: profileById.get(c.user_id) ?? null,
            }));

            // Group reactions by emoji for counts and top_emojis
            const emojiMap = new Map<string, { count: number; last_reacted_at: string }>();
            for (const r of reactionsList) {
                const prev = emojiMap.get(r.emoji);
                if (!prev) {
                    emojiMap.set(r.emoji, { count: 1, last_reacted_at: r.created_at });
                } else {
                    prev.count++;
                    if (r.created_at > prev.last_reacted_at) prev.last_reacted_at = r.created_at;
                }
            }

            const topEmojis = [...emojiMap.entries()]
                .map(([emoji, { count, last_reacted_at }]) => ({ emoji, count, last_reacted_at }))
                .sort((a, b) => b.count - a.count || b.last_reacted_at.localeCompare(a.last_reacted_at));

            return json({
                reactions: reactionsList,
                comments: commentsList,
                counts: {
                    reactions: reactionsList.length,
                    comments: commentsList.length,
                    top_emojis: topEmojis,
                },
            });
        }

        // ── POST ────────────────────────────────────────────────────────────────
        if (req.method === 'POST') {
            const body = await req.json();
            const { action } = body;

            // ── REACT (toggle) ─────────────────────────────────────────────────
            if (action === 'react') {
                const { target_type, target_id, emoji } = body;

                if (!isValidTargetType(target_type)) return fail('target_type must be table_night or entry');
                if (!target_id) return fail('target_id is required');
                if (!isValidEmoji(emoji)) return fail('emoji must be one of: 🔥 😋 ❤️ 💯 👀');

                const tableId = await resolveTableId(target_type, target_id);
                if (!tableId) return fail('Target not found', 404);
                if (!(await validateTableMember(tableId))) {
                    return fail('Not a member of this table', 403);
                }

                if (target_type === 'table_night') {
                    const isRevealed = await validateRoundRevealed(target_id);
                    if (!isRevealed) return fail('Reactions are only allowed after reveal', 400);
                }

                // Toggle: delete if exists, insert if missing
                const { data: existing } = await supabase
                    .from('post_reactions')
                    .select('id')
                    .eq('target_type', target_type)
                    .eq('target_id', target_id)
                    .eq('user_id', user.id)
                    .eq('emoji', emoji)
                    .maybeSingle();

                if (existing) {
                    await supabase
                        .from('post_reactions')
                        .delete()
                        .eq('id', existing.id);

                    return json({ added: false, removed: true, reaction: null });
                } else {
                    const { data: reaction, error: insertError } = await supabase
                        .from('post_reactions')
                        .insert({ target_type, target_id, user_id: user.id, emoji })
                        .select()
                        .single();

                    if (insertError) throw insertError;
                    return json({ added: true, removed: false, reaction });
                }
            }

            // ── COMMENT ────────────────────────────────────────────────────────
            if (action === 'comment') {
                const { target_type, target_id, body: commentBody, client_nonce } = body;

                if (!isValidTargetType(target_type)) return fail('target_type must be table_night or entry');
                if (!target_id) return fail('target_id is required');
                if (!commentBody || typeof commentBody !== 'string') return fail('body is required');
                const trimmed = commentBody.trim();
                if (trimmed.length === 0) return fail('body must not be empty');
                if (trimmed.length > 2000) return fail('body must be 2000 characters or fewer');

                const tableId = await resolveTableId(target_type, target_id);
                if (!tableId) return fail('Target not found', 404);
                if (!(await validateTableMember(tableId))) {
                    return fail('Not a member of this table', 403);
                }

                if (target_type === 'table_night') {
                    const isRevealed = await validateRoundRevealed(target_id);
                    if (!isRevealed) return fail('Comments are only allowed after reveal', 400);
                }

                const { data: comment, error: commentError } = await supabase
                    .from('post_comments')
                    .insert({
                        target_type,
                        target_id,
                        table_id: tableId,
                        user_id: user.id,
                        body: trimmed,
                    })
                    .select('id, user_id, body, created_at, edited_at')
                    .single();

                if (commentError) throw commentError;

                const { data: authorProfile } = await supabase
                    .from('profiles')
                    .select('display_name, avatar_url')
                    .eq('user_id', user.id)
                    .maybeSingle();

                return json({
                    ...comment,
                    profiles: authorProfile
                        ? { display_name: authorProfile.display_name, avatar_url: authorProfile.avatar_url ?? null }
                        : null,
                    client_nonce: client_nonce ?? null,
                }, 201);
            }

            // ── EDIT_COMMENT ───────────────────────────────────────────────────
            if (action === 'edit_comment') {
                const { comment_id, body: newBody } = body;

                if (!comment_id) return fail('comment_id is required');
                if (!newBody || typeof newBody !== 'string') return fail('body is required');
                const trimmed = newBody.trim();
                if (trimmed.length === 0) return fail('body must not be empty');
                if (trimmed.length > 2000) return fail('body must be 2000 characters or fewer');

                const { data: existing, error: fetchError } = await supabase
                    .from('post_comments')
                    .select('id, user_id, created_at')
                    .eq('id', comment_id)
                    .single();

                if (fetchError || !existing) return fail('Comment not found', 404);
                if (existing.user_id !== user.id) return fail('Not the author of this comment', 403);

                const ageMs = Date.now() - new Date(existing.created_at).getTime();
                if (ageMs > 5 * 60 * 1000) {
                    return fail('Edit window has expired (5 minutes)', 403);
                }

                const { data: updated, error: updateError } = await supabase
                    .from('post_comments')
                    .update({ body: trimmed, edited_at: new Date().toISOString() })
                    .eq('id', comment_id)
                    .select('id, user_id, body, created_at, edited_at')
                    .single();

                if (updateError) throw updateError;

                const { data: authorProfile } = await supabase
                    .from('profiles')
                    .select('display_name, avatar_url')
                    .eq('user_id', updated.user_id)
                    .maybeSingle();

                return json({
                    ...updated,
                    profiles: authorProfile
                        ? { display_name: authorProfile.display_name, avatar_url: authorProfile.avatar_url ?? null }
                        : null,
                });
            }

            // ── DELETE_COMMENT ─────────────────────────────────────────────────
            if (action === 'delete_comment') {
                const { comment_id } = body;

                if (!comment_id) return fail('comment_id is required');

                const { data: existing, error: fetchError } = await supabase
                    .from('post_comments')
                    .select('id, user_id')
                    .eq('id', comment_id)
                    .single();

                if (fetchError || !existing) return fail('Comment not found', 404);
                if (existing.user_id !== user.id) return fail('Not the author of this comment', 403);

                const { error: deleteError } = await supabase
                    .from('post_comments')
                    .delete()
                    .eq('id', comment_id);

                if (deleteError) throw deleteError;
                return json({ id: comment_id });
            }

            return fail('Invalid action. Use: react, comment, edit_comment, delete_comment');
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('post-interactions error:', error);
        const message = error instanceof Error ? error.message : JSON.stringify(error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: message }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
