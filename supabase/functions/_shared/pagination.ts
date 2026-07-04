/**
 * Shared pagination helpers for Napkin edge functions.
 *
 * Server-side twin of napkin-app/lib/pagination.ts — structurally identical
 * but intentionally duplicated so server and client compile independently.
 *
 * Cursor format: base64(${iso8601}|${uuid})
 * Example plaintext: 2026-04-18T21:34:22.123Z|c1a0c9e4-8b2f-4a3d-9e1b-7f2a3b4c5d6e
 * The server is authoritative on what's inside; clients treat it as an opaque string.
 */

export type CursorTuple = { sort_date: string; id: string };

export function encodeCursor(c: CursorTuple): string {
    return btoa(`${c.sort_date}|${c.id}`);
}

export function decodeCursor(s: string | null | undefined): CursorTuple | null {
    if (!s) return null;
    try {
        const plain = atob(s);
        const pipe = plain.indexOf('|');
        if (pipe < 0) return null;
        const sort_date = plain.slice(0, pipe);
        const id = plain.slice(pipe + 1);
        if (!sort_date || !id) return null;
        return { sort_date, id };
    } catch {
        return null;
    }
}

export type Page<Row> = {
    rows: Row[];
    next_cursor: string | null;
    has_more: boolean;
};

/**
 * Build a Page envelope from raw query results.
 *
 * Caller must query with `.limit(pageSize + 1)` so we can detect has_more.
 * The `getCursor` getter extracts (sort_date, id) from the last kept row
 * and is used to encode the next_cursor.
 */
export function buildPage<Row>(
    rows: Row[],
    pageSize: number,
    getCursor: (r: Row) => CursorTuple,
): Page<Row> {
    const has_more = rows.length > pageSize;
    const kept = has_more ? rows.slice(0, pageSize) : rows;
    const last = kept[kept.length - 1];
    const next_cursor = has_more && last ? encodeCursor(getCursor(last)) : null;
    return { rows: kept, next_cursor, has_more };
}

// NOTE (TICKET-099): a former `applyKeysetFilter` helper here decomposed the
// keyset tuple into a PostgREST or-filter on a literal `sort_date` column. Its
// only caller filtered raw `entries` — which has no sort_date column — so every
// cursor request 42703'd. Keyset filtering belongs IN SQL, on a projected
// sort_date = COALESCE(visited_at, created_at): see fn_user_diary_page,
// fn_friends_feed, fn_user_aggregate_feed. Do not reintroduce a client-side
// keyset filter against a base table.
