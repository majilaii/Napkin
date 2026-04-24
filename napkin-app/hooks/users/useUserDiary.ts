/**
 * useUserDiary — paginated chronological diary for a user.
 * TICKET-025 / TICKET-035
 *
 * Pages backward by (visited_at, id) cursor (opaque base64 string).
 * Groups by month on the client.
 * Gated: self always accessible; stranger requires public profile (server-enforced).
 */
import { queryKeys } from '@/lib/queryKeys';
import { useCursorPagedQuery, flattenPages, type Page } from '@/lib/pagination';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { DiaryEntryRow } from './useUserProfile';

async function fetchDiaryPage(
    identifier: string,
    cursor: string | null,
    _token: string | null,
): Promise<Page<DiaryEntryRow>> {
    const body: Record<string, unknown> = { identifier };
    if (cursor) body.cursor = cursor;
    return callEdgeFn<Page<DiaryEntryRow>>('user-profile', { action: 'diary', body });
}

export function useUserDiary(identifier: string | null | undefined) {
    return useCursorPagedQuery<DiaryEntryRow>({
        queryKey: queryKeys.users.diary(identifier ?? ''),
        fetchPage: (cursor, token) => fetchDiaryPage(identifier!, cursor, token),
        enabled: !!identifier,
        staleTime: 1000 * 60 * 5,
    });
}

/** Flatten all pages into a flat array of DiaryEntryRow. */
export function flattenDiary(data: ReturnType<typeof useUserDiary>['data']) {
    return flattenPages(data);
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
