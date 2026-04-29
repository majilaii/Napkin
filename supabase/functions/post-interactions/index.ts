/**
 * Post Interactions Edge Function
 * Handles reactions and comments on table_nights and entries.
 *
 * POST actions: react, comment, edit_comment, delete_comment
 * GET: ?target_type=X&target_id=Y&scope=table|public  →  { reactions, comments, counts }
 *
 * TICKET-021: scope is REQUIRED on GET and every mutation. Missing/invalid
 * scope returns 400. scope='public' validates entry eligibility via
 * is_entry_publicly_eligible() RPC and rejects ineligible targets with 403.
 *
 * ── DB trigger dependencies (TICKET-037 P2-12) ──────────────────────────────
 * This function relies on the following triggers/functions being in place.
 * Do NOT drop or rename these without updating this function accordingly:
 *
 *   1. set_post_interaction_table_id (function + triggers set_post_reaction_table_id,
 *      set_post_comment_table_id) — defined in 20260418000000_post_interactions.sql,
 *      patched in 20260430010000_public_scope_feed_only_support.sql.
 *      Denorms `table_id` from the parent entry/table_night onto each
 *      post_reaction / post_comment row on INSERT. Tolerates NULL table_id
 *      (feed-only entries) as of the patch migration.
 *
 *   2. sync_counts_on_reaction / sync_counts_on_comment (triggers) + the
 *      sync_post_counts() function — defined in 20260418000000_post_interactions.sql,
 *      extended in 20260430000000_dual_scope_post_interactions.sql.
 *      Maintain reaction_count, comment_count, and top_emojis on both
 *      table_nights and entries after every reaction/comment change.
 *      Branched on scope ('table' vs 'public') as of the dual-scope migration.
 *
 * These triggers fire on the DB side; the edge function does not replicate their
 * logic. If the triggers are removed, counts will drift silently.
 * ─────────────────────────────────────────────────────────────────────────────
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

function isValidScope(v: unknown): v is 'table' | 'public' {
    return v === 'table' || v === 'public';
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
        // TICKET-043: for 'entry' targets, prefer the supplied table_id from the request body.
        // This is the new contract for table-scope reactions/replies on entries.
        //
        // Review-fix: when no table_id is supplied (aggregate feed cards have no Table
        // context), pick the FIRST entry_tables row whose table_id the caller is a
        // member of — instead of always returning entries.table_id (primary). The
        // primary-only fallback breaks B-only viewers of multi-Table entries posted
        // to [A, B] (legacy primary=A): they're not in A, so the membership check
        // fails. Resolving to ANY linked Table the caller belongs to fixes this
        // without leaking other Tables' identities (the picked id is one the caller
        // already knows about).
        async function resolveAndValidateEntryTable(
            entryId: string,
            suppliedTableId: string | undefined
        ): Promise<string | null> {
            if (suppliedTableId) {
                // New contract: validate the supplied table_id is linked via entry_tables.
                const { data: linked } = await supabase
                    .from('entry_tables')
                    .select('table_id')
                    .eq('entry_id', entryId)
                    .eq('table_id', suppliedTableId)
                    .maybeSingle();
                if (linked) return suppliedTableId;
                // Transition-window fallback: accept legacy entries.table_id match.
                const { data: legacy } = await supabase
                    .from('entries')
                    .select('table_id')
                    .eq('id', entryId)
                    .single();
                return legacy?.table_id === suppliedTableId ? suppliedTableId : null;
            }

            // No table_id supplied (aggregate feed). Find any linked Table the
            // caller is a member of. Two-step query because entry_tables has no
            // direct FK to table_members (both relate via tables only, so PostgREST
            // can't infer the embed).
            //   1. Get caller's Table ids via table_members.member_id (NOT user_id).
            //   2. Find an entry_tables row whose table_id is in that set.
            const { data: callerMemberships, error: memErr } = await supabase
                .from('table_members')
                .select('table_id')
                .eq('member_id', user.id);
            if (memErr) throw memErr;
            const callerTableIds = (callerMemberships ?? []).map((m: { table_id: string }) => m.table_id);
            if (callerTableIds.length > 0) {
                const { data: linkedRows, error: linkedErr } = await supabase
                    .from('entry_tables')
                    .select('table_id')
                    .eq('entry_id', entryId)
                    .in('table_id', callerTableIds)
                    .limit(1);
                if (linkedErr) throw linkedErr;
                const firstAllowed = (linkedRows ?? [])[0];
                if (firstAllowed) return (firstAllowed as { table_id: string }).table_id;
            }

            // Last resort: legacy primary (preserves single-Table behaviour).
            const { data: legacy } = await supabase
                .from('entries')
                .select('table_id')
                .eq('id', entryId)
                .single();
            return legacy?.table_id ?? null;
        }

        async function resolveTableId(
            targetType: 'table_night' | 'entry',
            targetId: string,
            suppliedTableId?: string
        ): Promise<string | null> {
            if (targetType === 'table_night') {
                const { data } = await supabase
                    .from('table_nights')
                    .select('table_id')
                    .eq('id', targetId)
                    .single();
                return data?.table_id ?? null;
            } else {
                return resolveAndValidateEntryTable(targetId, suppliedTableId);
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

        // ── Helper: check public eligibility via SQL function ───────────────────
        async function checkPublicEligibility(entryId: string): Promise<boolean> {
            const { data, error } = await supabase
                .rpc('is_entry_publicly_eligible', { p_entry_id: entryId });
            if (error) throw error;
            return !!data;
        }

        // ── Helper: check if entry author allows public replies ─────────────────
        async function checkAllowPublicReplies(entryId: string): Promise<boolean> {
            const { data } = await supabase
                .from('entries')
                .select('user_id')
                .eq('id', entryId)
                .single();
            if (!data) return false;
            const { data: profile } = await supabase
                .from('profiles')
                .select('allow_public_replies')
                .eq('user_id', data.user_id)
                .single();
            return !!profile?.allow_public_replies;
        }

        // ── Helper: read trigger-maintained reaction counts post-mutation ──────
        // After a react insert/delete, the sync_post_counts_and_top_emojis
        // trigger has updated the parent row. Read it back so the client can
        // reconcile counts.reactions + counts.top_emojis exactly without an
        // extra round-trip and without invalidating the postInteractions query.
        // (TICKET-036 P0-5)
        async function readReactionCounts(
            targetType: 'table_night' | 'entry',
            targetId: string,
            scope: 'table' | 'public',
        ): Promise<{ reactions: number; top_emojis: Array<{ emoji: string; count: number; last_reacted_at: string }> }> {
            const table = targetType === 'table_night' ? 'table_nights' : 'entries';
            const countCol = scope === 'public' ? 'public_reaction_count' : 'reaction_count';
            const topCol = scope === 'public' ? 'public_top_emojis' : 'top_emojis';
            const { data } = await supabase
                .from(table)
                .select(`${countCol}, ${topCol}`)
                .eq('id', targetId)
                .maybeSingle();
            const row = (data ?? {}) as Record<string, unknown>;
            return {
                reactions: (row[countCol] as number) ?? 0,
                top_emojis: (row[topCol] as Array<{ emoji: string; count: number; last_reacted_at: string }>) ?? [],
            };
        }

        // ── GET ─────────────────────────────────────────────────────────────────
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const targetType = url.searchParams.get('target_type');
            const targetId   = url.searchParams.get('target_id');
            const scope      = url.searchParams.get('scope');
            // TICKET-043 review-fix: accept table_id from the request so multi-Table
            // entries resolve to the requesting Table instead of legacy primary.
            // Without this, a B-only viewer of [A,B] entry resolves A → 403.
            const suppliedTableId = url.searchParams.get('table_id') ?? undefined;

            if (!isValidTargetType(targetType)) return fail('target_type must be table_night or entry');
            if (!targetId) return fail('target_id is required');
            if (!isValidScope(scope)) return fail('scope must be table or public');

            if (scope === 'public') {
                // Public scope: validate entry type and eligibility
                if (targetType !== 'entry') return fail('scope=public is only valid for entry targets');
                const eligible = await checkPublicEligibility(targetId);
                if (!eligible) return fail('not_public', 403);
            } else {
                // Table scope: validate membership
                const tableId = await resolveTableId(targetType, targetId, suppliedTableId);
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
            }

            // Fetch reactions filtered by scope
            const { data: reactionsRaw, error: reactionsError } = await supabase
                .from('post_reactions')
                .select('id, user_id, emoji, created_at')
                .eq('target_type', targetType)
                .eq('target_id', targetId)
                .eq('scope', scope)
                .order('created_at', { ascending: true });

            if (reactionsError) throw reactionsError;

            // Fetch comments filtered by scope
            const { data: commentsRaw, error: commentsError } = await supabase
                .from('post_comments')
                .select('id, user_id, body, created_at, edited_at')
                .eq('target_type', targetType)
                .eq('target_id', targetId)
                .eq('scope', scope)
                .order('created_at', { ascending: true });

            if (commentsError) throw commentsError;

            // Batch-fetch profiles for all unique user_ids referenced
            const userIds = Array.from(new Set([
                ...(reactionsRaw ?? []).map((r: any) => r.user_id as string),
                ...(commentsRaw  ?? []).map((c: any) => c.user_id as string),
            ]));

            const profileById = new Map<string, { display_name: string; avatar_url: string | null; username?: string | null }>();
            if (userIds.length > 0) {
                const { data: profiles, error: profilesErr } = await supabase
                    .from('profiles')
                    .select('user_id, display_name, avatar_url, username')
                    .in('user_id', userIds);
                if (profilesErr) throw profilesErr;
                for (const p of (profiles ?? []) as any[]) {
                    profileById.set(p.user_id, {
                        display_name: p.display_name,
                        avatar_url: p.avatar_url ?? null,
                        username: p.username ?? null,
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
                const { target_type, target_id, emoji, scope } = body;

                if (!isValidTargetType(target_type)) return fail('target_type must be table_night or entry');
                if (!target_id) return fail('target_id is required');
                if (!isValidEmoji(emoji)) return fail('emoji must be one of: 🔥 😋 ❤️ 💯 👀');
                if (!isValidScope(scope)) return fail('scope must be table or public');

                let insertTableId: string | null = null;

                if (scope === 'public') {
                    if (target_type !== 'entry') return fail('scope=public is only valid for entry targets');
                    const eligible = await checkPublicEligibility(target_id);
                    if (!eligible) return fail('not_public', 403);
                } else {
                    // TICKET-043: pass body.table_id so multi-Table entries route to the correct Table.
                    const tableId = await resolveTableId(target_type, target_id, body.table_id ?? undefined);
                    if (!tableId) return fail('Target not found', 404);
                    if (!(await validateTableMember(tableId))) {
                        return fail('Not a member of this table', 403);
                    }
                    insertTableId = tableId;

                    if (target_type === 'table_night') {
                        const isRevealed = await validateRoundRevealed(target_id);
                        if (!isRevealed) return fail('Reactions are only allowed after reveal', 400);
                    }
                }

                // Toggle: delete if exists, insert if missing
                const { data: existing } = await supabase
                    .from('post_reactions')
                    .select('id')
                    .eq('target_type', target_type)
                    .eq('target_id', target_id)
                    .eq('user_id', user.id)
                    .eq('emoji', emoji)
                    .eq('scope', scope)
                    .maybeSingle();

                if (existing) {
                    await supabase
                        .from('post_reactions')
                        .delete()
                        .eq('id', existing.id);

                    const counts = await readReactionCounts(target_type, target_id, scope);
                    return json({ added: false, removed: true, reaction: null, counts });
                } else {
                    const insertPayload: any = {
                        target_type,
                        target_id,
                        user_id: user.id,
                        emoji,
                        scope,
                    };
                    // table_id is denormalized by trigger for table scope; pass it for public too
                    // (the trigger handles it, but we pass it if known)
                    if (insertTableId) insertPayload.table_id = insertTableId;

                    const { data: reaction, error: insertError } = await supabase
                        .from('post_reactions')
                        .insert(insertPayload)
                        .select()
                        .single();

                    if (insertError) throw insertError;

                    // Hydrate the reactor's profile so the client can render
                    // avatar/name without a follow-up fetch.
                    const { data: reactorProfile } = await supabase
                        .from('profiles')
                        .select('display_name, avatar_url, username')
                        .eq('user_id', user.id)
                        .maybeSingle();

                    const counts = await readReactionCounts(target_type, target_id, scope);
                    return json({
                        added: true,
                        removed: false,
                        reaction: { ...reaction, profiles: reactorProfile ?? null },
                        counts,
                    });
                }
            }

            // ── COMMENT ────────────────────────────────────────────────────────
            if (action === 'comment') {
                const { target_type, target_id, body: commentBody, client_nonce, scope } = body;

                if (!isValidTargetType(target_type)) return fail('target_type must be table_night or entry');
                if (!target_id) return fail('target_id is required');
                if (!commentBody || typeof commentBody !== 'string') return fail('body is required');
                const trimmed = commentBody.trim();
                if (trimmed.length === 0) return fail('body must not be empty');
                if (trimmed.length > 2000) return fail('body must be 2000 characters or fewer');
                if (!isValidScope(scope)) return fail('scope must be table or public');

                let insertTableId: string | null = null;

                if (scope === 'public') {
                    if (target_type !== 'entry') return fail('scope=public is only valid for entry targets');
                    const eligible = await checkPublicEligibility(target_id);
                    if (!eligible) return fail('not_public', 403);
                    const allowReplies = await checkAllowPublicReplies(target_id);
                    if (!allowReplies) return fail('replies_disabled', 403);
                } else {
                    // TICKET-043: pass body.table_id so multi-Table entries route to the correct Table.
                    const tableId = await resolveTableId(target_type, target_id, body.table_id ?? undefined);
                    if (!tableId) return fail('Target not found', 404);
                    if (!(await validateTableMember(tableId))) {
                        return fail('Not a member of this table', 403);
                    }
                    insertTableId = tableId;

                    if (target_type === 'table_night') {
                        const isRevealed = await validateRoundRevealed(target_id);
                        if (!isRevealed) return fail('Comments are only allowed after reveal', 400);
                    }
                }

                const insertPayload: any = {
                    target_type,
                    target_id,
                    user_id: user.id,
                    body: trimmed,
                    scope,
                };
                if (insertTableId) insertPayload.table_id = insertTableId;

                const { data: comment, error: commentError } = await supabase
                    .from('post_comments')
                    .insert(insertPayload)
                    .select('id, user_id, body, created_at, edited_at')
                    .single();

                if (commentError) throw commentError;

                const { data: authorProfile } = await supabase
                    .from('profiles')
                    .select('display_name, avatar_url, username')
                    .eq('user_id', user.id)
                    .maybeSingle();

                return json({
                    ...comment,
                    profiles: authorProfile
                        ? {
                            display_name: authorProfile.display_name,
                            avatar_url: authorProfile.avatar_url ?? null,
                            username: (authorProfile as any).username ?? null,
                          }
                        : null,
                    client_nonce: client_nonce ?? null,
                }, 201);
            }

            // ── EDIT_COMMENT ───────────────────────────────────────────────────
            if (action === 'edit_comment') {
                const { comment_id, body: newBody, scope } = body;

                if (!isValidScope(scope)) return fail('scope must be table or public');

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
                    .select('display_name, avatar_url, username')
                    .eq('user_id', updated.user_id)
                    .maybeSingle();

                return json({
                    ...updated,
                    profiles: authorProfile
                        ? {
                            display_name: authorProfile.display_name,
                            avatar_url: authorProfile.avatar_url ?? null,
                            username: (authorProfile as any).username ?? null,
                          }
                        : null,
                });
            }

            // ── DELETE_COMMENT ─────────────────────────────────────────────────
            if (action === 'delete_comment') {
                const { comment_id, scope } = body;

                if (!isValidScope(scope)) return fail('scope must be table or public');

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
