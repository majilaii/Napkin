import { safeRandomUUID } from './uuid';

export type ImportProtocolGeneration = 'legacy' | 'v2';

export type CompletenessDestinationKind = 'wishlist' | 'table' | 'list' | 'new_list';

/** One immutable server-owned routing effect for one import item. */
export interface CompletenessDestinationIntent {
    item_nonce: string;
    destination_nonce: string;
    destination_kind: CompletenessDestinationKind;
    target_table_id?: string;
    target_list_id?: string;
    target_list_title?: string;
    /** Stable at job/title scope; only present for `new_list`. */
    title_nonce?: string;
    notify_done: boolean;
}

export interface ImportDestinationNonceState {
    wishlist?: string;
    tables: Record<string, string>;
    lists: Record<string, string>;
    newLists: Record<string, { destinationNonce: string; titleNonce: string }>;
}

export interface ImportDestinationSelection {
    wishlist: boolean;
    tableIds: string[];
    listIds: string[];
    newListTitles: string[];
}

export interface ImportDestinationTarget {
    nonce: string;
    kind: CompletenessDestinationKind;
    tableId?: string;
    listId?: string;
    listTitle?: string;
    titleNonce?: string;
}

export const EMPTY_IMPORT_DESTINATION_NONCES: ImportDestinationNonceState = {
    tables: {},
    lists: {},
    newLists: {},
};

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
}

function uniqueTitles(values: string[]): string[] {
    const seen = new Set<string>();
    const titles: string[] = [];
    for (const raw of values) {
        const title = raw.trim();
        const key = title.toLocaleLowerCase();
        if (!title || seen.has(key)) continue;
        seen.add(key);
        titles.push(title);
    }
    return titles;
}

/**
 * Reconcile the selected destinations with their persisted nonce set. Existing
 * destinations keep their nonce; newly selected destinations mint exactly once.
 * Removed destinations are pruned before a manifest is released to the drain.
 */
export function reconcileImportDestinationNonces(
    selection: ImportDestinationSelection,
    prior: Partial<ImportDestinationNonceState> | null | undefined,
    uuid: () => string = safeRandomUUID,
): ImportDestinationNonceState {
    const tables: Record<string, string> = {};
    for (const tableId of uniqueStrings(selection.tableIds)) {
        tables[tableId] = prior?.tables?.[tableId] ?? uuid();
    }

    const lists: Record<string, string> = {};
    for (const listId of uniqueStrings(selection.listIds)) {
        lists[listId] = prior?.lists?.[listId] ?? uuid();
    }

    const newLists: ImportDestinationNonceState['newLists'] = {};
    for (const title of uniqueTitles(selection.newListTitles)) {
        const existing = prior?.newLists?.[title];
        newLists[title] = existing ?? {
            destinationNonce: uuid(),
            titleNonce: uuid(),
        };
    }

    return {
        ...(selection.wishlist
            ? { wishlist: prior?.wishlist ?? uuid() }
            : {}),
        tables,
        lists,
        newLists,
    };
}

/** Build the deterministic destination order used for count + request records. */
export function importDestinationTargets(
    selection: ImportDestinationSelection,
    nonces: ImportDestinationNonceState,
): ImportDestinationTarget[] {
    const targets: ImportDestinationTarget[] = [];
    if (selection.wishlist && nonces.wishlist) {
        targets.push({ kind: 'wishlist', nonce: nonces.wishlist });
    }
    for (const tableId of uniqueStrings(selection.tableIds)) {
        const nonce = nonces.tables[tableId];
        if (nonce) targets.push({ kind: 'table', nonce, tableId });
    }
    for (const listId of uniqueStrings(selection.listIds)) {
        const nonce = nonces.lists[listId];
        if (nonce) targets.push({ kind: 'list', nonce, listId });
    }
    for (const title of uniqueTitles(selection.newListTitles)) {
        const pair = nonces.newLists[title];
        if (pair) {
            targets.push({
                kind: 'new_list',
                nonce: pair.destinationNonce,
                listTitle: title,
                titleNonce: pair.titleNonce,
            });
        }
    }
    return targets;
}

/** The server seals only on exact item x destination cardinality. */
export function expectedImportDestinations(itemCount: number, targetCount: number): number {
    return Math.max(0, Math.floor(itemCount)) * Math.max(0, Math.floor(targetCount));
}

/**
 * Expand a target set for the items carried by this request. The first target is
 * the stable completion-notification intent; the server's job barrier still emits
 * at most one notification for the whole sealed job.
 */
export function buildCompletenessDestinationIntent(
    itemNonces: string[],
    targets: ImportDestinationTarget[],
    notifyDone = true,
): CompletenessDestinationIntent[] {
    const out: CompletenessDestinationIntent[] = [];
    for (const itemNonce of itemNonces) {
        targets.forEach((target, targetIndex) => {
            out.push({
                item_nonce: itemNonce,
                destination_nonce: target.nonce,
                destination_kind: target.kind,
                ...(target.tableId ? { target_table_id: target.tableId } : {}),
                ...(target.listId ? { target_list_id: target.listId } : {}),
                ...(target.listTitle ? { target_list_title: target.listTitle } : {}),
                ...(target.titleNonce ? { title_nonce: target.titleNonce } : {}),
                notify_done: notifyDone && targetIndex === 0,
            });
        });
    }
    return out;
}

export function normalizeImportDestinationNonces(value: unknown): ImportDestinationNonceState | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const raw = value as Record<string, unknown>;
    const stringRecord = (candidate: unknown): Record<string, string> => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
        return Object.fromEntries(
            Object.entries(candidate as Record<string, unknown>)
                .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );
    };
    const newLists: ImportDestinationNonceState['newLists'] = {};
    if (raw.newLists && typeof raw.newLists === 'object' && !Array.isArray(raw.newLists)) {
        for (const [title, pair] of Object.entries(raw.newLists as Record<string, unknown>)) {
            if (!pair || typeof pair !== 'object' || Array.isArray(pair)) continue;
            const p = pair as Record<string, unknown>;
            if (typeof p.destinationNonce !== 'string' || typeof p.titleNonce !== 'string') continue;
            newLists[title] = {
                destinationNonce: p.destinationNonce,
                titleNonce: p.titleNonce,
            };
        }
    }
    return {
        ...(typeof raw.wishlist === 'string' ? { wishlist: raw.wishlist } : {}),
        tables: stringRecord(raw.tables),
        lists: stringRecord(raw.lists),
        newLists,
    };
}
