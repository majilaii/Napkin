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
import { reportError } from '../_shared/report.ts';
import { upsertRestaurant, type RestaurantInput } from '../_shared/restaurant.ts';
import { validateWishlistSource } from '../_shared/wishlistSource.ts';

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
    lat: number | null;
    lng: number | null;
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

            // Validate source if provided [H1 / ARCH-REVIEW-H1]
            let validatedSource: unknown = null;
            if (body.source !== undefined && body.source !== null) {
                const sourceResult = validateWishlistSource(body.source);
                if (!sourceResult.ok) {
                    return jsonResponse({
                        error: {
                            code: 'INVALID_SOURCE_SHAPE',
                            message: `source validation failed: ${sourceResult.reason}`,
                            details: { extra_keys: (sourceResult as any).extra_keys },
                        },
                    }, 400);
                }
                validatedSource = sourceResult.source;
            }

            // Idempotent: if a row already exists, return it untouched (do not overwrite note).
            const { data: existing, error: existingErr } = await supabase
                .from('wishlist_items')
                .select('id, user_id, restaurant_id, note, source, created_at, job_id')
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurantId)
                .maybeSingle();
            if (existingErr) throw existingErr;
            if (existing) {
                // b48 amend: sparse back-fill — if this add is tagging the spot into
                // an import batch and the existing row has no job_id, link it so it
                // shows up in that batch's detail. Never overwrite a non-null job_id.
                if (typeof body.job_id === 'string' && existing.job_id == null) {
                    await supabase
                        .from('wishlist_items')
                        .update({ job_id: body.job_id })
                        .eq('id', existing.id)
                        .eq('user_id', user.id);
                    return jsonResponse({ data: { ...existing, job_id: body.job_id } });
                }
                return jsonResponse({ data: existing });
            }

            const { data, error } = await supabase
                .from('wishlist_items')
                .insert({
                    user_id: user.id,
                    restaurant_id: restaurantId,
                    note: body.note ?? null,
                    source: validatedSource ?? null,
                    // b48 amend: tag this save to an import batch so an added-by-hand
                    // spot shows up in that import's detail (list_import_items).
                    job_id: typeof body.job_id === 'string' ? body.job_id : null,
                })
                .select('id, user_id, restaurant_id, note, source, created_at, job_id')
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
                    source,
                    created_at,
                    job_id,
                    extraction_status,
                    deleted_at,
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
                        external_id,
                        lat,
                        lng,
                        verification,
                        created_by
                    )
                `)
                .eq('user_id', user.id)
                .is('deleted_at', null)            // exclude soft-deleted rows
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

            // Fetch all wishlist items for members of this table, joined to restaurants.
            // NOTE: `source` is intentionally OMITTED here — it contains pasted URLs and
            // TikTok captions (user PII) that must not leak to tablemates. [ARCH-REVIEW-M3]
            // TICKET-060 H4: filter to verified restaurants only (canonical read).
            const { data: wishlistRows, error: wishlistError } = await supabase
                .from('wishlist_items')
                .select(`
                    user_id,
                    restaurant_id,
                    created_at,
                    restaurant:restaurants!inner (
                        id,
                        name,
                        address,
                        city,
                        country,
                        photo_url,
                        cuisine,
                        google_rating,
                        price_level,
                        external_id,
                        verification
                    )
                `)
                .in('user_id', memberIds)
                .is('deleted_at', null)
                .not('restaurant_id', 'is', null)   // exclude pending async captures
                .eq('restaurant.verification', 'verified')  // [TICKET-060 H4] verified only
                .order('created_at', { ascending: false });

            if (wishlistError) throw wishlistError;

            // Fetch profiles separately (no FK from wishlist_items → profiles)
            const uniqueUserIds = [...new Set((wishlistRows ?? []).map((r: any) => r.user_id as string))];
            const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
            if (uniqueUserIds.length > 0) {
                const { data: profiles } = await supabase
                    .from('profiles')
                    .select('user_id, display_name, avatar_url')
                    .in('user_id', uniqueUserIds);
                for (const p of (profiles ?? [])) {
                    profileMap.set(p.user_id, { display_name: p.display_name, avatar_url: p.avatar_url });
                }
            }

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
                    const prof = profileMap.get(row.user_id as string);
                    entry.members.push({
                        user_id: row.user_id as string,
                        display_name: prof?.display_name ?? null,
                        avatar_url: prof?.avatar_url ?? null,
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

        // ── list_imports ───────────────────────────────────────────────────
        // Batch history for the wishlist tab: each import (grouped by job_id)
        // with its current item count + a few preview names. Scoped to the
        // caller — service-role bypasses RLS, so the explicit user_id filter is
        // load-bearing (a missing filter would leak every user's jobs).
        if (action === 'list_imports') {
            const limit = Math.min(Number(body.limit ?? 30), 50);

            const { data: jobs, error: jobsErr } = await supabase
                .from('import_jobs')
                .select('job_id, source, status, created_at')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false })
                .limit(limit);
            if (jobsErr) throw jobsErr;

            const jobIds = (jobs ?? []).map((j: { job_id: string }) => j.job_id);
            if (jobIds.length === 0) {
                return jsonResponse({ data: { imports: [] } });
            }

            // Items for these jobs (non-deleted). wishlist_items → restaurants is
            // a single FK (restaurant_id) → unambiguous embed, no PGRST201 risk.
            const { data: itemRows, error: itemsErr } = await supabase
                .from('wishlist_items')
                .select('job_id, created_at, restaurant:restaurants(name)')
                .eq('user_id', user.id)
                .in('job_id', jobIds)
                .is('deleted_at', null)
                .order('created_at', { ascending: true });
            if (itemsErr) throw itemsErr;

            const byJob = new Map<string, { count: number; names: string[] }>();
            for (const row of (itemRows ?? []) as Array<{ job_id: string; restaurant: { name: string } | null }>) {
                const g = byJob.get(row.job_id) ?? { count: 0, names: [] };
                g.count++;
                const nm = row.restaurant?.name;
                if (nm && g.names.length < 3) g.names.push(nm);
                byJob.set(row.job_id, g);
            }

            const imports = (jobs ?? [])
                .map((j: any) => {
                    const g = byJob.get(j.job_id);
                    return {
                        job_id: j.job_id,
                        source: j.source ?? null,
                        status: j.status,
                        created_at: j.created_at,
                        item_count: g?.count ?? 0,
                        preview_names: g?.names ?? [],
                    };
                })
                // Only surface imports that still have saved spots (pruned/empty
                // batches drop out — keeps the band meaningful).
                .filter((b: { item_count: number }) => b.item_count > 0);

            return jsonResponse({ data: { imports } });
        }

        // ── list_import_items ──────────────────────────────────────────────
        // The spots from one import batch (batch-detail screen). Job scoped to
        // the caller (service-role bypass → explicit user_id guard, critique #7).
        if (action === 'list_import_items') {
            const { job_id } = body;
            if (!job_id) return jsonResponse({ error: 'job_id is required' }, 400);

            const { data: job, error: jobErr } = await supabase
                .from('import_jobs')
                .select('job_id, source, status, created_at')
                .eq('job_id', job_id)
                .eq('user_id', user.id)
                .maybeSingle();
            if (jobErr) throw jobErr;
            if (!job) return jsonResponse({ error: 'Not found' }, 404);

            const { data: items, error: itemsErr } = await supabase
                .from('wishlist_items')
                .select(`
                    id,
                    note,
                    created_at,
                    restaurant:restaurants (
                        id, name, address, city, country, photo_url, cuisine,
                        google_rating, price_level, external_id, lat, lng
                    )
                `)
                .eq('user_id', user.id)
                .eq('job_id', job_id)
                .is('deleted_at', null)
                .order('created_at', { ascending: true });
            if (itemsErr) throw itemsErr;

            return jsonResponse({ data: { job, items: items ?? [] } });
        }

        // ── repoint ────────────────────────────────────────────────────────
        // b48 amend: re-point ONE wishlist item to a different restaurant (fix a
        // mis-resolved import spot). Per-item (item_id), unlike table-shares
        // `correct` which re-points a whole job. Service-role → explicit user_id.
        if (action === 'repoint') {
            const item_id = body.item_id as string | undefined;
            const restaurant_id = body.restaurant_id as string | undefined;
            if (!item_id || !restaurant_id) {
                return jsonResponse({ error: 'item_id and restaurant_id are required' }, 400);
            }

            const { data: item, error: itemErr } = await supabase
                .from('wishlist_items')
                .select('id, restaurant_id, job_id, note')
                .eq('id', item_id)
                .eq('user_id', user.id)
                .maybeSingle();
            if (itemErr) throw itemErr;
            if (!item) return jsonResponse({ error: 'Not found' }, 404);
            if (item.restaurant_id === restaurant_id) {
                return jsonResponse({ data: { id: item_id, restaurant_id } });
            }

            // UNIQUE(user_id, restaurant_id) is NON-partial — a row (even
            // soft-deleted) for the target restaurant blocks a straight update.
            // If one exists, merge: resurrect/keep it and drop the mis-resolved item.
            const { data: dup, error: dupErr } = await supabase
                .from('wishlist_items')
                .select('id, deleted_at, job_id, note')
                .eq('user_id', user.id)
                .eq('restaurant_id', restaurant_id)
                .neq('id', item_id)
                .maybeSingle();
            if (dupErr) throw dupErr;

            if (dup) {
                // Carry the mis-resolved item's batch linkage (job_id) + note onto
                // the surviving row so it stays in this import's detail after the fix
                // (don't clobber a job_id/note the dup already has). Resurrect if
                // soft-deleted; mark resolved like the plain-update path.
                await supabase
                    .from('wishlist_items')
                    .update({
                        deleted_at: null,
                        job_id: dup.job_id ?? item.job_id ?? null,
                        note: dup.note ?? item.note ?? null,
                        extraction_status: 'resolved',
                    })
                    .eq('id', dup.id)
                    .eq('user_id', user.id);
                await supabase
                    .from('wishlist_items')
                    .delete()
                    .eq('id', item_id)
                    .eq('user_id', user.id);
                return jsonResponse({ data: { id: dup.id, restaurant_id, merged: true } });
            }

            const { data: updated, error: updErr } = await supabase
                .from('wishlist_items')
                .update({ restaurant_id, extraction_status: 'resolved' })
                .eq('id', item_id)
                .eq('user_id', user.id)
                .select('id, restaurant_id')
                .single();
            if (updErr) throw updErr;
            return jsonResponse({ data: updated });
        }

        return jsonResponse({ error: 'Unknown action' }, 400);

    } catch (err) {
        console.error('wishlist error:', err);
        reportError(err, { fn: 'wishlist' });
        return jsonResponse({ error: 'Internal Server Error', details: String(err) }, 500);
    }
});
