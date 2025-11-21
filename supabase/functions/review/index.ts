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

        const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (req.method === 'POST') {
            const body = await req.json();
            const { restaurant, rating, content, value_profile } = body;

            if (!restaurant || !restaurant.foursquare_id || typeof rating !== 'number') {
                return new Response(
                    JSON.stringify({ error: 'Invalid payload: missing restaurant or rating' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 1. Upsert Restaurant
            const { data: restaurantData, error: restaurantError } = await supabaseClient
                .from('restaurants')
                .upsert({
                    foursquare_id: restaurant.foursquare_id,
                    name: restaurant.name,
                    address: restaurant.location?.address,
                    city: restaurant.location?.locality,
                    country: restaurant.location?.country,
                    lat: restaurant.latitude,
                    lng: restaurant.longitude,
                }, { onConflict: 'foursquare_id' })
                .select('id')
                .single();

            if (restaurantError) {
                console.error('Restaurant upsert error:', restaurantError);
                throw restaurantError;
            }

            const restaurantId = restaurantData.id;

            // 2. Upsert Review
            const { data: existingReview } = await supabaseClient
                .from('reviews')
                .select('id')
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurantId)
                .maybeSingle();

            let reviewResult;
            if (existingReview) {
                reviewResult = await supabaseClient
                    .from('reviews')
                    .update({
                        rating,
                        content,
                        value_profile: value_profile || {},
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', existingReview.id)
                    .select()
                    .single();
            } else {
                reviewResult = await supabaseClient
                    .from('reviews')
                    .insert({
                        user_id: user.id,
                        restaurant_id: restaurantId,
                        rating,
                        content,
                        value_profile: value_profile || {},
                    })
                    .select()
                    .single();
            }

            if (reviewResult.error) throw reviewResult.error;

            return new Response(
                JSON.stringify({ data: reviewResult.data }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error(error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
