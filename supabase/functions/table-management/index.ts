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
        const tableId = url.pathname.split('/').pop();

        // GET - List user's tables
        if (req.method === 'GET' && (!tableId || tableId === 'table-management')) {
            const { data, error } = await supabase
                .from('table_members')
                .select(`
                    role,
                    joined_at,
                    tables (
                        id,
                        name,
                        avatar_url,
                        created_by,
                        created_at,
                        updated_at
                    )
                `)
                .eq('user_id', user.id)
                .order('joined_at', { ascending: false });

            if (error) throw error;

            return new Response(
                JSON.stringify({ data }),
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
                    user_id,
                    role,
                    joined_at,
                    profiles (
                        display_name,
                        avatar_url
                    )
                `)
                .eq('table_id', tableId);

            if (membersError) throw membersError;

            return new Response(
                JSON.stringify({ data: { ...table, members } }),
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
                .insert({ name: name.trim(), avatar_url, created_by: user.id })
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
