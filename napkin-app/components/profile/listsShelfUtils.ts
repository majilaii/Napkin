/**
 * listsShelfUtils — pure normalizers for the profile Lists shelf (TICKET-185).
 *
 * Self and stranger read from different sources (useMyLists vs the profile
 * payload's public_lists), so this collapses both into one card shape. No React
 * / native imports (unit-testable, same pattern as listsSectionUtils).
 */
import type { MyList } from '@/hooks/lists/useMyLists';
import type { ProfileListSummary } from '@/hooks/users/useUserProfile';

export interface ShelfList {
    id: string;
    title: string;
    /** Derived first-entry photo (own-bucket / Places mirror only — always ToS-safe). */
    coverPhotoUrl: string | null;
    /** User-chosen list emoji; null → the default terracotta teardrop plate. */
    emoji: string | null;
    /** "N places", or the owning Table's name for a shared Table list. */
    meta: string;
}

function placesLabel(n: number): string {
    return `${n} ${n === 1 ? 'place' : 'places'}`;
}

/** Own lists — the richest source (incl. private + Table, emoji, table_name). */
export function myListsToShelf(lists: MyList[]): ShelfList[] {
    return lists.map((list) => ({
        id: list.id,
        title: list.title,
        coverPhotoUrl: list.cover_photo_url,
        emoji: list.emoji,
        meta:
            list.table_id && list.table_name
                ? list.table_name
                : placesLabel(list.entry_count),
    }));
}

/** A stranger's public lists (the profile payload's public_lists — no emoji). */
export function publicListsToShelf(lists: ProfileListSummary[]): ShelfList[] {
    return lists.map((list) => ({
        id: list.id,
        title: list.title,
        coverPhotoUrl: list.cover_photo_url,
        emoji: null,
        meta: placesLabel(list.entry_count),
    }));
}
