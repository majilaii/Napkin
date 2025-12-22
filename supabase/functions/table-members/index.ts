/**
 * Table Members Edge Function
 * Manage table membership: invite, join, remove, role changes
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
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: authHeader } } }
        );

        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const url = new URL(req.url);
        const pathParts = url.pathname.split('/').filter(Boolean);
        const action = pathParts[pathParts.length - 1];
        const body = req.method !== 'GET' && req.method !== 'DELETE'
            ? await req.json()
            : {};

        // Helper: check if user is admin of a table
        async function isAdmin(tableId: string): Promise<boolean> {
            const { data } = await supabase
                .from('table_members')
                .select('role')
                .eq('table_id', tableId)
                .eq('user_id', user.id)
                .single();
            return data?.role === 'admin';
        }

        // Helper: check if user has a pending invitation
        async function hasPendingInvitation(tableId: string, userId: string): Promise<boolean> {
            const { data } = await supabase
                .from('table_invitations')
                .select('id')
                .eq('table_id', tableId)
                .eq('invited_user_id', userId)
                .eq('status', 'pending')
                .single();
            return !!data;
        }

        // Helper: count admins in a table
        async function countAdmins(tableId: string): Promise<number> {
            const { data } = await supabase
                .from('table_members')
                .select('user_id')
                .eq('table_id', tableId)
                .eq('role', 'admin');
            return data?.length ?? 0;
        }

        // POST /invite - Send an invitation to a user
        if (req.method === 'POST' && action === 'invite') {
            const { table_id, invite_user_id } = body;

            if (!table_id || !invite_user_id) {
                return new Response(
                    JSON.stringify({ error: 'table_id and invite_user_id are required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Check admin permission
            if (!(await isAdmin(table_id))) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can invite members' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Check if user is already a member
            const { data: existingMember } = await supabase
                .from('table_members')
                .select('user_id')
                .eq('table_id', table_id)
                .eq('user_id', invite_user_id)
                .single();

            if (existingMember) {
                return new Response(
                    JSON.stringify({ error: 'User is already a member of this table' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Check if there's already a pending invitation
            const { data: existingInvitation } = await supabase
                .from('table_invitations')
                .select('id')
                .eq('table_id', table_id)
                .eq('invited_user_id', invite_user_id)
                .eq('status', 'pending')
                .single();

            if (existingInvitation) {
                return new Response(
                    JSON.stringify({ error: 'User already has a pending invitation' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Create the invitation
            const { data, error } = await supabase
                .from('table_invitations')
                .insert({
                    table_id,
                    invited_user_id: invite_user_id,
                    invited_by: user.id,
                    status: 'pending'
                })
                .select()
                .single();

            if (error) throw error;

            return new Response(
                JSON.stringify({ data }),
                { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST /join - Join a table (self) - requires valid invitation
        if (req.method === 'POST' && action === 'join') {
            const { table_id, invitation_code } = body;

            if (!table_id) {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Check if user has a pending invitation
            const hasInvitation = await hasPendingInvitation(table_id, user.id);
            if (!hasInvitation) {
                return new Response(
                    JSON.stringify({ error: 'You must be invited to join this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Add the user as a member
            const { data, error } = await supabase
                .from('table_members')
                .insert({ table_id, user_id: user.id, role: 'member' })
                .select()
                .single();

            if (error) throw error;

            // Mark invitation as accepted
            await supabase
                .from('table_invitations')
                .update({ status: 'accepted' })
                .eq('table_id', table_id)
                .eq('invited_user_id', user.id)
                .eq('status', 'pending');

            return new Response(
                JSON.stringify({ data }),
                { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // DELETE /:userId - Remove a member
        if (req.method === 'DELETE') {
            const table_id = url.searchParams.get('table_id');
            const targetUserId = action;

            if (!table_id || !targetUserId) {
                return new Response(
                    JSON.stringify({ error: 'table_id and user_id are required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Allow self-removal or admin removal
            const isSelf = targetUserId === user.id;
            if (!isSelf && !(await isAdmin(table_id))) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can remove other members' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { error } = await supabase
                .from('table_members')
                .delete()
                .eq('table_id', table_id)
                .eq('user_id', targetUserId);

            if (error) throw error;

            return new Response(
                JSON.stringify({ success: true }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // PUT /:userId/role - Change member role
        if (req.method === 'PUT' && pathParts.includes('role')) {
            const targetUserId = pathParts[pathParts.length - 2];
            const { table_id, role } = body;

            if (!table_id || !targetUserId || !role) {
                return new Response(
                    JSON.stringify({ error: 'table_id, user_id, and role are required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            if (!(await isAdmin(table_id))) {
                return new Response(
                    JSON.stringify({ error: 'Only admins can change roles' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Prevent demoting the last admin
            if (role === 'member') {
                // Get the target user's current role
                const { data: targetMember } = await supabase
                    .from('table_members')
                    .select('role')
                    .eq('table_id', table_id)
                    .eq('user_id', targetUserId)
                    .single();

                if (targetMember?.role === 'admin') {
                    const adminCount = await countAdmins(table_id);
                    if (adminCount <= 1) {
                        return new Response(
                            JSON.stringify({ error: 'Cannot demote the last admin. Promote another member to admin first.' }),
                            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }
                }
            }

            const { data, error } = await supabase
                .from('table_members')
                .update({ role })
                .eq('table_id', table_id)
                .eq('user_id', targetUserId)
                .select()
                .single();

            if (error) throw error;

            return new Response(
                JSON.stringify({ data }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ error: 'Invalid action' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('table-members error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
