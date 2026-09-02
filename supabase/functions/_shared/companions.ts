/**
 * Service-role companion authorization.
 *
 * A companion can read the tagged entry, so callers must not trust the
 * `entry_companions` RLS policy as the write gate. The Edge Function validates
 * both follow directions and both block directions before inserting rows.
 */

const IN_CHUNK_SIZE = 100;

type FollowRow = { follower_id?: string; following_id?: string };
type BlockRow = { blocker_id?: string; blocked_id?: string };

interface QueryResult<T> {
    data: T[] | null;
    error: unknown;
}

interface FilterBuilder<T> {
    eq(column: string, value: string): FilterBuilder<T>;
    in(column: string, values: string[]): PromiseLike<QueryResult<T>>;
}

export interface CompanionGateClient {
    from(table: string): {
        select(columns: string): FilterBuilder<FollowRow | BlockRow>;
    };
}

/**
 * Keep only candidates who mutually follow `authorId` and have no block in
 * either direction. Input order is preserved. Query failures throw so callers
 * fail closed; this helper must be called with the service-role client because
 * blocked_users RLS hides the reverse block direction.
 */
export async function filterMutualCompanionIds(
    supabase: CompanionGateClient,
    authorId: string,
    ids: string[],
): Promise<string[]> {
    const orderedCandidates = ids.filter((id) => id && id !== authorId);
    const candidates = [...new Set(orderedCandidates)];
    if (candidates.length === 0) return [];

    const authorFollows = new Set<string>();
    const followsAuthor = new Set<string>();
    const blocked = new Set<string>();

    for (let offset = 0; offset < candidates.length; offset += IN_CHUNK_SIZE) {
        const chunk = candidates.slice(offset, offset + IN_CHUNK_SIZE);

        const { data: outgoingRows, error: outgoingError } = await supabase
            .from('follows')
            .select('following_id')
            .eq('follower_id', authorId)
            .in('following_id', chunk);
        if (outgoingError) throw outgoingError;
        for (const row of (outgoingRows ?? []) as FollowRow[]) {
            if (row.following_id) authorFollows.add(row.following_id);
        }

        const { data: incomingRows, error: incomingError } = await supabase
            .from('follows')
            .select('follower_id')
            .eq('following_id', authorId)
            .in('follower_id', chunk);
        if (incomingError) throw incomingError;
        for (const row of (incomingRows ?? []) as FollowRow[]) {
            if (row.follower_id) followsAuthor.add(row.follower_id);
        }

        const { data: blockedByAuthorRows, error: blockedByAuthorError } = await supabase
            .from('blocked_users')
            .select('blocked_id')
            .eq('blocker_id', authorId)
            .in('blocked_id', chunk);
        if (blockedByAuthorError) throw blockedByAuthorError;
        for (const row of (blockedByAuthorRows ?? []) as BlockRow[]) {
            if (row.blocked_id) blocked.add(row.blocked_id);
        }

        const { data: blockedAuthorRows, error: blockedAuthorError } = await supabase
            .from('blocked_users')
            .select('blocker_id')
            .eq('blocked_id', authorId)
            .in('blocker_id', chunk);
        if (blockedAuthorError) throw blockedAuthorError;
        for (const row of (blockedAuthorRows ?? []) as BlockRow[]) {
            if (row.blocker_id) blocked.add(row.blocker_id);
        }
    }

    return orderedCandidates.filter((id) =>
        authorFollows.has(id) && followsAuthor.has(id) && !blocked.has(id)
    );
}
