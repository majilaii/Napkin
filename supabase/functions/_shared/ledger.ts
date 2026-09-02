import {
    loadVisibleEntryIds,
    type EntryVisibilityCandidate,
    type EntryVisibilityRpcClient,
} from './entryVisibility.ts';

export const LEDGER_COHORT_CHUNK_SIZE = 100;
export const LEDGER_RESTAURANT_CHUNK_SIZE = 100;
export const LEDGER_VISIBILITY_CHUNK_SIZE = 500;
export const LEDGER_PAGE_SIZE = 1000;
export const LEDGER_FOLLOWEE_CAP = 500;
export const LEDGER_TABLE_MEMBER_CAP = 500;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CROWN_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export type LedgerInputErrorCode = 'INVALID_MONTH' | 'INVALID_TZ' | 'FUTURE_MONTH';

export type LedgerInputError = {
    ok: false;
    status: 400;
    code: LedgerInputErrorCode;
    message: string;
};

export type LedgerBounds = {
    ok: true;
    month: string;
    tz: string;
    monthStart: string;
    monthEnd: string;
    snapshotEnd: string;
    crownStart: string;
    currentMonth: string;
    isCurrentMonth: boolean;
};

export type LedgerCandidate = {
    id: string;
    user_id: string;
    restaurant_id: string;
    rating: number;
    visited_at: string | null;
    created_at: string;
};

export type LedgerProfile = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
};

export type LedgerRow = LedgerProfile & {
    napkins: number;
    meals: number;
    new_places: number;
    crowns: number;
    is_viewer: boolean;
};

export type LedgerScope =
    | { kind: 'friends' }
    | { kind: 'table'; table_id: string; table_name: string };

export class LedgerAuthorizationError extends Error {
    readonly status = 403;
    readonly code = 'NOT_A_MEMBER';

    constructor() {
        super('you are not a current member of this table');
        this.name = 'LedgerAuthorizationError';
    }
}

export function ledgerErrorResponse(
    code: string,
    message: string,
    status: number,
    headers: Record<string, string> = {},
): Response {
    return new Response(JSON.stringify({ error: { code, message } }), {
        status,
        headers: { ...headers, 'Content-Type': 'application/json' },
    });
}

export type RegularDetail = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    visits: number;
    is_viewer: boolean;
    runner_up: { display_name: string; gap: number } | null;
};

export type RegularResult = {
    regular: string | null;
    regular_detail: RegularDetail | null;
};

export type LedgerCandidateRead = {
    category: 'month' | 'crown' | 'lookback';
    branch: 'visited' | 'created';
    userIds: string[];
    restaurantIds?: string[];
    restaurantId?: string;
    start: string | null;
    end: string;
    after: { date: string; id: string } | null;
    limit: number;
};

export type LedgerReadPort = {
    fetchFollowees(viewerId: string): Promise<string[]>;
    fetchTableMembership?(viewerId: string, tableId: string): Promise<{ table_name: string } | null>;
    fetchTableMembers?(tableId: string): Promise<{ member_id: string; joined_at: string }[]>;
    fetchProfiles(userIds: string[]): Promise<LedgerProfile[]>;
    fetchEntryPage(request: LedgerCandidateRead): Promise<LedgerCandidate[]>;
    fetchVisibleEntryIds(
        viewerId: string,
        candidates: EntryVisibilityCandidate[],
    ): Promise<Set<string>>;
};

export type LedgerQueryMetrics = {
    month: number;
    crown: number;
    lookback: number;
    visibility: number;
    follows: number;
    profiles: number;
};

export type LedgerSnapshot = {
    data: { rows: LedgerRow[]; scope: LedgerScope };
    metrics: LedgerQueryMetrics;
};

export type RegularSnapshot = {
    data: RegularResult;
    metrics: LedgerQueryMetrics;
};

function partsInZone(instant: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(instant);
    const value = (type: Intl.DateTimeFormatPartTypes) =>
        Number(parts.find((part) => part.type === type)?.value ?? 0);
    return {
        year: value('year'),
        month: value('month'),
        day: value('day'),
        hour: value('hour'),
        minute: value('minute'),
        second: value('second'),
    };
}

/** Convert a local wall-clock instant in an IANA zone to its UTC instant. */
function zonedWallTimeToUtc(
    year: number,
    month: number,
    day: number,
    timeZone: string,
): Date {
    const wallClockMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
    let guessMs = wallClockMs;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const shown = partsInZone(new Date(guessMs), timeZone);
        const shownAsUtc = Date.UTC(
            shown.year,
            shown.month - 1,
            shown.day,
            shown.hour,
            shown.minute,
            shown.second,
        );
        const nextGuess = wallClockMs - (shownAsUtc - guessMs);
        if (nextGuess === guessMs) break;
        guessMs = nextGuess;
    }
    return new Date(guessMs);
}

function monthStringInZone(instant: Date, timeZone: string): string {
    const parts = partsInZone(instant, timeZone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

/**
 * Validate month/tz before any database read and derive half-open bounds.
 * Past snapshots end at month_end; the current snapshot ends at now.
 */
export function validateLedgerInput(
    month: unknown,
    tz: unknown,
    now = new Date(),
): LedgerBounds | LedgerInputError {
    if (typeof month !== 'string' || !MONTH_PATTERN.test(month)) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_MONTH',
            message: 'month must use YYYY-MM',
        };
    }
    if (typeof tz !== 'string' || tz.length === 0) {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_TZ',
            message: 'tz must be a valid IANA time zone',
        };
    }
    try {
        new Intl.DateTimeFormat(undefined, { timeZone: tz }).format(now);
    } catch {
        return {
            ok: false,
            status: 400,
            code: 'INVALID_TZ',
            message: 'tz must be a valid IANA time zone',
        };
    }

    const currentMonth = monthStringInZone(now, tz);
    if (month > currentMonth) {
        return {
            ok: false,
            status: 400,
            code: 'FUTURE_MONTH',
            message: 'month cannot be in the future',
        };
    }

    const [year, monthNumber] = month.split('-').map(Number);
    const nextYear = monthNumber === 12 ? year + 1 : year;
    const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
    const monthStart = zonedWallTimeToUtc(year, monthNumber, 1, tz);
    const monthEnd = zonedWallTimeToUtc(nextYear, nextMonth, 1, tz);
    const isCurrentMonth = month === currentMonth;
    const snapshotEnd = isCurrentMonth ? now : monthEnd;

    return {
        ok: true,
        month,
        tz,
        monthStart: monthStart.toISOString(),
        monthEnd: monthEnd.toISOString(),
        snapshotEnd: snapshotEnd.toISOString(),
        crownStart: new Date(snapshotEnd.getTime() - CROWN_WINDOW_MS).toISOString(),
        currentMonth,
        isCurrentMonth,
    };
}

function chunk<T>(values: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }
    return chunks;
}

function candidateDate(row: LedgerCandidate): string {
    return row.visited_at ?? row.created_at;
}

export function buildLedgerKeysetFilter(
    dateColumn: 'visited_at' | 'created_at',
    after: { date: string; id: string },
): string {
    return `${dateColumn}.gt.${after.date},and(${dateColumn}.eq.${after.date},id.gt.${after.id})`;
}

export function createSupabaseLedgerReader(
    supabase: EntryVisibilityRpcClient & { from: (table: string) => any },
): LedgerReadPort {
    return {
        async fetchFollowees(viewerId) {
            // The ring is the viewer plus the 500 most-recently-followed users.
            // This stays one single-column-filter read; the cap is intentionally
            // documented in code/FEATURE-MAP and never surfaced as UI copy.
            const { data, error } = await supabase
                .from('follows')
                .select('following_id')
                .eq('follower_id', viewerId)
                .order('created_at', { ascending: false })
                .limit(LEDGER_FOLLOWEE_CAP);
            if (error) throw error;
            return (data ?? []).map((row: { following_id: string }) => row.following_id);
        },

        async fetchTableMembership(viewerId, tableId) {
            const { data, error } = await supabase
                .from('table_members')
                .select('member_id, tables!inner(name)')
                .eq('table_id', tableId)
                .eq('member_id', viewerId)
                .maybeSingle();
            if (error) throw error;
            if (!data) return null;
            const joined = (data as { tables?: { name?: string } | { name?: string }[] }).tables;
            const table = Array.isArray(joined) ? joined[0] : joined;
            return { table_name: table?.name ?? 'the table' };
        },

        async fetchTableMembers(tableId) {
            const { data, error } = await supabase
                .from('table_members')
                .select('member_id, joined_at')
                .eq('table_id', tableId)
                .order('joined_at', { ascending: false })
                .limit(LEDGER_TABLE_MEMBER_CAP);
            if (error) throw error;
            return (data ?? []) as { member_id: string; joined_at: string }[];
        },

        async fetchProfiles(userIds) {
            if (userIds.length > LEDGER_COHORT_CHUNK_SIZE) {
                throw new Error('ledger profile chunk exceeds 100 ids');
            }
            const { data, error } = await supabase
                .from('profiles')
                .select('user_id, display_name, avatar_url')
                .in('user_id', userIds);
            if (error) throw error;
            return (data ?? []) as LedgerProfile[];
        },

        async fetchEntryPage(request) {
            if (request.userIds.length > LEDGER_COHORT_CHUNK_SIZE) {
                throw new Error('ledger cohort chunk exceeds 100 ids');
            }
            if (
                request.restaurantIds
                && request.restaurantIds.length > LEDGER_RESTAURANT_CHUNK_SIZE
            ) {
                throw new Error('ledger restaurant chunk exceeds 100 ids');
            }

            const dateColumn = request.branch === 'visited' ? 'visited_at' : 'created_at';
            let query = supabase
                .from('entries')
                .select('id, user_id, restaurant_id, rating, visited_at, created_at')
                // LAW: cohort filtering happens before fn_visible_entry_ids.
                .in('user_id', request.userIds)
                .not('restaurant_id', 'is', null)
                .not('rating', 'is', null);

            query = request.branch === 'visited'
                ? query.not('visited_at', 'is', null)
                : query.is('visited_at', null);
            if (request.restaurantIds) {
                query = query.in('restaurant_id', request.restaurantIds);
            } else if (request.restaurantId) {
                query = query.eq('restaurant_id', request.restaurantId);
            }
            if (request.start) query = query.gte(dateColumn, request.start);
            query = query.lt(dateColumn, request.end);
            if (request.after) {
                query = query.or(buildLedgerKeysetFilter(dateColumn, request.after));
            }

            const { data, error } = await query
                .order(dateColumn, { ascending: true })
                .order('id', { ascending: true })
                .limit(request.limit);
            if (error) throw error;
            return (data ?? []) as LedgerCandidate[];
        },

        async fetchVisibleEntryIds(viewerId, candidates) {
            if (candidates.length > LEDGER_VISIBILITY_CHUNK_SIZE) {
                throw new Error('ledger visibility chunk exceeds 500 ids');
            }
            return await loadVisibleEntryIds(supabase, viewerId, candidates, {
                requireContent: false,
            });
        },
    };
}

function emptyMetrics(): LedgerQueryMetrics {
    return { month: 0, crown: 0, lookback: 0, visibility: 0, follows: 0, profiles: 0 };
}

async function readBranchToExhaustion(
    reader: LedgerReadPort,
    request: Omit<LedgerCandidateRead, 'after' | 'limit'>,
    metrics: LedgerQueryMetrics,
): Promise<LedgerCandidate[]> {
    const rows: LedgerCandidate[] = [];
    let after: LedgerCandidateRead['after'] = null;

    while (true) {
        metrics[request.category] += 1;
        const page = await reader.fetchEntryPage({
            ...request,
            after,
            limit: LEDGER_PAGE_SIZE,
        });
        rows.push(...page);
        if (page.length < LEDGER_PAGE_SIZE) break;
        const last = page[page.length - 1];
        after = { date: candidateDate(last), id: last.id };
    }
    return rows;
}

async function readWindowForChunk(
    reader: LedgerReadPort,
    category: 'month' | 'crown',
    userIds: string[],
    start: string,
    end: string,
    metrics: LedgerQueryMetrics,
    restaurantId?: string,
): Promise<LedgerCandidate[]> {
    const [visited, created] = await Promise.all([
        readBranchToExhaustion(reader, {
            category,
            branch: 'visited',
            userIds,
            restaurantId,
            start,
            end,
        }, metrics),
        readBranchToExhaustion(reader, {
            category,
            branch: 'created',
            userIds,
            restaurantId,
            start,
            end,
        }, metrics),
    ]);
    return [...visited, ...created];
}

async function readLookbackForChunk(
    reader: LedgerReadPort,
    userIds: string[],
    restaurantIds: string[],
    end: string,
    metrics: LedgerQueryMetrics,
): Promise<LedgerCandidate[]> {
    const restaurantChunks = chunk(
        [...new Set(restaurantIds)],
        LEDGER_RESTAURANT_CHUNK_SIZE,
    );
    const groups = await Promise.all(restaurantChunks.map(async (ids) => {
        const [visited, created] = await Promise.all([
            readBranchToExhaustion(reader, {
                category: 'lookback',
                branch: 'visited',
                userIds,
                restaurantIds: ids,
                start: null,
                end,
            }, metrics),
            readBranchToExhaustion(reader, {
                category: 'lookback',
                branch: 'created',
                userIds,
                restaurantIds: ids,
                start: null,
                end,
            }, metrics),
        ]);
        return [...visited, ...created];
    }));
    return groups.flat();
}

async function loadFriendsCohort(
    reader: LedgerReadPort,
    viewerId: string,
    metrics: LedgerQueryMetrics,
): Promise<string[]> {
    metrics.follows += 1;
    const followees = await reader.fetchFollowees(viewerId);
    return [viewerId, ...followees.filter((id) => id !== viewerId).slice(0, LEDGER_FOLLOWEE_CAP)];
}

async function hydrateProfiles(
    reader: LedgerReadPort,
    cohort: string[],
    metrics: LedgerQueryMetrics,
): Promise<Map<string, LedgerProfile>> {
    const profileGroups = await Promise.all(
        chunk(cohort, LEDGER_COHORT_CHUNK_SIZE).map(async (ids) => {
            metrics.profiles += 1;
            return await reader.fetchProfiles(ids);
        }),
    );
    return new Map(profileGroups.flat().map((profile) => [profile.user_id, profile]));
}

async function loadSurvivorIds(
    reader: LedgerReadPort,
    viewerId: string,
    candidates: LedgerCandidate[],
    metrics: LedgerQueryMetrics,
): Promise<Set<string>> {
    const allCandidates = new Map<string, LedgerCandidate>();
    for (const candidate of candidates) allCandidates.set(candidate.id, candidate);

    // LAW: self candidates survive without RPC. Only the deduplicated non-self
    // union from EVERY read category is batched through the authorization RPC.
    const survivors = new Set<string>();
    const rpcCandidates: EntryVisibilityCandidate[] = [];
    for (const candidate of allCandidates.values()) {
        if (candidate.user_id === viewerId) {
            survivors.add(candidate.id);
        } else {
            rpcCandidates.push({ entryId: candidate.id, authorId: candidate.user_id });
        }
    }

    for (const batch of chunk(rpcCandidates, LEDGER_VISIBILITY_CHUNK_SIZE)) {
        metrics.visibility += 1;
        const visible = await reader.fetchVisibleEntryIds(viewerId, batch);
        for (const id of visible) survivors.add(id);
    }
    return survivors;
}

type CrownStanding = {
    userId: string;
    visits: number;
    lastVisit: string;
};

function crownStandings(rows: LedgerCandidate[]): CrownStanding[] {
    const byUser = new Map<string, CrownStanding>();
    for (const row of rows) {
        const date = candidateDate(row);
        const standing = byUser.get(row.user_id);
        if (standing) {
            standing.visits += 1;
            if (date > standing.lastVisit) standing.lastVisit = date;
        } else {
            byUser.set(row.user_id, { userId: row.user_id, visits: 1, lastVisit: date });
        }
    }
    return [...byUser.values()].sort((a, b) =>
        b.visits - a.visits
        || b.lastVisit.localeCompare(a.lastVisit)
        || a.userId.localeCompare(b.userId)
    );
}

function buildRegularResult(
    standings: CrownStanding[],
    profiles: Map<string, LedgerProfile>,
    viewerId: string,
): RegularResult {
    const winner = standings[0];
    if (!winner || winner.visits < 3) {
        return { regular: null, regular_detail: null };
    }

    const winnerProfile = profiles.get(winner.userId);
    const displayName = winnerProfile?.display_name ?? 'Member';
    const second = standings[1];
    const runnerUp = second && winner.visits - second.visits <= 2
        ? {
            display_name: profiles.get(second.userId)?.display_name ?? 'Member',
            gap: winner.visits - second.visits,
        }
        : null;
    const lead = winner.userId === viewerId
        ? "you're the regular here"
        : `${displayName} is the regular here`;
    const regular = runnerUp
        ? `${lead} · ${runnerUp.display_name} is ${runnerUp.gap} behind`
        : lead;

    return {
        regular,
        regular_detail: {
            user_id: winner.userId,
            display_name: displayName,
            avatar_url: winnerProfile?.avatar_url ?? null,
            visits: winner.visits,
            is_viewer: winner.userId === viewerId,
            runner_up: runnerUp,
        },
    };
}

/** Load the current rolling-90-day friends crown for one restaurant. */
export async function loadRestaurantRegular(
    reader: LedgerReadPort,
    viewerId: string,
    restaurantId: string,
    now = new Date(),
): Promise<RegularSnapshot> {
    const metrics = emptyMetrics();
    const cohort = await loadFriendsCohort(reader, viewerId, metrics);
    const cohortChunks = chunk(cohort, LEDGER_COHORT_CHUNK_SIZE);
    const crownRows = (await Promise.all(cohortChunks.map((userIds) =>
        readWindowForChunk(
            reader,
            'crown',
            userIds,
            new Date(now.getTime() - CROWN_WINDOW_MS).toISOString(),
            now.toISOString(),
            metrics,
            restaurantId,
        )
    ))).flat();
    const survivors = await loadSurvivorIds(reader, viewerId, crownRows, metrics);
    const visibleRows = crownRows.filter((row) => survivors.has(row.id));
    const standings = crownStandings(visibleRows);
    const winner = standings[0];
    if (!winner || winner.visits < 3) {
        return {
            data: { regular: null, regular_detail: null },
            metrics,
        };
    }

    const second = standings[1];
    const profileIds = [
        winner.userId,
        ...(second && winner.visits - second.visits <= 2 ? [second.userId] : []),
    ];
    metrics.profiles += 1;
    const profiles = new Map(
        (await reader.fetchProfiles(profileIds)).map((profile) => [profile.user_id, profile]),
    );
    return {
        data: buildRegularResult(standings, profiles, viewerId),
        metrics,
    };
}

/** Load one monthly friends ledger using the locked bounded read plan. */
export async function loadFriendsLedger(
    reader: LedgerReadPort,
    viewerId: string,
    bounds: LedgerBounds,
): Promise<LedgerSnapshot> {
    const metrics = emptyMetrics();
    const cohort = await loadFriendsCohort(reader, viewerId, metrics);
    return await loadLedgerForCohort(
        reader,
        viewerId,
        bounds,
        cohort,
        metrics,
        { kind: 'friends' },
    );
}

/** Load one monthly table ledger after proving current membership. */
export async function loadTableLedger(
    reader: LedgerReadPort,
    viewerId: string,
    tableId: string,
    bounds: LedgerBounds,
): Promise<LedgerSnapshot> {
    if (!reader.fetchTableMembership || !reader.fetchTableMembers) {
        throw new Error('table ledger reader is incomplete');
    }
    // LAW: month/tz validation occurs in the router before this membership read.
    const membership = await reader.fetchTableMembership(viewerId, tableId);
    if (!membership) throw new LedgerAuthorizationError();

    const memberRows = await reader.fetchTableMembers(tableId);
    const cohort = [...new Set(memberRows.map((row) => row.member_id))]
        .slice(0, LEDGER_TABLE_MEMBER_CAP);
    return await loadLedgerForCohort(
        reader,
        viewerId,
        bounds,
        cohort,
        emptyMetrics(),
        { kind: 'table', table_id: tableId, table_name: membership.table_name },
    );
}

async function loadLedgerForCohort(
    reader: LedgerReadPort,
    viewerId: string,
    bounds: LedgerBounds,
    cohort: string[],
    metrics: LedgerQueryMetrics,
    scope: LedgerScope,
): Promise<LedgerSnapshot> {
    const cohortChunks = chunk(cohort, LEDGER_COHORT_CHUNK_SIZE);
    const profilesPromise = hydrateProfiles(reader, cohort, metrics);

    const [monthByChunk, crownByChunk] = await Promise.all([
        Promise.all(cohortChunks.map((userIds) => readWindowForChunk(
            reader,
            'month',
            userIds,
            bounds.monthStart,
            bounds.snapshotEnd,
            metrics,
        ))),
        Promise.all(cohortChunks.map((userIds) => readWindowForChunk(
            reader,
            'crown',
            userIds,
            bounds.crownStart,
            bounds.snapshotEnd,
            metrics,
        ))),
    ]);

    const lookbackByChunk = await Promise.all(cohortChunks.map((userIds, index) => {
        const restaurantIds = monthByChunk[index].map((row) => row.restaurant_id);
        return readLookbackForChunk(
            reader,
            userIds,
            restaurantIds,
            bounds.snapshotEnd,
            metrics,
        );
    }));

    const monthRows = monthByChunk.flat();
    const crownRows = crownByChunk.flat();
    const lookbackRows = lookbackByChunk.flat();
    const survivors = await loadSurvivorIds(
        reader,
        viewerId,
        [...monthRows, ...crownRows, ...lookbackRows],
        metrics,
    );
    const visibleMonth = monthRows.filter((row) => survivors.has(row.id));
    const visibleCrown = crownRows.filter((row) => survivors.has(row.id));
    const visibleLookback = lookbackRows.filter((row) => survivors.has(row.id));

    const meals = new Map<string, number>();
    for (const row of visibleMonth) {
        meals.set(row.user_id, (meals.get(row.user_id) ?? 0) + 1);
    }

    // LAW: SQL never groups MIN over ungated rows. The first eligible visit is
    // computed only now, in memory, after the single union visibility gate.
    const firstVisitByUserRestaurant = new Map<string, string>();
    for (const row of visibleLookback) {
        const key = `${row.user_id}\u0000${row.restaurant_id}`;
        const date = candidateDate(row);
        const current = firstVisitByUserRestaurant.get(key);
        if (!current || date < current) firstVisitByUserRestaurant.set(key, date);
    }
    const newPlaces = new Map<string, number>();
    for (const [key, firstVisit] of firstVisitByUserRestaurant) {
        if (firstVisit < bounds.monthStart || firstVisit >= bounds.snapshotEnd) continue;
        const userId = key.split('\u0000')[0];
        newPlaces.set(userId, (newPlaces.get(userId) ?? 0) + 1);
    }

    const crowns = new Map<string, number>();
    const crownByRestaurant = new Map<string, LedgerCandidate[]>();
    for (const row of visibleCrown) {
        const rows = crownByRestaurant.get(row.restaurant_id) ?? [];
        rows.push(row);
        crownByRestaurant.set(row.restaurant_id, rows);
    }
    for (const rows of crownByRestaurant.values()) {
        const winner = crownStandings(rows)[0];
        if (winner?.visits >= 3) {
            crowns.set(winner.userId, (crowns.get(winner.userId) ?? 0) + 1);
        }
    }

    const profiles = await profilesPromise;
    const rows = cohort.map((userId): LedgerRow => {
        const mealCount = meals.get(userId) ?? 0;
        const newPlaceCount = newPlaces.get(userId) ?? 0;
        const crownCount = crowns.get(userId) ?? 0;
        const profile = profiles.get(userId);
        return {
            user_id: userId,
            display_name: profile?.display_name ?? 'Member',
            avatar_url: profile?.avatar_url ?? null,
            napkins: mealCount + newPlaceCount + crownCount,
            meals: mealCount,
            new_places: newPlaceCount,
            crowns: crownCount,
            is_viewer: userId === viewerId,
        };
    }).sort((a, b) =>
        b.napkins - a.napkins
        || b.meals - a.meals
        || a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })
        || a.user_id.localeCompare(b.user_id)
    );

    return { data: { rows, scope }, metrics };
}
