/**
 * Table Management Edge Function
 * CRUD operations for Tables (supper club groups)
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

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

        // Use service role key to bypass RLS - we validate auth manually via getUser
        const supabase = createClient(
            supabaseUrl ?? '',
            supabaseServiceKey ?? ''
        );

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const url = new URL(req.url);
        const action = url.searchParams.get('action');
        const tableId = url.pathname.split('/').pop();

        // GET ?action=last_seen&table_id=X — return the caller's last_seen_at for a table
        if (req.method === 'GET' && action === 'last_seen') {
            const targetTableId = url.searchParams.get('table_id');
            if (!targetTableId) {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { data: membership, error: memberError } = await supabase
                .from('table_members')
                .select('last_seen_at')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .single();

            if (memberError) {
                // Not a member of this table
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(
                JSON.stringify({ data: { last_seen_at: membership.last_seen_at ?? null } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=mark_seen — write last_seen_at = now() for caller in a table
        if (req.method === 'POST' && action === 'mark_seen') {
            const body = await req.json();
            const { table_id: targetTableId } = body;

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Verify membership before writing
            const { data: membership, error: memberCheckError } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .single();

            if (memberCheckError || !membership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { data: updated, error: updateError } = await supabase
                .from('table_members')
                .update({ last_seen_at: new Date().toISOString() })
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .select('last_seen_at')
                .single();

            if (updateError) throw updateError;

            return new Response(
                JSON.stringify({ data: { last_seen_at: updated.last_seen_at } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // GET - List user's tables
        // By default, personal tables are excluded so the Tables tab only shows
        // social Tables. Pass ?include_personal=true to include them (used by
        // TICKET-015/016 to surface the user's diary/personal Table).
        if (req.method === 'GET' && (!tableId || tableId === 'table-management')) {
            const includePersonal = url.searchParams.get('include_personal') === 'true';

            let query = supabase
                .from('table_members')
                .select(`
                    role,
                    joined_at,
                    tables (
                        id,
                        name,
                        avatar_url,
                        owner_id,
                        is_personal,
                        created_at,
                        updated_at
                    )
                `)
                .eq('member_id', user.id)
                .order('joined_at', { ascending: false });

            if (!includePersonal) {
                query = query.eq('tables.is_personal', false);
            }

            const { data, error } = await query;

            if (error) throw error;

            // When filtering personal tables via PostgREST column filter, rows where
            // the joined table doesn't match come back with tables = null. Strip them.
            const filtered = includePersonal
                ? data
                : (data ?? []).filter((row: any) => row.tables !== null);

            return new Response(
                JSON.stringify({ data: filtered }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // GET /:id - Get single table with members
        if (req.method === 'GET' && tableId && tableId !== 'table-management') {
            const { data: table, error: tableError } = await supabase
                .from('tables')
                .select('*')
                .eq('id', tableId)
                .single();

            if (tableError) throw tableError;

            const { data: members, error: membersError } = await supabase
                .from('table_members')
                .select(`
                    member_id,
                    role,
                    joined_at,
                    welcomed_at,
                    profiles (
                        display_name,
                        avatar_url
                    )
                `)
                .eq('table_id', tableId);

            if (membersError) throw membersError;

            // Surface the caller's own welcomed_at so the client can show/hide the banner
            const callerMembership = (members ?? []).find((m: any) => m.member_id === user.id);
            const callerWelcomedAt = callerMembership?.welcomed_at ?? null;
            const callerRole = callerMembership?.role ?? null;

            return new Response(
                JSON.stringify({ data: { ...table, members, caller_welcomed_at: callerWelcomedAt, caller_role: callerRole } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=add_member — add a mutual-follow to the table (owner only)
        if (req.method === 'POST' && action === 'add_member') {
            const body = await req.json();
            const { table_id: targetTableId, target_user_id } = body;

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
            if (!target_user_id || typeof target_user_id !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'target_user_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 1. Verify caller is the table owner
            const { data: table, error: tableErr } = await supabase
                .from('tables')
                .select('owner_id')
                .eq('id', targetTableId)
                .maybeSingle();

            if (tableErr) throw tableErr;
            if (!table) {
                return new Response(
                    JSON.stringify({ error: 'Table not found' }),
                    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
            if (table.owner_id !== user.id) {
                return new Response(
                    JSON.stringify({ error: 'Only the table owner can add members', error_code: 'NOT_OWNER' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 2. Verify target user exists
            const { data: targetProfile, error: profileErr } = await supabase
                .from('profiles')
                .select('user_id')
                .eq('user_id', target_user_id)
                .maybeSingle();

            if (profileErr) throw profileErr;
            if (!targetProfile) {
                return new Response(
                    JSON.stringify({ error: 'User not found' }),
                    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 3. Verify mutual follow: caller→target AND target→caller must both exist
            const [{ data: callerFollowsTarget }, { data: targetFollowsCaller }] = await Promise.all([
                supabase
                    .from('follows')
                    .select('follower_id')
                    .eq('follower_id', user.id)
                    .eq('following_id', target_user_id)
                    .maybeSingle(),
                supabase
                    .from('follows')
                    .select('follower_id')
                    .eq('follower_id', target_user_id)
                    .eq('following_id', user.id)
                    .maybeSingle(),
            ]);

            if (!callerFollowsTarget || !targetFollowsCaller) {
                return new Response(
                    JSON.stringify({
                        error: 'Mutual follow required to add a member',
                        error_code: 'NOT_MUTUAL_FOLLOW',
                    }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 4. Idempotent upsert — welcomed_at stays NULL so the banner fires on first view
            const { data: existing, error: existErr } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId)
                .eq('member_id', target_user_id)
                .maybeSingle();

            if (existErr) throw existErr;

            if (existing) {
                return new Response(
                    JSON.stringify({ data: { member_id: target_user_id, already_member: true } }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { error: insertErr } = await supabase
                .from('table_members')
                .insert({ table_id: targetTableId, member_id: target_user_id, role: 'member' });

            if (insertErr) throw insertErr;

            return new Response(
                JSON.stringify({ data: { member_id: target_user_id, already_member: false } }),
                { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=mark_welcomed — dismiss the "added to table" banner for the caller
        if (req.method === 'POST' && action === 'mark_welcomed') {
            const body = await req.json();
            const { table_id: targetTableId } = body;

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Verify membership
            const { data: membership, error: memberCheckError } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .maybeSingle();

            if (memberCheckError || !membership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { error: updateError } = await supabase
                .from('table_members')
                .update({ welcomed_at: new Date().toISOString() })
                .eq('table_id', targetTableId)
                .eq('member_id', user.id);

            if (updateError) throw updateError;

            return new Response(
                JSON.stringify({ data: { welcomed_at: new Date().toISOString() } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=leave_table — non-owner member leaves the table
        if (req.method === 'POST' && action === 'leave_table') {
            const body = await req.json();
            const { table_id: targetTableId } = body;

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Verify membership and role
            const { data: membership, error: memberCheckError } = await supabase
                .from('table_members')
                .select('member_id, role')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .maybeSingle();

            if (memberCheckError || !membership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            if (membership.role === 'admin') {
                return new Response(
                    JSON.stringify({
                        error: 'Table owners cannot leave their own table. Transfer ownership first.',
                        error_code: 'OWNER_CANNOT_LEAVE',
                    }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { error: deleteError } = await supabase
                .from('table_members')
                .delete()
                .eq('table_id', targetTableId)
                .eq('member_id', user.id);

            if (deleteError) throw deleteError;

            return new Response(
                JSON.stringify({ data: { left: true } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST - Create table
        if (req.method === 'POST') {
            const body = await req.json();
            const { name, avatar_url } = body;

            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return new Response(
                    JSON.stringify({ error: 'Name is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Create the table
            const { data: newTable, error: createError } = await supabase
                .from('tables')
                .insert({ name: name.trim(), avatar_url, owner_id: user.id })
                .select()
                .single();

            if (createError) throw createError;

            // Add creator as admin member
            const { error: memberError } = await supabase
                .from('table_members')
                .insert({ table_id: newTable.id, member_id: user.id, role: 'admin' });

            if (memberError) throw memberError;

            return new Response(
                JSON.stringify({ data: newTable }),
                { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // PUT /:id - Update table
        if (req.method === 'PUT' && tableId) {
            const body = await req.json();
            const { name, avatar_url } = body;

            const { data, error } = await supabase
                .from('tables')
                .update({ name, avatar_url, updated_at: new Date().toISOString() })
                .eq('id', tableId)
                .select()
                .single();

            if (error) throw error;

            return new Response(
                JSON.stringify({ data }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // DELETE /:id - Delete table
        if (req.method === 'DELETE' && tableId) {
            const { error } = await supabase
                .from('tables')
                .delete()
                .eq('id', tableId);

            if (error) throw error;

            return new Response(
                JSON.stringify({ success: true }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('table-management error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
