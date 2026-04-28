/**
 * Client-side pagination helpers for Napkin infinite-scroll endpoints.
 *
 * Server-side twin: supabase/functions/_shared/pagination.ts
 * The two are structurally identical but intentionally duplicated — the server
 * and client compile independently and share no TS build step.
 *
 * Cursor format: base64(${iso8601}|${uuid})
 * The server is authoritative on what's inside; clients treat cursors as opaque
 * strings and must never parse them — pass them through as-is.
 *
 * Usage:
 *   const query = useCursorPagedQuery({
 *     queryKey: queryKeys.users.diary(identifier),
 *     fetchPage: (cursor, token) => fetchDiaryPage(identifier, cursor, token),
 *     enabled: !!identifier,
 *   });
 *   const rows = flattenPages(query.data);
 */
import {
    useInfiniteQuery,
    type QueryKey,
} from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Canonical wire envelope returned by every paginated Napkin endpoint. */
export type Page<T> = { rows: T[]; next_cursor: string | null; has_more: boolean };

export type CursorPagedQueryArgs<T, ExtraPageFields = {}> = {
    queryKey: QueryKey;
    /** Called once per page. `cursor` is null for the first page. */
    fetchPage: (cursor: string | null, token: string | null) => Promise<Page<T> & ExtraPageFields>;
    enabled?: boolean;
    staleTime?: number;
};

/**
 * Wraps `useInfiniteQuery` with the canonical Napkin cursor pagination contract:
 * - Session token is fetched inside; callers don't touch auth.
 * - `getNextPageParam` reads `next_cursor` from the last page (null → done).
 * - `initialPageParam` is null (first page).
 *
 * Mandate: every paginated endpoint in Napkin MUST use this helper.
 * Do not open-code `useInfiniteQuery` or numeric offset patterns.
 *
 * `ExtraPageFields` (default `{}`) allows endpoints like `notifications/inbox`
 * to include extra top-level fields (e.g. `unread_count`) alongside the
 * canonical `rows / next_cursor / has_more` envelope without breaking existing
 * callers — they just don't pass the second generic and get the old behaviour.
 */
export function useCursorPagedQuery<T, ExtraPageFields = {}>(
    args: CursorPagedQueryArgs<T, ExtraPageFields>,
) {
    return useInfiniteQuery<Page<T> & ExtraPageFields, Error>({
        queryKey: args.queryKey,
        initialPageParam: null as string | null,
        queryFn: async ({ pageParam }) => {
            const { data: { session } } = await supabase.auth.getSession();
            return args.fetchPage(
                (pageParam as string | null) ?? null,
                session?.access_token ?? null,
            );
        },
        getNextPageParam: (last) => last.next_cursor ?? undefined,
        enabled: args.enabled ?? true,
        staleTime: args.staleTime ?? 1000 * 60 * 2,
    });
}

/**
 * Flatten all pages from an infinite query into a single array.
 * Use this everywhere instead of `data?.pages?.flat()` or manual `flatMap`.
 *
 * Example:
 *   const items = flattenPages(activityData);
 */
export function flattenPages<T>(data: { pages: Page<T>[] } | undefined): T[] {
    return data?.pages.flatMap((p) => p.rows) ?? [];
}
