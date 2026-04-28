/**
 * TICKET-048: Notifications edge function.
 *
 * Three POST actions:
 *   inbox        — paginated inbox with hydration + unread_count (first page only)
 *   mark_read    — flip read_at for one notification row
 *   mark_all_read — bulk-flip read_at for all unread rows of the caller
 *
 * Pattern: service-role client + manual getUser(token) + corsHeaders.
 * Mirrors top-fours/index.ts.
 *
 * Pagination: opts out of applyKeysetFilter (which keys on sort_date, not
 * created_at) and inlines the keyset filter. Cursors still go through
 * encodeCursor / decodeCursor from the shared helper.
 *
 * Hydration: server-side in TS (consistent with restaurant-history, feed).
 * friend_logged rows are re-checked at read-time via the SECURITY DEFINER
 * RPC can_recipient_view_entry(recipient_id, entry_id) — DO NOT re-implement
 * the predicate in TS; use the RPC.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';
import { encodeCursor, decodeCursor, type CursorTuple } from '../_shared/pagination.ts';

// ── Wire types ────────────────────────────────────────────────────────────────

interface RawNotificationRow {
    id: string;
    kind: string;
    actor_user_id: string | null;
    subject_table_id: string | null;
    subject_entry_id: string | null;
    subject_restaurant_id: string | null;
    subject_text: string | null;
    subject_meta: Record<string, unknown>;
    created_at: string;
    read_at: string | null;
}

// Discriminated-union shape matching useNotifications client types exactly.
type HydratedNotification =
    | FriendLoggedNotification
    | TopFourSwapNotification
    | TableInviteNotification
    | PassthroughNotification;

interface BaseHydrated {
    id: string;
    read: boolean;
    createdAt: string;
    timeLabel: string;
}

interface FriendLoggedNotification extends BaseHydrated {
    type: 'friend_logged';
    actor: { id: string; name: string; avatarUrl: string | null };
    restaurantName: string;
    restaurantId: string | undefined;
    photoUrl: string | null;
    quote: string | undefined;
    youveBeen: boolean;
}

interface TopFourSwapNotification extends BaseHydrated {
    type: 'top_four_swap';
    actor: { id: string; name: string; avatarUrl: string | null };
    addedName: string;
    removedName: string;
    tableName: string;
    photoUrl: null;
}

interface TableInviteNotification extends BaseHydrated {
    type: 'table_invite';
    actor: { id: string; name: string; avatarUrl: string | null };
    tableName: string;
    tableId: string;
}

interface PassthroughNotification extends BaseHydrated {
    type: 'friend_pinned' | 'claim_city' | 'reservation_reminder';
}

interface InboxResponse {
    rows: HydratedNotification[];
    next_cursor: string | null;
    has_more: boolean;
    unread_count: number | null; // populated only on first page (cursor === null)
}

const PAGE_SIZE = 30;
const MAX_LOOPS = 3;

// ── Inline keyset filter ──────────────────────────────────────────────────────
// applyKeysetFilter from _shared/pagination.ts keys on sort_date (a SELECT
// alias), but PostgREST resolves .lt('sort_date', ...) against a real column.
// We inline the filter using created_at instead.
function applyNotificationKeyset<Q extends { or: (...args: unknown[]) => Q }>(
    q: Q,
    cursor: CursorTuple | null,
): Q {
    if (!cursor) return q;
    return q.or(
        `created_at.lt.${cursor.sort_date},and(created_at.eq.${cursor.sort_date},id.lt.${cursor.id})`,
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function unique<T>(arr: T[]): T[] {
    return [...new Set(arr)];
}

function byId<T>(rows: T[], key: keyof T): Map<string, T> {
    const m = new Map<string, T>();
    for (const r of rows) {
        const k = r[key];
        if (typeof k === 'string') m.set(k, r);
    }
    return m;
}

/**
 * Format a time label. Prefer day + period of day for ≥1 day ago.
 * Same-day: "Nh ago" (hour granularity).
 */
function formatTimeLabel(createdAtIso: string): string {
    const created = new Date(createdAtIso);
    const now = new Date();
    const diffMs = now.getTime() - created.getTime();
    const diffH = diffMs / (1000 * 60 * 60);

    if (diffH < 1) return 'just now';
    if (diffH < 24) return `${Math.floor(diffH)}h ago`;

    // ≥ 1 day: "Wednesday morning" style
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[created.getDay()];
    const hour = created.getHours();
    let period = '';
    if (hour < 12) period = ' morning';
    else if (hour < 17) period = '';
    else period = ' evening';

    if (diffH < 48) return `Yesterday${period || ''}`;
    return `${dayName}${period}`;
}

/**
 * Build a quote string from entry rating + content.
 * Returns undefined if no content exists.
 */
function buildQuote(entry: { rating: number | null; content: string | null }): string | undefined {
    const content = entry.content?.trim();
    if (!content) return undefined;
    const stars = entry.rating ? ` ${'★'.repeat(Math.round(entry.rating))}` : '';
    return `"${content}${stars}"`;
}

/**
 * Check if the recipient has been to the given restaurant.
 * Best-effort — returns false on error.
 */
async function viewerHasBeen(
    supabase: SupabaseClient,
    recipientUserId: string,
    restaurantId: string | null,
): Promise<boolean> {
    if (!restaurantId) return false;
    try {
        const { data } = await supabase
            .from('user_restaurant_status')
            .select('been')
            .eq('user_id', recipientUserId)
            .eq('restaurant_id', restaurantId)
            .maybeSingle();
        return (data as { been?: boolean } | null)?.been === true;
    } catch {
        return false;
    }
}

// ── Hydration ─────────────────────────────────────────────────────────────────

async function hydrate(
    supabase: SupabaseClient,
    rows: RawNotificationRow[],
    recipientUserId: string,
): Promise<HydratedNotification[]> {
    if (rows.length === 0) return [];

    const actorIds = unique(rows.map(r => r.actor_user_id).filter(Boolean) as string[]);
    const tableIds = unique(rows.map(r => r.subject_table_id).filter(Boolean) as string[]);
    const restaurantIds = unique(rows.map(r => r.subject_restaurant_id).filter(Boolean) as string[]);
    const entryIds = unique(rows.map(r => r.subject_entry_id).filter(Boolean) as string[]);

    // Batch-fetch related entities in parallel.
    const [profilesRes, tablesRes, restaurantsRes, entriesRes] = await Promise.all([
        actorIds.length
            ? supabase.from('profiles').select('user_id, display_name, avatar_url').in('user_id', actorIds)
            : Promise.resolve({ data: [] as { user_id: string; display_name: string; avatar_url: string | null }[], error: null }),
        tableIds.length
            ? supabase.from('tables').select('id, name').in('id', tableIds)
            : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
        restaurantIds.length
            ? supabase.from('restaurants').select('id, name, photo_url').in('id', restaurantIds)
            : Promise.resolve({ data: [] as { id: string; name: string; photo_url: string | null }[], error: null }),
        entryIds.length
            ? supabase.from('entries').select('id, user_id, table_id, rating, content, photo_url, restaurant_id, visited_at, visibility').in('id', entryIds)
            : Promise.resolve({ data: [] as { id: string; user_id: string; table_id: string | null; rating: number | null; content: string | null; photo_url: string | null; restaurant_id: string | null; visited_at: string; visibility: string }[], error: null }),
    ]);

    // Fix #2 (Codex review 2026-04-28): check each hydration query for errors.
    // A schema drift or transient DB error must not silently produce blank fields
    // while unread_count still reports unread. Fail loudly so the caller surfaces
    // an error UI rather than a mysteriously empty inbox.
    if (profilesRes.error) {
        console.error('inbox hydration: profiles failed', profilesRes.error);
        throw new Error(`DB_ERROR: profiles hydration failed — ${profilesRes.error.message}`);
    }
    if (tablesRes.error) {
        console.error('inbox hydration: tables failed', tablesRes.error);
        throw new Error(`DB_ERROR: tables hydration failed — ${tablesRes.error.message}`);
    }
    if (restaurantsRes.error) {
        console.error('inbox hydration: restaurants failed', restaurantsRes.error);
        throw new Error(`DB_ERROR: restaurants hydration failed — ${restaurantsRes.error.message}`);
    }
    if (entriesRes.error) {
        console.error('inbox hydration: entries failed', entriesRes.error);
        throw new Error(`DB_ERROR: entries hydration failed — ${entriesRes.error.message}`);
    }

    const profileById = byId(profilesRes.data ?? [], 'user_id');
    const tableById = byId(tablesRes.data ?? [], 'id');
    const restaurantById = byId(restaurantsRes.data ?? [], 'id');
    const entryById = byId(entriesRes.data ?? [], 'id');

    // friend_logged needs visibility re-check via the SECURITY DEFINER RPC
    // can_recipient_view_entry(recipient_id, entry_id) added in this migration.
    // DO NOT re-implement the predicate in TS — it would drift.

    const out: HydratedNotification[] = [];
    for (const r of rows) {
        const actor = r.actor_user_id ? profileById.get(r.actor_user_id) : null;

        switch (r.kind) {
            case 'friend_logged': {
                const entry = r.subject_entry_id ? entryById.get(r.subject_entry_id) : null;
                if (!entry) continue; // entry deleted: silently drop (belt-and-suspenders; FK cascade handles this)

                // Visibility re-check via SECURITY DEFINER RPC (NOT a TS reimpl).
                const { data: visible } = await supabase.rpc('can_recipient_view_entry', {
                    p_recipient_id: recipientUserId,
                    p_entry_id: entry.id,
                });
                if (visible !== true) continue;

                const restaurant = r.subject_restaurant_id
                    ? restaurantById.get(r.subject_restaurant_id)
                    : null;

                const actorProfile = actor
                    ? { id: actor.user_id, name: actor.display_name, avatarUrl: actor.avatar_url ?? null }
                    : { id: '', name: 'Someone', avatarUrl: null };

                out.push({
                    id: r.id,
                    type: 'friend_logged',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                    actor: actorProfile,
                    restaurantName: restaurant?.name ?? '',
                    restaurantId: restaurant?.id,
                    photoUrl: entry.photo_url ?? restaurant?.photo_url ?? null,
                    quote: buildQuote(entry),
                    youveBeen: await viewerHasBeen(supabase, recipientUserId, restaurant?.id ?? null),
                });
                break;
            }

            case 'top_four_swap': {
                const meta = (r.subject_meta ?? {}) as { added_name?: string; removed_name?: string };
                const table = r.subject_table_id ? tableById.get(r.subject_table_id) : null;
                if (!actor || !table) continue;
                out.push({
                    id: r.id,
                    type: 'top_four_swap',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                    actor: { id: actor.user_id, name: actor.display_name, avatarUrl: actor.avatar_url ?? null },
                    addedName: meta.added_name ?? '',
                    removedName: meta.removed_name ?? '',
                    tableName: table.name,
                    photoUrl: null,
                });
                break;
            }

            case 'table_invite': {
                const table = r.subject_table_id ? tableById.get(r.subject_table_id) : null;
                if (!actor || !table) continue;
                out.push({
                    id: r.id,
                    type: 'table_invite',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                    actor: { id: actor.user_id, name: actor.display_name, avatarUrl: actor.avatar_url ?? null },
                    tableName: table.name,
                    tableId: table.id,
                });
                break;
            }

            case 'friend_pinned':
            case 'claim_city':
            case 'reservation_reminder':
                // Deferred producers: rows will exist in future tickets; passthrough.
                out.push({
                    id: r.id,
                    type: r.kind as 'friend_pinned' | 'claim_city' | 'reservation_reminder',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                });
                break;
        }
    }
    return out;
}

// ── Loop-fetch: hydration may drop friend_logged rows ─────────────────────────
// If hydration filters out friend_logged rows, we may end up with fewer than
// PAGE_SIZE visible results. We loop (bounded by MAX_LOOPS) to fill the page.
//
// Fix #1 (Codex review-2 2026-04-28) — sentinel data-loss fix:
// We must visibility-check the sentinel (raw[PAGE_SIZE]) before using it as a
// cursor, otherwise a visible sentinel row would be silently unreachable in the
// next page (current page didn't include it; next page's strict-< keyset skips it).
//
// Solution: hydrate ALL PAGE_SIZE+1 raw rows in every iteration, not just the
// first PAGE_SIZE. We stop collecting into `visible` after we have PAGE_SIZE+1
// (enough to know has_more), but every row fetched is hydrated and checked.
// `lastRawRow` is always the last hydrated+checked row of the final chunk —
// never an unexamined sentinel.
//
// Pagination semantics:
// • Loop until (a) visible.length >= PAGE_SIZE+1, OR (b) raw exhausted, OR (c) loop cap.
// • Case (a): take first PAGE_SIZE, has_more=true, next_cursor = cursor of visible[PAGE_SIZE-1].
// • Case (b): take all visible, has_more=false, next_cursor=null.
// • Case (c): take all visible, has_more=true, next_cursor = cursor of lastRawRow
//   (which IS hydrated/checked, safe to use as a cursor to advance past the gap).

async function fetchVisiblePage(
    supabase: SupabaseClient,
    userId: string,
    initialCursor: CursorTuple | null,
): Promise<{
    rows: HydratedNotification[];
    has_more: boolean;
    next_cursor: string | null;
}> {
    // Collect PAGE_SIZE + 1 visible rows so we can detect has_more.
    const visible: HydratedNotification[] = [];
    let cursor = initialCursor;
    let rawExhausted = false;
    let lastRawRow: RawNotificationRow | null = null;
    let loops = 0;

    while (visible.length < PAGE_SIZE + 1 && loops < MAX_LOOPS) {
        let q = supabase
            .from('notifications')
            .select('id, kind, actor_user_id, subject_table_id, subject_entry_id, ' +
                    'subject_restaurant_id, subject_text, subject_meta, created_at, read_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(PAGE_SIZE + 1);
        q = applyNotificationKeyset(q as Parameters<typeof applyNotificationKeyset>[0], cursor);
        const { data: rawRows, error } = await q;
        if (error) throw error;
        const raw = rawRows as RawNotificationRow[] ?? [];

        // Track the last raw row of this chunk. Because we now hydrate ALL rows
        // in the chunk (see below), this is always a visibility-checked row —
        // never an unexamined sentinel.
        if (raw.length > 0) lastRawRow = raw[raw.length - 1];

        // raw.length < PAGE_SIZE + 1 means there are no more rows after this batch.
        if (raw.length < PAGE_SIZE + 1) {
            rawExhausted = true;
            // Hydrate everything — no sentinel to worry about.
            const hydrated = await hydrate(supabase, raw, userId);
            visible.push(...hydrated);
            break;
        }

        // raw.length === PAGE_SIZE + 1: more rows MAY exist.
        // Hydrate ALL PAGE_SIZE+1 rows so the sentinel is visibility-checked
        // before we use it as a cursor. Without this, a visible sentinel would
        // be dropped: not included in this page (only first PAGE_SIZE returned)
        // AND skipped by the next page's strict-< keyset.
        const hydrated = await hydrate(supabase, raw, userId);
        visible.push(...hydrated);

        // Advance cursor past the entire chunk (to the sentinel row, raw[PAGE_SIZE]).
        // That row is now hydrated; if it was visible it's already in `visible`.
        const tail = raw[PAGE_SIZE]; // the sentinel — now always hydrated
        cursor = { sort_date: tail.created_at, id: tail.id };
        loops++;
    }

    const hitLoopCap = loops >= MAX_LOOPS && !rawExhausted;

    if (visible.length > PAGE_SIZE) {
        // Case (a): have more than a full page of visible rows.
        const pageRows = visible.slice(0, PAGE_SIZE);
        const lastRow = pageRows[pageRows.length - 1];
        return {
            rows: pageRows,
            has_more: true,
            next_cursor: encodeCursor({ sort_date: lastRow.createdAt, id: lastRow.id }),
        };
    }

    if (rawExhausted) {
        // Case (b): raw rows exhausted, fewer than PAGE_SIZE + 1 visible.
        return {
            rows: visible,
            has_more: false,
            next_cursor: null,
        };
    }

    // Case (c): loop cap hit, fewer than PAGE_SIZE + 1 visible.
    // Use the last raw row's cursor — it is always hydrated/checked at this point
    // (we hydrate all PAGE_SIZE+1 per chunk), so no visible row is unreachable.
    const fallbackCursor = lastRawRow
        ? encodeCursor({ sort_date: lastRawRow.created_at, id: lastRawRow.id })
        : null;
    return {
        rows: visible,
        has_more: !!fallbackCursor,
        next_cursor: fallbackCursor,
    };
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Missing Authorization header' } }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const token = authHeader.replace('Bearer ', '');
        const supabase = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
        );

        const { data: { user }, error: userError } = await supabase.auth.getUser(token);
        if (userError || !user) {
            return new Response(
                JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        if (req.method !== 'POST') {
            return new Response(
                JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }),
                { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        const body = await req.json();
        const action: string = body.action ?? '';

        // ── inbox ────────────────────────────────────────────────────────────
        if (action === 'inbox') {
            const rawCursor: string | null = body.cursor ?? null;
            const cursor = decodeCursor(rawCursor);

            const { rows, has_more, next_cursor } =
                await fetchVisiblePage(supabase, user.id, cursor);

            // Fix #4 (Codex review 2026-04-28): unread_count is computed via the
            // SECURITY DEFINER RPC unread_notification_count_for, which applies the
            // same visibility filter as hydration at DB-side — no TS-side cap needed.
            // Only computed on the first page (rawCursor === null) to avoid waste.
            let unread_count: number | null = null;
            if (!rawCursor) {
                const { data: countData, error: countErr } = await supabase
                    .rpc('unread_notification_count_for', { p_recipient_id: user.id });
                if (countErr) {
                    console.error('[notifications] unread_notification_count_for failed:', countErr);
                    unread_count = 0;
                } else {
                    unread_count = (countData as number) ?? 0;
                }
            }

            const response: InboxResponse = { rows, next_cursor, has_more, unread_count };
            return new Response(
                JSON.stringify({ data: response }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // ── mark_read ────────────────────────────────────────────────────────
        if (action === 'mark_read') {
            const notificationId: string = body.notification_id ?? '';
            if (!notificationId) {
                return new Response(
                    JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'notification_id is required' } }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            const { data, error } = await supabase
                .from('notifications')
                .update({ read_at: new Date().toISOString() })
                .eq('id', notificationId)
                .eq('user_id', user.id)
                .is('read_at', null)
                .select()
                .maybeSingle();

            if (error) {
                return new Response(
                    JSON.stringify({ error: { code: 'DB_ERROR', message: error.message } }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }
            return new Response(
                JSON.stringify({ data }), // null if already read or not found — fine
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        // ── mark_all_read ────────────────────────────────────────────────────
        if (action === 'mark_all_read') {
            const { data, error, count } = await supabase
                .from('notifications')
                .update({ read_at: new Date().toISOString() })
                .eq('user_id', user.id)
                .is('read_at', null)
                .select('id', { count: 'exact' });

            if (error) {
                return new Response(
                    JSON.stringify({ error: { code: 'DB_ERROR', message: error.message } }),
                    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }
            return new Response(
                JSON.stringify({ data: { updated: count ?? 0 } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        return new Response(
            JSON.stringify({ error: { code: 'INVALID_ACTION', message: `Unknown action: ${action}` } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );

    } catch (err) {
        console.error('[notifications] unhandled error:', err);
        const msg = err instanceof Error ? err.message : String(err);
        // Hydration failures bubble up as `Error('DB_ERROR: ...')`. Surface them
        // as code: 'DB_ERROR' so clients/log pipeline can distinguish DB issues
        // from unexpected fn bugs. Anything else is INTERNAL_ERROR.
        const isDbError = msg.startsWith('DB_ERROR');
        return new Response(
            JSON.stringify({
                error: {
                    code: isDbError ? 'DB_ERROR' : 'INTERNAL_ERROR',
                    message: isDbError ? msg.replace(/^DB_ERROR:\s*/, '') : msg,
                },
            }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }
});
