/** Unknown visit dates stay unknown; record timestamps are only ordering metadata. */
export function knownVisitDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function visitDateLabel(
    value: string | null | undefined,
    options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
    locale = 'en-GB',
): string {
    return knownVisitDate(value)?.toLocaleDateString(locale, options) ?? 'no date';
}

export function visitOrderDate(row: { visited_at?: string | null; created_at?: string }): string {
    return row.visited_at ?? row.created_at ?? '';
}

export function compareVisitRecords(
    a: { id: string; created_at?: string; visited_at?: string | null },
    b: { id: string; created_at?: string; visited_at?: string | null },
): number {
    return (b.created_at ?? b.visited_at ?? '').localeCompare(a.created_at ?? a.visited_at ?? '')
        || b.id.localeCompare(a.id);
}
