/**
 * Companion formatting utilities (TICKET-027).
 *
 * Single source of truth for the truncation rule used on feed cards and detail headers:
 *   "with Clara · Thomas"          (max 2 names)
 *   "with Clara · Thomas +3 more"  (overflow)
 */

export interface CompanionLike {
    display_name: string;
    user_id?: string;
}

export function reconcileAcceptedCompanions<T extends { user_id: string }>(
    companions: T[],
    acceptedCompanionIds: string[] | undefined,
): T[] {
    if (acceptedCompanionIds === undefined) return companions;
    const acceptedIds = new Set(acceptedCompanionIds);
    return companions.filter((companion) => acceptedIds.has(companion.user_id));
}

/**
 * Format companions into a display string.
 * Returns null when companions array is empty or undefined.
 *
 * @param companions  Array of companion objects with display_name
 * @param options.max Maximum number of names to show before collapsing (default 2)
 */
export function formatCompanions(
    companions: CompanionLike[] | null | undefined,
    { max = 2 }: { max?: number } = {},
): string | null {
    if (!companions || companions.length === 0) return null;

    const shown = companions.slice(0, max).map((c) => c.display_name);
    const overflow = companions.length - max;

    const nameList = shown.join(' · ');

    if (overflow <= 0) {
        return `with ${nameList}`;
    }

    return `with ${nameList} +${overflow} more`;
}
