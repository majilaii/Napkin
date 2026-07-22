/**
 * listHeaderUtils — pure derivations for the list-detail sheet header
 * (TICKET-186). Kept free of React so the A13/A14/A4 matrices are jest-tested
 * directly; the header component renders the results.
 */
import type { ListDetail, ListEntry, OwnerProfile } from '@/hooks/lists/useList';
import {
    PlacesPhotoCredit,
    resolveSourcedPhoto,
} from '@/components/ui/PlacesCredit';

type CoverEntry = Pick<ListEntry, 'restaurant'> & Partial<Pick<ListEntry, 'id'>>;
type HeaderList = Pick<ListDetail, 'table_id' | 'privacy'>;
type HeaderOwner = Pick<OwnerProfile, 'display_name' | 'username' | 'account_privacy'>;

export interface DerivedListCover {
    photoUrl: string;
}

/**
 * A4 (Codex #13): derive from the first entry's restaurant hero
 * (`restaurants.photo_url`) — not from an entry/user photo. A Places hero only
 * leaves this boundary with a parseable credit; missing source metadata from a
 * stale payload also fails closed to the list's emoji/tint plate.
 */
export function deriveCover(entries: readonly CoverEntry[]): DerivedListCover | null {
    const restaurant = entries[0]?.restaurant;
    if (!restaurant) return null;
    const resolved = resolveSourcedPhoto({
        url: restaurant.photo_url,
        photoSource: restaurant.photo_source,
        attributionHtml: restaurant.places_photo_attribution_html,
        restaurantName: restaurant.name,
    });
    return resolved.url ? { photoUrl: resolved.url } : null;
}

export interface ListPlacesCreditSummary {
    credits: PlacesPhotoCredit[];
    /** Rendered Places instances (header cover + row thumbnails) before author dedupe. */
    photoCount: number;
}

function resolvedEntryPhoto(entry: CoverEntry) {
    return resolveSourcedPhoto({
        url: entry.restaurant.photo_url,
        photoSource: entry.restaurant.photo_source,
        attributionHtml: entry.restaurant.places_photo_attribution_html,
        restaurantName: entry.restaurant.name,
    });
}

export function listRowPhotoFailureKey(entry: CoverEntry): string | null {
    const photo = resolvedEntryPhoto(entry);
    return photo.url
        ? `row:${entry.id ?? entry.restaurant.id}:${photo.url}`
        : null;
}

export function listCoverPhotoFailureKey(entries: readonly CoverEntry[]): string | null {
    const first = entries[0];
    if (!first) return null;
    const photo = resolvedEntryPhoto(first);
    return photo.url
        ? `cover:${first.id ?? first.restaurant.id}:${photo.url}`
        : null;
}

/**
 * Derives structured attribution metadata for safely-renderable Places
 * thumbnails. Render surfaces do not display this metadata inline.
 */
export function deriveListPlacesCredits(
    entries: readonly CoverEntry[],
    failedPhotoKeys: ReadonlySet<string> = new Set(),
): ListPlacesCreditSummary {
    const credits: PlacesPhotoCredit[] = [];
    let photoCount = 0;
    entries.forEach(({ restaurant }, index) => {
        const resolved = resolveSourcedPhoto({
            url: restaurant.photo_url,
            photoSource: restaurant.photo_source,
            attributionHtml: restaurant.places_photo_attribution_html,
            restaurantName: restaurant.name,
        });
        if (!resolved.url || !resolved.credit) return;

        const entry = entries[index];
        const rowFailureKey = listRowPhotoFailureKey(entry);
        if (!(rowFailureKey && failedPhotoKeys.has(rowFailureKey))) {
            credits.push(resolved.credit);
            photoCount += 1;
        }

        // The first entry's hero can render twice on this surface: once as the
        // header cover and once as its AA row thumbnail. Track the instances
        // independently so either load failure updates grammar exactly.
        if (index === 0) {
            const coverFailureKey = listCoverPhotoFailureKey(entries);
            if (!(coverFailureKey && failedPhotoKeys.has(coverFailureKey))) {
                credits.push(resolved.credit);
                photoCount += 1;
            }
        }
    });
    return { credits, photoCount };
}

/**
 * A14: the saves clause, appended to the metadata line ONLY when the list is a
 * public personal list that has saves. Historical counts on now-private (or
 * Table) lists are suppressed. Returns the bare clause (no middle-dot).
 */
export function deriveSavesClause(
    saveCount: number,
    privacy: HeaderList['privacy'],
    tableId: HeaderList['table_id'],
): string | null {
    if (saveCount > 0 && privacy === 'public' && !tableId) {
        return `saved ${saveCount} ${saveCount === 1 ? 'time' : 'times'}`;
    }
    return null;
}

/** The full metadata line: "{n} places" + optional " · saved {m} times". */
export function deriveMetadataLine(
    entryCount: number,
    saveCount: number,
    privacy: HeaderList['privacy'],
    tableId: HeaderList['table_id'],
): string {
    const places = `${entryCount} ${entryCount === 1 ? 'place' : 'places'}`;
    const saves = deriveSavesClause(saveCount, privacy, tableId);
    return saves ? `${places} · ${saves}` : places;
}

/**
 * A13 context-line matrix (exhaustive):
 *   table list        → "Shared with everyone at this Table"
 *   own private       → "Only you can find this list"
 *   own public        → null (the metadata line is enough; quiet is the brand)
 *   other's public    → byline "a list by {name}", tappable only when the owner
 *                        account is public.
 * The header maps `kind` → icon/avatar; only the byline carries a profile handle.
 */
export type ContextLine =
    | { kind: 'table'; text: string }
    | { kind: 'private'; text: string }
    | { kind: 'byline'; text: string; profileHandle: string | null };

export function deriveContextLine(
    list: HeaderList,
    isOwner: boolean,
    ownerProfile: HeaderOwner | null,
): ContextLine | null {
    if (list.table_id) {
        return { kind: 'table', text: 'Shared with everyone at this Table' };
    }
    if (isOwner) {
        return list.privacy === 'private'
            ? { kind: 'private', text: 'Only you can find this list' }
            : null;
    }
    // Non-owner, non-Table lists the server surfaced are public personal lists.
    // A missing owner profile just drops the byline (review F5a) — the screen
    // must still render.
    if (!ownerProfile) return null;
    const name = ownerProfile.display_name ?? ownerProfile.username ?? 'Unknown';
    const profileHandle = ownerProfile.account_privacy === 'public' && ownerProfile.username
        ? ownerProfile.username
        : null;
    return { kind: 'byline', text: `a list by ${name}`, profileHandle };
}
