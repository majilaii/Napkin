import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { callEdgeFn } from '@/lib/edgeInvoke';
import { useCreateImport } from '../useCreateImport';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

function wrapper(client: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
        return React.createElement(QueryClientProvider, { client }, children);
    };
}

it('a screenshot import states the consent this build asked for (server refuses model work without it)', async () => {
    mockCallEdgeFn.mockResolvedValue({ job_id: 'job-1', wishlist_id: null, share_ids: [], status: 'pending' });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { result } = renderHook(() => useCreateImport('user-1'), { wrapper: wrapper(client) });
    await act(async () => {
        await result.current.mutateAsync({
            image_path: 'user-1/shot.jpg',
            destinations: { wishlist: true, table_ids: [] },
        });
    });
    expect(mockCallEdgeFn).toHaveBeenCalledWith('table-shares', {
        action: 'create_import',
        body: {
            image_path: 'user-1/shot.jpg',
            destinations: { wishlist: true, table_ids: [] },
            ai_consent_version: 'import-v2:anthropic',
        },
    });
});
