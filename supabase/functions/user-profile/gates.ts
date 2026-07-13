/**
 * gates.ts — the audience-gating decisions for every user-profile read action.
 *
 * Extracted from index.ts so the semantics are executable as unit tests
 * (gates.test.ts) without importing the serve() entrypoint.
 *
 * TICKET-093 decision (a), locked 2026-07-04: sharing an entry to a Table
 * makes it public-eligible — the entry is the author's own log; only Table
 * CONTEXT (name, members, comments, rounds) is sacred. Concretely: a stranger
 * with `public_only` access reads the palate surfaces, and each fetcher's SQL
 * keeps filtering rows with `visibility != 'private'`. The client mitigates
 * surprise with a transparency line in the logger (log-meal SHARE TO card),
 * not by gating.
 */

export type ViewerRelationship =
    | 'self'
    | 'tables_in_common'
    | 'public_only'
    | 'public_and_tables'
    | 'none';

/**
 * Compute viewer ↔ target relationship.
 * Must be called BEFORE any palate data fetching.
 */
export function computeRelationship(
    _callerId: string,
    targetPrivacy: 'private' | 'public',
    sharedTableIds: string[],
): ViewerRelationship {
    const hasSharedTables = sharedTableIds.length > 0;

    if (targetPrivacy === 'public' && hasSharedTables) return 'public_and_tables';
    if (targetPrivacy === 'public') return 'public_only';
    if (hasSharedTables) return 'tables_in_common';
    return 'none';
}

/**
 * Block state between viewer and target (TICKET-090). Blocks trump every
 * relationship tier — checked before palate data is fetched. When both have
 * blocked each other, the viewer's own block wins (they see the unblock stub).
 */
export type BlockState = 'none' | 'viewer_blocked_target' | 'target_blocked_viewer';

export async function fetchBlockState(
    supabase: any,
    viewerId: string,
    targetId: string,
): Promise<BlockState> {
    const { data, error } = await supabase
        .from('blocked_users')
        .select('blocker_id')
        .or(
            `and(blocker_id.eq.${viewerId},blocked_id.eq.${targetId}),` +
            `and(blocker_id.eq.${targetId},blocked_id.eq.${viewerId})`,
        );
    if (error) throw error;
    const rows = (data ?? []) as Array<{ blocker_id: string }>;
    if (rows.some((r) => r.blocker_id === viewerId)) return 'viewer_blocked_target';
    if (rows.some((r) => r.blocker_id === targetId)) return 'target_blocked_viewer';
    return 'none';
}

/**
 * The single yes/no for a NON-self viewer reading a palate surface
 * (diary / regulars / spots / reviews). Self always reads; callers must not
 * reach this for isSelf.
 *
 *   • any block, either direction → denied (reads as not-found)
 *   • public_only / public_and_tables → allowed (TICKET-093 decision a)
 *   • tables_in_common / none → denied — sharing a Table grants the Table
 *     feed, never the member's own profile surfaces.
 */
export function strangerCanReadPalate(
    blockState: BlockState,
    relationship: ViewerRelationship,
): boolean {
    if (blockState !== 'none') return false;
    return relationship === 'public_only' || relationship === 'public_and_tables';
}

/**
 * TICKET-155 — reachable private-account stub.
 *
 * Built as a pure function (not inline in index.ts) so the exact payload shape
 * is executable in a unit test — index.ts calls serve() at the top level and is
 * NOT import-safe, so a test cannot reach an inline object. Mirrors the
 * gates.ts "extracted so semantics are executable" pattern.
 *
 * Fires for an EXISTING private target with relationship === 'none' (private +
 * no shared Table + not self + not blocked-either-way — those cases already
 * returned earlier). Returns identity + social metadata (follower/following
 * counts, follow state) with ALL palate explicitly withheld, plus the
 * `private_stub: true` discriminator the client renders as "their journal is
 * private". A genuinely nonexistent target is unaffected — the `!targetProfile`
 * guard returns not_found before this is ever reached (existence-ambiguity
 * intact for real 404s).
 *
 * Social counts here are NON-INTERACTIVE on the client (follow_list still 404s a
 * non-tablemate viewer of a private account, so a tappable count would dead-end).
 * `viewer_target_relationship` stays 'none' — the stub is a sibling variant, not
 * a new relationship tier.
 */
export function buildPrivateProfileStub<P>(
    profile: P,
    opts: {
        isFollowingViewer: boolean;
        followsViewer: boolean;
        followersCount: number;
        followingCount: number;
    },
): {
    profile: P;
    stats: null;
    social: { followers_count: number; following_count: number };
    public_lists: null;
    recently_logged: null;
    tables_in_common: never[];
    top_four: never[];
    quick_takes: never[];
    regulars_preview: never[];
    is_self: false;
    is_following_viewer: boolean;
    follows_viewer: boolean;
    viewer_target_relationship: ViewerRelationship;
    private_stub: true;
} {
    return {
        profile,
        stats: null,
        social: {
            followers_count: opts.followersCount,
            following_count: opts.followingCount,
        },
        public_lists: null,
        recently_logged: null,
        tables_in_common: [],
        top_four: [],
        quick_takes: [],
        regulars_preview: [],
        is_self: false,
        is_following_viewer: opts.isFollowingViewer,
        follows_viewer: opts.followsViewer,
        viewer_target_relationship: 'none',
        private_stub: true,
    };
}
