import { useQuery } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';

export type LedgerRow = {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
    napkins: number;
    meals: number;
    new_places: number;
    crowns: number;
    is_viewer: boolean;
};

export type LedgerData = {
    rows: LedgerRow[];
    scope:
        | { kind: 'friends' }
        | { kind: 'table'; table_id: string; table_name: string };
};

export function deviceTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function ledgerMonthFor(date = new Date(), timeZone = deviceTimeZone()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    return `${year}-${month}`;
}

export async function fetchLedger(
    month: string,
    tz: string,
    tableId?: string,
): Promise<LedgerData> {
    return await callEdgeFn<LedgerData>('user-profile', {
        method: 'POST',
        action: 'ledger',
        body: { month, tz, ...(tableId ? { table_id: tableId } : {}) },
    });
}

export function useLedger(
    viewerId: string | null | undefined,
    month: string,
    tz: string,
    tableId?: string,
    enabled = true,
) {
    return useQuery({
        queryKey: queryKeys.users.ledger(viewerId ?? '', month, tz, tableId),
        queryFn: () => fetchLedger(month, tz, tableId),
        enabled: enabled && !!viewerId && !!month && !!tz,
        staleTime: 1000 * 60 * 5,
    });
}
