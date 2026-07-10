/**
 * buildGatheringCard — TICKET-136.
 *
 * The single-row parallel of table-activity's batched gathering hydration
 * (supabase/functions/table-activity/index.ts ~lines 989–1056). It is the pure
 * assembly the `get` action calls: given one gathering row + its RSVPs + the
 * current roster + a profile map + the restaurant + the host's pinned source, it
 * produces the SAME `GatheringCardActivity` shape the feed card consumes.
 *
 * This lives co-located with the `gatherings` function (NOT in `_shared/`): only
 * `handleGet` calls it, so it never forces one signature across the hot feed
 * path and the cold detail path. table-activity keeps its own inline batched copy.
 * A Deno shape-parity test (`buildCard.test.ts`) guards the 7-point parity
 * contract against this file — importing `index.ts` directly would boot `serve()`.
 *
 * Parity contract (must match table-activity field-for-field):
 *  1. Seats = the CURRENT roster only, each { user_id, display_name, avatar_url,
 *     is_host, response }, sorted host → 'in' → undecided → 'out' (seatRank).
 *  2. Ex-member drop rule, three places: seats derive from the roster; counters
 *     are filtered to roster members; in_count counts roster-filtered 'in' seats.
 *  3. viewer_response = the caller's rsvp response or null.
 *  4. host_name resolves off the profile map even when the host LEFT the table
 *     (the caller must include the host in the profile fetch).
 *  5. source_url/source_type come from the host's (host, restaurant) wishlist
 *     source — the caller looks it up on the composite key, never a bare match.
 *  6. restaurant = { id, name, city, photo_url } | null; rescheduled_from,
 *     note, gather_on, status, supper_id from the row.
 *  7. type: 'gathering'; created_at = row.created_at. sort_date = row.created_at
 *     (the ONE field not byte-identical to the feed's ordering value — neither
 *     surface renders sort_date, so it's safe).
 */

export type GatheringResponse = 'in' | 'out' | 'counter' | null;

export interface GatheringRowInput {
    id: string;
    table_id: string;
    restaurant_id: string | null;
    host_user_id: string | null;
    note: string | null;
    gather_on: string;
    status: string;
    supper_id: string | null;
    rescheduled_from: string | null;
    created_at: string;
}

export interface RsvpInput {
    user_id: string;
    response: string;
    counter_on: string | null;
}

export interface ProfileInput {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
}

export interface RestaurantInput {
    id: string;
    name: string;
    city: string | null;
    photo_url: string | null;
}

export interface SourceInput {
    type?: string;
    url?: string;
}

export interface GatheringSeatShape {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    is_host: boolean;
    response: GatheringResponse;
}

export interface GatheringCounterShape {
    user_id: string;
    display_name: string | null;
    counter_on: string;
}

export interface GatheringCardShape {
    id: string;
    type: 'gathering';
    sort_date: string;
    table_id: string;
    restaurant: RestaurantInput | null;
    host_user_id: string | null;
    host_name: string | null;
    note: string | null;
    gather_on: string;
    status: string;
    supper_id: string | null;
    seats: GatheringSeatShape[];
    in_count: number;
    viewer_response: GatheringResponse;
    counters: GatheringCounterShape[];
    source_url: string | null;
    source_type: string | null;
    rescheduled_from: string | null;
    created_at: string;
}

/**
 * Assemble the gathering card for a single row. Pure — no DB, no side effects.
 * `rosterIds` is the CURRENT table roster (table_members.member_id); everything
 * else (rsvps, profiles, restaurant, source) is looked up by the caller.
 */
export function buildGatheringCard(
    row: GatheringRowInput,
    rsvps: RsvpInput[],
    rosterIds: string[],
    profMap: Map<string, ProfileInput>,
    restaurant: RestaurantInput | null,
    source: SourceInput | undefined,
    viewerId: string,
): GatheringCardShape {
    const hostUserId = row.host_user_id ?? null;

    // Per-user response lookup (all RSVPs; ex-members are dropped by the roster
    // gate below, exactly like table-activity's rsvpByGatheringUser map).
    const rsvpByUser = new Map<string, string>();
    for (const r of rsvps) rsvpByUser.set(r.user_id, r.response);

    // Seats = every CURRENT table member: host → 'in' → undecided → 'out'.
    // RSVPs from ex-members simply drop out (they never appear in rosterIds).
    const seatRank = (s: GatheringSeatShape) =>
        s.is_host ? 0 : s.response === 'in' ? 1 : s.response == null ? 2 : 3;
    const seats: GatheringSeatShape[] = rosterIds
        .map((uid) => {
            const prof = profMap.get(uid);
            return {
                user_id: uid,
                display_name: prof?.display_name ?? null,
                avatar_url: prof?.avatar_url ?? null,
                is_host: uid === hostUserId,
                response: (rsvpByUser.get(uid) ?? null) as GatheringResponse,
            };
        })
        .sort((a, b) => seatRank(a) - seatRank(b));

    const in_count = seats.filter((s) => s.response === 'in').length;
    const viewer_response = (rsvpByUser.get(viewerId) ?? null) as GatheringResponse;

    // Counters — members who proposed another date. Drop ex-members (mirrors the
    // seat roster gate); name via the profile map.
    const counters: GatheringCounterShape[] = rsvps
        .filter((r) => r.response === 'counter' && !!r.counter_on && rosterIds.includes(r.user_id))
        .map((r) => ({
            user_id: r.user_id,
            display_name: profMap.get(r.user_id)?.display_name ?? null,
            counter_on: r.counter_on as string,
        }));

    // Source line — only when the host's pin carries a URL.
    const sourceUrl = source?.url && typeof source.url === 'string' ? source.url : null;
    const sourceType = sourceUrl ? (source?.type ?? null) : null;

    return {
        id: row.id,
        type: 'gathering',
        sort_date: row.created_at,
        table_id: row.table_id,
        restaurant: restaurant
            ? {
                  id: restaurant.id,
                  name: restaurant.name,
                  city: restaurant.city ?? null,
                  photo_url: restaurant.photo_url ?? null,
              }
            : null,
        host_user_id: hostUserId,
        host_name: (hostUserId ? profMap.get(hostUserId)?.display_name : null) ?? null,
        note: row.note ?? null,
        gather_on: row.gather_on,
        status: row.status,
        supper_id: row.supper_id ?? null,
        seats,
        in_count,
        viewer_response,
        counters,
        source_url: sourceUrl,
        source_type: sourceType,
        rescheduled_from: row.rescheduled_from ?? null,
        created_at: row.created_at,
    };
}
