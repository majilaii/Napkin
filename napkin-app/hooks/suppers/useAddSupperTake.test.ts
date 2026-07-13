import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { mockEdgeFnRejects, mockEdgeFnResolves } from '@/__tests__/utils/mockEdgeFn';
import { queryKeys } from '@/lib/queryKeys';
import { useAddSupperTake } from './useAddSupperTake';

jest.mock('@/providers/AuthProvider', () => ({
    useAuth: jest.fn(() => ({
        user: { id: 'viewer-user-id' },
        session: null,
        isLoading: false,
        signOut: jest.fn(),
    })),
    AuthProvider: ({ children }: any) => children,
}));
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));

const VIEWER_USER_ID = 'viewer-user-id';
const SUPPER_ID = 'supper-1';

describe('useAddSupperTake', () => {
    it('invalidates profile, Spots, and Taste after creating the caller entry', async () => {
        mockEdgeFnResolves({
            id: 'entry-1',
            user_id: VIEWER_USER_ID,
            supper_id: SUPPER_ID,
            rating: 4.5,
        });
        const { result, client } = renderHookWithClient(() => useAddSupperTake());
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        act(() => {
            result.current.mutate({ supper_id: SUPPER_ID, rating: 4.5 });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.users.profile(VIEWER_USER_ID),
        });
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.users.spots(VIEWER_USER_ID),
        });
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.users.taste(VIEWER_USER_ID),
        });
    });

    it('does not invalidate entry-derived aggregates when creation fails', async () => {
        mockEdgeFnRejects({ message: 'failed to add take' });
        const { result, client } = renderHookWithClient(() => useAddSupperTake());
        const invalidate = jest.spyOn(client, 'invalidateQueries');

        act(() => {
            result.current.mutate({ supper_id: SUPPER_ID, rating: 4.5 });
        });
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(invalidate).not.toHaveBeenCalledWith({
            queryKey: queryKeys.users.profile(VIEWER_USER_ID),
        });
        expect(invalidate).not.toHaveBeenCalledWith({
            queryKey: queryKeys.users.spots(VIEWER_USER_ID),
        });
        expect(invalidate).not.toHaveBeenCalledWith({
            queryKey: queryKeys.users.taste(VIEWER_USER_ID),
        });
    });
});
