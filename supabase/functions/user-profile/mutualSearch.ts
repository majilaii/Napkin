const IN_CHUNK_SIZE = 100;

export interface MutualSearchProfile {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    created_at: string;
}

export interface MutualSearchResult {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    is_following: boolean;
    follows_caller: boolean;
    is_mutual: boolean;
}

interface FollowGraph {
    following: Set<string>;
    followers: Set<string>;
    mutualIds: string[];
}

function chunks<T>(values: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

async function fetchFollowGraph(
    // Edge loaders use the concrete service-role Supabase client at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    viewerId: string,
): Promise<FollowGraph> {
    const { data: outgoingRows, error: outgoingError } = await supabase
        .from('follows')
        .select('following_id')
        .eq('follower_id', viewerId);
    if (outgoingError) throw outgoingError;

    const { data: incomingRows, error: incomingError } = await supabase
        .from('follows')
        .select('follower_id')
        .eq('following_id', viewerId);
    if (incomingError) throw incomingError;

    const following = new Set<string>(
        ((outgoingRows ?? []) as Array<{ following_id: string }>).map((row) => row.following_id),
    );
    const followers = new Set<string>(
        ((incomingRows ?? []) as Array<{ follower_id: string }>).map((row) => row.follower_id),
    );
    return {
        following,
        followers,
        mutualIds: [...following].filter((userId) => followers.has(userId)),
    };
}

async function searchMutualProfileRows(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    pattern: string,
    mutualIds: string[],
): Promise<MutualSearchProfile[]> {
    if (mutualIds.length === 0) return [];

    const matches: MutualSearchProfile[] = [];
    for (const idChunk of chunks(mutualIds, IN_CHUNK_SIZE)) {
        const { data, error } = await supabase
            .from('profiles')
            .select('user_id, display_name, avatar_url, created_at')
            .ilike('display_name', pattern)
            .in('user_id', idChunk)
            .order('display_name', { ascending: true });
        if (error) throw error;
        matches.push(...((data ?? []) as MutualSearchProfile[]));
    }

    return matches
        .sort((a, b) =>
            a.display_name.localeCompare(b.display_name) || a.user_id.localeCompare(b.user_id)
        );
}

function compareBackfillRows(a: MutualSearchProfile, b: MutualSearchProfile): number {
    if (a.created_at > b.created_at) return -1;
    if (a.created_at < b.created_at) return 1;
    return a.display_name.localeCompare(b.display_name) || a.user_id.localeCompare(b.user_id);
}

/**
 * Mutual-only search contract shared by companion and table pickers: all mutual
 * matches first, then followed non-mutuals, then strangers up to maxResults.
 */
export async function searchProfilesWithMutualBackfill(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    viewerId: string,
    pattern: string,
    maxResults: number,
): Promise<MutualSearchResult[]> {
    const graph = await fetchFollowGraph(supabase, viewerId);
    const mutualRows = await searchMutualProfileRows(supabase, pattern, graph.mutualIds);
    const mutualResults = mutualRows.map((row) => ({
        user_id: row.user_id,
        display_name: row.display_name,
        avatar_url: row.avatar_url ?? null,
        is_following: true,
        follows_caller: true,
        is_mutual: true,
    }));

    const backfillLimit = Math.max(0, maxResults - mutualResults.length);
    if (backfillLimit === 0) return mutualResults;

    const followedOnlyIds = [...graph.following]
        .filter((userId) => !graph.followers.has(userId));
    const followedMatches: MutualSearchProfile[] = [];
    for (const idChunk of chunks(followedOnlyIds, IN_CHUNK_SIZE)) {
        const { data, error } = await supabase
            .from('profiles')
            .select('user_id, display_name, avatar_url, created_at')
            .ilike('display_name', pattern)
            .in('user_id', idChunk)
            .order('created_at', { ascending: false })
            .order('display_name', { ascending: true })
            .limit(backfillLimit);
        if (error) throw error;
        followedMatches.push(...((data ?? []) as MutualSearchProfile[]));
    }

    const followedRows = followedMatches
        .sort(compareBackfillRows)
        .slice(0, backfillLimit);
    const followedResults = followedRows.map((row) => ({
        user_id: row.user_id,
        display_name: row.display_name,
        avatar_url: row.avatar_url ?? null,
        is_following: graph.following.has(row.user_id),
        follows_caller: graph.followers.has(row.user_id),
        is_mutual: false,
    }));

    const strangerLimit = backfillLimit - followedResults.length;
    if (strangerLimit === 0) return [...mutualResults, ...followedResults];

    let strangerQuery = supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url, created_at')
        .ilike('display_name', pattern)
        .neq('user_id', viewerId);
    const excludedIds = [...new Set([...graph.mutualIds, ...graph.following])];
    for (const idChunk of chunks(excludedIds, IN_CHUNK_SIZE)) {
        strangerQuery = strangerQuery.not('user_id', 'in', `(${idChunk.join(',')})`);
    }

    const { data: strangerData, error: strangerError } = await strangerQuery
        .order('created_at', { ascending: false })
        .order('display_name', { ascending: true })
        .limit(strangerLimit);
    if (strangerError) throw strangerError;

    const strangerResults = ((strangerData ?? []) as MutualSearchProfile[])
        .map((row) => ({
            user_id: row.user_id,
            display_name: row.display_name,
            avatar_url: row.avatar_url ?? null,
            is_following: graph.following.has(row.user_id),
            follows_caller: graph.followers.has(row.user_id),
            is_mutual: false,
        }));

    return [...mutualResults, ...followedResults, ...strangerResults];
}
