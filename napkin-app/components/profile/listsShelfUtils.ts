/**
 * listsShelfUtils — pure normalizers for the profile Lists shelf (TICKET-185).
 *
 * Self and stranger read from different sources (useMyLists vs the profile
 * payload's public_lists), so this collapses both into one card shape. No React
 * / native imports (unit-testable, same pattern as listsSectionUtils).
 */
import type { MyList } from '@/hooks/lists/useMyLists';
import type { ProfileListSummary } from '@/hooks/users/useUserProfile';
import { parsePlacesAttribution } from '@/lib/parsePlacesAttribution';

type CoverPhotoSource = 'user' | 'table' | 'places' | 'none' | null;

export interface ShelfList {
    id: string;
    title: string;
    /** Derived first-entry photo (own-bucket / Places mirror only — always ToS-safe). */
    coverPhotoUrl: string | null;
    /** Provenance for the cover photo. null covers include stale pre-194 data. */
    coverPhotoSource: CoverPhotoSource;
    /** Sanitized server-authored Places attribution HTML; parsed before display. */
    coverAttributionHtml: string | null;
    /** User-chosen list emoji; null → the default terracotta teardrop plate. */
    emoji: string | null;
    /** "N places", or the owning Table's name for a shared Table list. */
    meta: string;
}

function placesLabel(n: number): string {
    return `${n} ${n === 1 ? 'place' : 'places'}`;
}

/**
 * Only an explicitly sourced cover may leave the normalizer. In particular,
 * a Places cover requires a parseable credit, while a stale payload without
 * source metadata degrades to the deterministic tint plate.
 */
function safeCoverPhotoUrl(
    url: string | null,
    source: CoverPhotoSource | undefined,
    attributionHtml: string | null | undefined,
): string | null {
    if (!url) return null;
    if (source === 'places') {
        return parsePlacesAttribution(attributionHtml) ? url : null;
    }
    return source === 'user' || source === 'table' ? url : null;
}

/** Own lists — the richest source (incl. private + Table, emoji, table_name). */
export function myListsToShelf(lists: MyList[]): ShelfList[] {
    return lists.map((list) => {
        const coverPhotoSource = list.cover_photo_source ?? null;
        const coverAttributionHtml = list.cover_attribution_html ?? null;
        return {
            id: list.id,
            title: list.title,
            coverPhotoUrl: safeCoverPhotoUrl(
                list.cover_photo_url,
                list.cover_photo_source,
                list.cover_attribution_html,
            ),
            coverPhotoSource,
            coverAttributionHtml,
            emoji: list.emoji,
            meta:
                list.table_id && list.table_name
                    ? list.table_name
                    : placesLabel(list.entry_count),
        };
    });
}

/** A stranger's public lists (the profile payload's public_lists — no emoji). */
export function publicListsToShelf(lists: ProfileListSummary[]): ShelfList[] {
    return lists.map((list) => {
        const coverPhotoSource = list.cover_photo_source ?? null;
        const coverAttributionHtml = list.cover_attribution_html ?? null;
        return {
            id: list.id,
            title: list.title,
            coverPhotoUrl: safeCoverPhotoUrl(
                list.cover_photo_url,
                list.cover_photo_source,
                list.cover_attribution_html,
            ),
            coverPhotoSource,
            coverAttributionHtml,
            emoji: null,
            meta: placesLabel(list.entry_count),
        };
    });
}
