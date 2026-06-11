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
    /** Muted meta: "{N} spots" (singular-aware, total entries). */
    metaLabel: string;
    /**
     * Spot count carried to the HandoffSheet murmur — VERIFIED entries only,
     * matching what the frozen snapshot will actually contain (fix-pass).
     */
    spotCount: number;
    /**
     * Share eligibility: the handoff snapshot freezes verified spots only, so
     * a list with zero verified entries has nothing to share — the server
     * would 400 EMPTY_LIST. Gate on verified_count, not entry_count (fix-pass:
     * an all-unverified list previously showed share and could only mint an
     * error).
     */
    canShare: boolean;
}

/** Map the caller's lists (useMyLists) into YOUR LISTS rows. */
export function buildListsSectionRows(
    lists: readonly MyList[] | null | undefined,
): ListsSectionRow[] {
    return (lists ?? []).map((l) => {
        const verifiedCount = l.verified_count ?? 0;
        return {
            id: l.id,
            name: l.title,
            metaLabel: `${l.entry_count} spot${l.entry_count !== 1 ? 's' : ''}`,
            spotCount: verifiedCount,
            canShare: verifiedCount > 0,
        };
    });
}
