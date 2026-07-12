/**
 * Security-critical gates and deterministic shaping for first-class saved lists.
 *
 * The lists Edge Function uses a service-role client, so RLS is deliberately not
 * trusted here: every public-list read/save re-validates list privacy, Table
 * exclusion, owner account privacy, ownership and both-direction blocks.
 * Keeping these decisions outside index.ts makes the contract executable in
 * focused Deno tests without importing the serve() entrypoint.
 */

export interface SavedListGateRow {
    id: string;
    owner_id: string;
    privacy: 'public' | 'private';
    table_id: string | null;
}

export interface SavedListOwnerIdentity {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    username: string | null;
    account_privacy: 'public' | 'private';
}

export interface ListSaveRow {
    list_id: string;
    created_at: string;
}

export const SAVED_LISTS_DEFAULT_LIMIT = 40;
export const SAVED_LISTS_MAX_LIMIT = 50;

export interface SavedListsPageRequest {
    limit: number;
    before_saved_at: string | null;
    before_list_id: string | null;
}

export type SavedListsPageParseResult =
    | { value: SavedListsPageRequest; error?: never }
    | { value?: never; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parse the optional saved_mine keyset without changing the legacy array result.
 * Clients request the next page with the final card's `(saved_at, id)` pair.
 */
export function parseSavedListsPageRequest(
    body: Record<string, unknown>,
): SavedListsPageParseResult {
    const rawLimit = body.limit;
    let limit = SAVED_LISTS_DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
        if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1) {
            return { error: 'limit must be a positive integer' };
        }
        limit = Math.min(rawLimit, SAVED_LISTS_MAX_LIMIT);
    }

    const beforeSavedAt = body.before_saved_at;
    const beforeListId = body.before_list_id;
    const hasSavedAt = beforeSavedAt !== undefined && beforeSavedAt !== null;
    const hasListId = beforeListId !== undefined && beforeListId !== null;

    if (hasSavedAt !== hasListId) {
        return { error: 'before_saved_at and before_list_id must be provided together' };
    }
    if (!hasSavedAt) {
        return { value: { limit, before_saved_at: null, before_list_id: null } };
    }
    if (
        typeof beforeSavedAt !== 'string' ||
        !beforeSavedAt.trim() ||
        !Number.isFinite(Date.parse(beforeSavedAt))
    ) {
        return { error: 'before_saved_at must be a valid timestamp' };
    }
    if (typeof beforeListId !== 'string' || !UUID_PATTERN.test(beforeListId)) {
        return { error: 'before_list_id must be a valid uuid' };
    }

    return {
        value: {
            limit,
            before_saved_at: beforeSavedAt,
            before_list_id: beforeListId,
        },
    };
}

interface BlockedUsersQueryResult {
    data: Array<{ blocker_id: string; blocked_id: string }> | null;
    error: unknown;
}

interface BlockedUsersFilterBuilder {
    or(filter: string): PromiseLike<BlockedUsersQueryResult>;
}

export interface BlockGateClient {
    from(table: string): {
        select(columns: string): BlockedUsersFilterBuilder;
    };
}

/**
 * One yes/no for a non-owner viewer saving or reading a public personal list.
 * Table lists are never public, and either block direction is an immediate deny.
 */
export function canViewerSavePublicList(
    viewerId: string,
    list: SavedListGateRow,
    owner: Pick<SavedListOwnerIdentity, 'account_privacy'> | null | undefined,
    blockedEitherDirection: boolean,
): boolean {
    return list.owner_id !== viewerId &&
        list.privacy === 'public' &&
        list.table_id === null &&
        owner?.account_privacy === 'public' &&
        !blockedEitherDirection;
}

/**
 * Pair-specific both-direction block lookup. Errors throw so privileged callers
 * fail closed instead of accidentally exposing a list when the gate query fails.
 */
export async function isBlockedEitherDirection(
    supabase: BlockGateClient,
    viewerId: string,
    ownerId: string,
): Promise<boolean> {
    if (viewerId === ownerId) return false;

    const { data, error } = await supabase
        .from('blocked_users')
        .select('blocker_id, blocked_id')
        .or(
            `and(blocker_id.eq.${viewerId},blocked_id.eq.${ownerId}),` +
            `and(blocker_id.eq.${ownerId},blocked_id.eq.${viewerId})`,
        );
    if (error) throw error;
    return (data ?? []).length > 0;
}

/**
 * Batch form used by saved_mine. Returns every user who has either blocked the
 * viewer or been blocked by them, in one service-role query.
 */
export async function fetchBlockedCounterpartIds(
    supabase: BlockGateClient,
    viewerId: string,
): Promise<Set<string>> {
    const { data, error } = await supabase
        .from('blocked_users')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${viewerId},blocked_id.eq.${viewerId}`);
    if (error) throw error;

    const blocked = new Set<string>();
    for (const row of (data ?? []) as Array<{ blocker_id: string; blocked_id: string }>) {
        if (row.blocker_id === viewerId) blocked.add(row.blocked_id);
        if (row.blocked_id === viewerId) blocked.add(row.blocker_id);
    }
    return blocked;
}

export interface VisibleSavedListSeed<
    TList extends SavedListGateRow,
    TOwner extends SavedListOwnerIdentity,
> {
    list: TList;
    owner: TOwner;
    saved_at: string;
}

/**
 * Join saved rows to their current list/profile state without losing save
 * recency. Any list that is no longer publicly visible disappears immediately;
 * the bookmark row remains so `unsave_list` can always remove it later.
 */
export function selectVisibleSavedListSeeds<
    TList extends SavedListGateRow,
    TOwner extends SavedListOwnerIdentity,
>(
    viewerId: string,
    savesInRecencyOrder: ListSaveRow[],
    lists: TList[],
    owners: TOwner[],
    blockedCounterpartIds: ReadonlySet<string>,
): Array<VisibleSavedListSeed<TList, TOwner>> {
    const listById = new Map(lists.map((list) => [list.id, list]));
    const ownerById = new Map(owners.map((owner) => [owner.user_id, owner]));
    const seen = new Set<string>();
    const visible: Array<VisibleSavedListSeed<TList, TOwner>> = [];

    for (const save of savesInRecencyOrder) {
        if (seen.has(save.list_id)) continue;
        seen.add(save.list_id);

        const list = listById.get(save.list_id);
        if (!list) continue;
        const owner = ownerById.get(list.owner_id);
        if (!owner) continue;

        if (!canViewerSavePublicList(
            viewerId,
            list,
            owner,
            blockedCounterpartIds.has(list.owner_id),
        )) continue;

        visible.push({ list, owner, saved_at: save.created_at });
    }

    return visible;
}
