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
            // Optional filter params
            const filterType = url.searchParams.get('filter_type'); // 'round' | 'solo_share'
            const filterUserId = url.searchParams.get('filter_user_id'); // UUID

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

            // ── Solo entries (skipped when filter_type=round) ──────────────────
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let taggedEntries: any[] = [];

            if (filterType !== 'round') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let soloQuery: any = supabase
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
                        photo_url,
                        reaction_count,
                        comment_count,
                        top_emojis,
                        restaurants (
                            id,
                            name,
                            address,
                            city,
                            photo_url
                        )
                    `)
                    .eq('table_id', tableId)
                    .is('table_night_id', null)
                    .order('visited_at', { ascending: false })
                    .range(offset, offset + limit - 1);

                if (filterUserId) {
                    soloQuery = soloQuery.eq('user_id', filterUserId);
                }

                const { data: soloEntries, error: soloError } = await soloQuery;

                if (soloError) {
                    console.error('Solo entries query error:', soloError);
                    throw soloError;
                }

                // Fetch profile info for each entry's creator
                const userIds = [...new Set((soloEntries ?? []).map((e: { user_id: string }) => e.user_id))];
                const { data: profiles } = userIds.length > 0
                    ? await supabase
                        .from('profiles')
                        .select('user_id, display_name')
                        .in('user_id', userIds)
                    : { data: [] };

                const profileMap = new Map((profiles ?? []).map((p: { user_id: string; display_name: string }) => [p.user_id, p]));
                const entriesWithProfiles = (soloEntries ?? []).map((e: { user_id: string }) => ({
                    ...e,
                    profiles: profileMap.get(e.user_id) ?? { display_name: 'User' },
                }));

                // Fetch entry_participants for all fetched entries
                const entryIds = (soloEntries ?? []).map((e: { id: string }) => e.id);
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

                // Fetch entry_photos counts for all fetched entries
                const { data: entryPhotos } = entryIds.length > 0
                    ? await supabase
                        .from('entry_photos')
                        .select('entry_id')
                        .in('entry_id', entryIds)
                    : { data: [] };

                // Build a count map: entry_id -> number of photos
                const photoCountMap = new Map<string, number>();
                for (const ep of (entryPhotos ?? []) as { entry_id: string }[]) {
                    photoCountMap.set(ep.entry_id, (photoCountMap.get(ep.entry_id) ?? 0) + 1);
                }

                // Group participants by entry_id
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const participantsByEntry = new Map<string, any[]>();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const p of (entryParticipants ?? []) as any[]) {
                    const list = participantsByEntry.get(p.entry_id) ?? [];
                    list.push(p);
                    participantsByEntry.set(p.entry_id, list);
                }

                // Tag entries: solo_share (0-1 participants) or collaborative_entry (2+)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                taggedEntries = (entriesWithProfiles as any[]).map((entry) => {
                    const participants = participantsByEntry.get(entry.id) ?? [];
                    const photoCount = photoCountMap.get(entry.id) ?? 0;
                    if (participants.length > 1) {
                        const ratings = participants
                            .filter((p: { rating: number | null }) => p.rating !== null)
                            .map((p: { rating: number }) => p.rating as number);
                        const average = ratings.length > 0
                            ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
                            : null;
                        return {
                            ...entry,
                            type: 'collaborative_entry' as const,
                            participants,
                            average_rating: average,
                            sort_date: entry.visited_at || entry.created_at,
                            photo_count: photoCount,
                        };
                    }
                    return {
                        ...entry,
                        type: 'solo_share' as const,
                        sort_date: entry.visited_at || entry.created_at,
                        photo_count: photoCount,
                    };
                });
            }

            // ── Table nights (skipped when filter_type=solo_share) ─────────────
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let nightsWithParticipants: any[] = [];

            if (filterType !== 'solo_share') {
                // When filter_user_id is set, restrict to nights where that user is a participant
                let nightIds: string[] | null = null;
                if (filterUserId) {
                    const { data: participantRows } = await supabase
                        .from('table_night_participants')
                        .select('table_night_id')
                        .eq('user_id', filterUserId);
                    nightIds = ((participantRows ?? []) as { table_night_id: string }[])
                        .map((r) => r.table_night_id);
                    if (nightIds.length === 0) {
                        nightIds = ['__none__']; // forces empty result from IN clause
                    }
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let nightsQuery: any = supabase
                    .from('table_nights')
                    .select(`
                        id,
                        restaurant_id,
                        host_user_id,
                        status,
                        created_at,
                        revealed_at,
                        is_async,
                        reaction_count,
                        comment_count,
                        top_emojis,
                        restaurants (
                            id,
                            name,
                            address,
                            city,
                            photo_url
                        )
                    `)
                    .eq('table_id', tableId)
                    .in('status', ['rating', 'revealed', 'closed'])
                    .order('created_at', { ascending: false })
                    .range(offset, offset + limit - 1);

                if (nightIds !== null) {
                    nightsQuery = nightsQuery.in('id', nightIds);
                }

                const { data: tableNights, error: nightsError } = await nightsQuery;

                if (nightsError) throw nightsError;

                // For each table night, fetch participants with ratings
                nightsWithParticipants = await Promise.all(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (tableNights ?? []).map(async (night: any) => {
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
                            .filter((p: { rating: number | null }) => p.rating !== null)
                            .map((p: { rating: number }) => p.rating as number);
                        const average = ratings.length > 0
                            ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
                            : null;

                        return {
                            ...night,
                            participants: participants ?? [],
                            average_rating: average,
                            type: 'table_night' as const,
                            sort_date: night.revealed_at || night.created_at,
                        };
                    })
                );
            }

            // ── Caller's own reactions on fetched items ────────────────────────
            // One query each for entries + nights; merged as `my_reactions: string[]`.
            const entryIdsForReactions = taggedEntries.map((e: { id: string }) => e.id);
            const nightIdsForReactions = nightsWithParticipants.map((n: { id: string }) => n.id);

            const myReactionsByTarget = new Map<string, string[]>();
            const targetKey = (targetType: string, targetId: string) =>
                `${targetType}:${targetId}`;

            if (entryIdsForReactions.length > 0) {
                const { data: myEntryReactions } = await supabase
                    .from('post_reactions')
                    .select('target_id, emoji')
                    .eq('target_type', 'entry')
                    .eq('user_id', user.id)
                    .in('target_id', entryIdsForReactions);
                for (const r of (myEntryReactions ?? []) as { target_id: string; emoji: string }[]) {
                    const k = targetKey('entry', r.target_id);
                    const list = myReactionsByTarget.get(k) ?? [];
                    list.push(r.emoji);
                    myReactionsByTarget.set(k, list);
                }
            }

            if (nightIdsForReactions.length > 0) {
                const { data: myNightReactions } = await supabase
                    .from('post_reactions')
                    .select('target_id, emoji')
                    .eq('target_type', 'table_night')
                    .eq('user_id', user.id)
                    .in('target_id', nightIdsForReactions);
                for (const r of (myNightReactions ?? []) as { target_id: string; emoji: string }[]) {
                    const k = targetKey('table_night', r.target_id);
                    const list = myReactionsByTarget.get(k) ?? [];
                    list.push(r.emoji);
                    myReactionsByTarget.set(k, list);
                }
            }

            // Merge and sort by date
            const allActivity = [
                ...nightsWithParticipants.map((n: { id: string }) => ({
                    ...n,
                    my_reactions: myReactionsByTarget.get(targetKey('table_night', n.id)) ?? [],
                })),
                ...taggedEntries.map((e: { id: string }) => ({
                    ...e,
                    my_reactions: myReactionsByTarget.get(targetKey('entry', e.id)) ?? [],
                })),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ].sort((a: any, b: any) =>
                new Date(b.sort_date).getTime() - new Date(a.sort_date).getTime()
            );

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
