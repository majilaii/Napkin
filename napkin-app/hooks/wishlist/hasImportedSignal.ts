/**
 * hasImportedSignal (TICKET-122) — the pure OR behind useHasImported.
 *
 * Extracted from the hook so the truth-table is unit-testable without pulling the
 * react-query / supabase chain into jest (repo convention: pure gate modules).
 */

/** The durable flag, or ≥1 server-known recent import. */
export function combineHasImported(flag: boolean, recentCount: number | undefined): boolean {
    return flag || (recentCount ?? 0) > 0;
}
