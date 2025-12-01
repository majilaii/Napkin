import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_ANON_KEY') ?? '',
            { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
        );

        const { searchParams } = new URL(req.url);
        const userId = searchParams.get('user_id');
        const restaurantId = searchParams.get('restaurant_id'); // This would be the UUID, not Foursquare ID, unless we handle lookup.
        // Ideally we might want to look up by Foursquare ID too?
        const foursquareId = searchParams.get('foursquare_id');

        console.log('get-reviews called');
        console.log('Params:', { userId, restaurantId, foursquareId });

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
        } else if (foursquareId) {
            // If we only have Foursquare ID, we need to filter on the joined table?
            // Supabase/PostgREST allows filtering on joined tables: restaurant!inner(foursquare_id)
            query = supabaseClient
                .from('reviews')
                .select(`
          *,
          restaurant:restaurants!inner(*)
        `)
                .eq('restaurant.foursquare_id', foursquareId);
        }

        // Order by newest
        query = query.order('created_at', { ascending: false });

        const { data, error } = await query;

        if (error) {
            console.error('get-reviews error:', error);
            throw error;
        }
        console.log('get-reviews success, count:', data?.length);

        return new Response(
            JSON.stringify({ data }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error(error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
