/**
 * Table Night Edge Function
 * Manages real-time group rating sessions at restaurants
 * Actions: start, join, rate, ready, reveal (POST) | status, active (GET)
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

        // Helper: check if user is a member of a table
        async function validateTableMember(tableId: string) {
            const { data } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', tableId)
                .eq('member_id', user!.id)
                .single();
            return !!data;
        }

        // GET requests
        if (req.method === 'GET') {
            const url = new URL(req.url);
            const action = url.searchParams.get('action');

            if (action === 'status') {
                const tableNightId = url.searchParams.get('table_night_id');
                if (!tableNightId) return fail('table_night_id is required');

                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('*')
                    .eq('id', tableNightId)
                    .single();

                if (nightError) throw nightError;

                const { data: participants, error: partError } = await supabase
                    .from('table_night_participants')
                    .select(`
                        user_id,
                        rating,
                        ready,
                        notes,
                        profiles (
                            display_name,
                            avatar_url
                        )
                    `)
                    .eq('table_night_id', tableNightId);

                if (partError) throw partError;

                // Hide ratings if not yet revealed
                const safeParticipants = night.status === 'revealed'
                    ? participants
                    : participants?.map(p => ({ ...p, rating: null }));

                return json({ ...night, participants: safeParticipants });
            }

            if (action === 'active') {
                const tableId = url.searchParams.get('table_id');
                if (!tableId) return fail('table_id is required');

                const { data: night } = await supabase
                    .from('table_nights')
                    .select('*')
                    .eq('table_id', tableId)
                    .eq('status', 'rating')
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                return json(night);
            }

            return fail('Invalid action. Use ?action=status or ?action=active');
        }

        // POST requests
        if (req.method === 'POST') {
            const body = await req.json();
            const { action } = body;

            if (action === 'start') {
                const { table_id, restaurant_id } = body;
                if (!table_id || !restaurant_id) return fail('table_id and restaurant_id are required');

                if (!(await validateTableMember(table_id))) {
                    return fail('You are not a member of this table', 403);
                }

                // Check no active night already exists
                const { data: existing } = await supabase
                    .from('table_nights')
                    .select('id')
                    .eq('table_id', table_id)
                    .eq('status', 'rating')
                    .maybeSingle();

                if (existing) return fail('A Table Night is already active for this table');

                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .insert({
                        table_id,
                        restaurant_id,
                        host_user_id: user.id,
                        status: 'rating',
                    })
                    .select()
                    .single();

                if (nightError) throw nightError;

                // Add host as first participant
                const { error: partError } = await supabase
                    .from('table_night_participants')
                    .insert({
                        table_night_id: night.id,
                        user_id: user.id,
                    });

                if (partError) throw partError;

                return json(night, 201);
            }

            if (action === 'join') {
                const { table_night_id } = body;
                if (!table_night_id) return fail('table_night_id is required');

                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('table_id, status')
                    .eq('id', table_night_id)
                    .single();

                if (nightError) throw nightError;
                if (night.status !== 'rating') return fail('Table Night is not in rating phase');
                if (!(await validateTableMember(night.table_id))) {
                    return fail('You are not a member of this table', 403);
                }

                const { data: participant, error: partError } = await supabase
                    .from('table_night_participants')
                    .upsert(
                        { table_night_id, user_id: user.id },
                        { onConflict: 'table_night_id,user_id' }
                    )
                    .select()
                    .single();

                if (partError) throw partError;

                return json(participant, 201);
            }

            if (action === 'rate') {
                const { table_night_id, rating } = body;
                if (!table_night_id) return fail('table_night_id is required');

                // Validate rating: 0.5 to 5.0 in 0.5 increments
                if (typeof rating !== 'number' || rating < 0.5 || rating > 5.0 || (rating * 2) % 1 !== 0) {
                    return fail('Rating must be 0.5 to 5.0 in 0.5 increments');
                }

                // Validate user is a participant and not already ready
                const { data: participant, error: partError } = await supabase
                    .from('table_night_participants')
                    .select('ready')
                    .eq('table_night_id', table_night_id)
                    .eq('user_id', user.id)
                    .single();

                if (partError) return fail('You are not a participant in this Table Night');
                if (participant.ready) return fail('You have already locked in your rating');

                const { data: updated, error: updateError } = await supabase
                    .from('table_night_participants')
                    .update({ rating })
                    .eq('table_night_id', table_night_id)
                    .eq('user_id', user.id)
                    .select()
                    .single();

                if (updateError) throw updateError;

                return json(updated);
            }

            if (action === 'ready') {
                const { table_night_id } = body;
                if (!table_night_id) return fail('table_night_id is required');

                // Validate user has submitted a rating
                const { data: participant, error: partError } = await supabase
                    .from('table_night_participants')
                    .select('rating')
                    .eq('table_night_id', table_night_id)
                    .eq('user_id', user.id)
                    .single();

                if (partError) return fail('You are not a participant in this Table Night');
                if (participant.rating === null) return fail('You must submit a rating before locking in');

                const { data: updated, error: updateError } = await supabase
                    .from('table_night_participants')
                    .update({ ready: true })
                    .eq('table_night_id', table_night_id)
                    .eq('user_id', user.id)
                    .select()
                    .single();

                if (updateError) throw updateError;

                return json(updated);
            }

            if (action === 'reveal') {
                const { table_night_id } = body;
                if (!table_night_id) return fail('table_night_id is required');

                // Validate requester is host
                const { data: night, error: nightError } = await supabase
                    .from('table_nights')
                    .select('host_user_id, status')
                    .eq('id', table_night_id)
                    .single();

                if (nightError) throw nightError;
                if (night.host_user_id !== user.id) return fail('Only the host can trigger reveal', 403);
                if (night.status !== 'rating') return fail('Table Night is not in rating phase');

                // Validate all participants are ready and minimum 2
                const { data: participants, error: partError } = await supabase
                    .from('table_night_participants')
                    .select('user_id, rating, ready')
                    .eq('table_night_id', table_night_id);

                if (partError) throw partError;
                if (!participants || participants.length < 2) return fail('Need at least 2 participants to reveal');
                if (participants.some(p => !p.ready)) return fail('All participants must be ready before reveal');

                // Update night to revealed
                const { data: revealed, error: revealError } = await supabase
                    .from('table_nights')
                    .update({ status: 'revealed', revealed_at: new Date().toISOString() })
                    .eq('id', table_night_id)
                    .select()
                    .single();

                if (revealError) throw revealError;

                // Return full night data with all ratings
                const { data: fullParticipants, error: fullPartError } = await supabase
                    .from('table_night_participants')
                    .select(`
                        user_id,
                        rating,
                        ready,
                        notes,
                        profiles (
                            display_name,
                            avatar_url
                        )
                    `)
                    .eq('table_night_id', table_night_id);

                if (fullPartError) throw fullPartError;

                return json({ ...revealed, participants: fullParticipants });
            }

            return fail('Invalid action. Use: start, join, rate, ready, reveal');
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('table-night error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
