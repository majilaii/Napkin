/**
 * Table Activity Edge Function — TICKET-035 rewrite
 *
 * Replaced split-offset merge with fn_table_activity_page RPC (inline UNION
 * in SQL, keyset-paginated). Switched from GET to POST so the cursor rides in
 * the body. Returns the canonical { rows, next_cursor, has_more } envelope.
 *
 * Request: POST { table_id, cursor?, filter_type?, filter_user_id? }
 * Response: { data: { rows: ActivityItem[], next_cursor, has_more } }
 *
 * Each row in `rows` is a hydrated ActivityItem (solo_share | collaborative_entry
 * | table_night) with profile, participants, companions, photos, and reactions.
 *
 * Companion-widening: folded into fn_table_activity_page SQL — an entry appears
 * when the caller (p_caller_id) is its author OR a companion, independent of
 * p_filter_user_id. Preserves the old "companion-tagged entries surface in feed"
 * behaviour exactly.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { buildPage, decodeCursor } from '../_shared/pagination.ts';

const PAGE_SIZE = 20;

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

        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ error: 'Method not allowed' }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const body = await req.json();
        const {
            table_id: tableId,
            cursor,
            filter_type: filterType,
            filter_user_id: filterUserId,
        } = body as {
            table_id?: string;
            cursor?: string | null;
            filter_type?: string | null;
            filter_user_id?: string | null;
        };

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

        // Decode cursor for RPC
        const decoded = decodeCursor(cursor ?? null);

        // ── Call fn_table_activity_page RPC ───────────────────────────────────
        const { data: rpcRows, error: rpcErr } = await supabase.rpc('fn_table_activity_page', {
            p_table_id: tableId,
            p_caller_id: user.id,
            p_cursor_date: decoded?.sort_date ?? null,
            p_cursor_id: decoded?.id ?? null,
            p_limit: PAGE_SIZE + 1,
            p_filter_type: filterType ?? null,
            p_filter_user_id: filterUserId ?? null,
        });

        if (rpcErr) {
            console.error('fn_table_activity_page error:', rpcErr);
            throw rpcErr;
        }

        const pageRows = (rpcRows ?? []) as {
            kind: string;
            id: string;
            sort_date: string;
            payload: Record<string, unknown>;
        }[];

        // Build page envelope first (pageRows may have PAGE_SIZE + 1 rows)
        // We need to hydrate only the kept rows
        const has_more = pageRows.length > PAGE_SIZE;
        const keptRpc = has_more ? pageRows.slice(0, PAGE_SIZE) : pageRows;

        // ── Collect IDs for hydration ──────────────────────────────────────────
        const entryRpcRows = keptRpc.filter((r) => r.kind === 'entry');
        const nightRpcRows = keptRpc.filter((r) => r.kind === 'table_night');
        const tt4RpcRows = keptRpc.filter((r) => r.kind === 'top_4_edited');

        const entryIds = entryRpcRows.map((r) => r.id);
        const nightIds = nightRpcRows.map((r) => r.id);
        const tt4Ids = tt4RpcRows.map((r) => r.id);

        // ── Hydrate: solo entries ─────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let taggedEntries: any[] = [];

        if (entryIds.length > 0) {
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
                .in('id', entryIds);

            if (soloError) throw soloError;

            const allSoloEntries = (soloEntries ?? []) as any[];

            // Profiles
            const userIds = [...new Set(allSoloEntries.map((e: { user_id: string }) => e.user_id))];
            const { data: profiles } = userIds.length > 0
                ? await supabase
                    .from('profiles')
                    .select('user_id, display_name')
                    .in('user_id', userIds)
                : { data: [] };

            const profileMap = new Map((profiles ?? []).map((p: { user_id: string; display_name: string }) => [p.user_id, p]));
            const entriesWithProfiles = allSoloEntries.map((e: { user_id: string }) => ({
                ...e,
                profiles: profileMap.get(e.user_id) ?? { display_name: 'User' },
            }));

            // Entry participants
            const { data: entryParticipants } = await supabase
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
                .in('entry_id', entryIds);

            // Entry photos
            const { data: entryPhotos } = await supabase
                .from('entry_photos')
                .select('entry_id')
                .in('entry_id', entryIds);

            const photoCountMap = new Map<string, number>();
            for (const ep of (entryPhotos ?? []) as { entry_id: string }[]) {
                photoCountMap.set(ep.entry_id, (photoCountMap.get(ep.entry_id) ?? 0) + 1);
            }

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const participantsByEntry = new Map<string, any[]>();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const p of (entryParticipants ?? []) as any[]) {
                const list = participantsByEntry.get(p.entry_id) ?? [];
                list.push(p);
                participantsByEntry.set(p.entry_id, list);
            }

            // Entry companions
            const { data: entryCompanions } = await supabase
                .from('entry_companions')
                .select(`
                    entry_id,
                    user_id,
                    profiles:user_id (
                        display_name
                    )
                `)
                .in('entry_id', entryIds);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const companionsByEntry = new Map<string, any[]>();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            for (const c of (entryCompanions ?? []) as any[]) {
                const list = companionsByEntry.get(c.entry_id) ?? [];
                const profileNode = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
                list.push({
                    user_id: c.user_id,
                    display_name: profileNode?.display_name ?? 'User',
                });
                companionsByEntry.set(c.entry_id, list);
            }

            // Build sort_date lookup from RPC rows
            const sortDateByEntryId = new Map(entryRpcRows.map((r) => [r.id, r.sort_date]));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            taggedEntries = (entriesWithProfiles as any[]).map((entry) => {
                const participants = participantsByEntry.get(entry.id) ?? [];
                const companions = companionsByEntry.get(entry.id) ?? [];
                const photoCount = photoCountMap.get(entry.id) ?? 0;
                const sort_date = sortDateByEntryId.get(entry.id) ?? entry.visited_at ?? entry.created_at;

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
                        companions,
                        average_rating: average,
                        sort_date,
                        photo_count: photoCount,
                    };
                }
                return {
                    ...entry,
                    type: 'solo_share' as const,
                    companions,
                    sort_date,
                    photo_count: photoCount,
                };
            });
        }

        // ── Hydrate: table nights ─────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let nightsWithParticipants: any[] = [];

        if (nightIds.length > 0) {
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
                .in('id', nightIds);

            if (nightsError) throw nightsError;

            // Build sort_date lookup from RPC rows
            const sortDateByNightId = new Map(nightRpcRows.map((r) => [r.id, r.sort_date]));

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
                        sort_date: sortDateByNightId.get(night.id) ?? night.revealed_at ?? night.created_at,
                    };
                })
            );
        }

        // ── Hydrate: top_4_edited events ─────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let tt4Events: any[] = [];

        if (tt4Ids.length > 0) {
            const { data: histRows, error: histError } = await supabase
                .from('table_top_4_history')
                .select(`
                    id,
                    table_id,
                    position,
                    actor_id,
                    event_type,
                    prev_restaurant_id,
                    next_restaurant_id,
                    created_at
                `)
                .in('id', tt4Ids);

            if (histError) throw histError;

            // Hydrate actor profiles
            const tt4ActorIds = [...new Set((histRows ?? []).map((h: any) => h.actor_id as string))];
            const tt4ProfileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
            if (tt4ActorIds.length > 0) {
                const { data: tt4Profiles } = await supabase
                    .from('profiles')
                    .select('user_id, display_name, avatar_url')
                    .in('user_id', tt4ActorIds);
                for (const p of (tt4Profiles ?? []) as any[]) {
                    tt4ProfileMap.set(p.user_id, { display_name: p.display_name, avatar_url: p.avatar_url });
                }
            }

            // Hydrate restaurant names
            const tt4RestaurantIds = [
                ...(histRows ?? []).map((h: any) => h.prev_restaurant_id).filter(Boolean),
                ...(histRows ?? []).map((h: any) => h.next_restaurant_id).filter(Boolean),
            ] as string[];
            const tt4RestaurantMap = new Map<string, string>();
            if (tt4RestaurantIds.length > 0) {
                const { data: tt4Restaurants } = await supabase
                    .from('restaurants')
                    .select('id, name')
                    .in('id', [...new Set(tt4RestaurantIds)]);
                for (const r of (tt4Restaurants ?? []) as { id: string; name: string }[]) {
                    tt4RestaurantMap.set(r.id, r.name);
                }
            }

            const sortDateByTt4Id = new Map(tt4RpcRows.map((r) => [r.id, r.sort_date]));

            tt4Events = (histRows ?? []).map((h: any) => {
                const actor = tt4ProfileMap.get(h.actor_id);
                return {
                    id: h.id,
                    type: 'top_4_edited' as const,
                    table_id: h.table_id,
                    position: h.position,
                    actor_id: h.actor_id,
                    actor_name: actor?.display_name ?? null,
                    actor_avatar_url: actor?.avatar_url ?? null,
                    event_type: h.event_type,
                    prev_restaurant: h.prev_restaurant_id
                        ? { id: h.prev_restaurant_id, name: tt4RestaurantMap.get(h.prev_restaurant_id) ?? null }
                        : null,
                    next_restaurant: h.next_restaurant_id
                        ? { id: h.next_restaurant_id, name: tt4RestaurantMap.get(h.next_restaurant_id) ?? null }
                        : null,
                    created_at: h.created_at,
                    sort_date: sortDateByTt4Id.get(h.id) ?? h.created_at,
                };
            });
        }

        // ── Reactions ────────────────────────────────────────────────────────
        const myReactionsByTarget = new Map<string, string[]>();
        const targetKey = (targetType: string, targetId: string) => `${targetType}:${targetId}`;

        if (entryIds.length > 0) {
            const { data: myEntryReactions } = await supabase
                .from('post_reactions')
                .select('target_id, emoji')
                .eq('target_type', 'entry')
                .eq('user_id', user.id)
                .eq('scope', 'table')
                .in('target_id', entryIds);
            for (const r of (myEntryReactions ?? []) as { target_id: string; emoji: string }[]) {
                const k = targetKey('entry', r.target_id);
                const list = myReactionsByTarget.get(k) ?? [];
                list.push(r.emoji);
                myReactionsByTarget.set(k, list);
            }
        }

        if (nightIds.length > 0) {
            const { data: myNightReactions } = await supabase
                .from('post_reactions')
                .select('target_id, emoji')
                .eq('target_type', 'table_night')
                .eq('user_id', user.id)
                .eq('scope', 'table')
                .in('target_id', nightIds);
            for (const r of (myNightReactions ?? []) as { target_id: string; emoji: string }[]) {
                const k = targetKey('table_night', r.target_id);
                const list = myReactionsByTarget.get(k) ?? [];
                list.push(r.emoji);
                myReactionsByTarget.set(k, list);
            }
        }

        // ── Merge in RPC order (sort_date DESC already from fn_table_activity_page) ──
        const entryById = new Map(taggedEntries.map((e: { id: string }) => [e.id, e]));
        const nightById = new Map(nightsWithParticipants.map((n: { id: string }) => [n.id, n]));
        const tt4ById = new Map(tt4Events.map((t: { id: string }) => [t.id, t]));

        const orderedItems = keptRpc
            .map((rpcRow) => {
                let item: any;
                let tk: string | null = null;
                if (rpcRow.kind === 'entry') {
                    item = entryById.get(rpcRow.id);
                    tk = targetKey('entry', rpcRow.id);
                } else if (rpcRow.kind === 'table_night') {
                    item = nightById.get(rpcRow.id);
                    tk = targetKey('table_night', rpcRow.id);
                } else if (rpcRow.kind === 'top_4_edited') {
                    item = tt4ById.get(rpcRow.id);
                    // top_4_edited events don't have reactions in v1
                }
                if (!item) return null;
                return {
                    ...item,
                    my_reactions: tk ? (myReactionsByTarget.get(tk) ?? []) : [],
                };
            })
            .filter(Boolean);

        // Build Page envelope from the RPC rows (cursor uses sort_date + id)
        const last = keptRpc[keptRpc.length - 1];
        const next_cursor = has_more && last
            ? buildPage(keptRpc, PAGE_SIZE, (r) => ({ sort_date: r.sort_date, id: r.id })).next_cursor
            : null;

        return new Response(
            JSON.stringify({ data: { rows: orderedItems, next_cursor, has_more } }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
