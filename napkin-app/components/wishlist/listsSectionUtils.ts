/**
 * listsSectionUtils — pure logic for the YOUR LISTS section on the wishlist tab
 * (TICKET-074 lists area).
 *
 * Extracted into a separate module so unit tests can import real implementations
 * without pulling in React Native dependencies (same pattern as candidatePickerUtils).
 *
 * No I/O, no React, no native imports.
 */
import type { MyList } from '@/hooks/lists/useMyLists';

export interface ListsSectionRow {
    id: string;
    /** List title — rendered italic serif 17 (brand voice). */
    name: string;
    /** Muted meta: "{N} spots" (singular-aware). */
    metaLabel: string;
    /** Spot count carried to the HandoffSheet murmur. */
    spotCount: number;
    /**
     * Share eligibility: empty lists have nothing to freeze — the server would
     * 400 EMPTY_LIST, so the quiet `share` affordance is hidden instead.
     */
    canShare: boolean;
}

/** Map the caller's lists (useMyLists) into YOUR LISTS rows. */
export function buildListsSectionRows(
    lists: readonly MyList[] | null | undefined,
): ListsSectionRow[] {
    return (lists ?? []).map((l) => ({
        id: l.id,
        name: l.title,
        metaLabel: `${l.entry_count} spot${l.entry_count !== 1 ? 's' : ''}`,
        spotCount: l.entry_count,
        canShare: l.entry_count > 0,
    }));
}
