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
 *   map_pins         — all my-list entries with lat/lng + owning list emoji (wishlist map)
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
    /** TICKET-108: user-chosen emoji for the map pin + Lists row. Nullable. */
    emoji: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * TICKET-108: validate + normalize an incoming emoji value.
 * Returns `undefined` (leave column untouched), `null` (clear), or a ≤8-char
 * string. The client picker is the real constraint (curated set + 1-grapheme
 * free entry); this is the server-side length backstop mirroring the CHECK.
 */
function normalizeEmoji(raw: unknown): string | null | undefined {
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // char_length <= 8 backstop (matches the column CHECK). Reject longer.
    return [...trimmed].slice(0, 8).join('');
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
            // TICKET-108: optional emoji at creation. undefined → omit (column default null).
            const emoji = normalizeEmoji(body.emoji);

            const { data: list, error: listErr } = await supabase
                .from('lists')
                .insert({
                    owner_id: user.id,
                    title,
                    description,
                    ranked,
                    privacy,
                    ...(emoji !== undefined ? { emoji } : {}),
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
            // TICKET-108: emoji — explicit null clears it back to the teardrop.
            const emojiUpdate = normalizeEmoji(body.emoji);
            if (emojiUpdate !== undefined) {
                updates.emoji = emojiUpdate;
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

            // TICKET-074 fix-pass (Codex): verified entry counts for ALL lists in
            // ONE query (no per-list N+1). Share eligibility gates on this — the
            // handoff snapshot freezes verified spots only, so a list whose every
            // entry is unverified must not offer share (it would 400 EMPTY_LIST).
            const listIds = (lists ?? []).map((l: ListRow) => l.id);
            const verifiedCounts = new Map<string, number>();
            if (listIds.length > 0) {
                const { data: verifiedRows, error: verifiedErr } = await supabase
                    .from('list_entries')
                    .select('list_id, restaurant:restaurants!inner(verification)')
                    .in('list_id', listIds)
                    .eq('restaurant.verification', 'verified');
                if (verifiedErr) throw verifiedErr;
                for (const row of (verifiedRows ?? []) as Array<{ list_id: string }>) {
                    verifiedCounts.set(row.list_id, (verifiedCounts.get(row.list_id) ?? 0) + 1);
                }
            }

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
                        verified_count: verifiedCounts.get(list.id) ?? 0,
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
                        external_id,
                        verification,
                        lat,
                        lng
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

        // ── add_entries (bulk) ─────────────────────────────────────────────
        // Fast "import from saved sources" path: add many already-persisted
        // restaurants to a list in ONE call (e.g. from the wishlist multi-select).
        // Idempotent — restaurants already in the list are skipped (the unique
        // (list_id, restaurant_id) index). Returns the authoritative entry_count
        // so the client can reconcile its optimistic +N patch (dupes were skipped).
        if (action === 'add_entries') {
            const { list_id } = body;
            const rawIds: unknown = body.restaurant_ids;
            const restaurantIds: string[] = Array.isArray(rawIds)
                ? rawIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
                : [];
            if (!list_id) return jsonResponse({ error: 'list_id is required' }, 400);
            if (restaurantIds.length === 0) {
                return jsonResponse({ error: 'restaurant_ids must be a non-empty array' }, 400);
            }
            // Dedup the request + cap defensively against a runaway insert.
            const ids = [...new Set(restaurantIds)].slice(0, 200);

            // Verify caller owns the list
            const { data: list, error: listErr } = await supabase
                .from('lists')
                .select('id, owner_id')
                .eq('id', list_id)
                .eq('owner_id', user.id)
                .maybeSingle();
            if (listErr) throw listErr;
            if (!list) return jsonResponse({ error: 'Not found' }, 404);

            // Validate the ids resolve to REAL restaurants. The bulk insert is one
            // statement — a single bogus id (stale cache / unpersisted ghost) would
            // 23503 and abort the WHOLE batch. Pre-filter to the ones that exist.
            const { data: realRows, error: realErr } = await supabase
                .from('restaurants')
                .select('id')
                .in('id', ids);
            if (realErr) throw realErr;
            const realSet = new Set((realRows ?? []).map((r: { id: string }) => r.id));
            const validIds = ids.filter((rid) => realSet.has(rid));

            let added: ListEntry[] = [];
            if (validIds.length > 0) {
                const startPos = await nextPosition(supabase, list_id);
                const rows = validIds.map((rid, i) => ({
                    list_id,
                    restaurant_id: rid,
                    note: null,
                    position: startPos + i * 1024,
                }));
                // Atomic idempotency: ON CONFLICT (list_id, restaurant_id) DO NOTHING.
                // A dupe (concurrent import / double-tap) is skipped, not a 23505 that
                // rolls back the batch. ignoreDuplicates → only NEW rows are returned.
                const { data: inserted, error: insertErr } = await supabase
                    .from('list_entries')
                    .upsert(rows, { onConflict: 'list_id,restaurant_id', ignoreDuplicates: true })
                    .select('*');
                if (insertErr) throw insertErr;
                added = (inserted ?? []) as ListEntry[];
            }

            // Authoritative total after the insert — drives cache reconciliation.
            const { count } = await supabase
                .from('list_entries')
                .select('id', { count: 'exact', head: true })
                .eq('list_id', list_id);

            return jsonResponse({
                data: {
                    added,
                    added_count: added.length,
                    // skipped = already in the list + ids that don't resolve.
                    skipped_count: ids.length - added.length,
                    entry_count: count ?? 0,
                },
            });
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

        // ── map_pins ──────────────────────────────────────────────────────
        // TICKET-108: every restaurant across the caller's OWN lists, with the
        // owning list's emoji + updated_at, in ONE round-trip (list_mine returns
        // metadata only — no per-entry coords). Drives the wishlist map's
        // list-entry pins. Owner-scoped by design.
        //
        // Cross-Set seam (Set 4 table-lists): if lists can be owned by a Table
        // rather than a user, this predicate must widen to "my lists + my
        // Tables' lists". Kept narrow (owner_id = user.id) here — Set 4 widens.
        if (action === 'map_pins') {
            // My lists first (id + emoji + updated_at), so we can attach the
            // owning list's emoji/updated_at to each entry client-agnostically.
            const { data: myLists, error: myListsErr } = await supabase
                .from('lists')
                .select('id, emoji, updated_at')
                .eq('owner_id', user.id);
            if (myListsErr) throw myListsErr;

            const listMeta = new Map<string, { emoji: string | null; updated_at: string }>();
            for (const l of (myLists ?? []) as Array<{ id: string; emoji: string | null; updated_at: string }>) {
                listMeta.set(l.id, { emoji: l.emoji ?? null, updated_at: l.updated_at });
            }
            const myListIds = [...listMeta.keys()];
            if (myListIds.length === 0) {
                return jsonResponse({ data: [] });
            }

            // Join entries → restaurants (single FK, unambiguous), coords only.
            const { data: rows, error: rowsErr } = await supabase
                .from('list_entries')
                .select(`
                    list_id,
                    restaurant:restaurants (
                        id,
                        name,
                        city,
                        cuisine,
                        price_level,
                        lat,
                        lng
                    )
                `)
                .in('list_id', myListIds)
                .not('restaurant.lat', 'is', null)
                .not('restaurant.lng', 'is', null);
            if (rowsErr) throw rowsErr;

            const pins = [];
            for (const row of (rows ?? []) as Array<{ list_id: string; restaurant: any }>) {
                const r = row.restaurant;
                // The inner-embed lat/lng filter can still return rows with a
                // null restaurant embed on some PostgREST versions — belt-and-
                // braces: skip anything without coords.
                if (!r || r.lat == null || r.lng == null) continue;
                const meta = listMeta.get(row.list_id);
                pins.push({
                    restaurant_id: r.id as string,
                    name: r.name as string,
                    city: (r.city ?? null) as string | null,
                    cuisine: (r.cuisine ?? null) as string | null,
                    price_level: (r.price_level ?? null) as number | null,
                    lat: r.lat as number,
                    lng: r.lng as number,
                    list_id: row.list_id,
                    emoji: meta?.emoji ?? null,
                    list_updated_at: meta?.updated_at ?? null,
                });
            }

            return jsonResponse({ data: pins });
        }

        return jsonResponse({ error: 'Unknown action' }, 400);

    } catch (err) {
        console.error('lists error:', err);
        return jsonResponse({ error: 'Internal Server Error', details: String(err) }, 500);
    }
});
