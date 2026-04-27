/**
 * Table Management Edge Function
 * CRUD operations for Tables (supper club groups)
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { upsertRestaurant } from '../_shared/restaurant.ts';

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

        // Use service role key to bypass RLS - we validate auth manually via getUser
        const supabase = createClient(
            supabaseUrl ?? '',
            supabaseServiceKey ?? ''
        );

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: 'Unauthorized' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        const url = new URL(req.url);
        const action = url.searchParams.get('action');
        const tableId = url.pathname.split('/').pop();

        // GET ?action=last_seen&table_id=X — return the caller's last_seen_at for a table
        if (req.method === 'GET' && action === 'last_seen') {
            const targetTableId = url.searchParams.get('table_id');
            if (!targetTableId) {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { data: membership, error: memberError } = await supabase
                .from('table_members')
                .select('last_seen_at')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .single();

            if (memberError) {
                // Not a member of this table
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            return new Response(
                JSON.stringify({ data: { last_seen_at: membership.last_seen_at ?? null } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=mark_seen — write last_seen_at = now() for caller in a table
        if (req.method === 'POST' && action === 'mark_seen') {
            const body = await req.json();
            const { table_id: targetTableId } = body;

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Verify membership before writing
            const { data: membership, error: memberCheckError } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .single();

            if (memberCheckError || !membership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { data: updated, error: updateError } = await supabase
                .from('table_members')
                .update({ last_seen_at: new Date().toISOString() })
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .select('last_seen_at')
                .single();

            if (updateError) throw updateError;

            return new Response(
                JSON.stringify({ data: { last_seen_at: updated.last_seen_at } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // GET - List user's tables
        if (req.method === 'GET' && (!tableId || tableId === 'table-management')) {

            let query = supabase
                .from('table_members')
                .select(`
                    role,
                    joined_at,
                    tables (
                        id,
                        name,
                        avatar_url,
                        owner_id,
                        created_at,
                        updated_at
                    )
                `)
                .eq('member_id', user.id)
                .order('joined_at', { ascending: false });

            const { data, error } = await query;

            if (error) throw error;

            return new Response(
                JSON.stringify({ data: data ?? [] }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // GET /:id - Get single table with members
        if (req.method === 'GET' && tableId && tableId !== 'table-management') {
            const { data: table, error: tableError } = await supabase
                .from('tables')
                .select('*')
                .eq('id', tableId)
                .single();

            if (tableError) throw tableError;

            const { data: members, error: membersError } = await supabase
                .from('table_members')
                .select(`
                    member_id,
                    role,
                    joined_at,
                    welcomed_at,
                    profiles (
                        display_name,
                        avatar_url
                    )
                `)
                .eq('table_id', tableId);

            if (membersError) throw membersError;

            // Surface the caller's own welcomed_at so the client can show/hide the banner
            const callerMembership = (members ?? []).find((m: any) => m.member_id === user.id);
            const callerWelcomedAt = callerMembership?.welcomed_at ?? null;
            const callerRole = callerMembership?.role ?? null;

            return new Response(
                JSON.stringify({ data: { ...table, members, caller_welcomed_at: callerWelcomedAt, caller_role: callerRole } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=add_member — add a mutual-follow to the table (owner only)
        if (req.method === 'POST' && action === 'add_member') {
            const body = await req.json();
            const { table_id: targetTableId, target_user_id } = body;

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
            if (!target_user_id || typeof target_user_id !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'target_user_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 1. Verify caller is the table owner
            const { data: table, error: tableErr } = await supabase
                .from('tables')
                .select('owner_id')
                .eq('id', targetTableId)
                .maybeSingle();

            if (tableErr) throw tableErr;
            if (!table) {
                return new Response(
                    JSON.stringify({ error: 'Table not found' }),
                    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
            if (table.owner_id !== user.id) {
                return new Response(
                    JSON.stringify({ error: 'Only the table owner can add members', error_code: 'NOT_OWNER' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 2. Verify target user exists
            const { data: targetProfile, error: profileErr } = await supabase
                .from('profiles')
                .select('user_id')
                .eq('user_id', target_user_id)
                .maybeSingle();

            if (profileErr) throw profileErr;
            if (!targetProfile) {
                return new Response(
                    JSON.stringify({ error: 'User not found' }),
                    { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 3. Verify mutual follow: caller→target AND target→caller must both exist
            const [{ data: callerFollowsTarget }, { data: targetFollowsCaller }] = await Promise.all([
                supabase
                    .from('follows')
                    .select('follower_id')
                    .eq('follower_id', user.id)
                    .eq('following_id', target_user_id)
                    .maybeSingle(),
                supabase
                    .from('follows')
                    .select('follower_id')
                    .eq('follower_id', target_user_id)
                    .eq('following_id', user.id)
                    .maybeSingle(),
            ]);

            if (!callerFollowsTarget || !targetFollowsCaller) {
                return new Response(
                    JSON.stringify({
                        error: 'Mutual follow required to add a member',
                        error_code: 'NOT_MUTUAL_FOLLOW',
                    }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // 4. Idempotent upsert — welcomed_at stays NULL so the banner fires on first view
            const { data: existing, error: existErr } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId)
                .eq('member_id', target_user_id)
                .maybeSingle();

            if (existErr) throw existErr;

            if (existing) {
                return new Response(
                    JSON.stringify({ data: { member_id: target_user_id, already_member: true } }),
                    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { error: insertErr } = await supabase
                .from('table_members')
                .insert({ table_id: targetTableId, member_id: target_user_id, role: 'member' });

            if (insertErr) throw insertErr;

            return new Response(
                JSON.stringify({ data: { member_id: target_user_id, already_member: false } }),
                { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=mark_welcomed — dismiss the "added to table" banner for the caller
        if (req.method === 'POST' && action === 'mark_welcomed') {
            const body = await req.json();
            const { table_id: targetTableId } = body;

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Verify membership
            const { data: membership, error: memberCheckError } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .maybeSingle();

            if (memberCheckError || !membership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { error: updateError } = await supabase
                .from('table_members')
                .update({ welcomed_at: new Date().toISOString() })
                .eq('table_id', targetTableId)
                .eq('member_id', user.id);

            if (updateError) throw updateError;

            return new Response(
                JSON.stringify({ data: { welcomed_at: new Date().toISOString() } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=leave_table — non-owner member leaves the table
        if (req.method === 'POST' && action === 'leave_table') {
            const body = await req.json();
            const { table_id: targetTableId } = body;

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Verify membership and role
            const { data: membership, error: memberCheckError } = await supabase
                .from('table_members')
                .select('member_id, role')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .maybeSingle();

            if (memberCheckError || !membership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            if (membership.role === 'admin') {
                return new Response(
                    JSON.stringify({
                        error: 'Table owners cannot leave their own table. Transfer ownership first.',
                        error_code: 'OWNER_CANNOT_LEAVE',
                    }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            const { error: deleteError } = await supabase
                .from('table_members')
                .delete()
                .eq('table_id', targetTableId)
                .eq('member_id', user.id);

            if (deleteError) throw deleteError;

            return new Response(
                JSON.stringify({ data: { left: true } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=top_four_get — read current Top 4 + last_event + suggested
        if (req.method === 'POST' && action === 'top_four_get') {
            const body = await req.json();
            const { table_id: targetTableId } = body as { table_id?: string };

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Verify membership (member_id — not user_id — TICKET-034)
            const { data: membership, error: memberCheckError } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .maybeSingle();

            if (memberCheckError || !membership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // ── Fetch current slots ──────────────────────────────────────────
            const { data: slots, error: slotsError } = await supabase
                .from('table_top_4')
                .select(`
                    position,
                    restaurant_id,
                    custom_photo_url,
                    updated_by,
                    updated_at,
                    restaurant:restaurants (
                        id,
                        name,
                        city,
                        country,
                        photo_url,
                        external_id
                    )
                `)
                .eq('table_id', targetTableId)
                .order('position', { ascending: true });

            if (slotsError) throw slotsError;

            const liveSlots = (slots ?? []) as any[];
            const liveRestaurantIds = new Set(liveSlots.map((s: any) => s.restaurant_id));

            // ── Fetch most-recent history event for attribution row ──────────
            const { data: historyRows, error: histError } = await supabase
                .from('table_top_4_history')
                .select(`
                    id,
                    position,
                    actor_id,
                    event_type,
                    prev_restaurant_id,
                    next_restaurant_id,
                    created_at
                `)
                .eq('table_id', targetTableId)
                .order('created_at', { ascending: false })
                .order('position', { ascending: true })
                .limit(1);

            if (histError) throw histError;

            let lastEvent = null;
            if (historyRows && historyRows.length > 0) {
                const h = historyRows[0] as any;

                // Hydrate actor profile
                const { data: actorProfile } = await supabase
                    .from('profiles')
                    .select('display_name, avatar_url')
                    .eq('user_id', h.actor_id)
                    .maybeSingle();

                // Hydrate prev/next restaurant names
                const restaurantIdsToFetch = [h.prev_restaurant_id, h.next_restaurant_id]
                    .filter(Boolean) as string[];
                const restaurantNameMap = new Map<string, string>();
                if (restaurantIdsToFetch.length > 0) {
                    const { data: rNames } = await supabase
                        .from('restaurants')
                        .select('id, name')
                        .in('id', restaurantIdsToFetch);
                    for (const r of (rNames ?? []) as { id: string; name: string }[]) {
                        restaurantNameMap.set(r.id, r.name);
                    }
                }

                lastEvent = {
                    actor_id: h.actor_id,
                    actor_name: (actorProfile as any)?.display_name ?? null,
                    actor_avatar_url: (actorProfile as any)?.avatar_url ?? null,
                    event_type: h.event_type,
                    position: h.position,
                    prev_restaurant: h.prev_restaurant_id
                        ? { id: h.prev_restaurant_id, name: restaurantNameMap.get(h.prev_restaurant_id) ?? null }
                        : null,
                    next_restaurant: h.next_restaurant_id
                        ? { id: h.next_restaurant_id, name: restaurantNameMap.get(h.next_restaurant_id) ?? null }
                        : null,
                    created_at: h.created_at,
                };
            }

            // ── Suggested list: Table wishlist overlap, excl. live slots, top 8 ──
            const { data: tableMembers } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId);

            const memberIds = ((tableMembers ?? []) as { member_id: string }[]).map((m) => m.member_id);
            let suggested: any[] = [];

            if (memberIds.length > 0) {
                const { data: wishlistRows } = await supabase
                    .from('wishlist_items')
                    .select(`
                        user_id,
                        restaurant_id,
                        created_at,
                        restaurant:restaurants (
                            id,
                            name,
                            city,
                            country,
                            photo_url
                        )
                    `)
                    .in('user_id', memberIds)
                    .order('created_at', { ascending: false });

                // Aggregate by restaurant_id, count members
                const aggregator = new Map<string, { restaurant: any; count: number; max_created_at: string }>();
                for (const row of (wishlistRows ?? []) as any[]) {
                    const rid = row.restaurant_id as string;
                    // Exclude restaurants already in the live Top 4
                    if (liveRestaurantIds.has(rid)) continue;
                    if (!aggregator.has(rid)) {
                        aggregator.set(rid, {
                            restaurant: row.restaurant,
                            count: 0,
                            max_created_at: row.created_at,
                        });
                    }
                    const entry = aggregator.get(rid)!;
                    entry.count++;
                    if (row.created_at > entry.max_created_at) {
                        entry.max_created_at = row.created_at;
                    }
                }

                suggested = Array.from(aggregator.values())
                    .sort((a, b) => {
                        if (b.count !== a.count) return b.count - a.count;
                        return b.max_created_at > a.max_created_at ? 1 : -1;
                    })
                    .slice(0, 8)
                    .map(({ restaurant, count }) => ({
                        restaurant,
                        saved_by_n_members: count,
                    }));
            }

            return new Response(
                JSON.stringify({
                    data: {
                        slots: liveSlots,
                        last_event: lastEvent,
                        suggested,
                    },
                }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST ?action=top_four_set — diff + upsert/delete + history via RPC
        if (req.method === 'POST' && action === 'top_four_set') {
            const body = await req.json();
            const { table_id: targetTableId, slots: inputSlots } = body as {
                table_id?: string;
                slots?: Array<{
                    position: number;
                    /** Persisted restaurant UUID. Provide this OR `place`, not both. */
                    restaurant_id?: string | null;
                    /** Google Places payload for a ghost restaurant (not yet in Napkin DB).
                     *  Server will upsert via upsertRestaurant before writing the slot. */
                    place?: {
                        external_id: string;
                        name: string;
                        location?: { address?: string; locality?: string; country?: string };
                        latitude?: number;
                        longitude?: number;
                        photoReference?: string;
                        photoAttributionHtml?: string | null;
                        googleRating?: number;
                        googleRatingCount?: number;
                        priceLevel?: number;
                        cuisine?: string;
                    };
                }>;
            };

            if (!targetTableId || typeof targetTableId !== 'string') {
                return new Response(
                    JSON.stringify({ error: 'table_id is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }
            if (!Array.isArray(inputSlots) || inputSlots.length === 0) {
                return new Response(
                    JSON.stringify({ error: 'slots must be a non-empty array' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Validate: positions in {1,2,3,4}, no duplicates, each slot has restaurant_id OR place
            const positions = new Set<number>();
            const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            for (const slot of inputSlots) {
                if (![1, 2, 3, 4].includes(slot.position)) {
                    return new Response(
                        JSON.stringify({ error: `Invalid position: ${slot.position}` }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
                if (positions.has(slot.position)) {
                    return new Response(
                        JSON.stringify({ error: `Duplicate position: ${slot.position}` }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
                positions.add(slot.position);
                // Slot must carry restaurant_id (uuid or null to clear) OR place payload
                const rid = slot.restaurant_id;
                if (rid !== null && rid !== undefined && !UUID_RE.test(rid)) {
                    // Not null, not a valid UUID — reject unless place is provided
                    if (!slot.place) {
                        return new Response(
                            JSON.stringify({ error: `Invalid restaurant_id for position ${slot.position}` }),
                            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                        );
                    }
                }
                if (slot.place && (!slot.place.external_id || !slot.place.name)) {
                    return new Response(
                        JSON.stringify({ error: `place payload for position ${slot.position} must include external_id and name` }),
                        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
            }

            // Verify membership BEFORE resolving any ghost places — a non-member must
            // not be able to spend Google Places quota or pollute `restaurants`.
            // Same check used in top_four_get (member_id, NOT user_id — TICKET-034).
            const { data: setMembership, error: setMemberCheckError } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId)
                .eq('member_id', user.id)
                .maybeSingle();

            if (setMemberCheckError || !setMembership) {
                return new Response(
                    JSON.stringify({ error: 'Not a member of this table' }),
                    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Resolve any ghost-place slots: upsert via _shared/restaurant.ts to get a DB id
            const resolvedSlots: Array<{ position: number; restaurant_id: string | null }> = [];
            for (const slot of inputSlots) {
                if (slot.place) {
                    // Ghost restaurant — upsert and get DB UUID
                    const resolvedId = await upsertRestaurant(supabase, slot.place);
                    resolvedSlots.push({ position: slot.position, restaurant_id: resolvedId });
                } else {
                    resolvedSlots.push({ position: slot.position, restaurant_id: slot.restaurant_id ?? null });
                }
            }

            // Call the atomic RPC (all slots now have resolved restaurant_ids)
            const { error: rpcError } = await supabase.rpc('fn_set_table_top_4', {
                p_table_id: targetTableId,
                p_actor_id: user.id,
                p_slots: resolvedSlots,
            });

            if (rpcError) {
                if (rpcError.message?.includes('not a member')) {
                    return new Response(
                        JSON.stringify({ error: 'Not a member of this table' }),
                        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                    );
                }
                throw rpcError;
            }

            // Re-read the same shape as top_four_get for client reconciliation
            const { data: slotsAfter, error: slotsAfterError } = await supabase
                .from('table_top_4')
                .select(`
                    position,
                    restaurant_id,
                    custom_photo_url,
                    updated_by,
                    updated_at,
                    restaurant:restaurants (
                        id,
                        name,
                        city,
                        country,
                        photo_url,
                        external_id
                    )
                `)
                .eq('table_id', targetTableId)
                .order('position', { ascending: true });

            if (slotsAfterError) throw slotsAfterError;

            const liveAfter = (slotsAfter ?? []) as any[];
            const liveAfterIds = new Set(liveAfter.map((s: any) => s.restaurant_id));

            // Most-recent history event
            const { data: histAfter } = await supabase
                .from('table_top_4_history')
                .select(`
                    position,
                    actor_id,
                    event_type,
                    prev_restaurant_id,
                    next_restaurant_id,
                    created_at
                `)
                .eq('table_id', targetTableId)
                .order('created_at', { ascending: false })
                .order('position', { ascending: true })
                .limit(1);

            let lastEventAfter = null;
            if (histAfter && histAfter.length > 0) {
                const h = histAfter[0] as any;
                const { data: actorProfile } = await supabase
                    .from('profiles')
                    .select('display_name, avatar_url')
                    .eq('user_id', h.actor_id)
                    .maybeSingle();

                const restaurantIdsToFetch2 = [h.prev_restaurant_id, h.next_restaurant_id]
                    .filter(Boolean) as string[];
                const rNameMap2 = new Map<string, string>();
                if (restaurantIdsToFetch2.length > 0) {
                    const { data: rNames2 } = await supabase
                        .from('restaurants')
                        .select('id, name')
                        .in('id', restaurantIdsToFetch2);
                    for (const r of (rNames2 ?? []) as { id: string; name: string }[]) {
                        rNameMap2.set(r.id, r.name);
                    }
                }

                lastEventAfter = {
                    actor_id: h.actor_id,
                    actor_name: (actorProfile as any)?.display_name ?? null,
                    actor_avatar_url: (actorProfile as any)?.avatar_url ?? null,
                    event_type: h.event_type,
                    position: h.position,
                    prev_restaurant: h.prev_restaurant_id
                        ? { id: h.prev_restaurant_id, name: rNameMap2.get(h.prev_restaurant_id) ?? null }
                        : null,
                    next_restaurant: h.next_restaurant_id
                        ? { id: h.next_restaurant_id, name: rNameMap2.get(h.next_restaurant_id) ?? null }
                        : null,
                    created_at: h.created_at,
                };
            }

            // Suggested (same logic as top_four_get, post-save state)
            const { data: tableMembersAfter } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', targetTableId);

            const memberIdsAfter = ((tableMembersAfter ?? []) as { member_id: string }[]).map((m) => m.member_id);
            let suggestedAfter: any[] = [];

            if (memberIdsAfter.length > 0) {
                const { data: wishlistRowsAfter } = await supabase
                    .from('wishlist_items')
                    .select(`
                        user_id,
                        restaurant_id,
                        created_at,
                        restaurant:restaurants (
                            id,
                            name,
                            city,
                            country,
                            photo_url
                        )
                    `)
                    .in('user_id', memberIdsAfter)
                    .order('created_at', { ascending: false });

                const agg2 = new Map<string, { restaurant: any; count: number; max_created_at: string }>();
                for (const row of (wishlistRowsAfter ?? []) as any[]) {
                    const rid = row.restaurant_id as string;
                    if (liveAfterIds.has(rid)) continue;
                    if (!agg2.has(rid)) {
                        agg2.set(rid, { restaurant: row.restaurant, count: 0, max_created_at: row.created_at });
                    }
                    const entry = agg2.get(rid)!;
                    entry.count++;
                    if (row.created_at > entry.max_created_at) entry.max_created_at = row.created_at;
                }

                suggestedAfter = Array.from(agg2.values())
                    .sort((a, b) => {
                        if (b.count !== a.count) return b.count - a.count;
                        return b.max_created_at > a.max_created_at ? 1 : -1;
                    })
                    .slice(0, 8)
                    .map(({ restaurant, count }) => ({ restaurant, saved_by_n_members: count }));
            }

            return new Response(
                JSON.stringify({
                    data: {
                        slots: liveAfter,
                        last_event: lastEventAfter,
                        suggested: suggestedAfter,
                    },
                }),
                { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // POST - Create table
        if (req.method === 'POST') {
            const body = await req.json();
            const { name, avatar_url } = body;

            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return new Response(
                    JSON.stringify({ error: 'Name is required' }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                );
            }

            // Create the table
            const { data: newTable, error: createError } = await supabase
                .from('tables')
                .insert({ name: name.trim(), avatar_url, owner_id: user.id })
                .select()
                .single();

            if (createError) throw createError;

            // Add creator as admin member
            const { error: memberError } = await supabase
                .from('table_members')
                .insert({ table_id: newTable.id, member_id: user.id, role: 'admin' });

            if (memberError) throw memberError;

            return new Response(
                JSON.stringify({ data: newTable }),
                { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // PUT /:id - Update table
        if (req.method === 'PUT' && tableId) {
            const body = await req.json();
            const { name, avatar_url } = body;

            const { data, error } = await supabase
                .from('tables')
                .update({ name, avatar_url, updated_at: new Date().toISOString() })
                .eq('id', tableId)
                .select()
                .single();

            if (error) throw error;

            return new Response(
                JSON.stringify({ data }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // DELETE /:id - Delete table
        if (req.method === 'DELETE' && tableId) {
            const { error } = await supabase
                .from('tables')
                .delete()
                .eq('id', tableId);

            if (error) throw error;

            return new Response(
                JSON.stringify({ success: true }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
        }

        return new Response(
            JSON.stringify({ error: 'Method not allowed' }),
            { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('table-management error:', error);
        return new Response(
            JSON.stringify({ error: 'Internal Server Error', details: String(error) }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
});
