/**
 * Hook to fetch cursor-paginated table activity feed.
 * TICKET-035: rewrote from numeric-offset GET to cursor-based POST.
 *
 * Backed by fn_table_activity_page RPC — a UNION of entries + table_nights
 * sorted by sort_date DESC, id DESC. No more duplicates or gaps.
 */
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';

export interface CompanionProfile {
    user_id: string;
    display_name: string;
}

/** TICKET-082 Wave 2c: the supper "gathering" summary attached to a feed entry that
 *  anchors a Supper — only present for viewers who are supper members. */
export interface SupperSummary {
    head_count: number;
    group_avg: number | null;
    photos: string[];
    takers: Array<{
        user_id: string;
        display_name: string | null;
        avatar_url: string | null;
        rating: number | null;
    }>;
}

export interface SoloShareActivity {
    type: 'solo_share';
    id: string;
    user_id: string;
    restaurant_id: string | null;
    rating: number | null;
    content: string | null;
    dish_description: string | null;
    /** TICKET-075: author's Letterboxd-style like. Read-only on feed/journal rows. */
    liked?: boolean;
    /** true when this entry is attached to a Table or Round (journal badge, 20260616000100). */
    is_shared?: boolean;
    /** Supper gathering summary (Wave 2c) — present only when this entry anchors a
     *  Supper AND the viewer is a member. Renders pooled photos + headcount + avg. */
    supper?: SupperSummary | null;
    visited_at: string;
    created_at: string;
    sort_date: string;
    photo_url: string | null;
    photo_count?: number;
    reaction_count?: number;
    comment_count?: number;
    top_emojis?: Array<{ emoji: string; count: number; last_reacted_at: string }>;
    my_reactions?: string[];
    companions?: CompanionProfile[];
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    profiles: {
        display_name: string;
    };
}

export interface TableNightActivity {
    type: 'table_night';
    id: string;
    restaurant_id: string;
    host_user_id: string;
    /** Null for merged rounds (kind='merged', status=NULL). Live rounds: 'rating' | 'revealed' | 'closed'. */
    status: string | null;
    created_at: string;
    revealed_at: string | null;
    is_async: boolean;
    sort_date: string;
    average_rating: number | null;
    reaction_count?: number;
    comment_count?: number;
    top_emojis?: Array<{ emoji: string; count: number; last_reacted_at: string }>;
    my_reactions?: string[];
    /**
     * Round subtype discriminator (TICKET-044).
     * 'live'   = Round-Mode (table_nights state machine: start/rate/reveal/recap).
     * 'merged' = two solo entries bound together retroactively.
     * Undefined for rows pre-dating TICKET-044 (treat as 'live').
     */
    round_kind?: 'live' | 'merged';
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    };
    participants: {
        user_id: string;
        display_name?: string;
        avatar_url?: string | null;
        rating: number | null;
        notes: string | null;
        profiles: {
            display_name: string;
            avatar_url?: string | null;
        };
    }[];
}

export interface CollaborativeEntryActivity {
    type: 'collaborative_entry';
    id: string;
    user_id: string;
    restaurant_id: string | null;
    visited_at: string;
    created_at: string;
    sort_date: string;
    companions?: CompanionProfile[];
    restaurants: {
        id: string;
        name: string;
        address: string | null;
        city: string | null;
        photo_url: string | null;
    } | null;
    participants: {
        user_id: string;
        rating: number | null;
        notes: string | null;
        profiles: {
            display_name: string;
        };
    }[];
    average_rating: number | null;
}

export interface TopFourEditedActivity {
    type: 'top_4_edited';
    id: string;
    table_id: string;
    position: 1 | 2 | 3 | 4;
    actor_id: string;
    actor_name: string | null;
    actor_avatar_url: string | null;
    event_type: 'added' | 'removed' | 'swapped';
    prev_restaurant: { id: string; name: string | null } | null;
    next_restaurant: { id: string; name: string | null } | null;
    created_at: string;
    sort_date: string;
    my_reactions?: string[];
}

// TICKET-060: new feed item types (shape is hydrated by table-activity edge fn)
export interface SharedSaveActivityItem {
    type: 'shared_save';
    id: string;
    sort_date: string;
    table_id: string;
    author: { user_id: string; display_name: string | null; avatar_url: string | null } | null;
    restaurant: { id: string | null; name: string | null; city: string | null; cuisine: string | null; photo_url: string | null; verification?: string } | null;
    note?: string | null;
    extraction_status?: string | null;
    reaction_count: number;
    top_emojis: string[];
    my_reactions?: string[];
    created_at: string;
    // [H-6 FIX] camelCase aliases set by edge fn hydrator so SharedSaveCard props match
    shareId?: string;
    extractionStatus?: string | null;
    reactionCount?: number;
    topEmojis?: string[];
    myReactions?: string[];
    createdAt?: string;
}

export interface SharedSaveCardShapeForDigest {
    shareId: string;
    tableId: string;
    author: { user_id: string; display_name: string | null; avatar_url: string | null };
    restaurant: { id: string | null; name: string | null; city: string | null; cuisine: string | null; photo_url: string | null; verification?: string } | null;
    note?: string | null;
    extractionStatus?: string | null;
    reactionCount: number;
    commentCount?: number;
    topEmojis: string[];
    myReactions?: string[];
    createdAt: string;
}

export interface ShareDigestActivityItem {
    type: 'share_digest';
    id: string;
    sort_date: string;
    created_at: string;
    table_id: string;
    author: { user_id: string; display_name: string | null; avatar_url: string | null } | null;
    share_count: number;
    child_ids: string[];
    /** [H-6 FIX] Hydrated children already mapped to SharedSaveCardProps shape (camelCase) */
    childShares?: SharedSaveCardShapeForDigest[];
}

export interface RestaurantFloatActivityItem {
    type: 'restaurant_float';
    id: string;
    sort_date: string;
    created_at: string;
    float_id: string;
    table_id: string;
    restaurant: { id: string; name: string | null; city: string | null; cuisine: string | null; photo_url?: string | null } | null;
    distinct_count: number;
    members: { user_id: string; display_name: string | null; avatar_url: string | null }[];
    first_crossed_at?: string;
}

/** Supper v2 "The Empty Table" — one seat in the roster. `filled` = this member has
 *  logged their take; pending seats render ghosted. */
export interface SupperSeat {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    is_host: boolean;
    filled: boolean;
    rating: number | null;
    joined_at: string;
}

/** Supper v2 feed card — restaurant-anchored, viewer-relative. The 4 visual states
 *  (empty / filling-your-seat-empty / filling-your-seat-filled / gathered) are derived
 *  client-side from filled_count, seat_count and viewer_filled. */
export interface SupperCardActivity {
    type: 'supper';
    id: string;
    sort_date: string;
    table_id: string;
    restaurant: { id: string; name: string; city: string | null; photo_url: string | null } | null;
    host_user_id: string | null;
    host_name: string | null;
    /** Total seats (roster size). */
    seat_count: number;
    /** Seats that have a take (filled). */
    filled_count: number;
    /** Average of takes' overall ratings — a sibling signal, never cross-Table. */
    group_avg: number | null;
    /** The viewer has logged their own take. Drives the CTA (add-your-take vs see-the-table). */
    viewer_filled: boolean;
    viewer_take: { rating: number | null; content: string | null } | null;
    seats: SupperSeat[];
    /** Pooled photos from every take (hero-first), capped server-side. */
    photos: string[];
    created_at: string;
}

/** TICKET-095 "Gather the table" — one seat on a gathering card. Every CURRENT
 *  table member is a seat; `response` is their RSVP ('in' renders solid,
 *  undecided/out ghosted). Host first, then 'in', then undecided. */
export interface GatheringSeat {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    is_host: boolean;
    /** TICKET-127: 'counter' = proposed another date (renders as a counter chip,
     *  not in the in/out/waiting ledger). */
    response: 'in' | 'out' | 'counter' | null;
}

/** TICKET-127 — a member who countered with another date. Rendered as its own
 *  chip ("you · sat 12" / "Clara · sat 12"), separate from the in/out ledger. */
export interface GatheringCounter {
    user_id: string;
    display_name: string | null;
    /** YYYY-MM-DD — the date this member proposed instead. */
    counter_on: string;
}

/** TICKET-095 gathering feed card — a proposed future date at a restaurant.
 *  status drives the card: proposed (RSVP zone) → dispatched (supper_id set,
 *  "gathered — see the table") | expired ("didn't come together"). Cancelled
 *  rows are excluded server-side. */
export interface GatheringCardActivity {
    type: 'gathering';
    id: string;
    sort_date: string;
    table_id: string;
    restaurant: { id: string; name: string; city: string | null; photo_url: string | null } | null;
    host_user_id: string | null;
    host_name: string | null;
    note: string | null;
    /** YYYY-MM-DD (date-only — no time-of-day in v1). */
    gather_on: string;
    status: 'proposed' | 'dispatched' | 'expired';
    /** Set when dispatched — the auto-created supper this gathering became. */
    supper_id: string | null;
    seats: GatheringSeat[];
    in_count: number;
    viewer_response: 'in' | 'out' | 'counter' | null;
    /** TICKET-127: members who proposed another date (excludes ex-members). */
    counters: GatheringCounter[];
    /** TICKET-127: the host's pinned-from source URL for this spot (null = none). */
    source_url: string | null;
    /** TICKET-127: source type ('tiktok' | 'google_maps' | 'web' | ...); null when no URL. */
    source_type: string | null;
    /** TICKET-127: the previous gather_on if the host re-dated (null = never moved). */
    rescheduled_from: string | null;
    created_at: string;
}

/** TICKET-115 "Table lists" — a quiet ledger line (NOT a card): a member added
 *  spot(s) to one of the Table's shared lists. N adds by the same member to the
 *  same list within an hour coalesce to one line server-side. */
export interface ListAddActivityItem {
    type: 'list_add';
    id: string;
    sort_date: string;
    table_id: string;
    list_id: string | null;
    list_title: string | null;
    list_emoji: string | null;
    added_by: string | null;
    added_by_profile: { user_id: string; display_name: string | null; avatar_url: string | null } | null;
    /** How many spots were added in this coalesced line (1 = single). */
    add_count: number;
    /** Names of the added restaurants (for the "added {restaurant}" grammar). */
    sample_restaurant_names: string[];
    created_at: string;
}

export type ActivityItem =
    | SoloShareActivity
    | TableNightActivity
    | CollaborativeEntryActivity
    | TopFourEditedActivity
    | SharedSaveActivityItem
    | ShareDigestActivityItem
    | RestaurantFloatActivityItem
    | SupperCardActivity
    | GatheringCardActivity
    | ListAddActivityItem;

/** TICKET-095: every feed-card kind THIS client build can render. Sent as
 *  known_kinds so the server can add new kinds without breaking old clients
 *  (they don't send it and get the legacy set). Keep in sync with the
 *  tables.tsx feed if-chain. */
export const KNOWN_ACTIVITY_KINDS = [
    'entry',
    'table_night',
    'top_4_edited',
    'shared_save',
    'share_digest',
    'restaurant_float',
    'supper',
    'gathering',
    // TICKET-115: table-list add ledger line. Client-opt-in (never LEGACY_KINDS).
    'list_add',
] as const;

export interface TableActivityFilters {
    filterType?: string;   // 'round' | 'solo_share'
    filterUserId?: string; // UUID
}

async function fetchTableActivityPage(
    tableId: string,
    cursor: string | null,
    filters: TableActivityFilters | undefined,
    _token: string | null,
): Promise<Page<ActivityItem>> {
    const body: Record<string, unknown> = {
        table_id: tableId,
        // TICKET-095: enumerate every kind this build renders so the server can
        // ship new kinds without junk-carding older clients.
        known_kinds: KNOWN_ACTIVITY_KINDS,
    };
    if (cursor) body.cursor = cursor;
    if (filters?.filterType) body.filter_type = filters.filterType;
    if (filters?.filterUserId) body.filter_user_id = filters.filterUserId;
    return callEdgeFn<Page<ActivityItem>>('table-activity', { body });
}

export function useTableActivity(
    tableId: string | null | undefined,
    filters?: TableActivityFilters,
) {
    return useCursorPagedQuery<ActivityItem>({
        queryKey: queryKeys.tables.activity(tableId!, filters),
        fetchPage: (cursor, token) => fetchTableActivityPage(tableId!, cursor, filters, token),
        enabled: !!tableId,
        staleTime: 1000 * 60 * 2,
    });
}

/** Flatten all pages of activity items. */
export function flattenActivity(data: ReturnType<typeof useTableActivity>['data']): ActivityItem[] {
    return flattenPages(data);
}
