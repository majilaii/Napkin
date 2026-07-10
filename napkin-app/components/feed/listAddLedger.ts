/**
 * TICKET-115 — pure copy grammar for the table-list-add ledger line.
 * Extracted from ListAddLedgerLine.tsx so the single-vs-batched grammar is unit-
 * testable without rendering. Verb is lowercase past-tense (brand rules).
 */
import type { ListAddActivityItem } from '@/hooks/tables/useTableActivity';

/** The actor label: "You" for self, else the adder's display name, else "Someone". */
export function ledgerActorLabel(
    item: Pick<ListAddActivityItem, 'added_by' | 'added_by_profile'>,
    currentUserId?: string | null,
): string {
    if (currentUserId && item.added_by === currentUserId) return 'You';
    return item.added_by_profile?.display_name ?? 'Someone';
}

/**
 * The "{target}" fragment for "added {target} to {list}":
 *   single  → the restaurant name (or "a spot" when unknown)
 *   batched → "{n} spots"
 */
export function ledgerTargetFragment(
    item: Pick<ListAddActivityItem, 'add_count' | 'sample_restaurant_names'>,
): string {
    const count = item.add_count ?? item.sample_restaurant_names.length;
    if (count > 1) return `${count} spots`;
    return item.sample_restaurant_names[0] ?? 'a spot';
}

/** The list name for the "to {list}" fragment (never empty). */
export function ledgerListName(item: Pick<ListAddActivityItem, 'list_title'>): string {
    return item.list_title ?? 'a list';
}
