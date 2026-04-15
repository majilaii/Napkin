/**
 * Table Activity Edge Function
 * Fetches paginated activity feed for a table.
 * Returns three shapes: Table Night cards, solo share cards, and collaborative entry cards.
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

        if (req.method === 'GET') {
            const url = new URL(req.url);
            const tableId = url.searchParams.get('table_id');
            const limit = parseInt(url.searchParams.get('limit') || '20');
            const offset = parseInt(url.searchParams.get('offset') || '0');

            if (!tableId) {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Verify user is a member of this table
            const { data: membership } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', tableId)
                .eq('member_id', user.id)
                .single();

            if (!membership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Fetch entries shared to this table (no table_night_id)
            const { data: soloEntries, error: soloError } = await supabase
                .from('entries')
                .select(`
                    id,
                    user_id,
                    restaurant_id,
                    rating,
                    content,
                    dish_description,
                    visited_at,
                    created_at,
                    table_night_id,
                    restaurants (
                        id,
                        name,
                        address,
                        city
                    )
                `)
                .eq('table_id', tableId)
                .is('table_night_id', null)
                .order('visited_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (soloError) {
                console.error('Solo entries query error:', soloError);
                throw soloError;
            }

            // Fetch profile info for each entry's creator
            const userIds = [...new Set((soloEntries ?? []).map(e => e.user_id))];
            const { data: profiles } = userIds.length > 0
                ? await supabase
                    .from('profiles')
                    .select('user_id, display_name')
                    .in('user_id', userIds)
                : { data: [] };

            const profileMap = new Map((profiles ?? []).map(p => [p.user_id, p]));
            const entriesWithProfiles = (soloEntries ?? []).map(e => ({
                ...e,
                profiles: profileMap.get(e.user_id) ?? { display_name: 'User' },
            }));

            // Fetch entry_participants for all fetched entries
            const entryIds = (soloEntries ?? []).map(e => e.id);
            const { data: entryParticipants } = entryIds.length > 0
                ? await supabase
                    .from('entry_participants')
                    .select(`
                        entry_id,
                        user_id,
                        rating,
                        notes,
                        profiles:user_id (
                            display_name
                        )
                    `)
                    .in('entry_id', entryIds)
                : { data: [] };

            // Group participants by entry_id
            const participantsByEntry = new Map<string, typeof entryParticipants>();
            for (const p of (entryParticipants ?? [])) {
                const list = participantsByEntry.get(p.entry_id) ?? [];
                list.push(p);
                participantsByEntry.set(p.entry_id, list);
            }

            // Tag entries: solo_share (0-1 participants) or collaborative_entry (2+)
            const taggedEntries = entriesWithProfiles.map(entry => {
                const participants = participantsByEntry.get(entry.id) ?? [];
                if (participants.length > 1) {
                    const ratings = participants
                        .filter(p => p.rating !== null)
                        .map(p => p.rating as number);
                    const average = ratings.length > 0
                        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
                        : null;
                    return {
                        ...entry,
                        type: 'collaborative_entry' as const,
                        participants,
                        average_rating: average,
                        sort_date: entry.visited_at || entry.created_at,
                    };
                }
                return {
                    ...entry,
                    type: 'solo_share' as const,
                    sort_date: entry.visited_at || entry.created_at,
                };
            });

            // Fetch table nights for this table (all statuses including active rounds)
            const { data: tableNights, error: nightsError } = await supabase
                .from('table_nights')
                .select(`
                    id,
                    restaurant_id,
                    host_user_id,
                    status,
                    created_at,
                    revealed_at,
                    is_async,
                    restaurants (
                        id,
                        name,
                        address,
                        city
                    )
                `)
                .eq('table_id', tableId)
                .in('status', ['rating', 'revealed', 'closed'])
                .order('created_at', { ascending: false })
                .range(offset, offset + limit - 1);

            if (nightsError) throw nightsError;

            // For each table night, fetch participants with ratings
            const nightsWithParticipants = await Promise.all(
                (tableNights ?? []).map(async (night) => {
                    const { data: participants } = await supabase
                        .from('table_night_participants')
                        .select(`
                            user_id,
                            rating,
                            notes,
                            profiles (
                                display_name
                            )
                        `)
                        .eq('table_night_id', night.id);

                    const ratings = (participants ?? [])
                        .filter(p => p.rating !== null)
                        .map(p => p.rating as number);
                    const average = ratings.length > 0
                        ? ratings.reduce((a, b) => a + b, 0) / ratings.length
                        : null;

                    return {
                        ...night,
                        participants: participants ?? [],
                        average_rating: average,
                        type: 'table_night' as const,
                    };
                })
            );

            // Merge and sort by date
            const allActivity = [
                ...nightsWithParticipants.map(n => ({
                    ...n,
                    sort_date: n.revealed_at || n.created_at,
                })),
                ...taggedEntries,
            ].sort((a, b) => new Date(b.sort_date).getTime() - new Date(a.sort_date).getTime());

            return new Response(
                JSON.stringify({ data: allActivity }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('table-activity error:', error);
        const details = error instanceof Error ? error.message : JSON.stringify(error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
