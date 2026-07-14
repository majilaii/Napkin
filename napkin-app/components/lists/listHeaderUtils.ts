/**
 * listHeaderUtils — pure derivations for the list-detail sheet header
 * (TICKET-186). Kept free of React so the A13/A14/A4 matrices are jest-tested
 * directly; the header component renders the results.
 */
import type { ListDetail, ListEntry, OwnerProfile } from '@/hooks/lists/useList';

type CoverEntry = Pick<ListEntry, 'restaurant'>;
type HeaderList = Pick<ListDetail, 'table_id' | 'privacy'>;
type HeaderOwner = Pick<OwnerProfile, 'display_name' | 'username' | 'account_privacy'>;

/**
 * A4 (Codex #13): the header cover derives from the server-returned order —
 * first entry's restaurant photo, else null (→ the emoji plate on tintFor).
 * Matches `list_mine`'s authored-first-entry derivation so shelf/detail agree.
 */
export function deriveCover(entries: readonly CoverEntry[]): string | null {
    return entries[0]?.restaurant.photo_url ?? null;
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
    ownerProfile: HeaderOwner,
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
    const name = ownerProfile.display_name ?? ownerProfile.username ?? 'Unknown';
    const profileHandle = ownerProfile.account_privacy === 'public' && ownerProfile.username
        ? ownerProfile.username
        : null;
    return { kind: 'byline', text: `a list by ${name}`, profileHandle };
}
