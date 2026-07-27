/* eslint-disable import/first */
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import {
    type ExhaustedCompletenessItem,
    type ExhaustedResponse,
    useCorrectCompletenessItem,
    useDismissCompletenessItem,
} from '../useCompletenessRetries';

const USER_ID = 'user-1';
const FIRST_ITEM: ExhaustedCompletenessItem = {
    id: 'item-1',
    job_id: 'job-1',
    item_nonce: 'item-nonce-1',
    import_nonce: 'import-nonce-1',
    restaurant_id: null,
    restaurant_name: 'Needs A Look',
    restaurant_city: 'London',
    resolution_id: null,
    external_id: null,
    last_error: 'no match',
    created_at: '2026-07-27T12:00:00Z',
};
const SECOND_ITEM: ExhaustedCompletenessItem = {
    ...FIRST_ITEM,
    id: 'item-2',
    item_nonce: 'item-nonce-2',
    import_nonce: null,
    restaurant_name: 'Another Spot',
};

const mockCallEdgeFn = callEdgeFn as jest.Mock;
const key = queryKeys.completeness.exhausted(USER_ID);

function exhaustedData(): InfiniteData<ExhaustedResponse> {
    return {
        pages: [
            {
                items: [FIRST_ITEM, SECOND_ITEM],
                next_cursor: null,
                has_more: false,
            },
        ],
        pageParams: [null],
    };
}

function cachedItemIds(client: QueryClient): string[] {
    const data = client.getQueryData<InfiniteData<ExhaustedResponse>>(key);
    return data?.pages.flatMap((page) => page.items ?? []).map((item) => item.id) ?? [];
}

describe('completeness item mutations', () => {
    beforeEach(() => {
        mockCallEdgeFn.mockReset();
    });

    it('optimistically removes a dismissed item', async () => {
        let resolveRequest: (value: unknown) => void = () => undefined;
        mockCallEdgeFn.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveRequest = resolve;
                }),
        );
        const { result, client } = renderHookWithClient(() =>
            useDismissCompletenessItem(USER_ID),
        );
        client.setQueryData(key, exhaustedData());

        act(() => result.current.mutate(FIRST_ITEM.id));

        await waitFor(() => {
            expect(cachedItemIds(client)).toEqual([SECOND_ITEM.id]);
            expect(mockCallEdgeFn).toHaveBeenCalledTimes(1);
        });
        expect(mockCallEdgeFn).toHaveBeenCalledWith('restaurant-completeness', {
            action: 'dismiss',
            body: { item_id: FIRST_ITEM.id },
        });

        await act(async () => {
            resolveRequest({
                item_id: FIRST_ITEM.id,
                state: 'exhausted',
                dismissed: true,
            });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('rolls a dismissed item back when the request fails', async () => {
        mockCallEdgeFn.mockRejectedValueOnce(new Error('dismiss failed'));
        const original = exhaustedData();
        const { result, client } = renderHookWithClient(() =>
            useDismissCompletenessItem(USER_ID),
        );
        client.setQueryData(key, original);

        act(() => result.current.mutate(FIRST_ITEM.id));

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(client.getQueryData(key)).toEqual(original);
    });

    it('optimistically removes a corrected item', async () => {
        let resolveRequest: (value: unknown) => void = () => undefined;
        mockCallEdgeFn.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveRequest = resolve;
                }),
        );
        const { result, client } = renderHookWithClient(() =>
            useCorrectCompletenessItem(USER_ID),
        );
        client.setQueryData(key, exhaustedData());

        act(() =>
            result.current.mutate({
                item_id: FIRST_ITEM.id,
                resolution_id: 'resolution-1',
            }),
        );

        await waitFor(() => {
            expect(cachedItemIds(client)).toEqual([SECOND_ITEM.id]);
            expect(mockCallEdgeFn).toHaveBeenCalledTimes(1);
        });
        expect(mockCallEdgeFn).toHaveBeenCalledWith('restaurant-completeness', {
            action: 'correct',
            body: {
                item_id: FIRST_ITEM.id,
                resolution_id: 'resolution-1',
            },
        });

        await act(async () => {
            resolveRequest({ item_id: FIRST_ITEM.id, state: 'pending' });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it('rolls a corrected item back when the request fails', async () => {
        mockCallEdgeFn.mockRejectedValueOnce(new Error('correct failed'));
        const original = exhaustedData();
        const { result, client } = renderHookWithClient(() =>
            useCorrectCompletenessItem(USER_ID),
        );
        client.setQueryData(key, original);

        act(() =>
            result.current.mutate({
                item_id: FIRST_ITEM.id,
                resolution_id: 'resolution-1',
            }),
        );

        await waitFor(() => expect(result.current.isError).toBe(true));
        expect(client.getQueryData(key)).toEqual(original);
    });
});
