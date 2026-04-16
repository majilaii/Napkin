/**
 * Wishlist Edge Function
 *
 * Personal wishlist add/remove/list + derived Table overlap view.
 * All actions are POST with a body `{ action: "add" | "remove" | "list_personal" | "list_table", ... }`.
 *
 * Doctrine: no table_id column on wishlist_items — Table overlap is computed at read time.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { upsertRestaurant, type RestaurantInput } from '../_shared/restaurant.ts';

// ── Types ─────────────────────────────────────────────────────────────────

interface RestaurantRow {
    id: string;
    name: string;
    address: string | null;
    city: string | null;
    country: string | null;
    photo_url: string | null;
    cuisine: string | null;
    google_rating: number | null;
    price_level: number | null;
    external_id: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

// ── Handler ────────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        // ── Auth ────────────────────────────────────────────────────────
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return jsonResponse({ error: 'Missing Authorization header' }, 401);
        }

        const token = authHeader.replace('Bearer ', '');
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

        // Service role client — bypasses RLS; we validate auth manually via getUser
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        // ── Route ───────────────────────────────────────────────────────
        if (req.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405);
        }

        const body = await req.json();
        const { action } = body;

        // ── add ──────────────────────────────────────────────────────────
        if (action === 'add') {
            let restaurantId: string;

            if (body.restaurant_id) {
                restaurantId = body.restaurant_id as string;
            } else if (body.restaurant) {
                // Places payload: upsert the restaurant first, then record the wish
                const input = body.restaurant as RestaurantInput;
                restaurantId = await upsertRestaurant(supabase, input);
            } else {
                return jsonResponse(
                    { error: 'Exactly one of restaurant_id or restaurant is required' },
                    400,
                );
            }

            // Idempotent: if a row already exists, return it untouched (do not overwrite note).
            const { data: existing, error: existingErr } = await supabase
                .from('wishlist_items')
                .select('id, user_id, restaurant_id, note, created_at')
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurantId)
                .maybeSingle();
            if (existingErr) throw existingErr;
            if (existing) {
                return jsonResponse({ data: existing });
            }

            const { data, error } = await supabase
                .from('wishlist_items')
                .insert({
                    user_id: user.id,
                    restaurant_id: restaurantId,
                    note: body.note ?? null,
                })
                .select('id, user_id, restaurant_id, note, created_at')
                .single();

            if (error) throw error;
            return jsonResponse({ data });
        }

        // ── check ────────────────────────────────────────────────────────
        if (action === 'check') {
            const { restaurant_id } = body;
            if (!restaurant_id) {
                return jsonResponse({ error: 'restaurant_id is required' }, 400);
            }

            const { data, error } = await supabase
                .from('wishlist_items')
                .select('id')
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurant_id)
                .maybeSingle();

            if (error) throw error;
            return jsonResponse({ data: { wishlisted: !!data } });
        }

        // ── remove ───────────────────────────────────────────────────────
        if (action === 'remove') {
            const { restaurant_id } = body;
            if (!restaurant_id) {
                return jsonResponse({ error: 'restaurant_id is required' }, 400);
            }

            const { error } = await supabase
                .from('wishlist_items')
                .delete()
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurant_id);

            if (error) throw error;
            return jsonResponse({ data: { removed: true } });
        }

        // ── list_personal ─────────────────────────────────────────────────
        if (action === 'list_personal') {
            const limit = Math.min(Number(body.limit ?? 40), 100);
            const beforeCreatedAt: string | undefined = body.before_created_at;

            let query = supabase
                .from('wishlist_items')
                .select(`
                    id,
                    note,
                    created_at,
                    restaurant:restaurants (
                        id,
                        name,
                        address,
                        city,
                        country,
                        photo_url,
                        cuisine,
                        google_rating,
                        price_level,
                        external_id
                    )
                `)
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(limit + 1); // fetch one extra to determine if there's a next page

            if (beforeCreatedAt) {
                query = query.lt('created_at', beforeCreatedAt);
            }

            const { data, error } = await query;
            if (error) throw error;

            const hasMore = (data?.length ?? 0) > limit;
            const items = hasMore ? data!.slice(0, limit) : (data ?? []);
            const nextCursor = hasMore
                ? items[items.length - 1].created_at
                : null;

            return jsonResponse({ data: items, next_cursor: nextCursor });
        }

        // ── list_table ────────────────────────────────────────────────────
        if (action === 'list_table') {
            const { table_id } = body;
            if (!table_id) {
                return jsonResponse({ error: 'table_id is required' }, 400);
            }

            // Validate caller is a member of the Table
            const { data: membership, error: memberError } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', table_id)
                .eq('member_id', user.id)
                .maybeSingle();

            if (memberError) throw memberError;
            if (!membership) {
                return jsonResponse({ error: 'Forbidden: not a member of this table' }, 403);
            }

            // Get all member IDs for this table
            const { data: members, error: membersError } = await supabase
                .from('table_members')
                .select('member_id')
                .eq('table_id', table_id);

            if (membersError) throw membersError;

            const memberIds = (members ?? []).map((m: { member_id: string }) => m.member_id);

            if (memberIds.length === 0) {
                return jsonResponse({ data: [] });
            }

            // Fetch all wishlist items for members of this table, joined to restaurants + profiles
            const { data: wishlistRows, error: wishlistError } = await supabase
                .from('wishlist_items')
                .select(`
                    user_id,
                    restaurant_id,
                    created_at,
                    restaurant:restaurants (
                        id,
                        name,
                        address,
                        city,
                        country,
                        photo_url,
                        cuisine,
                        google_rating,
                        price_level,
                        external_id
                    ),
                    profile:profiles (
                        display_name,
                        avatar_url
                    )
                `)
                .in('user_id', memberIds)
                .order('created_at', { ascending: false });

            if (wishlistError) throw wishlistError;

            // Aggregate: group by restaurant_id, count members, collect member info
            const restaurantMap = new Map<string, {
                restaurant: RestaurantRow;
                count: number;
                members: Array<{ user_id: string; display_name: string | null; avatar_url: string | null }>;
                max_created_at: string;
            }>();

            for (const row of (wishlistRows ?? [])) {
                const rid = row.restaurant_id as string;
                if (!restaurantMap.has(rid)) {
                    restaurantMap.set(rid, {
                        restaurant: row.restaurant as RestaurantRow,
                        count: 0,
                        members: [],
                        max_created_at: row.created_at as string,
                    });
                }
                const entry = restaurantMap.get(rid)!;
                entry.count++;
                // Cap at 5 members for the avatar stack
                if (entry.members.length < 5) {
                    entry.members.push({
                        user_id: row.user_id as string,
                        display_name: (row.profile as any)?.display_name ?? null,
                        avatar_url: (row.profile as any)?.avatar_url ?? null,
                    });
                }
                // Keep the most recent save timestamp for secondary sort
                if (row.created_at > entry.max_created_at) {
                    entry.max_created_at = row.created_at as string;
                }
            }

            // Sort: count DESC, max_created_at DESC; cap at 200
            const sorted = Array.from(restaurantMap.values())
                .sort((a, b) => {
                    if (b.count !== a.count) return b.count - a.count;
                    return b.max_created_at > a.max_created_at ? 1 : -1;
                })
                .slice(0, 200)
                .map(({ restaurant, count, members }) => ({ restaurant, count, members }));

            return jsonResponse({ data: sorted });
        }

        return jsonResponse({ error: 'Unknown action' }, 400);

    } catch (err) {
        console.error('wishlist error:', err);
        return jsonResponse({ error: 'Internal Server Error', details: String(err) }, 500);
    }
});
