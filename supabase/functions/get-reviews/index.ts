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
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

        console.log('get-reviews: Auth check', {
            hasAuthHeader: !!authHeader,
            authHeaderLength: authHeader?.length
        });

        if (!authHeader) {
            console.error('get-reviews: Missing Authorization header');
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace('Bearer ', '');

        const supabaseClient = createClient(
            supabaseUrl ?? '',
            supabaseAnonKey ?? '',
            { global: { headers: { Authorization: authHeader } } }
        );

        // Verify User Authentication
        const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);

        if (userError || !user) {
            console.error('get-reviews: Auth Error:', JSON.stringify(userError));
            return new Response(
                JSON.stringify({ error: 'Unauthorized', details: userError }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        console.log('get-reviews: User authenticated:', user.id);

        // Parse query params - support both URL params and body
        let userId: string | null = null;
        let restaurantId: string | null = null;
        let externalId: string | null = null;

        // Check URL params first
        const { searchParams } = new URL(req.url);
        userId = searchParams.get('user_id');
        restaurantId = searchParams.get('restaurant_id');
        externalId = searchParams.get('external_id');

        // Also check body for POST-like invocations via supabase.functions.invoke
        if (req.method === 'POST') {
            try {
                const body = await req.json();
                userId = body.user_id ?? userId;
                restaurantId = body.restaurant_id ?? restaurantId;
                externalId = body.external_id ?? externalId;
            } catch {
                // Body parsing failed, use URL params only
            }
        }

        console.log('get-reviews: Params:', { userId, restaurantId, externalId });

        let query = supabaseClient
            .from('reviews')
            .select(`
                *,
                restaurant:restaurants(*)
            `);

        if (userId) {
            query = query.eq('user_id', userId);
        }

        if (restaurantId) {
            query = query.eq('restaurant_id', restaurantId);
        } else if (externalId) {
            query = supabaseClient
                .from('reviews')
                .select(`
                    *,
                    restaurant:restaurants!inner(*)
                `)
                .eq('restaurant.external_id', externalId);
        }

        // Order by newest
        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;

        if (error) {
            console.error('get-reviews: Query error:', error);
            throw error;
        }
        console.log('get-reviews: Success, count:', data?.length);

        return new Response(
            JSON.stringify({ data }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('get-reviews: Error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
