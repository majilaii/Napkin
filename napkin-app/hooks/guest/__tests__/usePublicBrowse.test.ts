import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import {
    useGuestList,
    useGuestRecent,
    useGuestRestaurantPage,
    useGuestReviews,
    useGuestSearch,
} from '../usePublicBrowse';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/lib/supabase', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/__mocks__/supabase');
});

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

function wrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children);
    };
}

function freshClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('usePublicBrowse', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('search sends the trimmed query and never fires below two characters', async () => {
        mockCallEdgeFn.mockResolvedValue({ rows: [] });
        const client = freshClient();

        const short = renderHook(() => useGuestSearch(' k '), { wrapper: wrapper(client) });
        await Promise.resolve();
        expect(mockCallEdgeFn).not.toHaveBeenCalled();
        expect(short.result.current.fetchStatus).toBe('idle');
        short.unmount();

        renderHook(() => useGuestSearch('  kiln '), { wrapper: wrapper(client) });
        await waitFor(() => expect(mockCallEdgeFn).toHaveBeenCalledTimes(1));
        expect(mockCallEdgeFn).toHaveBeenCalledWith('public-browse', {
            action: 'search',
            body: { q: 'kiln' },
        });
    });

    it('recent asks for the recently reviewed rows', async () => {
        mockCallEdgeFn.mockResolvedValue({ rows: [{ id: 'r1' }] });
        const client = freshClient();

        const { result } = renderHook(() => useGuestRecent(), { wrapper: wrapper(client) });
        await waitFor(() => expect(result.current.data).toEqual([{ id: 'r1' }]));
        expect(mockCallEdgeFn).toHaveBeenCalledWith('public-browse', {
            action: 'recent',
            body: {},
        });
    });

    it('page sends the restaurant id and stays idle without one', async () => {
        mockCallEdgeFn.mockResolvedValue({ restaurant: { id: 'r1' }, reviews: [], reviews_total: 0 });
        const client = freshClient();

        const idle = renderHook(() => useGuestRestaurantPage(null), { wrapper: wrapper(client) });
        await Promise.resolve();
        expect(mockCallEdgeFn).not.toHaveBeenCalled();
        idle.unmount();

        renderHook(() => useGuestRestaurantPage('r1'), { wrapper: wrapper(client) });
        await waitFor(() => expect(mockCallEdgeFn).toHaveBeenCalledTimes(1));
        expect(mockCallEdgeFn).toHaveBeenCalledWith('public-browse', {
            action: 'page',
            body: { restaurant_id: 'r1' },
        });
    });

    it('reviews sends the restaurant id and threads the cursor on the next page', async () => {
        mockCallEdgeFn
            .mockResolvedValueOnce({ rows: [{ entry_id: 'e1' }], next_cursor: 'c1', has_more: true })
            .mockResolvedValueOnce({ rows: [{ entry_id: 'e2' }], next_cursor: null, has_more: false });
        const client = freshClient();

        const { result } = renderHook(() => useGuestReviews('r1'), { wrapper: wrapper(client) });
        await waitFor(() => expect(result.current.hasNextPage).toBe(true));
        expect(mockCallEdgeFn).toHaveBeenCalledWith('public-browse', {
            action: 'reviews',
            body: { restaurant_id: 'r1' },
        });

        await result.current.fetchNextPage();
        await waitFor(() => expect(result.current.hasNextPage).toBe(false));
        expect(mockCallEdgeFn).toHaveBeenLastCalledWith('public-browse', {
            action: 'reviews',
            body: { restaurant_id: 'r1', cursor: 'c1' },
        });
    });
    it('list sends the list id and reads a 404 as not found, never as an error', async () => {
        const detail = { list: { id: 'l1' }, entries: [], owner_profile: {}, save_count: 0 };
        mockCallEdgeFn.mockResolvedValueOnce(detail);
        const client = freshClient();

        const idle = renderHook(() => useGuestList(undefined), { wrapper: wrapper(client) });
        await Promise.resolve();
        expect(mockCallEdgeFn).not.toHaveBeenCalled();
        idle.unmount();

        const found = renderHook(() => useGuestList('l1'), { wrapper: wrapper(client) });
        await waitFor(() => expect(found.result.current.data).toEqual({ data: detail, isNotFound: false }));
        expect(mockCallEdgeFn).toHaveBeenCalledWith('public-browse', {
            action: 'list',
            body: { list_id: 'l1' },
        });

        const notFoundErr = Object.assign(new Error('list not found'), {
            cause: { code: 'NOT_FOUND', message: 'list not found', status: 404 },
        });
        mockCallEdgeFn.mockRejectedValueOnce(notFoundErr);
        const missing = renderHook(() => useGuestList('l-private'), { wrapper: wrapper(client) });
        await waitFor(() => expect(missing.result.current.data).toEqual({ data: null, isNotFound: true }));
        expect(missing.result.current.isError).toBe(false);

        mockCallEdgeFn.mockRejectedValueOnce(new Error('network down'));
        const broken = renderHook(() => useGuestList('l-broken'), { wrapper: wrapper(client) });
        await waitFor(() => expect(broken.result.current.isError).toBe(true));
    });
});
