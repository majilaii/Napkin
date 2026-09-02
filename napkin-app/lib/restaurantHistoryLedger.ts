import type { MyList } from '@/hooks/lists/useMyLists';
import type { SelfLogRow } from '@/hooks/restaurants/useRestaurantPage';

const LEDGER_MONTHS = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const;

export function shortLedgerDate(value: string): string {
    const date = new Date(value);
    return `${date.getDate()} ${LEDGER_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function deriveLedgerStats(rows: SelfLogRow[]) {
    const sorted = [...rows].sort((a, b) => {
        if (a.visited_at !== b.visited_at) return a.visited_at < b.visited_at ? 1 : -1;
        return b.id.localeCompare(a.id);
    });
    const rated = rows.filter((row) => row.rating != null).map((row) => Number(row.rating));
    const timestamps = rows.map((row) => row.visited_at).sort();
    return {
        rows: sorted,
        average: rated.length > 0
            ? rated.reduce((sum, rating) => sum + rating, 0) / rated.length
            : null,
        count: rows.length,
        first: timestamps[0] ? shortLedgerDate(timestamps[0]) : null,
        last: timestamps.at(-1) ? shortLedgerDate(timestamps.at(-1)!) : null,
    };
}

export type ElsewherePart =
    | { kind: 'text'; label: string; prefix: string }
    | { kind: 'list'; label: string; id: string; prefix: string };

export function buildElsewhereParts({
    wishlisted,
    lists,
    containingListIds,
    selfClipCount,
}: {
    wishlisted: boolean;
    lists: MyList[];
    containingListIds: string[];
    selfClipCount: number;
}): ElsewherePart[] {
    const containing = new Set(containingListIds);
    const parts: ElsewherePart[] = [];
    if (wishlisted) parts.push({ kind: 'text', label: 'pinned', prefix: '' });

    const containingLists = lists.filter((list) => containing.has(list.id));
    if (containingLists.length > 0) {
        parts.push({
            kind: 'text',
            label: 'in',
            prefix: parts.length > 0 ? ' · ' : '',
        });
        containingLists.forEach((list, index) => {
            parts.push({
                kind: 'list',
                label: list.title,
                id: list.id,
                prefix: index === 0 ? ' ' : ', ',
            });
        });
    }
    if (selfClipCount > 0) {
        parts.push({
            kind: 'text',
            label: `${selfClipCount} clip${selfClipCount === 1 ? '' : 's'}`,
            prefix: parts.length > 0 ? ' · ' : '',
        });
    }
    return parts;
}

export function selfLogTarget(row: SelfLogRow):
    | { pathname: '/table-night-detail'; params: { nightId: string } }
    | { pathname: '/entry-detail'; params: { entryId: string } }
    | null {
    if (row.table_night_id) {
        return { pathname: '/table-night-detail', params: { nightId: row.table_night_id } };
    }
    if (row.entry_id) {
        return { pathname: '/entry-detail', params: { entryId: row.entry_id } };
    }
    return null;
}

type HistoryRouter = {
    canGoBack: () => boolean;
    back: () => void;
    replace: (target: {
        pathname: '/restaurant/[id]';
        params: { id: string; tableId?: string };
    }) => void;
};

export function leaveRestaurantHistory(
    router: HistoryRouter,
    restaurantId: string,
    tableId?: string,
) {
    if (router.canGoBack()) {
        router.back();
        return;
    }
    router.replace({
        pathname: '/restaurant/[id]',
        params: { id: restaurantId, ...(tableId ? { tableId } : {}) },
    });
}
