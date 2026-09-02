import { filterMutualCompanionIds } from '../_shared/companions.ts';

const ENTRY_SCAN_LIMIT = 200;
const RECENT_COMPANION_LIMIT = 5;

export interface RecentCompanion {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
}

/**
 * Data loader for user-profile action=recent_companions.
 *
 * Frequency is computed from the viewer's own companion rows, then the ranked
 * candidate set is re-authorized against the current follow/block graph before
 * the top five are hydrated. Historical rows remain untouched.
 */
export async function fetchRecentCompanions(
    // Shared Edge Function loaders use the concrete service-role client at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: any,
    viewerId: string,
): Promise<RecentCompanion[]> {
    const { data: entries, error: entriesError } = await supabase
        .from('entries')
        .select('id')
        .eq('user_id', viewerId)
        .limit(ENTRY_SCAN_LIMIT);
    if (entriesError) throw entriesError;

    const entryIds = ((entries ?? []) as Array<{ id: string }>).map((entry) => entry.id);
    if (entryIds.length === 0) return [];

    const { data: companionRows, error: companionsError } = await supabase
        .from('entry_companions')
        .select('user_id')
        .in('entry_id', entryIds);
    if (companionsError) throw companionsError;

    const frequency = new Map<string, number>();
    for (const row of (companionRows ?? []) as Array<{ user_id: string }>) {
        frequency.set(row.user_id, (frequency.get(row.user_id) ?? 0) + 1);
    }
    if (frequency.size === 0) return [];

    const rankedIds = Array.from(frequency.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([userId]) => userId);
    const acceptedIds = (await filterMutualCompanionIds(
        supabase,
        viewerId,
        rankedIds,
    )).slice(0, RECENT_COMPANION_LIMIT);
    if (acceptedIds.length === 0) return [];

    const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, display_name, avatar_url')
        .in('user_id', acceptedIds);
    if (profilesError) throw profilesError;

    const profileById = new Map(
        ((profiles ?? []) as RecentCompanion[]).map((profile) => [profile.user_id, profile]),
    );
    return acceptedIds
        .map((userId) => profileById.get(userId))
        .filter((profile): profile is RecentCompanion => profile !== undefined)
        .map((profile) => ({
            user_id: profile.user_id,
            display_name: profile.display_name,
            avatar_url: profile.avatar_url ?? null,
        }));
}
