import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // Debug logging
        const authHeader = req.headers.get('Authorization');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

        console.log('Debug Env:', {
            hasUrl: !!supabaseUrl,
            hasAnonKey: !!supabaseAnonKey,
            urlPrefix: supabaseUrl?.substring(0, 10),
            hasAuthHeader: !!authHeader,
            authHeaderLength: authHeader?.length
        });

        if (!authHeader) {
            console.error('Missing Authorization header');
            return new Response(
                JSON.stringify({ error: 'Missing Authorization header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const token = authHeader.replace('Bearer ', '');

        // Single Supabase Client with User Authentication
        // This client enforces RLS policies - the database handles security
        const supabase = createClient(
            supabaseUrl ?? '',
            supabaseAnonKey ?? '',
            { global: { headers: { Authorization: authHeader } } }
        );

        // Verify User Authentication
        const { data: { user }, error: userError } = await supabase.auth.getUser(token);

        if (userError || !user) {
            console.error('Auth Error Details:', JSON.stringify(userError));
            return new Response(
                JSON.stringify({ error: 'Unauthorized', details: userError }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        if (req.method === 'POST') {
            const body = await req.json();
            console.log('review function called with body:', JSON.stringify(body));
            const { restaurant, rating, content, value_profile } = body;

            if (!restaurant || !restaurant.foursquare_id || typeof rating !== 'number') {
                console.error('Invalid payload:', { restaurant, rating });
                return new Response(
                    JSON.stringify({ error: 'Invalid payload: missing restaurant or rating' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 1. Upsert Restaurant (Protected by RLS)
            console.log('Upserting restaurant:', restaurant.name);
            const { data: restaurantData, error: restaurantError } = await supabase
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
            console.log('Restaurant upserted, ID:', restaurantId);

            // 2. Upsert Review (Protected by RLS)
            const { data: existingReview } = await supabase
                .from('reviews')
                .select('id')
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurantId)
                .maybeSingle();

            let reviewResult;
            if (existingReview) {
                console.log('Updating existing review:', existingReview.id);
                reviewResult = await supabase
                    .from('reviews')
                    .update({
                        rating,
                        content,
                        value_profile: value_profile || {},
                    })
                    .eq('id', existingReview.id)
                    .select()
                    .single();
            } else {
                console.log('Creating new review');
                reviewResult = await supabase
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

            if (reviewResult.error) {
                console.error('Review upsert error:', reviewResult.error);
                throw reviewResult.error;
            }
            console.log('Review saved successfully');

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
