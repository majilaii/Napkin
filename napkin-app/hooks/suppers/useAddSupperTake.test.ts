import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { mockEdgeFnRejects, mockEdgeFnResolves } from '@/__tests__/utils/mockEdgeFn';
import { callEdgeFn } from '@/lib/edgeInvoke';
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

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;

const VIEWER_USER_ID = 'viewer-user-id';
const SUPPER_ID = 'supper-1';
const RESTAURANT_ID = 'restaurant-1';

describe('useAddSupperTake', () => {
    it('forwards the complete approved photo list through the add-take action', async () => {
        mockEdgeFnResolves({
            id: 'entry-1',
            user_id: VIEWER_USER_ID,
            restaurant_id: RESTAURANT_ID,
            supper_id: SUPPER_ID,
            rating: 4.5,
        });
        const photoUrls = [
            'https://project.test/entry-photos/approved/viewer-user-id/a.jpg',
            'https://project.test/entry-photos/approved/viewer-user-id/b.jpg',
        ];
        const { result } = renderHookWithClient(() => useAddSupperTake());

        act(() => {
            result.current.mutate({
                supper_id: SUPPER_ID,
                rating: 4.5,
                content: 'Best dish of the night',
                dish_description: 'Rigatoni',
                visited_at: '2026-07-16T19:30:00.000Z',
                photo_urls: photoUrls,
                vibe_rating: 4,
                flavor_rating: 5,
                service_rating: 4.5,
                value_rating: 3.5,
                liked: true,
                client_nonce: 'nonce-supper-take-1',
            });
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockCallEdgeFn).toHaveBeenCalledTimes(1);
        expect(mockCallEdgeFn).toHaveBeenCalledWith('entry', {
            action: 'add-take',
            body: {
                supper_id: SUPPER_ID,
                rating: 4.5,
                content: 'Best dish of the night',
                dish_description: 'Rigatoni',
                visited_at: '2026-07-16T19:30:00.000Z',
                photo_urls: photoUrls,
                vibe_rating: 4,
                flavor_rating: 5,
                service_rating: 4.5,
                value_rating: 3.5,
                liked: true,
                client_nonce: 'nonce-supper-take-1',
            },
        });
    });

    it('invalidates profile, Spots, and Taste after creating the caller entry', async () => {
        mockEdgeFnResolves({
            id: 'entry-1',
            user_id: VIEWER_USER_ID,
            restaurant_id: RESTAURANT_ID,
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
        expect(invalidate).toHaveBeenCalledWith({
            queryKey: queryKeys.restaurants.page(RESTAURANT_ID),
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
