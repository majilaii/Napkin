/**
 * Lists Edge Function
 *
 * Curated, themed lists primitive — sibling to wishlist.
 * All actions are POST with a body `{ action: "...", ... }`.
 *
 * Actions:
 *   create           — create a new list (+ optional initial entry)
 *   update           — rename, toggle ranked/privacy
 *   delete           — delete a list
 *   list_mine        — caller's lists, MRU order
 *   get              — list detail + entries (privacy-gated)
 *   add_entry        — add a restaurant to a list (idempotent)
 *   remove_entry     — remove a restaurant from a list
 *   update_entry     — edit the per-entry note
 *   reorder_entry    — drag-and-drop repositioning for ranked lists
 *   lists_containing — list IDs that contain a given restaurant (drives sheet checkmarks)
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { upsertRestaurant, type RestaurantInput } from '../_shared/restaurant.ts';

// ── Types ──────────────────────────────────────────────────────────────────

interface ListRow {
    id: string;
    owner_id: string;
    title: string;
    description: string | null;
    ranked: boolean;
    privacy: 'public' | 'private';
    created_at: string;
    updated_at: string;
}

interface ListEntry {
    id: string;
    list_id: string;
    restaurant_id: string;
    note: string | null;
    position: number;
    created_at: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

/** Resolve restaurant_id from either a UUID or a Places payload. */
async function resolveRestaurantId(
    supabase: any,
    body: { restaurant_id?: string; restaurant?: RestaurantInput },
): Promise<string | null> {
    if (body.restaurant_id) return body.restaurant_id;
    if (body.restaurant) return await upsertRestaurant(supabase, body.restaurant as RestaurantInput);
    return null;
}

/**
 * Gap-based position for a new entry: max(position) + 1024.
 * If the list is empty, starts at 1024.
 */
async function nextPosition(supabase: any, listId: string): Promise<number> {
    const { data } = await supabase
        .from('list_entries')
        .select('position')
        .eq('list_id', listId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle();
    return ((data?.position as number) ?? 0) + 1024;
}

/**
 * Rewrite all entry positions for a list in their current order (compaction).
 * Positions become 1024, 2048, 3072, ...
 */
async function compactPositions(supabase: any, listId: string): Promise<void> {
    const { data: entries } = await supabase
        .from('list_entries')
        .select('id, position')
        .eq('list_id', listId)
        .order('position', { ascending: true });

    if (!entries || entries.length === 0) return;

    const updates = entries.map((e: { id: string }, i: number) => ({
        id: e.id,
        position: (i + 1) * 1024,
    }));

    for (const u of updates) {
        await supabase
            .from('list_entries')
            .update({ position: u.position })
            .eq('id', u.id);
    }
}

/**
 * Back-fill positions for existing entries when a list is converted
 * from unranked → ranked. Uses reverse-chron order (most-recently-added = rank 1).
 */
async function backfillPositions(supabase: any, listId: string): Promise<void> {
    const { data: entries } = await supabase
        .from('list_entries')
        .select('id')
        .eq('list_id', listId)
        .order('created_at', { ascending: false });

    if (!entries || entries.length === 0) return;

    for (let i = 0; i < entries.length; i++) {
        await supabase
            .from('list_entries')
            .update({ position: (i + 1) * 1024 })
            .eq('id', entries[i].id);
    }
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

        // Service role client — bypasses RLS; we validate auth manually
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }

        // ── Route ────────────────────────────────────────────────────────
        if (req.method !== 'POST') {
            return jsonResponse({ error: 'Method not allowed' }, 405);
        }

        const body = await req.json();
        const { action } = body;

        // ── create ────────────────────────────────────────────────────────
        if (action === 'create') {
            const title = typeof body.title === 'string' ? body.title.trim() : '';
            if (!title || title.length > 60) {
                return jsonResponse({ error: 'title is required (max 60 chars)' }, 400);
            }

            const description = body.description
                ? String(body.description).slice(0, 140)
                : null;
            const ranked = !!body.ranked;
            const privacy = body.privacy === 'private' ? 'private' : 'public';

            const { data: list, error: listErr } = await supabase
                .from('lists')
                .insert({
                    owner_id: user.id,
                    title,
                    description,
                    ranked,
                    privacy,
                })
                .select('*')
                .single();

            if (listErr) throw listErr;

            // Optionally add an initial entry (from "Add to list" sheet inline create)
            if (body.initial_restaurant_id || body.initial_restaurant) {
                const restaurantId = await resolveRestaurantId(supabase, {
                    restaurant_id: body.initial_restaurant_id,
                    restaurant: body.initial_restaurant,
                });
                if (restaurantId) {
                    const pos = await nextPosition(supabase, list.id);
                    await supabase.from('list_entries').insert({
                        list_id: list.id,
                        restaurant_id: restaurantId,
                        note: body.initial_note ?? null,
                        position: pos,
                    });
                }
            }

            return jsonResponse({ data: list });
        }

        // ── update ────────────────────────────────────────────────────────
        if (action === 'update') {
            const { list_id } = body;
            if (!list_id) return jsonResponse({ error: 'list_id is required' }, 400);

            // Verify ownership
            const { data: existing, error: fetchErr } = await supabase
                .from('lists')
                .select('*')
                .eq('id', list_id)
                .eq('owner_id', user.id)
                .maybeSingle();
            if (fetchErr) throw fetchErr;
            if (!existing) return jsonResponse({ error: 'Not found' }, 404);

            const updates: Partial<ListRow> = {};
            if (typeof body.title === 'string') {
                const t = body.title.trim();
                if (!t || t.length > 60) return jsonResponse({ error: 'Invalid title' }, 400);
                updates.title = t;
            }
            if (body.description !== undefined) {
                updates.description = body.description
                    ? String(body.description).slice(0, 140)
                    : null;
            }
            if (typeof body.ranked === 'boolean') {
                updates.ranked = body.ranked;
                // unranked → ranked: back-fill positions
                if (!existing.ranked && body.ranked) {
                    await backfillPositions(supabase, list_id);
                }
            }
            if (body.privacy === 'public' || body.privacy === 'private') {
                updates.privacy = body.privacy;
            }

            const { data: updated, error: updateErr } = await supabase
                .from('lists')
                .update(updates)
                .eq('id', list_id)
                .eq('owner_id', user.id)
                .select('*')
                .single();
            if (updateErr) throw updateErr;

            return jsonResponse({ data: updated });
        }

        // ── delete ────────────────────────────────────────────────────────
        if (action === 'delete') {
            const { list_id } = body;
            if (!list_id) return jsonResponse({ error: 'list_id is required' }, 400);

            const { error: deleteErr } = await supabase
                .from('lists')
                .delete()
                .eq('id', list_id)
                .eq('owner_id', user.id);
            if (deleteErr) throw deleteErr;

            return jsonResponse({ data: { deleted: true } });
        }

        // ── list_mine ──────────────────────────────────────────────────────
        if (action === 'list_mine') {
            const { data: lists, error: listsErr } = await supabase
                .from('lists')
                .select('*')
                .eq('owner_id', user.id)
                .order('updated_at', { ascending: false });
            if (listsErr) throw listsErr;

            // For each list, fetch entry_count and cover_photo_url (first entry's restaurant.photo_url)
            const enriched = await Promise.all(
                (lists ?? []).map(async (list: ListRow) => {
                    const { count } = await supabase
                        .from('list_entries')
                        .select('id', { count: 'exact', head: true })
                        .eq('list_id', list.id);

                    // Cover: first entry's restaurant photo (by position if ranked, else by created_at)
                    const orderCol = list.ranked ? 'position' : 'created_at';
                    const orderAsc = list.ranked ? true : false;
                    const { data: firstEntry } = await supabase
                        .from('list_entries')
                        .select('restaurant:restaurants(photo_url)')
                        .eq('list_id', list.id)
                        .order(orderCol, { ascending: orderAsc })
                        .limit(1)
                        .maybeSingle();

                    const coverPhotoUrl =
                        (firstEntry?.restaurant as any)?.photo_url ?? null;

                    return {
                        ...list,
                        entry_count: count ?? 0,
                        cover_photo_url: coverPhotoUrl,
                    };
                }),
            );

            return jsonResponse({ data: enriched });
        }

        // ── get ────────────────────────────────────────────────────────────
        if (action === 'get') {
            const { list_id } = body;
            if (!list_id) return jsonResponse({ error: 'list_id is required' }, 400);

            const { data: list, error: listErr } = await supabase
                .from('lists')
                .select('*')
                .eq('id', list_id)
                .maybeSingle();
            if (listErr) throw listErr;

            // Privacy gate: private lists are "not found" for non-owners
            if (!list) return jsonResponse({ error: 'Not found' }, 404);
            if (list.privacy === 'private' && list.owner_id !== user.id) {
                return jsonResponse({ error: 'Not found' }, 404);
            }

            // Entries — ordered by position (ranked) or created_at desc (unranked)
            const orderCol = list.ranked ? 'position' : 'created_at';
            const orderAsc = list.ranked ? true : false;
            const { data: entries, error: entriesErr } = await supabase
                .from('list_entries')
                .select(`
                    id,
                    list_id,
                    restaurant_id,
                    note,
                    position,
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
                .eq('list_id', list_id)
                .order(orderCol, { ascending: orderAsc });
            if (entriesErr) throw entriesErr;

            // Owner profile — username and account_privacy added for TICKET-020 list-detail author tap
            const { data: ownerProfile } = await supabase
                .from('profiles')
                .select('display_name, avatar_url, username, account_privacy')
                .eq('user_id', list.owner_id)
                .maybeSingle();

            return jsonResponse({
                data: {
                    list,
                    entries: entries ?? [],
                    owner_profile: ownerProfile ?? {
                        display_name: null,
                        avatar_url: null,
                        username: null,
                        account_privacy: 'private',
                    },
                },
            });
        }

        // ── add_entry ─────────────────────────────────────────────────────
        if (action === 'add_entry') {
            const { list_id, note } = body;
            if (!list_id) return jsonResponse({ error: 'list_id is required' }, 400);

            // Verify caller owns the list
            const { data: list, error: listErr } = await supabase
                .from('lists')
                .select('id, owner_id')
                .eq('id', list_id)
                .eq('owner_id', user.id)
                .maybeSingle();
            if (listErr) throw listErr;
            if (!list) return jsonResponse({ error: 'Not found' }, 404);

            const restaurantId = await resolveRestaurantId(supabase, {
                restaurant_id: body.restaurant_id,
                restaurant: body.restaurant,
            });
            if (!restaurantId) {
                return jsonResponse(
                    { error: 'Exactly one of restaurant_id or restaurant is required' },
                    400,
                );
            }

            // Idempotency: return existing row if already in the list
            const { data: existing, error: existingErr } = await supabase
                .from('list_entries')
                .select('*')
                .eq('list_id', list_id)
                .eq('restaurant_id', restaurantId)
                .maybeSingle();
            if (existingErr) throw existingErr;
            if (existing) return jsonResponse({ data: existing });

            const position = await nextPosition(supabase, list_id);
            const { data: entry, error: insertErr } = await supabase
                .from('list_entries')
                .insert({
                    list_id,
                    restaurant_id: restaurantId,
                    note: note ?? null,
                    position,
                })
                .select('*')
                .single();
            if (insertErr) throw insertErr;

            return jsonResponse({ data: entry });
        }

        // ── remove_entry ───────────────────────────────────────────────────
        if (action === 'remove_entry') {
            const { list_id, restaurant_id } = body;
            if (!list_id || !restaurant_id) {
                return jsonResponse({ error: 'list_id and restaurant_id are required' }, 400);
            }

            // Verify ownership
            const { data: list } = await supabase
                .from('lists')
                .select('id')
                .eq('id', list_id)
                .eq('owner_id', user.id)
                .maybeSingle();
            if (!list) return jsonResponse({ error: 'Not found' }, 404);

            const { error: deleteErr } = await supabase
                .from('list_entries')
                .delete()
                .eq('list_id', list_id)
                .eq('restaurant_id', restaurant_id);
            if (deleteErr) throw deleteErr;

            return jsonResponse({ data: { removed: true } });
        }

        // ── update_entry ───────────────────────────────────────────────────
        if (action === 'update_entry') {
            const { list_id, entry_id, note } = body;
            if (!list_id || !entry_id) {
                return jsonResponse({ error: 'list_id and entry_id are required' }, 400);
            }

            // Verify ownership via list
            const { data: list } = await supabase
                .from('lists')
                .select('id')
                .eq('id', list_id)
                .eq('owner_id', user.id)
                .maybeSingle();
            if (!list) return jsonResponse({ error: 'Not found' }, 404);

            const noteVal =
                note !== undefined
                    ? note
                        ? String(note).slice(0, 140)
                        : null
                    : undefined;

            const updatePayload: Partial<ListEntry> = {};
            if (noteVal !== undefined) updatePayload.note = noteVal;

            const { data: entry, error: updateErr } = await supabase
                .from('list_entries')
                .update(updatePayload)
                .eq('id', entry_id)
                .eq('list_id', list_id)
                .select('*')
                .single();
            if (updateErr) throw updateErr;

            return jsonResponse({ data: entry });
        }

        // ── reorder_entry ──────────────────────────────────────────────────
        // TICKET-037: accepts { entry_id, list_id, new_index } — server resolves
        // neighbours from authoritative DB state, eliminating stale-cache snapping.
        // Still accepts legacy before_entry_id/after_entry_id for backwards compat.
        if (action === 'reorder_entry') {
            const { list_id, entry_id, new_index, before_entry_id: legacyBefore, after_entry_id: legacyAfter } = body;
            if (!list_id || !entry_id) {
                return jsonResponse({ error: 'list_id and entry_id are required' }, 400);
            }

            // Verify ownership
            const { data: list } = await supabase
                .from('lists')
                .select('id')
                .eq('id', list_id)
                .eq('owner_id', user.id)
                .maybeSingle();
            if (!list) return jsonResponse({ error: 'Not found' }, 404);

            let prevPos: number | null = null;
            let nextPos: number | null = null;

            if (typeof new_index === 'number') {
                // Server-authoritative path: read all entries, derive neighbours from new_index
                const { data: allEntries, error: allErr } = await supabase
                    .from('list_entries')
                    .select('id, position')
                    .eq('list_id', list_id)
                    .order('position', { ascending: true });
                if (allErr) throw allErr;

                // Remove the moved entry to find its new neighbours
                const withoutMoved = (allEntries ?? []).filter((e: { id: string; position: number }) => e.id !== entry_id);
                const clampedIndex = Math.max(0, Math.min(new_index, withoutMoved.length));
                const beforeEntry = clampedIndex > 0 ? withoutMoved[clampedIndex - 1] : null;
                const afterEntry = clampedIndex < withoutMoved.length ? withoutMoved[clampedIndex] : null;
                prevPos = beforeEntry?.position ?? null;
                nextPos = afterEntry?.position ?? null;
            } else if (legacyBefore || legacyAfter) {
                // Legacy path: client-supplied neighbour ids
                const neighbourIds = [legacyBefore, legacyAfter].filter(Boolean) as string[];
                const { data: neighbours, error: fetchErr } = await supabase
                    .from('list_entries')
                    .select('id, position')
                    .eq('list_id', list_id)
                    .in('id', neighbourIds);
                if (fetchErr) throw fetchErr;
                const byId = new Map(
                    (neighbours as Array<{ id: string; position: number }>).map((e) => [e.id, e.position]),
                );
                prevPos = legacyBefore ? byId.get(legacyBefore) ?? null : null;
                nextPos = legacyAfter ? byId.get(legacyAfter) ?? null : null;
            } else {
                return jsonResponse({ error: 'new_index or before_entry_id/after_entry_id is required' }, 400);
            }

            let newPosition: number;
            if (prevPos !== null && nextPos !== null) {
                newPosition = Math.floor((prevPos + nextPos) / 2);
            } else if (prevPos !== null) {
                newPosition = prevPos + 1024;
            } else if (nextPos !== null) {
                newPosition = Math.floor(nextPos / 2);
            } else {
                newPosition = 1024;
            }

            // If gap is too small, compact first then re-calculate
            const gapTooSmall =
                prevPos !== null &&
                nextPos !== null &&
                nextPos - prevPos < 2;

            if (gapTooSmall) {
                await compactPositions(supabase, list_id);
                // After compaction, just append at the right place (simple: set to max+1024)
                // Client will re-fetch anyway; this is a rare path.
                newPosition = await nextPosition(supabase, list_id);
            }

            const { data: entry, error: updateErr } = await supabase
                .from('list_entries')
                .update({ position: newPosition })
                .eq('id', entry_id)
                .eq('list_id', list_id)
                .select('*')
                .single();
            if (updateErr) throw updateErr;

            return jsonResponse({ data: entry });
        }

        // ── lists_containing ──────────────────────────────────────────────
        if (action === 'lists_containing') {
            const { restaurant_id } = body;
            if (!restaurant_id) {
                return jsonResponse({ error: 'restaurant_id is required' }, 400);
            }

            const { data: entries, error: fetchErr } = await supabase
                .from('list_entries')
                .select('list_id, lists!inner(owner_id)')
                .eq('restaurant_id', restaurant_id)
                .eq('lists.owner_id', user.id);
            if (fetchErr) throw fetchErr;

            const listIds = (entries ?? []).map((e: any) => e.list_id as string);
            return jsonResponse({ data: listIds });
        }

        return jsonResponse({ error: 'Unknown action' }, 400);

    } catch (err) {
        console.error('lists error:', err);
        return jsonResponse({ error: 'Internal Server Error', details: String(err) }, 500);
    }
});
