/**
 * useUserDiary — paginated chronological diary for a user.
 * TICKET-025
 *
 * Pages backward by visited_at cursor. Groups by month on the client.
 * Gated: self always accessible; stranger requires public profile (server-enforced).
 */
import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';
import type { DiaryEntryRow } from './useUserProfile';

export type YearSummary = {
    year: number;
    logs: number;
    places: number;
    avgRating: number | null;
    reviews: number;
};

export type DiaryPage = {
    rows: DiaryEntryRow[];
    nextCursor: string | null;
    yearSummary: YearSummary;
};

async function fetchDiaryPage(identifier: string, cursor?: string | null): Promise<DiaryPage> {
    const { data: { session } } = await supabase.auth.getSession();

    const body: Record<string, unknown> = { action: 'diary', identifier };
    if (cursor) body.cursor = cursor;

    const { data, error } = await supabase.functions.invoke('user-profile', {
        body,
        headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : undefined,
    });

    if (error) {
        let details = error.message;
        try {
            if (error.context && typeof error.context.json === 'function') {
                const b = await error.context.json();
                details = JSON.stringify(b);
            }
        } catch (_) { /* ignore */ }
        throw new Error(details);
    }
    if (data?.error) throw new Error(data.error);

    return data?.data as DiaryPage;
}

export function useUserDiary(identifier: string | null | undefined) {
    return useInfiniteQuery<DiaryPage, Error>({
        queryKey: queryKeys.users.diary(identifier ?? ''),
        queryFn: ({ pageParam }) =>
            fetchDiaryPage(identifier!, pageParam as string | null | undefined),
        initialPageParam: null as string | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
        enabled: !!identifier,
        staleTime: 1000 * 60 * 5,
    });
}

/**
 * Group diary rows by "YYYY-MM" month key.
 * Returns ordered array of { monthLabel, rows }.
 */
export function groupDiaryByMonth(rows: DiaryEntryRow[]): { monthKey: string; monthLabel: string; rows: DiaryEntryRow[] }[] {
    const map = new Map<string, DiaryEntryRow[]>();
    for (const row of rows) {
        const ts = row.visited_at ?? row.created_at;
        const d = new Date(ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const existing = map.get(key);
        if (existing) {
            existing.push(row);
        } else {
            map.set(key, [row]);
        }
    }

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    return [...map.entries()].map(([key, monthRows]) => {
        const [year, month] = key.split('-').map(Number);
        const label = month === new Date().getMonth() + 1 && year === new Date().getFullYear()
            ? MONTHS[month - 1]
            : `${MONTHS[month - 1]} ${year}`;
        return { monthKey: key, monthLabel: label, rows: monthRows };
    });
}
