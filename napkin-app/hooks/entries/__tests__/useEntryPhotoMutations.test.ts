import { act, waitFor } from '@testing-library/react-native';

import { renderHookWithClient } from '@/__tests__/utils/queryWrapper';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { compressAndUpload } from '@/lib/imageUpload';
import { queryKeys } from '@/lib/queryKeys';
import {
    appendModeratedEntryPhoto,
    entryPhotosKey,
    useRemoveEntryPhoto,
} from '../useEntryPhotoMutations';

jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/lib/imageUpload', () => ({ compressAndUpload: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'user-1' } }),
}));

const mockCallEdgeFn = callEdgeFn as jest.MockedFunction<typeof callEdgeFn>;
const mockCompressAndUpload = compressAndUpload as jest.MockedFunction<typeof compressAndUpload>;

describe('entry photo writer routing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('stages first, then appends through the transactional entry writer', async () => {
        mockCompressAndUpload.mockResolvedValue('https://cdn.test/approved.jpg');
        mockCallEdgeFn.mockResolvedValue({
            id: 'photo-1',
            photo_url: 'https://cdn.test/approved.jpg',
            sort_order: 0,
            hero_url: 'https://cdn.test/approved.jpg',
        });

        await expect(
            appendModeratedEntryPhoto('entry-1', 'file:///meal.jpg', 'user-1'),
        ).resolves.toEqual({
            publicUrl: 'https://cdn.test/approved.jpg',
            sortOrder: 0,
            heroUrl: 'https://cdn.test/approved.jpg',
        });
        expect(mockCompressAndUpload).toHaveBeenCalledWith('file:///meal.jpg', 'user-1');
        expect(mockCallEdgeFn).toHaveBeenCalledWith('entry', {
            action: 'append_entry_photo',
            body: {
                entry_id: 'entry-1',
                photo_url: 'https://cdn.test/approved.jpg',
            },
        });
    });

    it('removes through the writer and reconciles the server-selected hero', async () => {
        mockCallEdgeFn.mockResolvedValue({
            deleted: true,
            entry_id: 'entry-1',
            hero_url: 'https://cdn.test/next.jpg',
        });
        const { result, client } = renderHookWithClient(() => useRemoveEntryPhoto('entry-1'));
        client.setQueryData(entryPhotosKey('entry-1'), [
            { id: 'photo-1', photo_url: 'https://cdn.test/old.jpg' },
            { id: 'photo-2', photo_url: 'https://cdn.test/next.jpg' },
        ]);
        client.setQueryData(queryKeys.entries.detail('entry-1'), {
            id: 'entry-1',
            photo_url: 'https://cdn.test/old.jpg',
        });

        act(() => result.current.mutate({
            photoId: 'photo-1',
            photoUrl: 'https://cdn.test/old.jpg',
            isHero: true,
        }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(mockCallEdgeFn).toHaveBeenCalledWith('entry', {
            action: 'delete_entry_photo',
            body: { photo_id: 'photo-1' },
        });
        expect(client.getQueryData(queryKeys.entries.detail('entry-1'))).toMatchObject({
            photo_url: 'https://cdn.test/next.jpg',
        });
    });

    it('rolls the optimistic photo removal back when the writer fails', async () => {
        mockCallEdgeFn.mockRejectedValue(new Error('failed'));
        const { result, client } = renderHookWithClient(() => useRemoveEntryPhoto('entry-1'));
        const original = [{ id: 'photo-1', photo_url: 'https://cdn.test/old.jpg' }];
        client.setQueryData(entryPhotosKey('entry-1'), original);

        act(() => result.current.mutate({
            photoId: 'photo-1',
            photoUrl: 'https://cdn.test/old.jpg',
            isHero: true,
        }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(client.getQueryData(entryPhotosKey('entry-1'))).toEqual(original);
    });
});
