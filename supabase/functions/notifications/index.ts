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
import { reportError } from '../_shared/report.ts';
import { emitImportDone } from '../_shared/notify.ts';
import { encodeCursor, decodeCursor, type CursorTuple } from '../_shared/pagination.ts';
import { resolveCanonicalRestaurantIds } from '../_shared/canonicalRestaurant.ts';

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
    | TableInviteAcceptedNotification
    | ImportDoneNotification
    | SupperSetNotification
    | ImageRejectedNotification
    | PassthroughNotification
    | UnknownKindNotification;

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
    // TICKET-133: joined LIVE at hydration (status mutates after the row is
    // written). memberCount is denormalized from subject_meta.
    invitationId: string;
    invitationStatus: 'pending' | 'accepted' | 'declined' | 'expired';
    memberCount: number;
}

interface TableInviteAcceptedNotification extends BaseHydrated {
    type: 'table_invite_accepted';
    actor: { id: string; name: string; avatarUrl: string | null };
    tableName: string;
    tableId: string;
}

interface ImportDoneNotification extends BaseHydrated {
    type: 'import_done';
    count: number;
    outcome: 'saved' | 'review' | 'failed';
    jobId?: string;
}

interface PassthroughNotification extends BaseHydrated {
    type: 'friend_pinned' | 'claim_city' | 'reservation_reminder';
}

/**
 * TICKET-159: self-directed dispatch nudge — "the table gathered at «spot»".
 * Null actor; restaurant hydrates from subject_restaurant_id; supperId deep-links
 * the tap to /supper/[id] (carried in subject_meta by the dispatch transaction).
 */
interface SupperSetNotification extends BaseHydrated {
    type: 'supper_set';
    supperId: string;
    restaurantName: string;
    restaurantId: string | undefined;
    photoUrl: string | null;
}

interface ImageRejectedNotification extends BaseHydrated {
    type: 'image_rejected';
    sinkKind: 'avatar' | 'entry_photo' | 'entry_hero';
    reason: string;
}

/**
 * TICKET-159 (finding 15): the generic forward-compat arm. Any kind this
 * hydrator doesn't recognise still emits a row, so the visible inbox can never
 * show fewer rows than unread_notification_count_for counted (no ghost badge).
 */
interface UnknownKindNotification extends BaseHydrated {
    type: string;
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

    // TICKET-090: a block is total — drop notifications whose ACTOR is someone
    // the recipient has blocked (or who blocked the recipient) before hydration.
    // This is the one surface that actively pushes a blocked user's activity
    // into the blocker's face; the keyset pager treats dropped rows like any
    // other invisible row.
    const { data: blockRows, error: blockErr } = await supabase
        .from('blocked_users')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${recipientUserId},blocked_id.eq.${recipientUserId}`);
    if (blockErr) {
        console.error('inbox hydration: blocked_users failed', blockErr);
        throw new Error(`DB_ERROR: blocked_users hydration failed — ${blockErr.message}`);
    }
    const blockedEitherWay = new Set<string>();
    for (const b of (blockRows ?? []) as { blocker_id: string; blocked_id: string }[]) {
        blockedEitherWay.add(b.blocker_id === recipientUserId ? b.blocked_id : b.blocker_id);
    }
    if (blockedEitherWay.size > 0) {
        rows = rows.filter((r) => !r.actor_user_id || !blockedEitherWay.has(r.actor_user_id));
        if (rows.length === 0) return [];
    }

    const actorIds = unique(rows.map(r => r.actor_user_id).filter(Boolean) as string[]);
    const tableIds = unique(rows.map(r => r.subject_table_id).filter(Boolean) as string[]);
    const restaurantIds = unique(rows.map(r => r.subject_restaurant_id).filter(Boolean) as string[]);
    // Notifications deliberately retain their immutable FK to an alias tombstone.
    // Resolve only for hydration/deep-link output so historical inbox rows survive
    // a merge while always displaying and opening the live canonical restaurant.
    const canonicalBySubject = await resolveCanonicalRestaurantIds(supabase, restaurantIds);
    const canonicalRestaurantIds = unique([...canonicalBySubject.values()]);
    const entryIds = unique(rows.map(r => r.subject_entry_id).filter(Boolean) as string[]);

    // Batch-fetch related entities in parallel.
    const [profilesRes, tablesRes, restaurantsRes, entriesRes] = await Promise.all([
        actorIds.length
            ? supabase.from('profiles').select('user_id, display_name, avatar_url').in('user_id', actorIds)
            : Promise.resolve({ data: [] as { user_id: string; display_name: string; avatar_url: string | null }[], error: null }),
        tableIds.length
            ? supabase.from('tables').select('id, name').in('id', tableIds)
            : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
        canonicalRestaurantIds.length
            ? supabase.from('restaurants').select('id, name, photo_url').in('id', canonicalRestaurantIds)
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
    for (const [subjectId, canonicalId] of canonicalBySubject) {
        const canonical = restaurantById.get(canonicalId);
        if (canonical) restaurantById.set(subjectId, canonical);
    }
    const entryById = byId(entriesRes.data ?? [], 'id');

    // TICKET-133: batch-fetch invitation status for all table_invite rows on the
    // page. Status mutates after the notification is written (accept/decline), so
    // it must be joined LIVE — the invite card renders pending/accepted/declined
    // from this map. Default to 'expired' when the invitation row is gone.
    const invitationIds = unique(
        rows
            .filter((r) => r.kind === 'table_invite')
            .map((r) => (r.subject_meta as { invitation_id?: string } | null)?.invitation_id)
            .filter(Boolean) as string[],
    );
    const invitationStatusById = new Map<string, string>();
    if (invitationIds.length > 0) {
        const { data: invRows, error: invErr } = await supabase
            .from('table_invitations')
            .select('id, status')
            .in('id', invitationIds);
        if (invErr) {
            console.error('inbox hydration: table_invitations failed', invErr);
            throw new Error(`DB_ERROR: table_invitations hydration failed — ${invErr.message}`);
        }
        for (const iv of (invRows ?? []) as { id: string; status: string }[]) {
            invitationStatusById.set(iv.id, iv.status);
        }
    }

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
                    // Entry photos are user uploads and need no Places chrome.
                    // A restaurant fallback could be a Places image; without
                    // room for adjacent attribution in the compact row, fail
                    // closed instead of rendering it bare.
                    photoUrl: entry.photo_url ?? null,
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
                const meta = (r.subject_meta ?? {}) as { invitation_id?: string; member_count?: number };
                const invitationId = meta.invitation_id ?? '';
                // LIVE status: default 'expired' when the row is gone (declined
                // rows persist as 'declined'; a missing row means deleted table).
                const rawStatus = invitationId ? invitationStatusById.get(invitationId) : undefined;
                const invitationStatus =
                    rawStatus === 'pending' || rawStatus === 'accepted' ||
                    rawStatus === 'declined' || rawStatus === 'expired'
                        ? rawStatus
                        : 'expired';
                out.push({
                    id: r.id,
                    type: 'table_invite',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                    actor: { id: actor.user_id, name: actor.display_name, avatarUrl: actor.avatar_url ?? null },
                    tableName: table.name,
                    tableId: table.id,
                    invitationId,
                    invitationStatus,
                    memberCount: typeof meta.member_count === 'number' ? meta.member_count : 0,
                });
                break;
            }

            case 'table_invite_accepted': {
                // TICKET-133: goes to the inviter. actor = joiner, subject = table.
                const table = r.subject_table_id ? tableById.get(r.subject_table_id) : null;
                if (!actor || !table) continue;
                out.push({
                    id: r.id,
                    type: 'table_invite_accepted',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                    actor: { id: actor.user_id, name: actor.display_name, avatarUrl: actor.avatar_url ?? null },
                    tableName: table.name,
                    tableId: table.id,
                });
                break;
            }

            case 'import_done': {
                // TICKET-123: self-directed (actor-less) import lifecycle row.
                // No joins — count/outcome/job_id ride in subject_meta straight
                // from the producer (server save_spots or the emit_self action).
                const meta = (r.subject_meta ?? {}) as {
                    job_id?: string | null;
                    count?: number;
                    outcome?: string;
                };
                const outcome =
                    meta.outcome === 'saved' || meta.outcome === 'review' || meta.outcome === 'failed'
                        ? meta.outcome
                        : 'saved';
                out.push({
                    id: r.id,
                    type: 'import_done',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                    count: typeof meta.count === 'number' ? meta.count : 0,
                    outcome,
                    jobId: meta.job_id ?? undefined,
                });
                break;
            }

            case 'supper_set': {
                // TICKET-159: self-directed (null actor) dispatch nudge. The
                // restaurant is already prefetched via subject_restaurant_id;
                // the supper deep link rides subject_meta.supper_id.
                const meta = (r.subject_meta ?? {}) as { supper_id?: string };
                const restaurant = r.subject_restaurant_id
                    ? restaurantById.get(r.subject_restaurant_id)
                    : null;
                out.push({
                    id: r.id,
                    type: 'supper_set',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                    supperId: meta.supper_id ?? '',
                    restaurantName: restaurant?.name ?? '',
                    restaurantId: restaurant?.id,
                    photoUrl: restaurant?.photo_url ?? null,
                });
                break;
            }

            case 'image_rejected': {
                const meta = (r.subject_meta ?? {}) as {
                    sink_kind?: string;
                    reason?: string;
                };
                const sinkKind = meta.sink_kind === 'avatar' ||
                        meta.sink_kind === 'entry_photo' ||
                        meta.sink_kind === 'entry_hero'
                    ? meta.sink_kind
                    : 'entry_photo';
                out.push({
                    id: r.id,
                    type: 'image_rejected',
                    read: !!r.read_at,
                    createdAt: r.created_at,
                    timeLabel: formatTimeLabel(r.created_at),
                    sinkKind,
                    reason: typeof meta.reason === 'string' ? meta.reason : 'moderation_rejected',
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

            default:
                // TICKET-159 (finding 15): NEVER silently drop an unknown kind —
                // unread_notification_count_for counts every non-friend_logged
                // row, so a dropped row would leave a ghost unread badge. Emit a
                // generic self-directed row; the client renders its own fallback.
                out.push({
                    id: r.id,
                    type: r.kind,
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

        // ── emit_self (TICKET-123) ─────────────────────────────────────────────
        // The client import drain has no service-role INSERT of its own, so it
        // calls this to write its OWN `import_done` row at the review-hold and
        // poison checkpoints (the auto-save path rides resolve-url?save_spots
        // instead). Security is by construction: the only reachable write is an
        // import_done row in the caller's OWN inbox with a null actor —
        //   • recipient is FORCED to the authenticated token user (never the body),
        //   • kind is hard-pinned to 'import_done' (no social kind is forgeable),
        //   • outcome is whitelisted, count/job_id are coerced before the insert.
        // No field of the request can redirect the write to another user or forge
        // a social kind. The notifications_lock_columns trigger still bars any
        // post-hoc mutation beyond read_at.
        if (action === 'emit_self') {
            const kind: string = body.kind ?? '';
            if (kind !== 'import_done') {
                return new Response(
                    JSON.stringify({ error: { code: 'INVALID_INPUT', message: "kind must be 'import_done'" } }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }

            const meta = (body.subject_meta ?? {}) as {
                job_id?: unknown;
                count?: unknown;
                outcome?: unknown;
            };
            const outcome = meta.outcome;
            // 'saved' is server-emitted only (rides resolve-url save_spots) — the
            // client path may not forge a "pinned" row into its own inbox.
            if (outcome !== 'review' && outcome !== 'failed') {
                return new Response(
                    JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'outcome must be review|failed' } }),
                    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
                );
            }
            const rawCount = Number(meta.count);
            const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.floor(rawCount) : 0;
            const jobId = typeof meta.job_id === 'string' ? meta.job_id : null;

            // Recipient FORCED to the token user; DRY via the shared emitter (the
            // same insert shape the server auto path uses). Best-effort — a failed
            // insert never throws, so a flaky row never fails the caller's import.
            await emitImportDone(supabase, {
                recipientUserId: user.id,
                jobId,
                count,
                outcome,
            });
            return new Response(
                JSON.stringify({ data: { ok: true } }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
        }

        return new Response(
            JSON.stringify({ error: { code: 'INVALID_ACTION', message: `Unknown action: ${action}` } }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );

    } catch (err) {
        console.error('[notifications] unhandled error:', err);
        reportError(err, { fn: 'notifications' });
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
