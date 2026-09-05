import { buildPage, decodeCursor, type CursorTuple } from '../_shared/pagination.ts';

export interface ActivityRpcRow {
    activity_key: string;
    kind: 'entry' | 'pin' | 'list';
    sort_date: string;
    payload: Record<string, unknown> & { id: string };
}

/** Keep legacy UUID cursors out of the opt-in activity stream. Preserve SQL microseconds. */
export function activityCursor(value: unknown): CursorTuple | null {
    if (value == null) return null;
    if (typeof value !== 'string') throw new Error('Invalid activity cursor');
    const decoded = decodeCursor(value);
    if (!decoded || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(decoded.sort_date)
        || !Number.isFinite(Date.parse(decoded.sort_date))
        || !/^(entry|pin|list):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(decoded.id)) {
        throw new Error('Invalid activity cursor');
    }
    return decoded;
}

export async function loadActivityPage(
    rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>,
    viewerId: string, cursor: CursorTuple | null, limit: number,
) {
    const { data, error } = await rpc('fn_friends_activity', {
        p_viewer: viewerId, p_cursor_date: cursor?.sort_date ?? null,
        p_cursor_key: cursor?.id ?? null, p_limit: limit + 1,
    });
    if (error) throw error;
    const page = buildPage((data ?? []) as ActivityRpcRow[], limit,
        (row) => ({ sort_date: row.sort_date, id: row.activity_key }));
    return { ...page, rows: page.rows.map((row) => ({
        ...row.payload, activity_key: row.activity_key, kind: row.kind, sort_date: row.sort_date,
    })) };
}
