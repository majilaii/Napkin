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

            // Rating can be null (visited but no rating) or a number
            if (!restaurant || !restaurant.foursquare_id) {
                console.error('Invalid payload:', { restaurant, rating });
                return new Response(
                    JSON.stringify({ error: 'Invalid payload: missing restaurant' }),
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

            // 2. Smart Review Logic:
            // - Fast review (rating only, no content): UPSERT — updates existing fast review or creates one
            // - Manual review (has content): INSERT — always creates a new entry
            const ratingValue = (rating === 0 || rating === undefined || rating === null) ? null : rating;
            const visitedAt = body.visited_at ? new Date(body.visited_at).toISOString() : new Date().toISOString();
            const hasContent = content && content.trim().length > 0;

            let reviewResult;

            if (hasContent) {
                // Manual review with content → Always INSERT new entry
                console.log('Creating manual review entry with content');
                reviewResult = await supabase
                    .from('reviews')
                    .insert({
                        user_id: user.id,
                        restaurant_id: restaurantId,
                        rating: ratingValue,
                        content: content.trim(),
                        value_profile: value_profile || {},
                        visited_at: visitedAt,
                    })
                    .select()
                    .single();
            } else {
                // Fast review (rating only) → UPSERT existing fast review
                // Look for existing fast review (one without content)
                const { data: existingFastReview } = await supabase
                    .from('reviews')
                    .select('id')
                    .eq('user_id', user.id)
                    .eq('restaurant_id', restaurantId)
                    .is('content', null)
                    .limit(1)
                    .maybeSingle();

                if (existingFastReview) {
                    // Update existing fast review
                    console.log('Updating existing fast review:', existingFastReview.id);
                    reviewResult = await supabase
                        .from('reviews')
                        .update({
                            rating: ratingValue,
                            visited_at: visitedAt,
                        })
                        .eq('id', existingFastReview.id)
                        .select()
                        .single();
                } else {
                    // Create new fast review
                    console.log('Creating new fast review entry');
                    reviewResult = await supabase
                        .from('reviews')
                        .insert({
                            user_id: user.id,
                            restaurant_id: restaurantId,
                            rating: ratingValue,
                            content: null,
                            value_profile: value_profile || {},
                            visited_at: visitedAt,
                        })
                        .select()
                        .single();
                }
            }

            if (reviewResult.error) {
                console.error('Review operation error:', reviewResult.error);
                throw reviewResult.error;
            }
            console.log('Review operation completed successfully');

            // 3. Upsert user_restaurant_status (mark as "been", optionally "liked")
            const statusPayload: { been: boolean; liked?: boolean; want_to_try?: boolean } = {
                been: true, // If they reviewed it, they've been there
            };

            // If liked is explicitly passed in the body, set it
            if (typeof body.liked === 'boolean') {
                statusPayload.liked = body.liked;
            }

            // If they've been, they probably don't "want to try" anymore
            statusPayload.want_to_try = false;

            console.log('Upserting user_restaurant_status:', statusPayload);
            const { error: statusError } = await supabase
                .from('user_restaurant_status')
                .upsert({
                    user_id: user.id,
                    restaurant_id: restaurantId,
                    ...statusPayload,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'user_id,restaurant_id' });

            if (statusError) {
                // Log but don't fail - status is secondary to the review
                console.error('Status upsert error (non-fatal):', statusError);
            } else {
                console.log('Status updated successfully');
            }

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
