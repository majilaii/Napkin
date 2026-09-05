/** Date for record ordering only. Never project this as an actual visit date. */
export function entryOrderDate(row: { visited_at?: string | null; created_at?: string | null }): string {
    return row.visited_at ?? row.created_at ?? '';
}

export function latestKnownVisit(a: string | null, b: string | null): string | null {
    return b && (!a || b > a) ? b : a;
}

export function countDatedVisitsSince(rows: Array<{ visited_at: string | null }>, start: string): number {
    return rows.filter((row) => row.visited_at != null && row.visited_at >= start).length;
}
