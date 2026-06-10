/**
 * resolve-url pure helpers — extracted for unit testing.
 *
 * These functions contain no I/O and no Deno.serve() — safe to import
 * in test files without triggering the HTTP server.
 *
 * TICKET-063 fix-pass-1.
 */

/**
 * Returns true when an external_id value represents an unresolved ghost
 * candidate (null, empty string, or the legacy 'ghost_pending' sentinel).
 * The minted ghost external_id ('ghost_<user>_<nonce>') is NOT a sentinel
 * and returns false.
 */
export function isGhostExternalId(id: string | null | undefined): boolean {
    return !id || id === 'ghost_pending' || id === '';
}

/**
 * Builds the stable ghost external_id for a (user, nonce) pair.
 * Pattern mirrors the SQL in fn_save_import_spot:
 *   'ghost_' || p_user_id::text || '_' || p_client_nonce::text
 */
export function buildGhostExternalId(userId: string, clientNonce: string): string {
    return `ghost_${userId}_${clientNonce}`;
}

/**
 * Returns the set of table_ids the user is NOT authorized to write to.
 * The memberRows must be queried with member_id = user_id (TICKET-034 doctrine).
 */
export function filterUnauthorizedTableIds(
    tableIds: string[],
    memberRows: { table_id: string }[],
): Set<string> {
    const authorized = new Set(memberRows.map((r) => r.table_id));
    const unauthorized = new Set<string>();
    for (const tid of tableIds) {
        if (!authorized.has(tid)) unauthorized.add(tid);
    }
    return unauthorized;
}
