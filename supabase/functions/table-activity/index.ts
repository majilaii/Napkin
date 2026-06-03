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
import { projectRound } from '../_shared/round_projection.ts';

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

        // TICKET-043: required because service-role bypasses RLS.
        // Explicit membership gate: caller must be a member of the requested table.
        // Uses member_id (NOT user_id) per TICKET-034 doctrine.
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
        // TICKET-060 R7: pass p_coalesce_hours (defaulted to 6 in SQL — non-breaking)
        const { data: rpcRows, error: rpcErr } = await supabase.rpc('fn_table_activity_page', {
            p_table_id: tableId,
            p_caller_id: user.id,
            p_cursor_date: decoded?.sort_date ?? null,
            p_cursor_id: decoded?.id ?? null,
            p_limit: PAGE_SIZE + 1,
            p_filter_type: filterType ?? null,
            p_filter_user_id: filterUserId ?? null,
            p_coalesce_hours: 6,   // R7: explicit, matches the DEFAULT 6 in fn_table_activity_page
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
        // TICKET-060: new share/float kinds
        const shareRpcRows = keptRpc.filter((r) => r.kind === 'shared_save' || r.kind === 'share_digest');
        const floatRpcRows = keptRpc.filter((r) => r.kind === 'restaurant_float');

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

                // TICKET-043: scrub response — member-facing payloads MUST:
                //   1. Never include table_ids[] (would leak other Tables).
                //   2. Set table_id to the REQUESTED tableId, not entries.table_id (the primary).
                //      Without this, a B-only viewer seeing an entry whose primary is A would
                //      receive table_id = A — leaking the existence of Table A.
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { table_id: _drop_table_id, table_ids: _drop_table_ids, ...entryWithoutTableId } = entry as any;

                if (participants.length > 1) {
                    const ratings = participants
                        .filter((p: { rating: number | null }) => p.rating !== null)
                        .map((p: { rating: number }) => p.rating as number);
                    const average = ratings.length > 0
                        ? ratings.reduce((a: number, b: number) => a + b, 0) / ratings.length
                        : null;
                    return {
                        ...entryWithoutTableId,
                        table_id: tableId,  // always the REQUESTED Table's id
                        type: 'collaborative_entry' as const,
                        participants,
                        companions,
                        average_rating: average,
                        sort_date,
                        photo_count: photoCount,
                    };
                }
                return {
                    ...entryWithoutTableId,
                    table_id: tableId,  // always the REQUESTED Table's id
                    type: 'solo_share' as const,
                    companions,
                    sort_date,
                    photo_count: photoCount,
                };
            });
        }

        // ── Hydrate: table nights (live AND merged) ───────────────────────────
        // TICKET-044: Use projectRound helper which branches on round_kind.
        // round_kind is extracted from the RPC payload (table_nights.kind column,
        // included in to_jsonb(n) by fn_table_activity_page).
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
                    kind,
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
                    // TICKET-044: use shared projectRound helper; branches on kind.
                    const roundKind: 'live' | 'merged' = night.kind === 'merged' ? 'merged' : 'live';
                    const { participants, average_rating } = await projectRound(
                        night.id,
                        roundKind,
                        supabase,
                    );

                    return {
                        ...night,
                        participants,
                        average_rating,
                        // round_kind is the subtype discriminator (TICKET-044).
                        // Top-level `kind` already discriminates row type ('table_night' | 'entry').
                        // Do NOT reuse `kind` for the subtype — that collides.
                        round_kind: roundKind,
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

        // ── TICKET-060: Hydrate shared_save / share_digest items ────────────────
        let sharedSaveItems: any[] = [];

        if (shareRpcRows.length > 0) {
            const allShareIds: string[] = [];
            for (const row of shareRpcRows) {
                const payload = row.payload as any;
                const childIds: string[] = payload?.child_ids ?? [];
                allShareIds.push(...childIds);
            }
            const deduped = [...new Set(allShareIds)];

            if (deduped.length > 0) {
                const { data: shareRows } = await supabase
                    .from('table_shares')
                    .select('id, job_id, table_id, author_id, restaurant_id, note, source, extraction_status, reaction_count, top_emojis, created_at')
                    .in('id', deduped);

                const shareAuthorIds = [...new Set((shareRows ?? []).map((s: any) => s.author_id as string))];
                const shareAuthorMap = new Map<string, any>();
                if (shareAuthorIds.length > 0) {
                    const { data: shareAuthors } = await supabase
                        .from('profiles').select('user_id, display_name, avatar_url')
                        .in('user_id', shareAuthorIds);
                    for (const p of (shareAuthors ?? []) as any[]) shareAuthorMap.set(p.user_id, p);
                }

                const shareRestaurantIds = [...new Set((shareRows ?? []).filter((s: any) => s.restaurant_id).map((s: any) => s.restaurant_id as string))];
                const shareRestaurantMap = new Map<string, any>();
                if (shareRestaurantIds.length > 0) {
                    const { data: shareRestaurants } = await supabase
                        .from('restaurants').select('id, name, city, cuisine, photo_url, verification')
                        .in('id', shareRestaurantIds).eq('verification', 'verified');
                    for (const r of (shareRestaurants ?? []) as any[]) shareRestaurantMap.set(r.id, r);
                }

                const shareRowById = new Map((shareRows ?? []).map((s: any) => [s.id, {
                    ...s,
                    author: shareAuthorMap.get(s.author_id) ?? null,
                    restaurant: s.restaurant_id ? (shareRestaurantMap.get(s.restaurant_id) ?? null) : null,
                    // booking_url deliberately NOT included (L3/KEEP — TICKET-061 seam)
                }]));

                // [H-6 FIX] Fetch my_reactions for ALL share ids (top-level + digest children)
                const allShareTargetIds = deduped;
                const myShareReactionMap = new Map<string, string[]>();
                if (allShareTargetIds.length > 0) {
                    const { data: allShareRxns } = await supabase
                        .from('post_reactions')
                        .select('target_id, emoji')
                        .eq('target_type', 'table_share')
                        .eq('user_id', user.id)
                        .eq('scope', 'table')
                        .in('target_id', allShareTargetIds);
                    for (const r of (allShareRxns ?? []) as { target_id: string; emoji: string }[]) {
                        const list = myShareReactionMap.get(r.target_id) ?? [];
                        list.push(r.emoji);
                        myShareReactionMap.set(r.target_id, list);
                    }
                }

                // Map hydrated DB row → SharedSaveCardProps (camelCase for client — H-6 fix)
                const toSharedSaveCardProps = (child: any) => ({
                    shareId: child.id,                              // camelCase (was missing; broke key + I'm-in)
                    tableId: child.table_id ?? tableId,
                    author: child.author ?? null,
                    restaurant: child.restaurant ?? null,
                    note: child.note ?? null,
                    extractionStatus: child.extraction_status ?? null,
                    reactionCount: child.reaction_count ?? 0,
                    topEmojis: child.top_emojis ?? [],
                    myReactions: myShareReactionMap.get(child.id) ?? [],
                    createdAt: child.created_at,
                });

                for (const row of shareRpcRows) {
                    const payload = row.payload as any;
                    const childIds: string[] = payload?.child_ids ?? [];
                    const hydratedChildren = childIds.map((cid) => shareRowById.get(cid)).filter(Boolean);
                    if (row.kind === 'shared_save') {
                        const child = hydratedChildren[0];
                        if (child) {
                            sharedSaveItems.push({
                                id: row.id,
                                type: 'shared_save',
                                sort_date: row.sort_date,
                                // [H-6 FIX] flatten into camelCase props the client type expects
                                ...toSharedSaveCardProps(child),
                                // also keep the snake_case fields that ActivityItem uses
                                table_id: child.table_id ?? tableId,
                                created_at: child.created_at,
                                reaction_count: child.reaction_count ?? 0,
                                top_emojis: child.top_emojis ?? [],
                                my_reactions: myShareReactionMap.get(child.id) ?? [],
                            });
                        }
                    } else {
                        const repShare = hydratedChildren[0];
                        // [H-6 FIX] childShares is mapped to SharedSaveCardProps[] not raw rows
                        const childShares = hydratedChildren.map(toSharedSaveCardProps);
                        sharedSaveItems.push({
                            id: row.id, type: 'share_digest', sort_date: row.sort_date, table_id: tableId,
                            created_at: repShare?.created_at ?? row.sort_date,
                            author: repShare?.author ?? null,
                            share_count: payload?.share_count ?? hydratedChildren.length,
                            child_ids: childIds,
                            childShares, // B3: real stable ids, mapped to SharedSaveCardProps
                        });
                    }
                }
            }
        }

        // ── TICKET-060: Hydrate restaurant_float items ────────────────────────
        let floatItems: any[] = [];

        if (floatRpcRows.length > 0) {
            for (const row of floatRpcRows) {
                const payload = row.payload as any;
                const restaurantId = payload?.restaurant_id as string | undefined;
                const saverUserIds = (payload?.saver_user_ids as string[]) ?? [];
                let restaurant: any = null;
                if (restaurantId) {
                    const { data: r } = await supabase.from('restaurants').select('id, name, city, cuisine, photo_url')
                        .eq('id', restaurantId).eq('verification', 'verified').maybeSingle();
                    restaurant = r ?? null;
                }
                const memberProfiles: any[] = [];
                if (saverUserIds.length > 0) {
                    const { data: floatProfiles } = await supabase.from('profiles')
                        .select('user_id, display_name, avatar_url').in('user_id', saverUserIds);
                    memberProfiles.push(...(floatProfiles ?? []));
                }
                floatItems.push({
                    id: row.id, type: 'restaurant_float', sort_date: row.sort_date,
                    float_id: row.id, table_id: tableId, restaurant,
                    distinct_count: payload?.distinct_count ?? saverUserIds.length,
                    members: memberProfiles, first_crossed_at: payload?.first_crossed_at,
                });
            }
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

        // TICKET-060: fetch my reactions for table_share targets too
        const shareIds = sharedSaveItems
            .filter((s: any) => s.type === 'shared_save')
            .map((s: any) => s.id as string);
        if (shareIds.length > 0) {
            const { data: myShareReactions } = await supabase
                .from('post_reactions')
                .select('target_id, emoji')
                .eq('target_type', 'table_share')
                .eq('user_id', user.id)
                .eq('scope', 'table')
                .in('target_id', shareIds);
            for (const r of (myShareReactions ?? []) as { target_id: string; emoji: string }[]) {
                const k = targetKey('table_share', r.target_id);
                const list = myReactionsByTarget.get(k) ?? [];
                list.push(r.emoji);
                myReactionsByTarget.set(k, list);
            }
        }

        // ── Merge in RPC order (sort_date DESC already from fn_table_activity_page) ──
        const entryById = new Map(taggedEntries.map((e: { id: string }) => [e.id, e]));
        const nightById = new Map(nightsWithParticipants.map((n: { id: string }) => [n.id, n]));
        const tt4ById = new Map(tt4Events.map((t: { id: string }) => [t.id, t]));
        // TICKET-060: maps for new kinds
        const sharedSaveById = new Map(sharedSaveItems.map((s: any) => [s.id, s]));
        const floatById = new Map(floatItems.map((f: any) => [f.id, f]));

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
                } else if (rpcRow.kind === 'shared_save') {
                    item = sharedSaveById.get(rpcRow.id);
                    if (item) tk = targetKey('table_share', item.id);
                } else if (rpcRow.kind === 'share_digest') {
                    item = sharedSaveById.get(rpcRow.id);
                    // digest reactions are per-child, not on the digest itself
                } else if (rpcRow.kind === 'restaurant_float') {
                    item = floatById.get(rpcRow.id);
                    // floats don't have direct reactions
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
