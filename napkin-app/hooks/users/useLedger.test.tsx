/* eslint-disable import/first -- Jest mocks must be registered before imports. */
jest.mock('react-native', () => {
    const ReactModule = jest.requireActual('react');
    const host = (name: string) => (props: Record<string, unknown>) =>
        ReactModule.createElement(name, props, props.children);
    return {
        Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
        StyleSheet: { create: (styles: unknown) => styles },
        Text: host('Text'),
        View: host('View'),
    };
});
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import { waitFor } from '@testing-library/react-native';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { fetchLedger, ledgerMonthFor, useLedger } from './useLedger';

describe('useLedger', () => {
    beforeEach(() => (callEdgeFn as jest.Mock).mockReset());

    it('uses canonical POST body and viewer/month/tz cache key', async () => {
        (callEdgeFn as jest.Mock).mockResolvedValue({ rows: [], scope: { kind: 'friends' } });
        const result = await fetchLedger('2026-09', 'Europe/London');
        expect(result).toEqual({ rows: [], scope: { kind: 'friends' } });
        expect(callEdgeFn).toHaveBeenCalledWith('user-profile', {
            method: 'POST',
            action: 'ledger',
            body: { month: '2026-09', tz: 'Europe/London' },
        });
        expect(queryKeys.users.ledger('viewer', '2026-09', 'Europe/London')).toEqual([
            'users', 'ledger', 'viewer', '2026-09', 'Europe/London',
        ]);
        expect(queryKeys.users.ledger('viewer', '2026-09', 'Europe/London', 'table-1')).toEqual([
            'users', 'ledger', 'viewer', '2026-09', 'Europe/London', 'table-1',
        ]);
    });

    it('adds table_id only for a table-scoped request', async () => {
        (callEdgeFn as jest.Mock).mockResolvedValue({
            rows: [],
            scope: { kind: 'table', table_id: 'table-1', table_name: 'Sunday Roast' },
        });
        await fetchLedger('2026-09', 'UTC', 'table-1');
        expect(callEdgeFn).toHaveBeenCalledWith('user-profile', {
            method: 'POST',
            action: 'ledger',
            body: { month: '2026-09', tz: 'UTC', table_id: 'table-1' },
        });
    });

    it('never fetches without the exact self-tab enable gate', async () => {
        renderHookWithClient(() => useLedger('viewer', '2026-09', 'UTC', undefined, false));
        await Promise.resolve();
        expect(callEdgeFn).not.toHaveBeenCalled();
    });

    it('fetches when enabled and derives the month in the requested zone', async () => {
        (callEdgeFn as jest.Mock).mockResolvedValue({ rows: [], scope: { kind: 'friends' } });
        const { result } = renderHookWithClient(() => useLedger('viewer', '2026-09', 'UTC'));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(ledgerMonthFor(new Date('2026-09-01T00:30:00.000Z'), 'America/Los_Angeles'))
            .toBe('2026-08');
    });
});
