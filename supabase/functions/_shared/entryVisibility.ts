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
        args: {
            p_viewer: string;
            p_entry_ids: string[];
            p_require_content: boolean;
        },
    ) => PromiseLike<{ data: VisibleEntryIdRow[] | null; error: unknown }>;
};

export type EntryVisibilityOptions = {
    requireContent: boolean;
};

/**
 * Resolves entry candidates through the canonical server-side visibility gate.
 * Self rows do not need an RPC round trip; all non-self rows are deduplicated
 * into the service-role-only fn_visible_entry_ids batch helper. The helper does
 * not chunk: callers with more than 500 non-self ids must batch before calling.
 */
export async function loadVisibleEntryIds(
    supabase: EntryVisibilityRpcClient,
    viewerId: string,
    candidates: EntryVisibilityCandidate[],
    options: EntryVisibilityOptions,
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
        p_require_content: options.requireContent,
    });
    if (error) throw error;

    const requestedIds = new Set(entryIds);
    for (const row of data ?? []) {
        if (requestedIds.has(row.entry_id)) visibleIds.add(row.entry_id);
    }

    return visibleIds;
}
