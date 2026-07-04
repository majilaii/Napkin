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
