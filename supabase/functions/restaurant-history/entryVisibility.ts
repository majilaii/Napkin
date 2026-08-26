export type EntryVisibilityCandidate = {
    entryId: string;
    authorId: string | null | undefined;
};

type VisibleEntryIdRow = {
    entry_id: string;
};

export type EntryVisibilityRpcClient = {
    rpc: (
        name: 'fn_visible_entry_ids',
        args: { p_viewer: string; p_entry_ids: string[] },
    ) => PromiseLike<{ data: VisibleEntryIdRow[] | null; error: unknown }>;
};

/**
 * Resolves every restaurant-page entry candidate through one server-side gate.
 * Self rows do not need an RPC round trip; all non-self rows are deduplicated
 * into the service-role-only fn_visible_entry_ids batch helper.
 */
export async function loadVisibleEntryIds(
    supabase: EntryVisibilityRpcClient,
    viewerId: string,
    candidates: EntryVisibilityCandidate[],
): Promise<Set<string>> {
    const visibleIds = new Set<string>();
    const nonSelfIds = new Set<string>();

    for (const candidate of candidates) {
        if (!candidate.entryId) continue;
        if (candidate.authorId === viewerId) {
            visibleIds.add(candidate.entryId);
        } else {
            nonSelfIds.add(candidate.entryId);
        }
    }

    if (nonSelfIds.size === 0) return visibleIds;

    const entryIds = [...nonSelfIds];
    const { data, error } = await supabase.rpc('fn_visible_entry_ids', {
        p_viewer: viewerId,
        p_entry_ids: entryIds,
    });
    if (error) throw error;

    const requestedIds = new Set(entryIds);
    for (const row of data ?? []) {
        if (requestedIds.has(row.entry_id)) visibleIds.add(row.entry_id);
    }

    return visibleIds;
}

/** Applies one resolved visibility set to both restaurant-page signal sources. */
export function filterVisibleEntrySignals<
    TEntry extends { id: string },
    TPhoto extends { entry_id: string },
>(
    visibleIds: ReadonlySet<string>,
    entries: TEntry[],
    photos: TPhoto[],
): { entries: TEntry[]; photos: TPhoto[] } {
    return {
        entries: entries.filter((entry) => visibleIds.has(entry.id)),
        photos: photos.filter((photo) => visibleIds.has(photo.entry_id)),
    };
}
