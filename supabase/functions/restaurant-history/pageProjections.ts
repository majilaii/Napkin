import { projectRound } from '../_shared/round_projection.ts';
import { loadVisibleEntryIds } from '../_shared/entryVisibility.ts';

export type SelfLogPhoto = {
    id: string;
    url: string;
};

export type SelfLogRow = {
    id: string;
    entry_id: string | null;
    table_night_id: string | null;
    source: 'solo' | 'supper';
    rating: number | null;
    note: string | null;
    visited_at: string | null;
    created_at: string;
    is_bare: boolean;
    supper_id: string | null;
    companions: string[];
    photos: SelfLogPhoto[];
};

export type TableNoteRow = {
    entry_id: string;
    table_id: string;
    table_name: string;
    author: {
        user_id: string;
        display_name: string;
        avatar_url: string | null;
    };
    rating: number | null;
    note: string;
    visited_at: string | null;
    created_at: string;
};

export type TableMembershipPair = {
    table_id: string;
    member_id: string;
};

type RoundProjection = {
    participants: Array<{
        user_id: string;
        display_name: string;
        rating: number | null;
        notes: string | null;
    }>;
};

type RoundProjector = (
    roundId: string,
    roundKind: 'live' | 'merged',
    supabase: any,
) => Promise<RoundProjection>;

function one<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
}

function sortProjectionRows<T extends { created_at: string }>(
    rows: T[],
    idFor: (row: T) => string,
): T[] {
    return rows.sort((a, b) => {
        if (a.created_at !== b.created_at) {
            return a.created_at < b.created_at ? 1 : -1;
        }
        return idFor(b).localeCompare(idFor(a));
    });
}

function photosForEntry(entry: any): SelfLogPhoto[] {
    const photos = ((entry.entry_photos ?? []) as any[])
        .filter((photo) => typeof photo?.id === 'string' && typeof photo?.photo_url === 'string')
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
        .map((photo) => ({ id: photo.id as string, url: photo.photo_url as string }));
    if (entry.photo_url && !photos.some((photo) => photo.url === entry.photo_url)) {
        photos.unshift({ id: `hero:${entry.id}`, url: entry.photo_url });
    }
    return photos;
}

/** Advisory UI state; undo must repeat these checks under the writer's lock.
 * Mirrors fn_visit_entry_result.is_bare: a date is metadata, never enrichment. */
export function isBareVisit(entry: any): boolean {
    return entry.rating == null
        && ['content', 'dish_description', 'cooked_by', 'photo_url'].every((key) => !entry[key]?.trim())
        && ['vibe_rating', 'flavor_rating', 'service_rating', 'value_rating', 'value_profile',
            'table_id', 'table_night_id', 'supper_id'].every((key) => entry[key] == null)
        && entry.liked !== true
        && ['entry_photos', 'entry_tables'].every((key) => !(entry[key]?.length))
        && ['entry_companions', 'entry_participants'].every((key) =>
            !(entry[key] ?? []).some((person: any) => person.user_id !== entry.user_id));
}

async function companionsFor(
    supabase: any,
    viewerId: string,
    roundId: string,
    kind: 'live' | 'merged',
    roundProjector: RoundProjector,
): Promise<string[]> {
    const projected = await roundProjector(roundId, kind, supabase);
    return projected.participants
        .filter((participant) => participant.user_id !== viewerId)
        .map((participant) => participant.display_name)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
}

/** Viewer-authored ledger for restaurant-history?action=page. */
export async function loadSelfLog(
    supabase: any,
    viewerId: string,
    restaurantId: string,
    roundProjector: RoundProjector = projectRound,
): Promise<SelfLogRow[]> {
    const { data: authoredEntries, error: entriesError } = await supabase
        .from('entries')
        .select(`
            id, user_id,
            rating,
            content,
            visited_at,
            created_at,
            table_night_id,
            supper_id, table_id, liked, dish_description, cooked_by, value_profile,
            vibe_rating, flavor_rating, service_rating, value_rating, photo_url,
            entry_tables(entry_id), entry_companions(user_id), entry_participants(user_id),
            entry_photos(id, photo_url, sort_order)
        `)
        .eq('user_id', viewerId)
        .eq('restaurant_id', restaurantId)
        .is('table_night_id', null);
    if (entriesError) throw entriesError;

    const entries = (authoredEntries ?? []) as any[];
    const entryIds = entries.map((entry) => entry.id as string).filter(Boolean);
    let roundBindings: any[] = [];
    if (entryIds.length > 0) {
        const { data, error } = await supabase
            .from('round_entries')
            .select('entry_id, round_id')
            .in('entry_id', entryIds);
        if (error) throw error;
        roundBindings = (data ?? []) as any[];
    }

    const roundIds = [...new Set(roundBindings.map((binding) => binding.round_id as string).filter(Boolean))];
    let mergedNights: any[] = [];
    if (roundIds.length > 0) {
        const { data, error } = await supabase
            .from('table_nights')
            .select('id, revealed_at, created_at')
            .in('id', roundIds)
            .eq('restaurant_id', restaurantId)
            .eq('kind', 'merged');
        if (error) throw error;
        mergedNights = (data ?? []) as any[];
    }

    const bindingByEntry = new Map<string, string>();
    for (const binding of roundBindings) {
        bindingByEntry.set(binding.entry_id as string, binding.round_id as string);
    }
    const mergedNightById = new Map(mergedNights.map((night) => [night.id as string, night]));

    const entryRows = await Promise.all(entries.map(async (entry): Promise<SelfLogRow> => {
        const roundId = bindingByEntry.get(entry.id as string);
        const mergedNight = roundId ? mergedNightById.get(roundId) : null;
        if (roundId && mergedNight) {
            return {
                id: `round:${roundId}`,
                entry_id: entry.id as string,
                table_night_id: roundId,
                source: 'supper',
                rating: entry.rating ?? null,
                note: entry.content ?? null,
                visited_at: (mergedNight.revealed_at ?? mergedNight.created_at) as string,
                created_at: entry.created_at as string,
                is_bare: false,
                supper_id: entry.supper_id ?? null,
                companions: await companionsFor(
                    supabase,
                    viewerId,
                    roundId,
                    'merged',
                    roundProjector,
                ),
                photos: photosForEntry(entry),
            };
        }

        return {
            id: `entry:${entry.id}`,
            entry_id: entry.id as string,
            table_night_id: null,
            source: 'solo',
            rating: entry.rating ?? null,
            note: entry.content ?? null,
            visited_at: entry.visited_at ?? null,
            created_at: entry.created_at as string,
            is_bare: isBareVisit(entry) && !roundId,
            supper_id: entry.supper_id ?? null,
            companions: [],
            photos: photosForEntry(entry),
        };
    }));

    const { data: liveTakes, error: liveError } = await supabase
        .from('table_night_participants')
        .select(`
            table_night_id,
            rating,
            notes,
            table_nights!inner(id, kind, status, restaurant_id, revealed_at, created_at)
        `)
        .eq('user_id', viewerId)
        .eq('table_nights.restaurant_id', restaurantId)
        .eq('table_nights.kind', 'live')
        .in('table_nights.status', ['revealed', 'closed']);
    if (liveError) throw liveError;

    const liveRows = await Promise.all(((liveTakes ?? []) as any[]).flatMap((take) => {
        const night = one<any>(take.table_nights);
        if (!night) return [];
        const roundId = take.table_night_id as string;
        return [companionsFor(
            supabase,
            viewerId,
            roundId,
            'live',
            roundProjector,
        ).then((companions): SelfLogRow => ({
            id: `round:${roundId}`,
            entry_id: null,
            table_night_id: roundId,
            source: 'supper',
            rating: take.rating ?? null,
            note: take.notes ?? null,
            visited_at: (night.revealed_at ?? night.created_at) as string,
            created_at: night.created_at as string,
            is_bare: false,
            supper_id: null,
            companions,
            photos: [],
        }))];
    }));

    return sortProjectionRows([...entryRows, ...liveRows], (row) => row.id);
}

/** Authorized Table-ring note projection for restaurant-history?action=page. */
export async function loadTableNotes(
    supabase: any,
    viewerId: string,
    restaurantId: string,
    memberships: TableMembershipPair[],
): Promise<TableNoteRow[]> {
    if (memberships.length === 0) return [];

    const memberTableIds = [...new Set(memberships.map((pair) => pair.table_id))];
    const sharedUserIds = [...new Set(memberships.map((pair) => pair.member_id))];
    const membershipKeys = new Set(
        memberships.map((pair) => `${pair.table_id}\u0000${pair.member_id}`),
    );

    const { data: shareRows, error: sharesError } = await supabase
        .from('entry_tables')
        .select(`
            entry_id,
            table_id,
            entries!inner(id, user_id, rating, content, visited_at, created_at, restaurant_id),
            tables(id, name)
        `)
        .in('table_id', memberTableIds)
        .in('entries.user_id', sharedUserIds)
        .eq('entries.restaurant_id', restaurantId)
        .not('entries.content', 'is', null);
    if (sharesError) throw sharesError;

    const candidates = ((shareRows ?? []) as any[]).flatMap((share) => {
        const entry = one<any>(share.entries);
        const pairKey = entry
            ? `${share.table_id as string}\u0000${entry.user_id as string}`
            : '';
        if (
            !entry
            || !membershipKeys.has(pairKey)
            || typeof entry.content !== 'string'
            || entry.content.trim().length === 0
        ) {
            return [];
        }
        return [{ share, entry }];
    });
    if (candidates.length === 0) return [];

    const visibleIds = await loadVisibleEntryIds(
        supabase,
        viewerId,
        candidates.map(({ entry }) => ({
            entryId: entry.id as string,
            authorId: entry.user_id as string,
        })),
        { requireContent: true },
    );

    const visibleCandidates = candidates.filter(({ entry }) =>
        visibleIds.has(entry.id as string)
    );
    const authorIds = [...new Set(visibleCandidates.map(({ entry }) => entry.user_id as string))];
    const profiles = new Map<string, { display_name: string; avatar_url: string | null }>();
    if (authorIds.length > 0) {
        const { data, error } = await supabase
            .from('profiles')
            .select('user_id, display_name, avatar_url')
            .in('user_id', authorIds);
        if (error) throw error;
        for (const profile of data ?? []) {
            profiles.set((profile as any).user_id, {
                display_name: (profile as any).display_name ?? 'Member',
                avatar_url: (profile as any).avatar_url ?? null,
            });
        }
    }

    const projected = visibleCandidates.map(({ share, entry }): TableNoteRow => {
        const table = one<any>(share.tables);
        const profile = profiles.get(entry.user_id as string);
        return {
            entry_id: entry.id as string,
            table_id: share.table_id as string,
            table_name: table?.name ?? '',
            author: {
                user_id: entry.user_id as string,
                display_name: profile?.display_name ?? 'Member',
                avatar_url: profile?.avatar_url ?? null,
            },
            rating: entry.rating ?? null,
            note: entry.content as string,
            visited_at: entry.visited_at ?? null,
            created_at: entry.created_at as string,
        };
    });

    return sortProjectionRows(projected, (row) => row.entry_id);
}

export function appendPageProjections<T extends Record<string, unknown>>(
    base: T,
    additions: { self_log: SelfLogRow[]; table_notes: TableNoteRow[] },
): T & { self_log: SelfLogRow[]; table_notes: TableNoteRow[] } {
    return { ...base, ...additions };
}
