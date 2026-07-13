/* eslint-disable import/first, @typescript-eslint/no-require-imports */
jest.mock('@/lib/edgeInvoke', () => ({ callEdgeFn: jest.fn() }));
jest.mock('@/lib/supabase', () => require('@/__mocks__/supabase'));

import { act, waitFor } from '@testing-library/react-native';
import { callEdgeFn } from '@/lib/edgeInvoke';
import { queryKeys } from '@/lib/queryKeys';
import { renderHookWithClient } from '../../__tests__/utils/queryWrapper';
import { mockEdgeFnRejects, mockEdgeFnResolves } from '../../__tests__/utils/mockEdgeFn';
import type { FetchResult } from './useList';
import { useSavedLists, type SavedList } from './useSavedLists';
import { useToggleListSave } from './useToggleListSave';

const USER_ID = 'viewer-1';
const LIST_ID = 'list-1';

function makeDetail(viewerHasSaved: boolean, saveCount: number): FetchResult {
    return {
        isNotFound: false,
        data: {
            list: {
                id: LIST_ID,
                owner_id: 'author-1',
                title: 'Bakeries and Sandis',
                description: 'Bread worth crossing town for.',
                ranked: false,
                privacy: 'public',
                emoji: '🥐',
                table_id: null,
                created_at: '2026-07-01T12:00:00.000Z',
                updated_at: '2026-07-10T12:00:00.000Z',
            },
            entries: [],
            owner_profile: {
                display_name: 'Maya',
                avatar_url: 'https://example.com/maya.jpg',
                username: 'maya',
                account_privacy: 'public',
            },
            save_count: saveCount,
            viewer_has_saved: viewerHasSaved,
            can_save: true,
        },
    };
}

function makeSavedList(saveCount: number): SavedList {
    return {
        id: LIST_ID,
        owner_id: 'author-1',
        title: 'Bakeries and Sandis',
        description: 'Bread worth crossing town for.',
        ranked: false,
        privacy: 'public',
        emoji: '🥐',
        created_at: '2026-07-01T12:00:00.000Z',
        updated_at: '2026-07-10T12:00:00.000Z',
        saved_at: '2026-07-11T12:00:00.000Z',
        entry_count: 0,
        save_count: saveCount,
        cover_photo_url: null,
        owner_display_name: 'Maya',
        owner_avatar_url: 'https://example.com/maya.jpg',
        owner_username: 'maya',
    };
}

describe('useToggleListSave', () => {
    it('optimistically adds the authored list and reconciles the server count', async () => {
        mockEdgeFnResolves({ list_id: LIST_ID, saved: true, save_count: 7 });

        const { result, client } = renderHookWithClient(() => useToggleListSave(USER_ID));
        const detailKey = queryKeys.lists.detail(LIST_ID);
        const savedKey = queryKeys.lists.saved(USER_ID);
        client.setQueryData(detailKey, makeDetail(false, 5));
        client.setQueryData(savedKey, [] as SavedList[]);

        act(() => result.current.mutate({ list_id: LIST_ID, next_saved: true }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const detail = client.getQueryData<FetchResult>(detailKey);
        expect(detail?.data?.viewer_has_saved).toBe(true);
        expect(detail?.data?.save_count).toBe(7);

        const saved = client.getQueryData<SavedList[]>(savedKey);
        expect(saved).toHaveLength(1);
        expect(saved?.[0]).toMatchObject({
            id: LIST_ID,
            save_count: 7,
            owner_display_name: 'Maya',
            owner_username: 'maya',
        });
        expect(callEdgeFn).toHaveBeenCalledWith('lists', {
            action: 'save_list',
            body: { list_id: LIST_ID },
        });
    });

    it('keeps the optimistic decrement when privacy-safe unsave omits save_count', async () => {
        mockEdgeFnResolves({ list_id: LIST_ID, saved: false });

        const { result, client } = renderHookWithClient(() => useToggleListSave(USER_ID));
        const detailKey = queryKeys.lists.detail(LIST_ID);
        const savedKey = queryKeys.lists.saved(USER_ID);
        client.setQueryData(detailKey, makeDetail(true, 5));
        client.setQueryData(savedKey, [makeSavedList(5)]);

        act(() => result.current.mutate({ list_id: LIST_ID, next_saved: false }));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const detail = client.getQueryData<FetchResult>(detailKey);
        expect(detail?.data?.viewer_has_saved).toBe(false);
        expect(detail?.data?.save_count).toBe(4);
        expect(client.getQueryData<SavedList[]>(savedKey)).toEqual([]);
        expect(callEdgeFn).toHaveBeenCalledWith('lists', {
            action: 'unsave_list',
            body: { list_id: LIST_ID },
        });
    });

    it('restores both exact cache snapshots on failure', async () => {
        mockEdgeFnRejects({ code: 'SERVER_ERROR', message: 'Could not save list' });

        const { result, client } = renderHookWithClient(() => useToggleListSave(USER_ID));
        const detailKey = queryKeys.lists.detail(LIST_ID);
        const savedKey = queryKeys.lists.saved(USER_ID);
        const detailBefore = makeDetail(false, 5);
        const savedBefore = [makeSavedList(2)];
        client.setQueryData(detailKey, detailBefore);
        client.setQueryData(savedKey, savedBefore);

        act(() => result.current.mutate({ list_id: LIST_ID, next_saved: true }));
        await waitFor(() => expect(result.current.isError).toBe(true));

        expect(client.getQueryData(detailKey)).toEqual(detailBefore);
        expect(client.getQueryData(savedKey)).toEqual(savedBefore);
    });
});

describe('useSavedLists', () => {
    it('loads the caller collection through the saved_mine action', async () => {
        const serverRows = [makeSavedList(5)];
        mockEdgeFnResolves(serverRows);

        const { result } = renderHookWithClient(() => useSavedLists(USER_ID));
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        expect(result.current.data).toEqual(serverRows);
        expect(callEdgeFn).toHaveBeenCalledWith('lists', { action: 'saved_mine' });
    });

    it('does not request saved lists without an authenticated user id', () => {
        const { result } = renderHookWithClient(() => useSavedLists(null));

        expect(result.current.fetchStatus).toBe('idle');
        expect(callEdgeFn).not.toHaveBeenCalled();
    });
});
