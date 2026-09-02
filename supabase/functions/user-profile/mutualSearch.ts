const IN_CHUNK_SIZE = 100;

export interface MutualSearchProfile {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    created_at: string;
}

function chunks<T>(values: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
}

/** Resolve the full mutual set before applying display-name search and limit. */
export async function searchMutualProfiles(
    // Edge loaders use the concrete service-role Supabase client at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    viewerId: string,
    pattern: string,
    limit: number,
): Promise<MutualSearchProfile[]> {
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

    const followers = new Set<string>(
        ((incomingRows ?? []) as Array<{ follower_id: string }>).map((row) => row.follower_id),
    );
    const mutualIds = ((outgoingRows ?? []) as Array<{ following_id: string }>)
        .map((row) => row.following_id)
        .filter((userId) => followers.has(userId));
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
        )
        .slice(0, limit);
}
