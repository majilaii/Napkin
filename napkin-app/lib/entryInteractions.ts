export type EntryInteractionScope = 'table' | 'public';

export interface EntryInteractionContext {
    enabled: boolean;
    scope: EntryInteractionScope;
    targetType: 'entry' | null;
    targetId: string | null;
}

type EntryInteractionCandidate = {
    id: string;
    table_id: string | null;
};

/**
 * Entry interactions exist only in a Table or on the public review surface.
 * Private solo journal entries have neither interaction scope, so querying the
 * Table endpoint for them can only return 404 "Target not found".
 */
export function getEntryInteractionContext(
    entry: EntryInteractionCandidate | null | undefined,
    isPublicView: boolean,
): EntryInteractionContext {
    const scope: EntryInteractionScope = isPublicView ? 'public' : 'table';
    const enabled = !!entry?.id && (isPublicView || !!entry.table_id);

    return {
        enabled,
        scope,
        targetType: enabled ? 'entry' : null,
        targetId: enabled ? entry!.id : null,
    };
}
